import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
	LEASE_VERSION,
	RUN_RECORD_SCHEMA_VERSION,
	SPRINT_STATE_VERSION,
	type DoctorFinding,
	type DoctorReport,
	type DoctorSeverity,
	type LeaseOwnership,
	type RunKind,
	type RunLeaseHandle,
	type RunLeaseRecord,
	type RunRecordKind,
	type RunRecordSummary,
	type RunReservation,
} from "./types.ts";
import {
	assertSafeRelativePath,
	RunArtifactStore,
	sha256,
	SprintStateStore,
} from "./artifacts.ts";
import { doctorExecutionRecord } from "./execution-records.ts";

function code(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function entryStat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (code(error) === "ENOENT") return undefined;
		throw error;
	}
}

// ── Sprint-store root ─────────────────────────────────────────────────────

/** Canonical sprints store path. Validates it's a regular directory with no symlinks. */
export async function sprintsRoot(internalDevPath: string): Promise<string> {
	const base = resolve(internalDevPath, "sprints");
	const store = await entryStat(base);
	if (!store?.isDirectory() || store.isSymbolicLink()) {
		throw new Error("The .internal-dev/sprints store is not ready.");
	}
	return base;
}

/** Resolve a safe single-segment run id to its absolute run directory. */
export function resolveRunDirectory(storeRoot: string, runId: string): string {
	const id = assertSafeRelativePath(runId);
	if (id.includes("/")) throw new Error("A sprint run id must be one path segment.");
	const root = resolve(storeRoot);
	const selected = resolve(root, id);
	if (relative(root, selected) !== id || basename(selected) !== id) throw new Error("Run directory escapes the sprints store.");
	return selected;
}

/** Validate that `selected` is exactly one direct child of a safe sprints root. */
export async function assertValidRunDirectory(storeRoot: string, selected: string): Promise<void> {
	const root = resolve(storeRoot);
	const store = await entryStat(root);
	if (!store?.isDirectory() || store.isSymbolicLink()) throw new Error("The .internal-dev/sprints store is not ready.");
	const rel = relative(root, resolve(selected));
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.includes(sep)) {
		throw new Error("Run directory must be one direct child of the sprints store.");
	}
}

/** Exclusively reserve a direct-child run directory and retain its identity. */
export async function reserveSprintRun(internalDevPath: string, runId: string): Promise<RunReservation> {
	const root = await sprintsRoot(internalDevPath);
	const path = resolveRunDirectory(root, runId);
	try {
		await mkdir(path);
	} catch (error) {
		if (code(error) === "EEXIST") throw new Error(`Sprint run already exists: ${runId}`);
		throw error;
	}
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Sprint run reservation is not a regular directory.");
	return { path, device: String(entry.dev), inode: String(entry.ino) };
}

/** Confirmed-reset primitive. This is the only recursive run-record deletion path. */
export async function deleteSprintRunRecord(storeRoot: string, runId: string): Promise<void> {
	const selected = resolveRunDirectory(storeRoot, runId);
	await assertValidRunDirectory(storeRoot, selected);
	const entry = await entryStat(selected);
	if (!entry) return;
	if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Refusing to reset a sprint path that is not a regular directory.");
	await rm(selected, { recursive: true, force: false });
}

// ── Lease parsing ─────────────────────────────────────────────────────────

export function parseLeaseBytes(raw: string, path: string): RunLeaseRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Malformed lease at ${path}: not valid JSON.`);
	}
	if (!parsed || typeof parsed !== "object") throw new Error(`Malformed lease at ${path}: expected an object.`);
	const record = parsed as Partial<RunLeaseRecord>;
	if (record.version !== LEASE_VERSION) {
		throw new Error(`Unsupported lease version at ${path}: ${record.version}.`);
	}
	if (
		typeof record.runId !== "string" || !record.runId
		|| typeof record.runKind !== "string" || !["planning", "execution"].includes(record.runKind)
		|| typeof record.ownerId !== "string" || !record.ownerId
		|| !Number.isInteger(record.pid)
		|| typeof record.hostname !== "string" || !record.hostname
		|| typeof record.acquiredAt !== "string" || !record.acquiredAt
	) {
		throw new Error(`Malformed lease at ${path}: missing or invalid required fields.`);
	}
	return record as RunLeaseRecord;
}

// ── Lease file path ───────────────────────────────────────────────────────

export function leasePath(runDirectory: string): string {
	return resolve(runDirectory, ".lease.json");
}

// ── Lease acquisition ─────────────────────────────────────────────────────

/**
 * Exclusively create a `.lease.json` in the run directory.
 * Returns a handle with canonical path, expected bytes, digest, and identity.
 * On collision, parses the existing lease and throws a descriptive error with
 * the existing owner evidence.
 */
export async function acquireLease(
	runDirectory: string,
	runId: string,
	runKind: RunKind,
): Promise<RunLeaseHandle> {
	const leaseFile = leasePath(runDirectory);
	const ownerId = randomUUID();
	const record: RunLeaseRecord = {
		version: LEASE_VERSION,
		runId,
		runKind,
		ownerId,
		pid: process.pid,
		hostname: hostname(),
		acquiredAt: new Date().toISOString(),
	};
	const serialized = `${JSON.stringify(record, null, 2)}\n`;
	const digest = sha256(serialized);
	const byteCount = Buffer.byteLength(serialized);

	const safeRunId = assertSafeRelativePath(runId);
	if (safeRunId.includes("/") || basename(resolve(runDirectory)) !== safeRunId) throw new Error("Lease run id does not match its direct-child directory.");
	const runEntry = await entryStat(runDirectory);
	if (!runEntry?.isDirectory() || runEntry.isSymbolicLink()) throw new Error("Run directory is not a regular directory.");

	// Attempt exclusive file creation
	try {
		await writeFile(leaseFile, serialized, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if (code(error) === "EEXIST") {
			// Parse the existing lease to provide collision evidence
			let existingLease: RunLeaseRecord | undefined;
			try {
				const existingRaw = await readFile(leaseFile, "utf8");
				existingLease = parseLeaseBytes(existingRaw, leaseFile);
			} catch {
				// Lease exists but is unparseable — still a collision.
			}
			const existingOwner = existingLease
				? `${existingLease.runKind} lease (pid ${existingLease.pid} on ${existingLease.hostname}, acquired ${existingLease.acquiredAt})`
				: "unparseable lease file";
			throw new Error(
				`Lease already exists at ${leaseFile}. Existing owner: ${existingOwner}. ` +
				`Use /sprint doctor ${runId} to inspect.`,
			);
		}
		throw error;
	}

	// Verify our lease file is safe on disk
	const leaseEntry = await lstat(leaseFile);
	if (!leaseEntry.isFile() || leaseEntry.isSymbolicLink()) {
		throw new Error("Created lease is not a regular file.");
	}

	return {
		path: leaseFile,
		record,
		expectedBytes: byteCount,
		digest,
		byteCount,
		device: String(leaseEntry.dev),
		inode: String(leaseEntry.ino),
	};
}

// ── Lease release ─────────────────────────────────────────────────────────

/**
 * Release a previously acquired lease. Verifies identity and content match
 * before unlinking. Returns true on successful release, false if the lease
 * was already gone.
 * Throws on identity or content drift.
 */
export async function releaseLease(handle: RunLeaseHandle): Promise<boolean> {
	const current = await entryStat(handle.path);
	if (!current) throw new Error("Lease file disappeared before ownership-checked release.");

	if (!current.isFile() || current.isSymbolicLink()) {
		throw new Error("Lease path is no longer a regular file.");
	}
	if (String(current.dev) !== handle.device || String(current.ino) !== handle.inode) {
		throw new Error("Lease file identity changed (device/inode mismatch). Refusing to unlink.");
	}

	// Read and verify content
	let currentContent: string;
	let afterRead: Awaited<ReturnType<typeof lstat>>;
	try {
		currentContent = await readFile(handle.path, "utf8");
		afterRead = await lstat(handle.path);
	} catch (error) {
		throw new Error(`Lease could not be read during ownership-checked release: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (
		!afterRead.isFile() || afterRead.isSymbolicLink()
		|| String(afterRead.dev) !== handle.device
		|| String(afterRead.ino) !== handle.inode
	) {
		throw new Error("Lease file identity changed during read.");
	}

	const currentDigest = sha256(currentContent);
	const currentBytes = Buffer.byteLength(currentContent);
	if (currentDigest !== handle.digest || currentBytes !== handle.byteCount) {
		throw new Error("Lease file content changed (digest or byte count mismatch). Refusing to unlink.");
	}

	try {
		await unlink(handle.path);
		return true;
	} catch (error) {
		if (code(error) === "ENOENT") throw new Error("Lease disappeared during ownership-checked release.");
		throw error;
	}
}

// ── Lease inspection (read-only) ──────────────────────────────────────────

export interface LeaseInspection {
	ownership: LeaseOwnership;
	record?: RunLeaseRecord;
	error?: string;
	path: string;
}

/** Remove a reservation only while its retained directory identity still matches and it is empty. */
export async function removeEmptyReservation(reservation: RunReservation): Promise<void> {
	const entry = await entryStat(reservation.path);
	if (!entry?.isDirectory() || entry.isSymbolicLink()) return;
	if (String(entry.dev) !== reservation.device || String(entry.ino) !== reservation.inode) return;
	if ((await readdir(reservation.path)).length > 0) return;
	try {
		await rmdir(reservation.path);
	} catch (error) {
		if (code(error) !== "ENOENT" && code(error) !== "ENOTEMPTY") throw error;
	}
}

/**
 * Read-only inspection of a lease file.
 * Returns ownership classification and parsed record (if parseable).
 */
export async function inspectLease(
	runDirectory: string,
	retainedHandle?: RunLeaseHandle,
): Promise<LeaseInspection> {
	const leaseFile = leasePath(runDirectory);
	const entry = await entryStat(leaseFile);

	if (!entry) {
		return { ownership: "unleased", path: leaseFile };
	}

	if (entry.isSymbolicLink() || !entry.isFile()) {
		return { ownership: "uncertain", path: leaseFile, error: "Lease path is not a regular file." };
	}

	let record: RunLeaseRecord | undefined;
	let parseError: string | undefined;

	let raw: string | undefined;
	try {
		raw = await readFile(leaseFile, "utf8");
		const afterRead = await entryStat(leaseFile);
		if (!afterRead?.isFile() || afterRead.isSymbolicLink()
			|| String(afterRead.dev) !== String(entry.dev) || String(afterRead.ino) !== String(entry.ino)) {
			return { ownership: "uncertain", path: leaseFile, error: "Lease file changed identity during read." };
		}
		record = parseLeaseBytes(raw, leaseFile);
	} catch (error) {
		parseError = error instanceof Error ? error.message : String(error);
	}

	if (!record) {
		return { ownership: "uncertain", path: leaseFile, error: parseError };
	}

	if (record.runId !== basename(resolve(runDirectory))) {
		return { ownership: "uncertain", record, path: leaseFile, error: "Lease run id does not match its directory." };
	}

	// A retained handle proves ownership only when path, identity, exact bytes, and binding all match.
	if (retainedHandle && raw !== undefined) {
		const exactRecord = record.runId === retainedHandle.record.runId
			&& record.runKind === retainedHandle.record.runKind
			&& record.ownerId === retainedHandle.record.ownerId;
		if (resolve(retainedHandle.path) === resolve(leaseFile)
			&& String(entry.dev) === retainedHandle.device
			&& String(entry.ino) === retainedHandle.inode
			&& Buffer.byteLength(raw) === retainedHandle.byteCount
			&& sha256(raw) === retainedHandle.digest
			&& exactRecord) {
			return { ownership: "owned-by-this-runtime", record, path: leaseFile };
		}
	}

	// PID/host is evidence only, never proof.
	if (record.pid === process.pid && record.hostname === hostname()) {
		// Same PID + host — could be from a previous run of this process
		// but we can't prove it without the retained handle
		return { ownership: "uncertain", record, path: leaseFile, error: "Lease matches current PID and hostname but no retained handle proves ownership." };
	}

	return { ownership: "held-by-other", record, path: leaseFile };
}

// ── Run discovery and classification ──────────────────────────────────────

/**
 * Classify a run directory as planning, execution-only, ambiguous, malformed, or unknown.
 * Does NOT read .state.json content — only checks file presence.
 */
export async function classifyRun(runDirectory: string): Promise<RunRecordKind> {
	const entry = await entryStat(runDirectory);
	if (!entry?.isDirectory() || entry.isSymbolicLink()) return "malformed";

	let hasState = false;
	let hasManifest = false;
	let hasExecutionRecord = false;
	let hasOther = false;

	try {
		const names = await readdir(runDirectory);
		for (const name of names) {
			switch (name) {
				case ".state.json":
					hasState = true;
					break;
				case "manifest.md":
					hasManifest = true;
					break;
				case ".lease.json":
				case "input.md":
				case "planning":
				case "reviews":
				case "brainstorm":
				case "ironout":
				case ".sessions":
					// known planning artifacts — not ambiguous
					break;
				default: {
					// Check for execution/record.json or execution/ directory
					const child = await entryStat(resolve(runDirectory, name));
					if (name === "execution" && child?.isDirectory() && !child.isSymbolicLink()) {
						const recordEntry = await entryStat(resolve(runDirectory, "execution", "record.json"));
						if (recordEntry?.isFile() && !recordEntry.isSymbolicLink()) {
							hasExecutionRecord = true;
						}
					} else if (!name.startsWith(".")) {
						hasOther = true;
					}
					break;
				}
			}
		}
	} catch {
		return "malformed";
	}

	// Classification rules
	if (hasState && hasExecutionRecord) return "ambiguous";
	if (hasExecutionRecord) return "execution-only";
	if (hasState) return "planning";
	if (hasManifest && !hasState) {
		// Manifest without state could be a completed planning run
		// (phase 01 cleaned up .state.json)
		return "planning";
	}
	if (hasOther) return "unknown";
	return "malformed";
}

// ── Run discovery (list) ──────────────────────────────────────────────────

/**
 * Discover and classify all direct-child sprint run directories.
 * Enumerates only lstat-confirmed regular directories. Never recurses.
 */
function retainedFor(runDirectory: string, retained?: RunLeaseHandle | readonly RunLeaseHandle[]): RunLeaseHandle | undefined {
	const handles = retained ? (Array.isArray(retained) ? retained : [retained]) : [];
	return handles.find((handle) => resolve(handle.path) === resolve(leasePath(runDirectory)));
}

export async function discoverSprintRuns(
	sprintsRoot: string,
	retainedHandle?: RunLeaseHandle | readonly RunLeaseHandle[],
): Promise<RunRecordSummary[]> {
	const storeEntry = await entryStat(sprintsRoot);
	if (!storeEntry?.isDirectory() || storeEntry.isSymbolicLink()) {
		throw new Error("The .internal-dev/sprints store is not ready.");
	}

	let names: string[];
	try {
		names = await readdir(sprintsRoot);
	} catch {
		return [];
	}

	const results: RunRecordSummary[] = [];

	for (const name of names.sort()) {
		if (name.startsWith(".")) continue;
		let runDir: string;
		try {
			runDir = resolveRunDirectory(sprintsRoot, name);
		} catch {
			results.push({
				version: RUN_RECORD_SCHEMA_VERSION,
				runId: name,
				kind: "malformed",
				state: "unsafe-direct-child",
				leaseOwnership: "uncertain",
				markers: { state: false, manifest: false, execution: false },
			});
			continue;
		}
		const entry = await entryStat(runDir);
		if (!entry?.isDirectory() || entry.isSymbolicLink()) {
			results.push({
				version: RUN_RECORD_SCHEMA_VERSION,
				runId: name,
				kind: "malformed",
				state: "unsafe-direct-child",
				leaseOwnership: "uncertain",
				markers: { state: false, manifest: false, execution: false },
			});
			continue;
		}

		const kind = await classifyRun(runDir);
		const selectedHandle = retainedFor(runDir, retainedHandle);
		const lease = await inspectLease(runDir, selectedHandle);
		let stateSummary = "unknown";

		if (kind === "planning") {
			try {
				const stateEntry = await entryStat(resolve(runDir, ".state.json"));
				if (stateEntry?.isFile() && !stateEntry.isSymbolicLink()) {
					stateSummary = (await new SprintStateStore(runDir).load()).status;
				} else {
					// Has manifest but no state — likely completed and cleaned up
					const manifestEntry = await entryStat(resolve(runDir, "manifest.md"));
					stateSummary = manifestEntry?.isFile() && !manifestEntry.isSymbolicLink() ? "completed" : "unknown";
				}
			} catch {
				stateSummary = "malformed";
			}
		} else if (kind === "execution-only") {
			const diagnosis = await doctorExecutionRecord(runDir, name, selectedHandle);
			stateSummary = diagnosis.state;
		}

		const stateMarker = await entryStat(resolve(runDir, ".state.json"));
		const manifestMarker = await entryStat(resolve(runDir, "manifest.md"));
		const executionMarker = await entryStat(resolve(runDir, "execution", "record.json"));
		results.push({
			version: RUN_RECORD_SCHEMA_VERSION,
			runId: name,
			kind,
			state: stateSummary,
			leaseOwnership: lease.ownership,
			leaseRunKind: lease.record?.runKind,
			markers: {
				state: Boolean(stateMarker?.isFile() && !stateMarker.isSymbolicLink()),
				manifest: Boolean(manifestMarker?.isFile() && !manifestMarker.isSymbolicLink()),
				execution: Boolean(executionMarker?.isFile() && !executionMarker.isSymbolicLink()),
			},
		});
	}

	return results;
}

// ── Doctor ─────────────────────────────────────────────────────────────────

function finding(
	code: string,
	severity: DoctorSeverity,
	message: string,
	path?: string,
	action?: string,
): DoctorFinding {
	const finding: DoctorFinding = { code, severity, message };
	if (path !== undefined) finding.path = path;
	if (action !== undefined) finding.action = action;
	return finding;
}

/**
 * Run comprehensive read-only diagnosis on a sprint run directory.
 * Never writes, acquires, releases, or mutates.
 * Returns stable codes, severity, path-scoped evidence.
 */
export async function runDoctor(
	sprintsRoot: string,
	runDirectory: string,
	runId: string,
	retainedHandle?: RunLeaseHandle | readonly RunLeaseHandle[],
): Promise<DoctorReport> {
	const findings: DoctorFinding[] = [];
	const canonical = resolveRunDirectory(sprintsRoot, runId);
	await assertValidRunDirectory(sprintsRoot, canonical);
	if (resolve(runDirectory) !== canonical) throw new Error("Doctor run directory does not match the requested direct-child run id.");

	// 1. Validate the run directory itself
	const runEntry = await entryStat(canonical);
	if (!runEntry) {
		return {
			version: RUN_RECORD_SCHEMA_VERSION,
			runId,
			runKind: "unknown",
			findings: [finding("run-missing", "critical", `Sprint run directory does not exist: ${runId}`, runDirectory, "Check the run id or create a new sprint with /sprint.")],
			leaseOwnership: "unleased",
		};
	}

	if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) {
		return {
			version: RUN_RECORD_SCHEMA_VERSION,
			runId,
			runKind: "malformed",
			findings: [finding("run-not-directory", "critical", "Sprint run path is not a regular directory.", runDirectory, "Remove the path and create a new sprint with /sprint.")],
			leaseOwnership: "unleased",
		};
	}

	// 2. Classify
	const kind = await classifyRun(runDirectory);
	const stateMarker = await entryStat(resolve(runDirectory, ".state.json"));
	const manifestMarker = await entryStat(resolve(runDirectory, "manifest.md"));
	const executionDirectoryMarker = await entryStat(resolve(runDirectory, "execution"));
	const hasStateFile = Boolean(stateMarker?.isFile() && !stateMarker.isSymbolicLink());
	const hasManifest = Boolean(manifestMarker?.isFile() && !manifestMarker.isSymbolicLink());
	const hasExecutionDir = Boolean(executionDirectoryMarker?.isDirectory() && !executionDirectoryMarker.isSymbolicLink());
	if (stateMarker?.isSymbolicLink()) findings.push(finding("state-unsafe-marker", "critical", "State marker is a symbolic link.", resolve(runDirectory, ".state.json")));
	if (manifestMarker?.isSymbolicLink()) findings.push(finding("manifest-unsafe-marker", "critical", "Manifest marker is a symbolic link.", resolve(runDirectory, "manifest.md")));
	if (executionDirectoryMarker?.isSymbolicLink()) findings.push(finding("execution-unsafe-marker", "critical", "Execution marker is a symbolic link.", resolve(runDirectory, "execution")));

	const selectedHandle = retainedFor(runDirectory, retainedHandle);
	let lease: LeaseInspection;
	try {
		lease = await inspectLease(runDirectory, selectedHandle);
	} catch (error) {
		lease = { ownership: "uncertain", path: leasePath(runDirectory), error: error instanceof Error ? error.message : String(error) };
	}

	// 3. Lease inspection
	if (lease.ownership === "unleased") {
		findings.push(finding("lease-missing", "info", "No lease file present.", lease.path));
	} else if (lease.ownership === "owned-by-this-runtime") {
		const r = lease.record!;
		findings.push(finding("lease-owned", "info", `Lease held by this runtime: kind=${r.runKind}, acquired ${r.acquiredAt}.`, lease.path));
		if (r.runKind === "execution" && kind === "planning") {
			findings.push(finding("lease-kind-mismatch", "warning", `Lease claims execution but directory appears to be planning.`, lease.path));
		}
		if (r.runKind === "planning" && kind === "execution-only") {
			findings.push(finding("lease-kind-mismatch", "warning", `Lease claims planning but directory appears to be execution-only.`, lease.path));
		}
	} else if (lease.ownership === "held-by-other") {
		const r = lease.record!;
		findings.push(finding("lease-foreign", "warning", `Lease held by another owner: kind=${r.runKind}, pid=${r.pid} host=${r.hostname}, acquired ${r.acquiredAt}.`, lease.path, `If the owner is stale, use /sprint reset to delete.`));
		if ((r.runKind === "execution" && kind === "planning") || (r.runKind === "planning" && kind === "execution-only")) {
			findings.push(finding("lease-kind-mismatch", "warning", `Lease kind ${r.runKind} conflicts with record kind ${kind}.`, lease.path));
		}
	} else {
		findings.push(finding("lease-uncertain", "warning", `Lease ownership uncertain: ${lease.error ?? "unknown reason"}.`, lease.path, "Inspect manually or use /sprint reset to clear."));
	}

	// 4. Run-kind-specific diagnosis
	if (kind === "planning") {
		if (hasStateFile) {
			try {
				const strictState = await new SprintStateStore(runDirectory).load();
				const artifacts = new RunArtifactStore(runDirectory);
				for (const record of [strictState.inputArtifact, ...Object.values(strictState.steps).flatMap((step) => step.artifacts)]) {
					if (!(await artifacts.verify(record))) findings.push(finding("artifact-hash-drift", "error", `Artifact hash or byte count does not match state: ${record.path}.`, resolve(runDirectory, record.path), "Restore the recorded artifact or reset the affected checkpoint with /sprint resume."));
				}
				const planningMarker = await entryStat(resolve(runDirectory, "planning"));
				if (planningMarker) {
					if (!planningMarker.isDirectory() || planningMarker.isSymbolicLink()) {
						findings.push(finding("planning-unsafe", "critical", "Planning publication is not a regular directory.", resolve(runDirectory, "planning")));
					} else {
						const plan = await inspectPlanDirectory(resolve(runDirectory, "planning"), strictState.projectRoot);
						for (const issue of plan.findings) findings.push(finding(`plan-${issue.code}`, "error", issue.message, issue.path ? resolve(runDirectory, "planning", issue.path) : resolve(runDirectory, "planning"), "Use /sprint resume to revalidate and regenerate invalid planning components."));
					}
				}
			} catch (error) {
				findings.push(finding("state-schema-invalid", "error", `State fails strict schema or ownership validation: ${error instanceof Error ? error.message : String(error)}.`, resolve(runDirectory, ".state.json"), "Inspect the record and use /sprint reset if it cannot be resumed."));
			}
			try {
				const raw = await readFile(resolve(runDirectory, ".state.json"), "utf8");
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") {
					const state = parsed as Record<string, unknown>;
					if (state.version !== SPRINT_STATE_VERSION) {
						findings.push(finding("state-unsupported-version", "error", `State version ${state.version} is unsupported (expected ${SPRINT_STATE_VERSION}).`, resolve(runDirectory, ".state.json"), "This run was created by a different version of sprint-planner."));
					}
					if (typeof state.runId === "string" && state.runId !== runId) {
						findings.push(finding("state-runid-mismatch", "error", `State claims runId=${state.runId} but directory is ${runId}.`, resolve(runDirectory, ".state.json")));
					}
					if (typeof state.status === "string") {
						switch (state.status) {
							case "running":
								findings.push(finding("state-running", "warning", lease.ownership === "owned-by-this-runtime" ? "State reports running under this runtime's retained lease." : "State reports running without proof that this runtime owns the lease.", resolve(runDirectory, ".state.json"), "Use /sprint doctor to inspect ownership; explicitly resume only after resolving any retained lease."));
								break;
							case "interrupted":
								findings.push(finding("state-interrupted", "info", "State reports interrupted — a prior session was shut down while work was running.", resolve(runDirectory, ".state.json"), "Use /sprint resume to continue."));
								break;
							case "paused":
								findings.push(finding("state-paused", "info", "State reports paused.", resolve(runDirectory, ".state.json"), "Use /sprint resume to continue."));
								break;
							case "failed":
								findings.push(finding("state-failed", "error", `State reports failed: ${state.error ?? "no error recorded"}.`, resolve(runDirectory, ".state.json"), "Investigate the error and use /sprint resume or /sprint reset."));
								break;
							case "completed":
								findings.push(finding("state-completed", "info", "State reports completed.", resolve(runDirectory, ".state.json")));
								break;
							case "cancelled":
								findings.push(finding("state-cancelled", "info", "State reports cancelled.", resolve(runDirectory, ".state.json")));
								break;
						}
					}
					// Check embedded ownership
					if (typeof state.runDirectory === "string" && resolve(state.runDirectory) !== resolve(runDirectory)) {
						findings.push(finding("state-rundir-mismatch", "error", "State runDirectory does not match its directory.", resolve(runDirectory, ".state.json")));
					}
					if (typeof state.projectRoot === "string") {
						const projectRootEntry = await entryStat(state.projectRoot);
						if (!projectRootEntry?.isDirectory()) {
							findings.push(finding("state-projectroot-missing", "warning", "State projectRoot no longer exists on disk.", resolve(runDirectory, ".state.json")));
						}
					}
				}
			} catch (error) {
				findings.push(finding("state-malformed", "error", `State file is malformed: ${error instanceof Error ? error.message : String(error)}.`, resolve(runDirectory, ".state.json"), "Delete this run with /sprint reset."));
			}
		} else if (hasManifest) {
			findings.push(finding("planning-completed", "info", "Planning run is completed — manifest exists and runtime state was cleaned up.", resolve(runDirectory, "manifest.md")));
			// Check manifest content
			try {
				const manifestContent = await readFile(resolve(runDirectory, "manifest.md"), "utf8");
				const required = ["## Directive", "## Stages", "## Artifacts", "## Implementation Evidence", "## Final Validation", "## Outcome"];
				const missing = required.filter((heading) => !new RegExp(`^${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "m").test(manifestContent));
				if (missing.length) findings.push(finding("manifest-suspect", "warning", `Manifest is missing canonical headings: ${missing.join(", ")}.`, resolve(runDirectory, "manifest.md")));
			} catch {
				findings.push(finding("manifest-unreadable", "warning", "Manifest exists but cannot be read.", resolve(runDirectory, "manifest.md")));
			}
		} else {
			findings.push(finding("planning-nostate", "error", "Planning run is missing both state and manifest.", runDirectory, "Delete this run with /sprint reset."));
		}
	} else if (kind === "execution-only") {
		// Full phase-04 execution record diagnosis
		try {
			const execResult = await doctorExecutionRecord(runDirectory, runId, selectedHandle);
			for (const f of execResult.findings) findings.push(f);
			if (execResult.leaseOwnership === "owned-by-this-runtime") {
				findings.push(finding("execution-active-lease", "info", "Execution record lease is held by this runtime.", leasePath(runDirectory)));
			}
		} catch (error) {
			findings.push(finding("execution-doctor-error", "error", `Execution record diagnosis failed: ${error instanceof Error ? error.message : String(error)}`, resolve(runDirectory, "execution", "record.json")));
		}
	} else if (kind === "ambiguous") {
		findings.push(finding("run-ambiguous", "error", "Run directory contains both planning and execution markers.", runDirectory, "Delete with /sprint reset after verifying no active work depends on it."));
	} else if (kind === "malformed") {
		findings.push(finding("run-malformed", "error", "Run directory is malformed — missing expected structure.", runDirectory, "Delete with /sprint reset."));
	} else {
		findings.push(finding("run-unknown", "warning", "Run directory has unrecognized structure.", runDirectory));
	}

	// 5. Symlink safety check
	if (runEntry.isSymbolicLink()) {
		findings.push(finding("run-symlink", "critical", "Run path is a symbolic link.", runDirectory));
	}

	return {
		version: RUN_RECORD_SCHEMA_VERSION,
		runId,
		runKind: kind,
		findings,
		leaseOwnership: lease.ownership,
		executionBaseline: kind === "execution-only",
	};
}
