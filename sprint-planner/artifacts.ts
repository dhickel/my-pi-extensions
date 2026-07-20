import { createHash, randomUUID } from "node:crypto";
import fsPromises, { lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SPRINT_STATE_VERSION, type ArtifactRecord, type SprintState } from "./types.ts";

function code(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function stat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (code(error) === "ENOENT") return undefined;
		throw error;
	}
}

export function assertSafeRelativePath(path: string): string {
	const selected = path.trim();
	if (!selected || selected.includes("\0") || /[\u0000-\u001f\u007f]/.test(selected)) throw new Error("Path is blank or contains control characters.");
	if (isAbsolute(selected) || /^[a-zA-Z]:[\\/]/.test(selected) || /^[/\\]{2}/.test(selected)) {
		throw new Error("Path must be relative.");
	}
	const parts = selected.split(/[\\/]+/);
	if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Path contains an unsafe traversal segment.");
	return parts.join("/");
}

export function assertInside(base: string, candidate: string): void {
	const rel = relative(resolve(base), resolve(candidate));
	if (rel === "" || rel === ".") return;
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes ${base}.`);
}

export async function assertNoSymlinkSegments(base: string, target: string, includeTarget = true): Promise<void> {
	assertInside(base, target);
	const rel = relative(resolve(base), resolve(target));
	const segments = rel && rel !== "." ? rel.split(sep) : [];
	let current = resolve(base);
	for (let index = 0; index < segments.length - (includeTarget ? 0 : 1); index++) {
		current = resolve(current, segments[index]);
		const entry = await stat(current);
		if (!entry) break;
		if (entry.isSymbolicLink()) throw new Error(`Refusing to traverse symbolic link: ${current}`);
		if (index < segments.length - 1 && !entry.isDirectory()) throw new Error(`Expected directory: ${current}`);
	}
}

export function sha256(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

export async function atomicWriteFile(path: string, content: string): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const target = await stat(path);
	if (target?.isSymbolicLink()) throw new Error(`Refusing to replace symbolic link: ${path}`);
	if (target && !target.isFile()) throw new Error(`Refusing to replace non-file: ${path}`);
	const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
}

interface OwnedEntry {
	path: string;
	dev: string;
	ino: string;
	kind: "file" | "directory";
	sha256?: string;
	bytes?: number;
}

export interface OwnedFilePublication extends OwnedEntry {
	kind: "file";
	sha256: string;
	bytes: number;
}

export interface OwnedDirectoryPublication extends OwnedEntry {
	kind: "directory";
	entries: OwnedEntry[];
}

function ownership(path: string, entry: Awaited<ReturnType<typeof lstat>>, kind: "file" | "directory", content?: string): OwnedEntry {
	return {
		path,
		dev: String(entry.dev),
		ino: String(entry.ino),
		kind,
		...(content === undefined ? {} : { sha256: sha256(content), bytes: Buffer.byteLength(content) }),
	};
}

async function stillOwned(entry: OwnedEntry): Promise<boolean> {
	const current = await stat(entry.path);
	if (!current || current.isSymbolicLink() || String(current.dev) !== entry.dev || String(current.ino) !== entry.ino) return false;
	if (entry.kind === "directory") return current.isDirectory();
	if (!current.isFile()) return false;
	const content = await readFile(entry.path);
	const afterRead = await stat(entry.path);
	return Boolean(
		afterRead
		&& afterRead.isFile()
		&& !afterRead.isSymbolicLink()
		&& String(afterRead.dev) === entry.dev
		&& String(afterRead.ino) === entry.ino
		&& sha256(content) === entry.sha256
		&& content.byteLength === entry.bytes,
	);
}

/** Atomically create a new file and return the identity required for ownership-safe rollback. */
export async function atomicCreateOwnedFile(path: string, content: string): Promise<OwnedFilePublication> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const parent = await stat(directory);
	if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error("Publication parent is not a regular directory.");
	const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
		await fsPromises.link(temporary, path);
		const target = await lstat(path);
		return ownership(path, target, "file", content) as OwnedFilePublication;
	} catch (error) {
		if (code(error) === "EEXIST") throw new Error(`Publication target already exists: ${path}`);
		throw error;
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
}

/** Atomically publish a new file while refusing an existing target, including races. */
export async function atomicCreateFile(path: string, content: string): Promise<void> {
	await atomicCreateOwnedFile(path, content);
}

export async function removeOwnedFile(publication: OwnedFilePublication): Promise<boolean> {
	try {
		if (!(await stillOwned(publication))) return false;
		await unlink(publication.path);
		return true;
	} catch (error) {
		if (code(error) === "ENOENT") return true;
		return false;
	}
}

export class RunArtifactStore {
	readonly runDirectory: string;

	constructor(runDirectory: string) {
		this.runDirectory = resolve(runDirectory);
	}

	resolve(relativePath: string): string {
		const selected = assertSafeRelativePath(relativePath);
		const absolute = resolve(this.runDirectory, selected);
		assertInside(this.runDirectory, absolute);
		return absolute;
	}

	async #assertRoot(): Promise<void> {
		const root = await stat(this.runDirectory);
		if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error("Sprint run root is not a regular directory.");
	}

	async write(relativePath: string, content: string): Promise<ArtifactRecord> {
		await this.#assertRoot();
		const normalized = assertSafeRelativePath(relativePath);
		const path = this.resolve(normalized);
		await assertNoSymlinkSegments(this.runDirectory, dirname(path));
		await mkdir(dirname(path), { recursive: true });
		await assertNoSymlinkSegments(this.runDirectory, dirname(path));
		await atomicWriteFile(path, content.endsWith("\n") ? content : `${content}\n`);
		const final = content.endsWith("\n") ? content : `${content}\n`;
		return { path: normalized, sha256: sha256(final), bytes: Buffer.byteLength(final) };
	}

	async read(relativePath: string): Promise<string> {
		await this.#assertRoot();
		const path = this.resolve(relativePath);
		await assertNoSymlinkSegments(this.runDirectory, path);
		const entry = await stat(path);
		if (!entry?.isFile() || entry.isSymbolicLink()) throw new Error(`Required artifact is not a regular file: ${relativePath}`);
		return readFile(path, "utf8");
	}

	async exists(relativePath: string): Promise<boolean> {
		await this.#assertRoot();
		const path = this.resolve(relativePath);
		await assertNoSymlinkSegments(this.runDirectory, path);
		const entry = await stat(path);
		return Boolean(entry?.isFile() && !entry.isSymbolicLink());
	}

	async verify(record: ArtifactRecord): Promise<boolean> {
		try {
			const content = await this.read(record.path);
			return sha256(content) === record.sha256 && Buffer.byteLength(content) === record.bytes;
		} catch {
			return false;
		}
	}

	async removeRuntimeFiles(): Promise<void> {
		await this.#assertRoot();
		for (const relativePath of [".state.json", ".sessions"]) {
			const path = resolve(this.runDirectory, relativePath);
			assertInside(this.runDirectory, path);
			const entry = await stat(path);
			if (entry?.isSymbolicLink()) throw new Error(`Refusing to remove symbolic-link runtime path: ${path}`);
			await rm(path, { recursive: true, force: true });
		}
	}
}

export class SprintStateStore {
	readonly path: string;
	readonly runDirectory: string;
	#saveQueue = Promise.resolve();
	constructor(runDirectory: string) {
		this.runDirectory = runDirectory;
		this.path = resolve(runDirectory, ".state.json");
	}

	async save(state: SprintState): Promise<void> {
		if (state.version !== SPRINT_STATE_VERSION) throw new Error(`Unsupported sprint state version: ${state.version}`);
		const root = await stat(this.runDirectory);
		if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error("Sprint run root is not a regular directory.");
		await assertNoSymlinkSegments(resolve(this.runDirectory), dirname(this.path));
		const serialized = `${JSON.stringify(state, null, 2)}\n`;
		const write = this.#saveQueue.then(() => atomicWriteFile(this.path, serialized));
		this.#saveQueue = write.catch(() => undefined);
		await write;
	}

	async load(): Promise<SprintState> {
		const root = await stat(this.runDirectory);
		if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error("Sprint run root is not a regular directory.");
		await assertNoSymlinkSegments(resolve(this.runDirectory), this.path);
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(this.path, "utf8"));
		} catch (error) {
			throw new Error(`Malformed sprint state: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!parsed || typeof parsed !== "object") throw new Error("Malformed sprint state: expected an object.");
		const state = parsed as Partial<SprintState>;
		if (state.version !== SPRINT_STATE_VERSION || typeof state.runId !== "string" || typeof state.projectRoot !== "string" || typeof state.runDirectory !== "string" || !state.steps || typeof state.steps !== "object" || typeof state.status !== "string" || !state.inputArtifact) {
			throw new Error("Malformed sprint state: required fields are absent or unsupported.");
		}
		if (!["running", "paused", "interrupted", "failed", "completed", "cancelled"].includes(state.status) || !["brainstorm", "ironout", "planning", "complete"].includes(String(state.stage))) throw new Error("Malformed sprint state: invalid run status or stage.");
		if (!Number.isInteger(state.agents) || state.agents! < 2 || state.agents! > 8) throw new Error("Malformed sprint state: invalid brainstorm concurrency.");
		if (resolve(state.runDirectory) !== resolve(this.runDirectory)) throw new Error("Sprint state runDirectory does not match its directory.");
		const runId = assertSafeRelativePath(state.runId);
		if (runId.includes("/") || resolve(state.projectRoot, ".internal-dev", "sprints", runId) !== resolve(this.runDirectory)) {
			throw new Error("Sprint state projectRoot or runId does not match the selected run directory.");
		}
		assertSafeRelativePath(state.directivePath);
		if (state.inputArtifact.path !== state.directivePath || typeof state.inputArtifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(state.inputArtifact.sha256) || !Number.isInteger(state.inputArtifact.bytes) || state.inputArtifact.bytes < 0) throw new Error("Malformed sprint state: invalid input artifact record.");
		const sessionBase = resolve(this.runDirectory, ".sessions");
		for (const [stepId, step] of Object.entries(state.steps)) {
			if (!step || typeof step !== "object" || step.id !== stepId || !["pending", "running", "interrupted", "completed", "failed"].includes(String(step.status)) || !Number.isInteger(step.attempts) || step.attempts < 0 || !step.model || typeof step.model.provider !== "string" || typeof step.model.model !== "string" || typeof step.model.thinking !== "string" || !Array.isArray(step.artifacts)) throw new Error("Malformed sprint state: invalid step record.");
			for (const artifact of step.artifacts) {
				if (!artifact || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes < 0) throw new Error("Malformed sprint state: invalid artifact record.");
				const artifactPath = assertSafeRelativePath(artifact.path);
				if (artifactPath === ".state.json" || artifactPath.startsWith(".sessions/")) throw new Error("Sprint state references a private runtime path as an artifact.");
			}
			if (step.sessionPath) {
				const checkpoint = resolve(step.sessionPath);
				assertInside(sessionBase, checkpoint);
				if (checkpoint === sessionBase || !checkpoint.endsWith(".jsonl")) throw new Error("Sprint child-session checkpoint path is invalid.");
			}
		}
		return state as SprintState;
	}
}

export async function createSprintRun(internalDevPath: string, runId: string): Promise<string> {
	const id = assertSafeRelativePath(runId);
	if (id.includes("/")) throw new Error("A sprint run id must be one path segment.");
	const sprints = resolve(internalDevPath, "sprints");
	await assertNoSymlinkSegments(resolve(internalDevPath), sprints);
	const sprintStore = await stat(sprints);
	if (!sprintStore?.isDirectory() || sprintStore.isSymbolicLink()) throw new Error("The .internal-dev/sprints store is not ready.");
	const runDirectory = resolve(sprints, id);
	assertInside(sprints, runDirectory);
	if (await stat(runDirectory)) throw new Error(`Sprint run already exists: ${id}`);
	await mkdir(runDirectory);
	return runDirectory;
}

export function sprintRunDirectory(internalDevPath: string, runId: string): string {
	const id = assertSafeRelativePath(runId);
	if (id.includes("/")) throw new Error("A sprint run id must be one path segment.");
	const base = resolve(internalDevPath, "sprints");
	const selected = resolve(base, id);
	assertInside(base, selected);
	return selected;
}

/** Confirm before calling. This intentionally does not inspect or parse .state.json. */
export async function deleteSprintRun(internalDevPath: string, runId: string): Promise<void> {
	const selected = sprintRunDirectory(internalDevPath, runId);
	const entry = await stat(selected);
	if (!entry) return;
	if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Refusing to reset a sprint path that is not a regular directory.");
	await rm(selected, { recursive: true, force: false });
}

async function assertReservationOwned(root: OwnedEntry): Promise<void> {
	if (!(await stillOwned(root))) throw new Error(`Publication target reservation was replaced during materialization: ${root.path}`);
}

async function materializePublishedTree(source: string, target: string, publication: OwnedDirectoryPublication, root: OwnedEntry): Promise<void> {
	await assertReservationOwned(root);
	const entries = await readdir(source, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const sourcePath = resolve(source, entry.name);
		const targetPath = resolve(target, entry.name);
		await assertReservationOwned(root);
		if (entry.isDirectory()) {
			try {
				await mkdir(targetPath);
			} catch (error) {
				await assertReservationOwned(root);
				throw error;
			}
			let targetEntry: Awaited<ReturnType<typeof lstat>>;
			try {
				targetEntry = await lstat(targetPath);
			} catch (error) {
				await assertReservationOwned(root);
				throw error;
			}
			const created = ownership(targetPath, targetEntry, "directory");
			publication.entries.push(created);
			if (!(await stillOwned(created))) throw new Error(`Could not prove ownership of published directory: ${targetPath}`);
			await assertReservationOwned(root);
			await materializePublishedTree(sourcePath, targetPath, publication, root);
			continue;
		}
		if (!entry.isFile()) throw new Error(`Publication staging contains an unsupported entry: ${sourcePath}`);
		const content = await readFile(sourcePath, "utf8");
		const sourceEntry = await lstat(sourcePath);
		if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) throw new Error(`Publication staging file changed during materialization: ${sourcePath}`);
		await assertReservationOwned(root);
		try {
			await fsPromises.link(sourcePath, targetPath);
		} catch (error) {
			await assertReservationOwned(root);
			throw error;
		}
		let targetEntry: Awaited<ReturnType<typeof lstat>>;
		try {
			targetEntry = await lstat(targetPath);
		} catch (error) {
			await assertReservationOwned(root);
			throw error;
		}
		if (!targetEntry.isFile() || targetEntry.isSymbolicLink() || String(targetEntry.dev) !== String(sourceEntry.dev) || String(targetEntry.ino) !== String(sourceEntry.ino)) {
			throw new Error(`Could not prove ownership of published file: ${targetPath}`);
		}
		const created = ownership(targetPath, targetEntry, "file", content);
		publication.entries.push(created);
		if (!(await stillOwned(created))) throw new Error(`Could not prove ownership of published file: ${targetPath}`);
		await assertReservationOwned(root);
	}
}

async function assertPublicationOwned(publication: OwnedDirectoryPublication, root: OwnedEntry): Promise<void> {
	for (const entry of publication.entries) {
		if (!(await stillOwned(entry))) throw new Error(`Publication entry changed during materialization: ${entry.path}`);
	}
	await assertReservationOwned(root);
}

export async function removeOwnedDirectory(publication: OwnedDirectoryPublication): Promise<boolean> {
	let removed = true;
	for (const entry of [...publication.entries].reverse()) {
		try {
			if (!(await stillOwned(entry))) {
				removed = false;
				continue;
			}
			if (entry.kind === "file") await unlink(entry.path);
			else await rmdir(entry.path);
		} catch (error) {
			if (code(error) !== "ENOENT") removed = false;
		}
	}
	return removed;
}

/**
 * Publish through an exclusive target-directory reservation. Node/POSIX has no portable
 * no-replace directory rename, so the reserved target is populated from a complete staging
 * tree. This is collision-safe and ownership-safe, but not crash-atomic across the tree.
 */
export async function publishDirectoryExclusively(
	parent: string,
	name: string,
	files: readonly { path: string; content: string }[],
): Promise<OwnedDirectoryPublication> {
	const selectedName = assertSafeRelativePath(name);
	if (selectedName.includes("/")) throw new Error("Published directory name must be one path segment.");
	const selectedParent = resolve(parent);
	const parentEntry = await stat(selectedParent);
	if (!parentEntry?.isDirectory() || parentEntry.isSymbolicLink()) throw new Error("Publication parent is not a regular directory.");
	const target = resolve(selectedParent, selectedName);
	assertInside(selectedParent, target);
	const temporary = resolve(selectedParent, `.${selectedName}.${randomUUID()}.tmp`);
	await mkdir(temporary);
	let publication: OwnedDirectoryPublication | undefined;
	try {
		for (const file of files) {
			const rel = assertSafeRelativePath(file.path);
			const path = resolve(temporary, rel);
			assertInside(temporary, path);
			await assertNoSymlinkSegments(temporary, dirname(path));
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, file.content.endsWith("\n") ? file.content : `${file.content}\n`, { encoding: "utf8", flag: "wx" });
		}
		try {
			await mkdir(target);
		} catch (error) {
			if (code(error) === "EEXIST") throw new Error(`Publication target already exists: ${target}`);
			throw error;
		}
		const reserved = await lstat(target);
		if (!reserved.isDirectory() || reserved.isSymbolicLink()) throw new Error(`Publication target reservation is not a regular directory: ${target}`);
		const root = ownership(target, reserved, "directory");
		publication = { ...root, kind: "directory", entries: [root] };
		await assertReservationOwned(root);
		await materializePublishedTree(temporary, target, publication, root);
		await assertPublicationOwned(publication, root);
		return publication;
	} catch (error) {
		if (publication && !(await removeOwnedDirectory(publication))) {
			throw new Error(`${error instanceof Error ? error.message : String(error)} Rollback stopped because publication ownership could not be proven.`);
		}
		throw error;
	} finally {
		await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
	}
}

