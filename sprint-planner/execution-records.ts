import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rmdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	assertInside,
	assertSafeRelativePath,
	atomicCreateOwnedFile,
	atomicWriteFile,
	removeOwnedFile,
	sha256,
} from "./artifacts.ts";
import { inspectPlanDirectory, type PlanValidationResult } from "./validation.ts";
import {
	acquireLease,
	assertValidRunDirectory,
	inspectLease,
	leasePath,
	releaseLease,
	removeEmptyReservation,
	reserveSprintRun,
	resolveRunDirectory,
	sprintsRoot,
	type LeaseInspection,
} from "./run-records.ts";
import {
	EXECUTION_RECORD_VERSION,
	type ArtifactRecord,
	type ChangedFileObservation,
	type CheckpointAction,
	type DoctorFinding,
	type DoctorSeverity,
	type ExecutionRecord,
	type ExecutionRecordState,
	type FinishAction,
	type FrozenOrchestrationSnapshot,
	type LeaseOwnership,
	type ModelTuple,
	type PhaseEvidence,
	type RunLeaseHandle,
	type RunReservation,
	type SourceDescriptor,
} from "./types.ts";

const RECORD_RELATIVE_PATH = "execution/record.json";
const MANIFEST_FILENAME = "manifest.md";
const MAX_REPORT_BYTES = 100_000;
const MAX_CHANGED_PATHS = 500;
const IMPL_TUPLE: ModelTuple = { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" };
const VAL_TUPLE: ModelTuple = { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" };
const mutationQueues = new Map<string, Promise<void>>();

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function entryStat(path: string) {
	try { return await lstat(path); }
	catch (error) { if (errorCode(error) === "ENOENT") return undefined; throw error; }
}

function recordPath(runDirectory: string): string { return resolve(runDirectory, RECORD_RELATIVE_PATH); }
function manifestPath(runDirectory: string): string { return resolve(runDirectory, MANIFEST_FILENAME); }
function now(): string { return new Date().toISOString(); }
function nonEmpty(value: string, label: string): string {
	if (!value.trim()) throw new Error(`${label} must be non-empty.`);
	if (Buffer.byteLength(value) > MAX_REPORT_BYTES) throw new Error(`${label} exceeds ${MAX_REPORT_BYTES} bytes.`);
	return value;
}
function exactTuple(actual: ModelTuple, expected: ModelTuple): boolean {
	return actual.provider === expected.provider && actual.model === expected.model && actual.thinking === expected.thinking;
}
function validTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameSnapshot(left: SourceDescriptor, right: SourceDescriptor): boolean {
	return left.aggregateDigest === right.aggregateDigest
		&& left.files.length === right.files.length
		&& left.files.every((file, index) => {
			const other = right.files[index];
			return file.path === other?.path && file.sha256 === other.sha256 && file.bytes === other.bytes;
		});
}

async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
	const prior = mutationQueues.get(key) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
	const tail = prior.catch(() => undefined).then(() => gate);
	mutationQueues.set(key, tail);
	await prior.catch(() => undefined);
	try { return await operation(); }
	finally {
		release();
		if (mutationQueues.get(key) === tail) mutationQueues.delete(key);
	}
}

export async function observeChangedFile(projectRoot: string, relativePath: string): Promise<ChangedFileObservation> {
	const canonical = assertSafeRelativePath(relativePath);
	if (canonical !== relativePath) throw new Error(`Changed-file path must be canonical project-relative text: ${relativePath}`);
	const root = resolve(projectRoot);
	const selected = resolve(root, canonical);
	assertInside(root, selected);
	const segments = relative(root, selected).split(sep);
	let current = root;
	for (let index = 0; index < segments.length - 1; index++) {
		current = resolve(current, segments[index]);
		const entry = await entryStat(current);
		if (!entry?.isDirectory() || entry.isSymbolicLink()) throw new Error(`Changed-file ancestor is unsafe: ${canonical}`);
	}
	const before = await entryStat(selected);
	if (!before) return { path: canonical, status: "deleted" };
	if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Changed-file path is not a regular file: ${canonical}`);
	let handle;
	try {
		handle = await open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const opened = await handle.stat();
		if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`Changed-file identity changed during open: ${canonical}`);
		const bytes = await handle.readFile();
		const after = await handle.stat();
		if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.byteLength || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
			throw new Error(`Changed-file changed while being read: ${canonical}`);
		}
		return { path: canonical, status: "present", digest: sha256(bytes), bytes: bytes.byteLength };
	} finally { await handle?.close(); }
}

interface SnapshotResult {
	descriptor: SourceDescriptor;
	contents: Map<string, string>;
}

async function readPlanSnapshot(planDirectory: string, projectRoot: string, sourcePlanningRunId?: string): Promise<SnapshotResult> {
	const names = (await readdir(planDirectory)).sort();
	const files: ArtifactRecord[] = [];
	const contents = new Map<string, string>();
	for (const name of names) {
		const safe = assertSafeRelativePath(name);
		if (safe.includes("/")) throw new Error(`Source plan entry is not flat: ${name}`);
		const selected = resolve(planDirectory, safe);
		const before = await lstat(selected);
		if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Source plan entry is not a regular file: ${name}`);
		let handle;
		try {
			handle = await open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			const opened = await handle.stat();
			if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`Source plan entry changed during open: ${name}`);
			const bytes = await handle.readFile();
			const after = await handle.stat();
			if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.byteLength || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error(`Source plan entry changed during snapshot: ${name}`);
			files.push({ path: safe, sha256: sha256(bytes), bytes: bytes.byteLength });
			contents.set(safe, bytes.toString("utf8"));
		} finally { await handle?.close(); }
	}
	const sourcePlanPath = relative(resolve(projectRoot), resolve(planDirectory)).split(sep).join("/") || ".";
	const aggregateDigest = sha256(JSON.stringify(files.map((file) => [file.path, file.sha256, file.bytes])));
	return {
		descriptor: { projectRoot: resolve(projectRoot), sourcePlanPath, ...(sourcePlanningRunId ? { sourcePlanningRunId } : {}), aggregateDigest, files },
		contents,
	};
}

function detectedPlanningRunId(sourcePath: string): string | undefined {
	const match = sourcePath.match(/^\.internal-dev\/sprints\/([^/]+)\/planning$/);
	return match?.[1];
}

async function snapshotSourcePlan(planDirectory: string, projectRoot: string, suppliedPlanningRunId?: string): Promise<{ snapshot: SnapshotResult; validation: PlanValidationResult }> {
	const validation = await inspectPlanDirectory(planDirectory, projectRoot);
	if (!validation.valid) throw new Error(`Source plan is not valid:\n${validation.findings.map((finding) => `- [${finding.category}] ${finding.message}`).join("\n")}`);
	const relativePath = relative(resolve(projectRoot), resolve(planDirectory)).split(sep).join("/") || ".";
	const detected = detectedPlanningRunId(relativePath);
	if (suppliedPlanningRunId !== undefined) {
		const safeId = assertSafeRelativePath(suppliedPlanningRunId);
		if (safeId.includes("/") || safeId !== suppliedPlanningRunId || detected !== safeId) throw new Error("sourcePlanningRunId must exactly identify the source planning run's canonical planning directory.");
	}
	const first = await readPlanSnapshot(planDirectory, projectRoot, suppliedPlanningRunId ?? detected);
	const second = await readPlanSnapshot(planDirectory, projectRoot, suppliedPlanningRunId ?? detected);
	if (!sameSnapshot(first.descriptor, second.descriptor)) throw new Error("Source plan changed while its immutable descriptor was being established.");
	return { snapshot: second, validation };
}

function sectionLines(content: string, heading: string): string[] {
	const lines = content.split(/\r?\n/);
	const start = lines.findIndex((line) => line === `## ${heading}`);
	if (start < 0) throw new Error(`Validated orchestration is missing ## ${heading}.`);
	const endOffset = lines.slice(start + 1).findIndex((line) => /^##(?:\s|$)/.test(line));
	const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
	return lines.slice(start + 1, end).filter((line) => line.trim());
}

function freezeOrchestration(validation: PlanValidationResult, orchestration: string): FrozenOrchestrationSnapshot {
	const phases = [...validation.metadata.phasePaths];
	const dependencies: Record<string, string[]> = {};
	const goals: Record<string, string> = {};
	const targets: Record<string, string[]> = {};
	for (const line of sectionLines(orchestration, "Phase Ledger")) {
		const match = line.match(/^- (phase-\d{2}-[a-z0-9][a-z0-9-]*\.md) \| depends: (none|[^|]+) \| targets: ([^|]+) \| goal: (\S.*)$/);
		if (!match || !phases.includes(match[1])) throw new Error(`Cannot freeze malformed phase ledger entry: ${line}`);
		dependencies[match[1]] = match[2] === "none" ? [] : match[2].split(", ");
		targets[match[1]] = match[3].split(", ").map(assertSafeRelativePath);
		goals[match[1]] = match[4];
	}
	const waves: Record<string, number> = {};
	for (const [index, line] of sectionLines(orchestration, "Execution Waves").entries()) {
		const match = line.match(/^- wave-(\d{2}): (.+)$/);
		if (!match || Number(match[1]) !== index + 1) throw new Error(`Cannot freeze malformed execution wave: ${line}`);
		for (const phase of match[2].split(", ")) waves[phase] = index + 1;
	}
	if (![dependencies, goals, targets, waves].every((map) => phases.every((phase) => Object.hasOwn(map, phase)))) throw new Error("Validated orchestration metadata could not be frozen completely.");
	return {
		scopeSize: validation.metadata.scopeSize!, phases, dependencies, waves, goals, targets,
		implementationModel: { ...IMPL_TUPLE }, validationModel: { ...VAL_TUPLE },
	};
}

async function allocateExecId(internalDevPath: string, name?: string): Promise<string> {
	const root = await sprintsRoot(internalDevPath);
	const slug = name?.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "record";
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const id = `exec-${slug}${suffix === 1 ? "" : `-${suffix}`}`;
		if (!(await entryStat(resolveRunDirectory(root, id)))) return id;
	}
	throw new Error("Could not allocate a unique execution record id.");
}

function parseObservation(value: unknown): ChangedFileObservation {
	if (!value || typeof value !== "object") throw new Error("Malformed changed-file observation.");
	const observation = value as Partial<ChangedFileObservation>;
	const path = assertSafeRelativePath(String(observation.path ?? ""));
	if (path !== observation.path || !["present", "deleted"].includes(String(observation.status))) throw new Error("Malformed changed-file observation.");
	if (observation.status === "present") {
		if (!/^[0-9a-f]{64}$/.test(String(observation.digest)) || !Number.isInteger(observation.bytes) || observation.bytes! < 0) throw new Error("Malformed present changed-file observation.");
	} else if (observation.digest !== undefined || observation.bytes !== undefined) throw new Error("Deleted changed-file observations cannot contain digest authority.");
	return observation as ChangedFileObservation;
}

function parseEvidence(value: unknown, expected: ModelTuple, validator = false) {
	if (!value || typeof value !== "object") throw new Error("Malformed execution evidence.");
	const evidence = value as Record<string, unknown>;
	if (!evidence.agentModel || !exactTuple(evidence.agentModel as ModelTuple, expected)) throw new Error("Execution evidence model tuple drifted from the frozen contract.");
	nonEmpty(String(evidence.report ?? ""), "Evidence report");
	if (!validTimestamp(evidence.timestamp) || !Array.isArray(evidence.changedFiles) || !Array.isArray(evidence.changedFileObservations)) throw new Error("Malformed execution evidence.");
	const observations = evidence.changedFileObservations.map(parseObservation);
	if (!sameStringSet(evidence.changedFiles as string[], observations.map((item) => item.path))) throw new Error("Changed-file index does not match authoritative observations.");
	if (validator && !["PASS", "BLOCKED"].includes(String(evidence.verdict))) throw new Error("Malformed validator verdict.");
	return evidence;
}

export function parseExecutionRecord(raw: string, _runDirectory: string, runId: string): ExecutionRecord {
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { throw new Error("Malformed execution record: not valid JSON."); }
	if (!parsed || typeof parsed !== "object") throw new Error("Malformed execution record: expected an object.");
	const record = parsed as Partial<ExecutionRecord>;
	if (record.version !== EXECUTION_RECORD_VERSION) throw new Error(`Unsupported execution record version: ${record.version}. Expected ${EXECUTION_RECORD_VERSION}.`);
	if (record.runId !== runId || !runId.startsWith("exec-") || basename(resolve(_runDirectory)) !== runId) throw new Error("Execution record runId does not match its exec direct-child id.");
	if (!["active", "completed", "blocked", "interrupted"].includes(String(record.state)) || !Number.isInteger(record.revision) || record.revision! < 0) throw new Error("Execution record has invalid state or revision.");
	if (!validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) throw new Error("Execution record timestamps are malformed.");
	const source = record.source;
	const validSourcePath = source?.sourcePlanPath === "." || (typeof source?.sourcePlanPath === "string" && assertSafeRelativePath(source.sourcePlanPath) === source.sourcePlanPath);
	if (!source || !isAbsolute(source.projectRoot) || !validSourcePath || !/^[0-9a-f]{64}$/.test(source.aggregateDigest) || !Array.isArray(source.files)) throw new Error("Execution record has malformed source descriptor.");
	const sourcePaths = source.files.map((file) => {
		if (!file || assertSafeRelativePath(file.path) !== file.path || file.path.includes("/") || !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0) throw new Error("Execution record has malformed source file entry.");
		return file.path;
	});
	if (new Set(sourcePaths).size !== sourcePaths.length || !sameStringSet(sourcePaths, [...sourcePaths].sort())) throw new Error("Execution source file set must be unique and sorted.");
	if (source.aggregateDigest !== sha256(JSON.stringify(source.files.map((file) => [file.path, file.sha256, file.bytes])))) throw new Error("Execution source aggregate digest does not match its immutable entries.");
	if (source.sourcePlanningRunId !== undefined) {
		const planningId = assertSafeRelativePath(source.sourcePlanningRunId);
		if (planningId !== source.sourcePlanningRunId || planningId.includes("/") || detectedPlanningRunId(source.sourcePlanPath) !== planningId) throw new Error("Execution source planning-run identity is malformed.");
	}
	const frozen = record.frozen;
	if (!frozen || !Array.isArray(frozen.phases) || !exactTuple(frozen.implementationModel, IMPL_TUPLE) || !exactTuple(frozen.validationModel, VAL_TUPLE)) throw new Error("Execution record has malformed frozen orchestration.");
	if (new Set(frozen.phases).size !== frozen.phases.length || frozen.phases.length === 0) throw new Error("Frozen phase ledger is invalid.");
	for (const map of [frozen.dependencies, frozen.targets, frozen.goals, frozen.waves]) {
		if (!map || !sameStringSet(Object.keys(map), frozen.phases)) throw new Error("Frozen orchestration maps must contain exactly the phase ledger in order.");
	}
	for (const phase of frozen.phases) {
		if (assertSafeRelativePath(phase) !== phase || !Array.isArray(frozen.dependencies[phase]) || !Array.isArray(frozen.targets[phase]) || !frozen.goals[phase]?.trim() || !Number.isInteger(frozen.waves[phase]) || frozen.waves[phase] < 1) throw new Error("Frozen phase metadata is incomplete.");
		if (new Set(frozen.dependencies[phase]).size !== frozen.dependencies[phase].length || new Set(frozen.targets[phase]).size !== frozen.targets[phase].length) throw new Error("Frozen phase metadata contains duplicates.");
		for (const target of frozen.targets[phase]) if (assertSafeRelativePath(target) !== target) throw new Error("Frozen write target is not canonical.");
		for (const dependency of frozen.dependencies[phase]) if (!frozen.phases.includes(dependency) || frozen.waves[dependency] >= frozen.waves[phase]) throw new Error("Frozen dependency or wave ordering is impossible.");
	}
	const waveNumbers = [...new Set(Object.values(frozen.waves))].sort((left, right) => left - right);
	if (waveNumbers.some((wave, index) => wave !== index + 1)) throw new Error("Frozen execution waves are not contiguous.");
	if (!Array.isArray(record.phases) || !sameStringSet(record.phases.map((phase) => phase.phase), frozen.phases)) throw new Error("Execution phase evidence does not match the frozen ledger.");
	let transitions = 0;
	for (const phase of record.phases) {
		if (phase.implementation) { parseEvidence(phase.implementation, IMPL_TUPLE); transitions++; }
		if (phase.validator) {
			if (!phase.implementation) throw new Error("Validator evidence precedes implementation evidence.");
			parseEvidence(phase.validator, VAL_TUPLE, true); transitions++;
		}
	}
	if (record.integration) { parseEvidence(record.integration, VAL_TUPLE, true); transitions++; if (!record.phases.every((phase) => phase.validator?.verdict === "PASS")) throw new Error("Integration evidence precedes all phase PASS evidence."); }
	const blockedVerdict = record.phases.some((phase) => phase.validator?.verdict === "BLOCKED") || record.integration?.verdict === "BLOCKED";
	if (blockedVerdict && !record.blocker) throw new Error("BLOCKED validation evidence requires blocker evidence.");
	if (record.state === "active" && record.blocker && !blockedVerdict) throw new Error("Active blocker evidence requires a validator BLOCKED verdict.");
	if (record.blocker && blockedVerdict) {
		const blockedAt = Date.parse(record.blocker.timestamp);
		const laterCheckpoint = record.phases.some((phase) => [phase.implementation, phase.validator].some((evidence) => evidence && Date.parse(evidence.timestamp) > blockedAt))
			|| Boolean(record.integration && Date.parse(record.integration.timestamp) > blockedAt);
		if (laterCheckpoint) throw new Error("Checkpoint evidence exists after a BLOCKED verdict.");
	}
	if (record.blocker) { nonEmpty(record.blocker.reason, "Blocker reason"); if (!validTimestamp(record.blocker.timestamp) || !Array.isArray(record.blocker.changedFileObservations)) throw new Error("Malformed blocker evidence."); record.blocker.changedFileObservations.map(parseObservation); }
	if (record.interrupted) { nonEmpty(record.interrupted.reason, "Interruption reason"); if (!validTimestamp(record.interrupted.timestamp) || !Array.isArray(record.interrupted.changedFileObservations)) throw new Error("Malformed interruption evidence."); record.interrupted.changedFileObservations.map(parseObservation); }
	if (record.sourceDrift && (!validTimestamp(record.sourceDrift.observedAt) || !record.sourceDrift.reason.trim())) throw new Error("Malformed source-drift evidence.");
	if (record.state === "active") {
		if (record.completedAt || record.completion || record.interrupted || record.terminalAt) throw new Error("Active record contains terminal evidence.");
	} else {
		transitions++;
		if (!validTimestamp(record.terminalAt) || record.terminalAt !== record.updatedAt) throw new Error("Terminal record must persist its terminal timestamp with the terminal revision.");
		if (record.state === "completed") {
			if (!record.completedAt || !record.completion || !validTimestamp(record.completedAt) || !validTimestamp(record.completion.timestamp) || !Array.isArray(record.completion.changedFileObservations) || record.blocker || record.interrupted || record.sourceDrift || record.integration?.verdict !== "PASS" || !record.phases.every((phase) => phase.validator?.verdict === "PASS")) throw new Error("Completed record has an impossible terminal combination.");
			nonEmpty(record.completion.report, "Completion report");
			record.completion.changedFileObservations.map(parseObservation);
		} else if (record.state === "blocked") {
			if (!record.blocker || record.completedAt || record.completion || record.interrupted) throw new Error("Blocked record has an impossible terminal combination.");
		} else if (!record.interrupted || record.completedAt || record.completion || record.blocker) throw new Error("Interrupted record has an impossible terminal combination.");
	}
	if (record.revision !== transitions) throw new Error(`Execution record revision ${record.revision} does not match its ${transitions} accepted transitions.`);
	return record as ExecutionRecord;
}

async function readRecord(runDirectory: string, runId: string): Promise<ExecutionRecord> {
	return parseExecutionRecord(await readFile(recordPath(runDirectory), "utf8"), runDirectory, runId);
}
async function writeRecord(runDirectory: string, record: ExecutionRecord): Promise<void> {
	await mkdir(dirname(recordPath(runDirectory)), { recursive: true });
	await atomicWriteFile(recordPath(runDirectory), `${JSON.stringify(record, null, 2)}\n`);
}

export function renderManifest(record: ExecutionRecord): string {
	const lines = [
		`# Execution Record ${record.runId}`, "", "## Directive", "",
		`Source plan \`${record.source.sourcePlanPath}\` is authoritative. Planning was performed externally${record.source.sourcePlanningRunId ? ` by sprint-planner run \`${record.source.sourcePlanningRunId}\`` : ""}; this record contains execution evidence only.`,
		"", "## Stages", "",
		...record.frozen.phases.map((phase) => {
			const evidence = record.phases.find((item) => item.phase === phase)!;
			return `- ${phase}: wave-${String(record.frozen.waves[phase]).padStart(2, "0")}, implementation ${evidence.implementation ? "recorded" : "not recorded"}, validator ${evidence.validator?.verdict ?? "not recorded"}`;
		}),
		"", "## Artifacts", "",
		...record.source.files.map((file) => `- \`${file.path}\` — sha256 \`${file.sha256}\`, ${file.bytes} bytes`),
		"", "## Implementation Evidence", "",
		...(record.phases.filter((phase) => phase.implementation).map((phase) => `- \`${phase.phase}\`: ${phase.implementation!.timestamp}, ${phase.implementation!.changedFileObservations.length} changed-file observation(s)`)),
		...(record.phases.some((phase) => phase.implementation) ? [] : ["No implementation evidence recorded."]),
		"", "## Final Validation", "",
		...record.phases.filter((phase) => phase.validator).map((phase) => `- \`${phase.phase}\`: ${phase.validator!.verdict} at ${phase.validator!.timestamp}`),
		...(record.integration ? [`- integration: ${record.integration.verdict} at ${record.integration.timestamp}`] : ["Integration validation not recorded."]),
		"", "## Outcome", "",
	];
	if (record.state === "completed") lines.push(`Completed at ${record.completedAt}.`);
	else if (record.state === "blocked") lines.push(`Blocked: ${record.blocker!.reason}`);
	else if (record.state === "interrupted") lines.push(`Interrupted: ${record.interrupted!.reason}`);
	else lines.push(`Active, revision ${record.revision}.`);
	lines.push("");
	return lines.join("\n");
}
async function writeManifest(runDirectory: string, record: ExecutionRecord): Promise<void> {
	await atomicWriteFile(manifestPath(runDirectory), renderManifest(record));
}
async function recordManifestAgree(runDirectory: string, runId: string): Promise<{ agree: boolean; record?: ExecutionRecord }> {
	try {
		const record = await readRecord(runDirectory, runId);
		return { agree: await readFile(manifestPath(runDirectory), "utf8").then((raw) => raw === renderManifest(record), () => false), record };
	} catch { return { agree: false }; }
}
async function reconcileManifest(handle: ExecutionRecordHandle, record: ExecutionRecord): Promise<void> {
	const inspection = await inspectLease(handle.runDirectory, handle.leaseHandle);
	if (inspection.ownership !== "owned-by-this-runtime" || inspection.record?.runKind !== "execution") throw new Error("Execution record lease is no longer owned by this runtime.");
	const expected = renderManifest(record);
	if (await readFile(manifestPath(handle.runDirectory), "utf8").then((raw) => raw === expected, () => false)) return;
	await atomicWriteFile(manifestPath(handle.runDirectory), expected);
}
async function persistTransition(handle: ExecutionRecordHandle, record: ExecutionRecord): Promise<void> {
	await writeManifest(handle.runDirectory, record);
	await writeRecord(handle.runDirectory, record);
	if (!(await recordManifestAgree(handle.runDirectory, handle.runId)).agree) throw new Error("Record/manifest agreement check failed after transition write.");
}

function allPhasesPassed(record: ExecutionRecord): boolean { return record.phases.every((phase) => phase.validator?.verdict === "PASS"); }
function phaseEvidence(record: ExecutionRecord, phase: string): PhaseEvidence {
	const evidence = record.phases.find((item) => item.phase === phase);
	if (!evidence) throw new Error(`Phase "${phase}" is not in the frozen orchestration.`);
	return evidence;
}
function pathAllowed(path: string, targets: readonly string[]): boolean {
	return targets.some((target) => path === target || path.startsWith(`${target}/`));
}
async function observeDeclaredPaths(record: ExecutionRecord, runId: string, changedPaths: readonly string[] | undefined, targets: readonly string[]): Promise<ChangedFileObservation[]> {
	if (!changedPaths) return [];
	if (changedPaths.length > MAX_CHANGED_PATHS || new Set(changedPaths).size !== changedPaths.length) throw new Error("Changed paths must be a unique bounded declared path set.");
	const observations: ChangedFileObservation[] = [];
	for (const raw of changedPaths) {
		const path = assertSafeRelativePath(raw);
		if (path !== raw) throw new Error(`Changed-file path must be canonical project-relative text: ${raw}`);
		if (record.source.sourcePlanPath === "." || path === record.source.sourcePlanPath || path.startsWith(`${record.source.sourcePlanPath}/`)) throw new Error(`Changed-file path must not be in the source plan directory: ${path}`);
		const executionRoot = `.internal-dev/sprints/${runId}`;
		if (path === executionRoot || path.startsWith(`${executionRoot}/`)) throw new Error(`Changed-file path must not be in the execution record directory: ${path}`);
		if (!pathAllowed(path, targets)) throw new Error(`Changed-file path is outside the declared write-target set: ${raw}`);
		observations.push(await observeChangedFile(record.source.projectRoot, path));
	}
	return observations;
}
async function sourceUnchanged(record: ExecutionRecord): Promise<boolean> {
	try {
		const sourceDir = resolve(record.source.projectRoot, record.source.sourcePlanPath);
		const current = await readPlanSnapshot(sourceDir, record.source.projectRoot, record.source.sourcePlanningRunId);
		return sameSnapshot(record.source, current.descriptor);
	} catch { return false; }
}

export interface ExecutionRecordHandle { runId: string; runDirectory: string; leaseHandle: RunLeaseHandle; }

async function cleanupFailedStart(
	reservation: RunReservation,
	leaseHandle?: RunLeaseHandle,
	ownedFiles: Awaited<ReturnType<typeof atomicCreateOwnedFile>>[] = [],
	executionIdentity?: { dev: string; ino: string },
): Promise<void> {
	if (leaseHandle) await releaseLease(leaseHandle).catch(() => undefined);
	for (const publication of [...ownedFiles].reverse()) await removeOwnedFile(publication);
	const execution = resolve(reservation.path, "execution");
	const executionEntry = await entryStat(execution);
	if (executionEntry?.isDirectory() && !executionEntry.isSymbolicLink()
		&& executionIdentity && String(executionEntry.dev) === executionIdentity.dev && String(executionEntry.ino) === executionIdentity.ino
		&& (await readdir(execution)).length === 0) await rmdir(execution).catch(() => undefined);
	await removeEmptyReservation(reservation);
}

export async function startExecutionRecord(
	internalDevPath: string,
	projectRoot: string,
	sourcePlanPath: string,
	sourcePlanningRunId?: string,
	name?: string,
	explicitRunId?: string,
): Promise<{ handle: ExecutionRecordHandle; revision: number }> {
	const root = resolve(projectRoot);
	const canonicalSource = sourcePlanPath === "." ? "." : assertSafeRelativePath(sourcePlanPath);
	if (canonicalSource !== sourcePlanPath) throw new Error("Source plan path must be canonical project-relative text.");
	const sourceDirectory = resolve(root, canonicalSource);
	assertInside(root, sourceDirectory);
	const { snapshot, validation } = await snapshotSourcePlan(sourceDirectory, root, sourcePlanningRunId);
	const runId = explicitRunId ?? await allocateExecId(internalDevPath, name);
	if (!/^exec-[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId) || runId.length > 128) throw new Error("Explicit execution run id must be a safe exec-... direct-child id.");
	const sprintRoot = await sprintsRoot(internalDevPath);
	const runDirectory = resolveRunDirectory(sprintRoot, runId);
	await assertValidRunDirectory(sprintRoot, runDirectory);
	if (resolve(sourceDirectory) === resolve(runDirectory) || resolve(sourceDirectory).startsWith(`${resolve(runDirectory)}${sep}`) || resolve(runDirectory).startsWith(`${resolve(sourceDirectory)}${sep}`)) throw new Error("Source and execution paths may not alias or have an ancestor relationship.");
	const reservation = await reserveSprintRun(internalDevPath, runId);
	let leaseHandle: RunLeaseHandle | undefined;
	const ownedFiles: Awaited<ReturnType<typeof atomicCreateOwnedFile>>[] = [];
	let executionIdentity: { dev: string; ino: string } | undefined;
	try {
		leaseHandle = await acquireLease(runDirectory, runId, "execution");
		const frozen = freezeOrchestration(validation, snapshot.contents.get("orchestration.md")!);
		const timestamp = now();
		const record: ExecutionRecord = {
			version: EXECUTION_RECORD_VERSION, runId, state: "active", revision: 0,
			source: snapshot.descriptor, frozen, phases: frozen.phases.map((phase) => ({ phase })),
			createdAt: timestamp, updatedAt: timestamp,
		};
		parseExecutionRecord(`${JSON.stringify(record)}\n`, runDirectory, runId);
		const executionDirectory = dirname(recordPath(runDirectory));
		await mkdir(executionDirectory);
		const executionEntry = await lstat(executionDirectory);
		executionIdentity = { dev: String(executionEntry.dev), ino: String(executionEntry.ino) };
		ownedFiles.push(await atomicCreateOwnedFile(recordPath(runDirectory), `${JSON.stringify(record, null, 2)}\n`));
		ownedFiles.push(await atomicCreateOwnedFile(manifestPath(runDirectory), renderManifest(record)));
		if (!(await recordManifestAgree(runDirectory, runId)).agree) throw new Error("Initial record and manifest do not agree.");
		return { handle: { runId, runDirectory, leaseHandle }, revision: 0 };
	} catch (error) {
		await cleanupFailedStart(reservation, leaseHandle, ownedFiles, executionIdentity);
		throw error;
	}
}

export async function checkpointExecutionRecord(
	handle: ExecutionRecordHandle,
	expectedRevision: number,
	type: CheckpointAction,
	phase: string | undefined,
	verdict: "PASS" | "BLOCKED" | undefined,
	report: string,
	changedPaths: string[] | undefined,
): Promise<number> {
	return serialized(handle.runDirectory, async () => {
		nonEmpty(report, "Checkpoint report");
		const lease: LeaseInspection = await inspectLease(handle.runDirectory, handle.leaseHandle);
		if (lease.ownership !== "owned-by-this-runtime" || lease.record?.runKind !== "execution") throw new Error("Execution record lease is no longer owned by this runtime.");
		const record = await readRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.revision !== expectedRevision) throw new Error(`Revision mismatch: expected ${expectedRevision}, current ${record.revision}. Stale checkpoint rejected.`);
		if (record.state !== "active") throw new Error(`Execution record is ${record.state}; accepts no further checkpoints.`);
		if (record.blocker) throw new Error("A BLOCKED verdict is already recorded; only finish: blocked may follow.");
		if (!(await sourceUnchanged(record))) throw new Error("Source plan drift detected; checkpoint rejected without changing the immutable descriptor.");
		const timestamp = now();
		if (type === "implementation") {
			if (!phase) throw new Error("Implementation checkpoint requires phase.");
			const evidence = phaseEvidence(record, phase);
			if (evidence.implementation) throw new Error(`Phase ${phase} already has implementation evidence.`);
			if (!(record.frozen.dependencies[phase] ?? []).every((dependency) => phaseEvidence(record, dependency).validator?.verdict === "PASS")) throw new Error(`Cannot implement ${phase}: not all dependencies have validator PASS.`);
			const observations = await observeDeclaredPaths(record, handle.runId, changedPaths, record.frozen.targets[phase]);
			evidence.implementation = { agentModel: { ...IMPL_TUPLE }, report, changedFiles: observations.map((item) => item.path), changedFileObservations: observations, timestamp };
		} else if (type === "phase_validation") {
			if (!phase) throw new Error("Phase validation checkpoint requires phase.");
			if (verdict !== "PASS" && verdict !== "BLOCKED") throw new Error("Phase validation requires verdict PASS or BLOCKED.");
			const evidence = phaseEvidence(record, phase);
			if (!evidence.implementation) throw new Error(`Phase ${phase} has no implementation evidence — validator checkpoint rejected.`);
			if (evidence.validator) throw new Error(`Phase ${phase} already has validator evidence.`);
			const observations = await observeDeclaredPaths(record, handle.runId, changedPaths, record.frozen.targets[phase]);
			evidence.validator = { agentModel: { ...VAL_TUPLE }, verdict, report, changedFiles: observations.map((item) => item.path), changedFileObservations: observations, timestamp };
			if (verdict === "BLOCKED") record.blocker = { reason: `Phase ${phase} validator returned BLOCKED: ${report}`, timestamp, changedFileObservations: [] };
		} else {
			if (verdict !== "PASS" && verdict !== "BLOCKED") throw new Error("Integration validation requires verdict PASS or BLOCKED.");
			if (!allPhasesPassed(record)) throw new Error("Integration validation requires every phase to have validator PASS.");
			if (record.integration) throw new Error("Integration evidence already recorded.");
			const targets = [...new Set(Object.values(record.frozen.targets).flat())];
			const observations = await observeDeclaredPaths(record, handle.runId, changedPaths, targets);
			record.integration = { agentModel: { ...VAL_TUPLE }, verdict, report, changedFiles: observations.map((item) => item.path), changedFileObservations: observations, timestamp };
			if (verdict === "BLOCKED") record.blocker = { reason: `Integration validator returned BLOCKED: ${report}`, timestamp, changedFileObservations: [] };
		}
		record.revision++;
		record.updatedAt = timestamp;
		parseExecutionRecord(`${JSON.stringify(record)}\n`, handle.runDirectory, handle.runId);
		await persistTransition(handle, record);
		return record.revision;
	});
}

export async function finishExecutionRecord(
	handle: ExecutionRecordHandle,
	expectedRevision: number,
	type: FinishAction,
	reason: string,
	changedPaths?: string[],
): Promise<number> {
	return serialized(handle.runDirectory, async () => {
		nonEmpty(reason, "Finish report");
		const lease = await inspectLease(handle.runDirectory, handle.leaseHandle);
		if (lease.ownership !== "owned-by-this-runtime" || lease.record?.runKind !== "execution") throw new Error("Execution record lease is no longer owned by this runtime.");
		const record = await readRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.revision !== expectedRevision) throw new Error(`Revision mismatch: expected ${expectedRevision}, current ${record.revision}. Stale finish rejected.`);
		if (record.state !== "active") throw new Error(`Execution record is already ${record.state}.`);
		if (record.blocker && type !== "blocked") throw new Error("A BLOCKED verdict permits only finish: blocked.");
		const timestamp = now();
		const unchanged = await sourceUnchanged(record);
		const observations = await observeDeclaredPaths(record, handle.runId, changedPaths, [...new Set(Object.values(record.frozen.targets).flat())]);
		if (type === "completed") {
			if (!unchanged) throw new Error("Cannot finish completed: source plan bytes have changed since start.");
			if (!allPhasesPassed(record) || record.integration?.verdict !== "PASS") throw new Error("Cannot finish completed: every phase and integration validation must PASS.");
			record.state = "completed"; record.completedAt = timestamp; record.completion = { report: reason, timestamp, changedFileObservations: observations };
		} else if (type === "blocked") {
			record.state = "blocked";
			if (!record.blocker) record.blocker = { reason, timestamp, changedFileObservations: observations };
			else record.blocker.changedFileObservations = observations;
		} else {
			record.state = "interrupted"; record.interrupted = { reason, timestamp, changedFileObservations: observations };
		}
		if (!unchanged) record.sourceDrift = { observedAt: timestamp, reason: "Source entry set, type, or bytes differ from the immutable start descriptor." };
		record.terminalAt = timestamp;
		record.revision++; record.updatedAt = timestamp;
		parseExecutionRecord(`${JSON.stringify(record)}\n`, handle.runDirectory, handle.runId);
		await persistTransition(handle, record);
		await releaseLease(handle.leaseHandle);
		return record.revision;
	});
}

export async function repairManifest(handle: ExecutionRecordHandle): Promise<boolean> {
	return serialized(handle.runDirectory, async () => {
		const record = await readRecord(handle.runDirectory, handle.runId);
		const before = (await recordManifestAgree(handle.runDirectory, handle.runId)).agree;
		await reconcileManifest(handle, record);
		return !before;
	});
}

function finding(code: string, severity: DoctorSeverity, message: string, path?: string): DoctorFinding {
	return { code, severity, message, ...(path ? { path } : {}) };
}
export interface ExecutionDoctorResult {
	record?: ExecutionRecord;
	findings: DoctorFinding[];
	leaseOwnership: LeaseOwnership;
	manifestMismatch: boolean;
	state: "valid" | "malformed" | "unsupported" | "active" | "blocked" | "interrupted" | "completed" | "unknown";
}
export async function doctorExecutionRecord(runDirectory: string, runId: string, retainedHandle?: RunLeaseHandle): Promise<ExecutionDoctorResult> {
	const findings: DoctorFinding[] = [];
	let leaseOwnership: LeaseOwnership = "uncertain";
	try {
		const lease = await inspectLease(runDirectory, retainedHandle);
		leaseOwnership = lease.ownership;
		if (lease.ownership === "held-by-other") findings.push(finding("exec-lease-foreign", "warning", "Execution lease is held by another owner.", lease.path));
		if (lease.ownership === "uncertain") findings.push(finding("exec-lease-uncertain", "warning", lease.error ?? "Execution lease ownership is uncertain.", lease.path));
		if (lease.record && lease.record.runKind !== "execution") findings.push(finding("exec-lease-kind", "error", "Execution record has a non-execution lease.", lease.path));
	} catch (error) { findings.push(finding("exec-lease-inspect-fail", "error", String(error), leasePath(runDirectory))); }
	let record: ExecutionRecord;
	try { record = await readRecord(runDirectory, runId); }
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const unsupported = message.includes("Unsupported execution record version");
		findings.push(finding(unsupported ? "exec-version-unsupported" : "exec-record-malformed", "error", message, recordPath(runDirectory)));
		return { findings, leaseOwnership, manifestMismatch: false, state: unsupported ? "unsupported" : "malformed" };
	}
	const expected = renderManifest(record);
	const manifestMismatch = await readFile(manifestPath(runDirectory), "utf8").then((raw) => raw !== expected, () => true);
	if (manifestMismatch) findings.push(finding("exec-manifest-mismatch", "warning", "Manifest does not match the authoritative record.", manifestPath(runDirectory)));
	if (record.state === "active" && !(await sourceUnchanged(record))) findings.push(finding("exec-source-drift", "warning", "Source plan differs from the immutable descriptor.", record.source.sourcePlanPath));
	if (record.state === "active") findings.push(finding("exec-active-progress", "info", `Active at revision ${record.revision}; ${record.phases.filter((phase) => phase.validator?.verdict === "PASS").length}/${record.phases.length} phases PASS.`, recordPath(runDirectory)));
	if (record.state === "completed") findings.push(finding("exec-completed", "info", `Execution completed at ${record.completedAt}.`, recordPath(runDirectory)));
	if (record.state === "blocked") findings.push(finding("exec-blocked", "warning", record.blocker!.reason, recordPath(runDirectory)));
	if (record.state === "interrupted") findings.push(finding("exec-interrupted", "info", record.interrupted!.reason, recordPath(runDirectory)));
	return { record, findings, leaseOwnership, manifestMismatch, state: record.state };
}

export async function loadExecutionRecord(runDirectory: string, runId: string): Promise<ExecutionRecord | undefined> {
	try { return await readRecord(runDirectory, runId); } catch { return undefined; }
}

export async function interruptActiveRecord(handle: ExecutionRecordHandle, reason: string): Promise<boolean> {
	return serialized(handle.runDirectory, async () => {
		nonEmpty(reason, "Interruption reason");
		const lease = await inspectLease(handle.runDirectory, handle.leaseHandle);
		if (lease.ownership !== "owned-by-this-runtime" || lease.record?.runKind !== "execution") return false;
		const record = await readRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.state !== "active") return false;
		const timestamp = now();
		if (record.blocker) {
			record.state = "blocked";
			record.blocker.changedFileObservations = [];
		} else {
			record.state = "interrupted";
			record.interrupted = { reason, timestamp, changedFileObservations: [] };
		}
		if (!(await sourceUnchanged(record))) record.sourceDrift = { observedAt: timestamp, reason: "Source entry set, type, or bytes differ from the immutable start descriptor." };
		record.terminalAt = timestamp;
		record.revision++; record.updatedAt = timestamp;
		parseExecutionRecord(`${JSON.stringify(record)}\n`, handle.runDirectory, handle.runId);
		await persistTransition(handle, record);
		await releaseLease(handle.leaseHandle);
		return true;
	});
}
