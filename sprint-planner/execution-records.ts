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
	LEGACY_EXECUTION_RECORD_VERSION,
	type ArtifactRecord,
	type ChangedFileObservation,
	type CheckpointAction,
	type CheckpointResult,
	type CheckpointWarning,
	type DoctorFinding,
	type DoctorSeverity,
	type ExecutionEvidence,
	type ExecutionRecord,
	type ExecutionRecordState,
	type FinishAction,
	type FrozenOrchestrationSnapshot,
	type LeaseOwnership,
	type ModelTuple,
	type PhaseEvidence,
	type PhaseExecutionStatus,
	type ReadableExecutionRecord,
	type ReadOnlyExecutionRecordV1,
	type RunLeaseHandle,
	type RunReservation,
	type SourceDescriptor,
	type SourceIdentity,
	type ValidationEvidence,
} from "./types.ts";

const RECORD_RELATIVE_PATH = "execution/record.json";
const MANIFEST_FILENAME = "manifest.md";
const MAX_REPORT_BYTES = 100_000;
const MAX_CHANGED_PATHS = 500;
const IMPL_TUPLE: ModelTuple = { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" };
const VAL_TUPLE: ModelTuple = { provider: "openai-codex", model: "gpt-5.6-terra", thinking: "high" };
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

const SOURCE_PROVENANCE_ERROR = "sourcePlanningRunId must be the exact <id> from .internal-dev/plans/<id> or .internal-dev/sprints/<id>/planning; omit it for other source layouts.";

/** Shared source-layout and provenance validation used by start and record parsing. */
export function sourceIdentity(sourcePath: string, suppliedPlanningRunId?: string): SourceIdentity {
	const standalone = sourcePath.match(/^\.internal-dev\/plans\/([^/]+)$/);
	const sprint = sourcePath.match(/^\.internal-dev\/sprints\/([^/]+)\/planning$/);
	const identity: SourceIdentity = standalone
		? { layout: "standalone-plan", planningRunId: standalone[1] }
		: sprint
			? { layout: "sprint-planning", planningRunId: sprint[1] }
			: { layout: "other" };
	if (suppliedPlanningRunId === undefined) return identity;
	let safeId: string;
	try { safeId = assertSafeRelativePath(suppliedPlanningRunId); }
	catch { throw new Error(SOURCE_PROVENANCE_ERROR); }
	if (safeId.includes("/") || safeId !== suppliedPlanningRunId || identity.planningRunId !== safeId) throw new Error(SOURCE_PROVENANCE_ERROR);
	return identity;
}

async function snapshotSourcePlan(planDirectory: string, projectRoot: string, suppliedPlanningRunId?: string): Promise<{ snapshot: SnapshotResult; validation: PlanValidationResult }> {
	const validation = await inspectPlanDirectory(planDirectory, projectRoot);
	if (!validation.valid) throw new Error(`Source plan is not valid:\n${validation.findings.map((finding) => `- [${finding.category}] ${finding.message}`).join("\n")}`);
	const relativePath = relative(resolve(projectRoot), resolve(planDirectory)).split(sep).join("/") || ".";
	const identity = sourceIdentity(relativePath, suppliedPlanningRunId);
	const planningRunId = suppliedPlanningRunId ?? identity.planningRunId;
	const first = await readPlanSnapshot(planDirectory, projectRoot, planningRunId);
	const second = await readPlanSnapshot(planDirectory, projectRoot, planningRunId);
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
	const waveAssignments: Record<string, number> = {};
	for (const [index, line] of sectionLines(orchestration, "Execution Waves").entries()) {
		const match = line.match(/^- wave-(\d{2}): (.+)$/);
		if (!match || Number(match[1]) !== index + 1) throw new Error(`Cannot freeze malformed execution wave: ${line}`);
		for (const phase of match[2].split(", ")) waveAssignments[phase] = index + 1;
	}
	if (![dependencies, goals, targets, waveAssignments].every((map) => phases.every((phase) => Object.hasOwn(map, phase)))) throw new Error("Validated orchestration metadata could not be frozen completely.");
	const waves = Object.fromEntries(phases.map((phase) => [phase, waveAssignments[phase]]));
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

function parseOutsideDeclaredTargets(value: unknown, observations: readonly ChangedFileObservation[], legacy: boolean): string[] {
	if (legacy && value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("Malformed outside-declared-target evidence.");
	const paths = value.map((path) => {
		if (typeof path !== "string" || assertSafeRelativePath(path) !== path) throw new Error("Malformed outside-declared-target evidence.");
		return path;
	});
	if (new Set(paths).size !== paths.length || paths.some((path) => !observations.some((observation) => observation.path === path))) throw new Error("Outside-declared-target evidence must be a unique subset of changed-file observations.");
	return paths;
}

function parseEvidence(value: unknown, expected: ModelTuple, options: { validator?: boolean; attempt?: number; legacy?: boolean } = {}): ExecutionEvidence | ValidationEvidence {
	if (!value || typeof value !== "object") throw new Error("Malformed execution evidence.");
	const evidence = value as Record<string, unknown>;
	if (!evidence.agentModel || !exactTuple(evidence.agentModel as ModelTuple, expected)) throw new Error("Execution evidence model tuple drifted from the frozen contract.");
	const report = nonEmpty(String(evidence.report ?? ""), "Evidence report");
	if (!validTimestamp(evidence.timestamp) || !Array.isArray(evidence.changedFiles) || !Array.isArray(evidence.changedFileObservations)) throw new Error("Malformed execution evidence.");
	const observations = evidence.changedFileObservations.map(parseObservation);
	if (!sameStringSet(evidence.changedFiles as string[], observations.map((item) => item.path))) throw new Error("Changed-file index does not match authoritative observations.");
	const outsideDeclaredTargets = parseOutsideDeclaredTargets(evidence.outsideDeclaredTargets, observations, options.legacy === true);
	const normalized: ExecutionEvidence = {
		agentModel: { ...(evidence.agentModel as ModelTuple) }, report,
		changedFiles: [...evidence.changedFiles as string[]], changedFileObservations: observations,
		outsideDeclaredTargets, timestamp: evidence.timestamp as string,
	};
	if (!options.validator) return normalized;
	if (!["PASS", "BLOCKED"].includes(String(evidence.verdict))) throw new Error("Malformed validator verdict.");
	const attempt = options.attempt ?? Number(evidence.attempt);
	if (!Number.isInteger(attempt) || attempt < 1 || (!options.legacy && evidence.attempt !== attempt)) throw new Error("Malformed validator attempt number.");
	return { ...normalized, attempt, verdict: evidence.verdict as "PASS" | "BLOCKED" };
}

function parseTerminalEvidence(value: unknown, label: string, legacy: boolean): { reason: string; timestamp: string; changedFileObservations: ChangedFileObservation[]; outsideDeclaredTargets: string[] } {
	if (!value || typeof value !== "object") throw new Error(`Malformed ${label.toLowerCase()} evidence.`);
	const evidence = value as Record<string, unknown>;
	const reason = nonEmpty(String(evidence.reason ?? ""), `${label} reason`);
	if (!validTimestamp(evidence.timestamp) || !Array.isArray(evidence.changedFileObservations)) throw new Error(`Malformed ${label.toLowerCase()} evidence.`);
	const observations = evidence.changedFileObservations.map(parseObservation);
	return { reason, timestamp: evidence.timestamp as string, changedFileObservations: observations, outsideDeclaredTargets: parseOutsideDeclaredTargets(evidence.outsideDeclaredTargets, observations, legacy) };
}

function parseCompletionEvidence(value: unknown, legacy: boolean) {
	if (!value || typeof value !== "object") throw new Error("Malformed completion evidence.");
	const evidence = value as Record<string, unknown>;
	const report = nonEmpty(String(evidence.report ?? ""), "Completion report");
	if (!validTimestamp(evidence.timestamp) || !Array.isArray(evidence.changedFileObservations)) throw new Error("Malformed completion evidence.");
	const observations = evidence.changedFileObservations.map(parseObservation);
	return { report, timestamp: evidence.timestamp as string, changedFileObservations: observations, outsideDeclaredTargets: parseOutsideDeclaredTargets(evidence.outsideDeclaredTargets, observations, legacy) };
}

function parseCommonRecord(record: Record<string, unknown>, runDirectory: string, runId: string): { source: SourceDescriptor; frozen: FrozenOrchestrationSnapshot; state: ExecutionRecordState; revision: number; createdAt: string; updatedAt: string } {
	if (record.runId !== runId || !runId.startsWith("exec-") || basename(resolve(runDirectory)) !== runId) throw new Error("Execution record runId does not match its exec direct-child id.");
	if (!["active", "completed", "blocked", "interrupted"].includes(String(record.state)) || !Number.isInteger(record.revision) || Number(record.revision) < 0) throw new Error("Execution record has invalid state or revision.");
	if (!validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) throw new Error("Execution record timestamps are malformed.");
	const source = record.source as SourceDescriptor | undefined;
	const validSourcePath = source?.sourcePlanPath === "." || (typeof source?.sourcePlanPath === "string" && assertSafeRelativePath(source.sourcePlanPath) === source.sourcePlanPath);
	if (!source || !isAbsolute(source.projectRoot) || !validSourcePath || !/^[0-9a-f]{64}$/.test(source.aggregateDigest) || !Array.isArray(source.files)) throw new Error("Execution record has malformed source descriptor.");
	const sourcePaths = source.files.map((file) => {
		if (!file || assertSafeRelativePath(file.path) !== file.path || file.path.includes("/") || !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0) throw new Error("Execution record has malformed source file entry.");
		return file.path;
	});
	if (new Set(sourcePaths).size !== sourcePaths.length || !sameStringSet(sourcePaths, [...sourcePaths].sort())) throw new Error("Execution source file set must be unique and sorted.");
	if (source.aggregateDigest !== sha256(JSON.stringify(source.files.map((file) => [file.path, file.sha256, file.bytes])))) throw new Error("Execution source aggregate digest does not match its immutable entries.");
	try { sourceIdentity(source.sourcePlanPath, source.sourcePlanningRunId); }
	catch { throw new Error("Execution source planning-run identity is malformed."); }
	const frozen = record.frozen as FrozenOrchestrationSnapshot | undefined;
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
	return { source, frozen, state: record.state as ExecutionRecordState, revision: record.revision as number, createdAt: record.createdAt as string, updatedAt: record.updatedAt as string };
}

export function latestValidation(phase: PhaseEvidence): ValidationEvidence | undefined {
	return phase.validations.at(-1);
}

export function phaseExecutionStatus(phase: PhaseEvidence): PhaseExecutionStatus {
	const latest = latestValidation(phase);
	if (latest?.verdict === "PASS") return "passed";
	if (latest?.verdict === "BLOCKED") return "blocked";
	return phase.implementation ? "implemented" : "pending";
}

function allPhasesPassed(record: ReadableExecutionRecord): boolean {
	return record.phases.every((phase) => latestValidation(phase)?.verdict === "PASS");
}

function latestIntegration(record: ReadableExecutionRecord): ValidationEvidence | undefined {
	return record.integrationValidations.at(-1);
}

function parseLegacyRecord(record: Record<string, unknown>, runDirectory: string, runId: string): ReadOnlyExecutionRecordV1 {
	const common = parseCommonRecord(record, runDirectory, runId);
	const legacyPhases = record.phases as Array<{ phase?: unknown; implementation?: unknown; validator?: unknown }> | undefined;
	if (!Array.isArray(legacyPhases) || !sameStringSet(legacyPhases.map((phase) => String(phase.phase)), common.frozen.phases)) throw new Error("Execution phase evidence does not match the frozen ledger.");
	let transitions = 0;
	const phases: PhaseEvidence[] = legacyPhases.map((phase) => {
		const implementation = phase.implementation ? parseEvidence(phase.implementation, IMPL_TUPLE, { legacy: true }) as ExecutionEvidence : undefined;
		if (implementation) transitions++;
		const validations: ValidationEvidence[] = [];
		if (phase.validator) {
			if (!implementation) throw new Error("Validator evidence precedes implementation evidence.");
			validations.push(parseEvidence(phase.validator, VAL_TUPLE, { validator: true, attempt: 1, legacy: true }) as ValidationEvidence);
			transitions++;
		}
		return { phase: String(phase.phase), ...(implementation ? { implementation } : {}), validations };
	});
	const integrationValidations: ValidationEvidence[] = [];
	if (record.integration) {
		integrationValidations.push(parseEvidence(record.integration, VAL_TUPLE, { validator: true, attempt: 1, legacy: true }) as ValidationEvidence);
		transitions++;
		if (!phases.every((phase) => latestValidation(phase)?.verdict === "PASS")) throw new Error("Integration evidence precedes all phase PASS evidence.");
	}
	const blockedVerdict = phases.some((phase) => latestValidation(phase)?.verdict === "BLOCKED") || integrationValidations.at(-1)?.verdict === "BLOCKED";
	const blocker = record.blocker ? parseTerminalEvidence(record.blocker, "Blocker", true) : undefined;
	if (blockedVerdict && !blocker) throw new Error("BLOCKED validation evidence requires blocker evidence.");
	if (common.state === "active" && blocker && !blockedVerdict) throw new Error("Active blocker evidence requires a validator BLOCKED verdict.");
	if (blocker && blockedVerdict) {
		const blockedAt = Date.parse(blocker.timestamp);
		const laterCheckpoint = phases.some((phase) => [phase.implementation, ...phase.validations].some((evidence) => evidence && Date.parse(evidence.timestamp) > blockedAt))
			|| integrationValidations.some((evidence) => Date.parse(evidence.timestamp) > blockedAt);
		if (laterCheckpoint) throw new Error("Checkpoint evidence exists after a BLOCKED verdict.");
	}
	const interrupted = record.interrupted ? parseTerminalEvidence(record.interrupted, "Interruption", true) : undefined;
	const completion = record.completion ? parseCompletionEvidence(record.completion, true) : undefined;
	const sourceDrift = record.sourceDrift as ReadOnlyExecutionRecordV1["sourceDrift"];
	if (sourceDrift && (!validTimestamp(sourceDrift.observedAt) || !sourceDrift.reason.trim())) throw new Error("Malformed source-drift evidence.");
	if (common.state === "active") {
		if (record.completedAt || completion || interrupted || record.terminalAt) throw new Error("Active record contains terminal evidence.");
	} else {
		transitions++;
		if (!validTimestamp(record.terminalAt) || record.terminalAt !== common.updatedAt) throw new Error("Terminal record must persist its terminal timestamp with the terminal revision.");
		if (common.state === "completed") {
			if (!validTimestamp(record.completedAt) || !completion || blocker || interrupted || sourceDrift || integrationValidations.at(-1)?.verdict !== "PASS" || !phases.every((phase) => latestValidation(phase)?.verdict === "PASS")) throw new Error("Completed record has an impossible terminal combination.");
		} else if (common.state === "blocked") {
			if (!blocker || record.completedAt || completion || interrupted) throw new Error("Blocked record has an impossible terminal combination.");
		} else if (!interrupted || record.completedAt || completion || blocker) throw new Error("Interrupted record has an impossible terminal combination.");
	}
	if (common.revision !== transitions) throw new Error(`Execution record revision ${common.revision} does not match its ${transitions} accepted transitions.`);
	return {
		version: LEGACY_EXECUTION_RECORD_VERSION, runId, state: common.state, revision: common.revision,
		source: common.source, frozen: common.frozen, phases, integrationValidations,
		...(blocker ? { blocker } : {}), ...(interrupted ? { interrupted } : {}), ...(completion ? { completion } : {}),
		...(sourceDrift ? { sourceDrift } : {}), ...(record.terminalAt ? { terminalAt: record.terminalAt as string } : {}),
		createdAt: common.createdAt, updatedAt: common.updatedAt,
		...(record.completedAt ? { completedAt: record.completedAt as string } : {}),
	};
}

function parseV2Record(record: Record<string, unknown>, runDirectory: string, runId: string): ExecutionRecord {
	const common = parseCommonRecord(record, runDirectory, runId);
	const rawPhases = record.phases as Array<{ phase?: unknown; implementation?: unknown; validations?: unknown }> | undefined;
	if (!Array.isArray(rawPhases) || !sameStringSet(rawPhases.map((phase) => String(phase.phase)), common.frozen.phases)) throw new Error("Execution phase evidence does not match the frozen ledger.");
	let transitions = 0;
	const phases: PhaseEvidence[] = rawPhases.map((phase) => {
		const implementation = phase.implementation ? parseEvidence(phase.implementation, IMPL_TUPLE) as ExecutionEvidence : undefined;
		if (implementation) transitions++;
		if (!Array.isArray(phase.validations)) throw new Error("Execution phase validation history is malformed.");
		if (phase.validations.length > 0 && !implementation) throw new Error("Validator evidence precedes implementation evidence.");
		const validations = phase.validations.map((validation, index) => parseEvidence(validation, VAL_TUPLE, { validator: true, attempt: index + 1 }) as ValidationEvidence);
		transitions += validations.length;
		return { phase: String(phase.phase), ...(implementation ? { implementation } : {}), validations };
	});
	if (!Array.isArray(record.integrationValidations)) throw new Error("Integration validation history is malformed.");
	const integrationValidations = record.integrationValidations.map((validation, index) => parseEvidence(validation, VAL_TUPLE, { validator: true, attempt: index + 1 }) as ValidationEvidence);
	transitions += integrationValidations.length;
	if (integrationValidations.length > 0 && !phases.every((phase) => latestValidation(phase)?.verdict === "PASS")) throw new Error("Integration evidence requires every phase's latest validation to PASS.");
	const firstIntegrationAt = integrationValidations[0] ? Date.parse(integrationValidations[0].timestamp) : undefined;
	if (firstIntegrationAt !== undefined && phases.some((phase) => phase.validations.some((validation) => Date.parse(validation.timestamp) > firstIntegrationAt))) throw new Error("Phase validation evidence cannot follow integration validation evidence.");
	const blocker = record.blocker ? parseTerminalEvidence(record.blocker, "Blocker", false) : undefined;
	const interrupted = record.interrupted ? parseTerminalEvidence(record.interrupted, "Interruption", false) : undefined;
	const completion = record.completion ? parseCompletionEvidence(record.completion, false) : undefined;
	const sourceDrift = record.sourceDrift as ExecutionRecord["sourceDrift"];
	if (sourceDrift && (!validTimestamp(sourceDrift.observedAt) || !sourceDrift.reason.trim())) throw new Error("Malformed source-drift evidence.");
	if (common.state === "active") {
		if (record.completedAt || completion || blocker || interrupted || record.terminalAt) throw new Error("Active record contains terminal evidence.");
	} else {
		transitions++;
		if (!validTimestamp(record.terminalAt) || record.terminalAt !== common.updatedAt) throw new Error("Terminal record must persist its terminal timestamp with the terminal revision.");
		if (common.state === "completed") {
			if (!validTimestamp(record.completedAt) || !completion || blocker || interrupted || sourceDrift || integrationValidations.at(-1)?.verdict !== "PASS" || !phases.every((phase) => latestValidation(phase)?.verdict === "PASS")) throw new Error("Completed record has an impossible terminal combination.");
		} else if (common.state === "blocked") {
			if (!blocker || record.completedAt || completion || interrupted) throw new Error("Blocked record has an impossible terminal combination.");
		} else if (!interrupted || record.completedAt || completion || blocker) throw new Error("Interrupted record has an impossible terminal combination.");
	}
	if (common.revision !== transitions) throw new Error(`Execution record revision ${common.revision} does not match its ${transitions} accepted transitions.`);
	return {
		version: EXECUTION_RECORD_VERSION, runId, state: common.state, revision: common.revision,
		source: common.source, frozen: common.frozen, phases, integrationValidations,
		...(blocker ? { blocker } : {}), ...(interrupted ? { interrupted } : {}), ...(completion ? { completion } : {}),
		...(sourceDrift ? { sourceDrift } : {}), ...(record.terminalAt ? { terminalAt: record.terminalAt as string } : {}),
		createdAt: common.createdAt, updatedAt: common.updatedAt,
		...(record.completedAt ? { completedAt: record.completedAt as string } : {}),
	};
}

export function parseExecutionRecord(raw: string, runDirectory: string, runId: string): ReadableExecutionRecord {
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { throw new Error("Malformed execution record: not valid JSON."); }
	if (!parsed || typeof parsed !== "object") throw new Error("Malformed execution record: expected an object.");
	const record = parsed as Record<string, unknown>;
	if (record.version === LEGACY_EXECUTION_RECORD_VERSION) return parseLegacyRecord(record, runDirectory, runId);
	if (record.version === EXECUTION_RECORD_VERSION) return parseV2Record(record, runDirectory, runId);
	throw new Error(`Unsupported execution record version: ${record.version}. Expected ${EXECUTION_RECORD_VERSION}, or read-only legacy version ${LEGACY_EXECUTION_RECORD_VERSION}.`);
}

async function readRecord(runDirectory: string, runId: string): Promise<ReadableExecutionRecord> {
	return parseExecutionRecord(await readFile(recordPath(runDirectory), "utf8"), runDirectory, runId);
}
async function readMutableRecord(runDirectory: string, runId: string): Promise<ExecutionRecord> {
	const record = await readRecord(runDirectory, runId);
	if (record.version !== EXECUTION_RECORD_VERSION) throw new Error(`Execution record version ${record.version} is read-only; start a version ${EXECUTION_RECORD_VERSION} record to append evidence.`);
	return record;
}
async function writeRecord(runDirectory: string, record: ExecutionRecord): Promise<void> {
	await mkdir(dirname(recordPath(runDirectory)), { recursive: true });
	await atomicWriteFile(recordPath(runDirectory), `${JSON.stringify(record, null, 2)}\n`);
}

export function renderManifest(record: ReadableExecutionRecord): string {
	const phaseValidations = record.phases.flatMap((phase) => phase.validations.map((validation) => `- \`${phase.phase}\` attempt ${validation.attempt}: ${validation.verdict} at ${validation.timestamp}`));
	const integrationValidations = record.integrationValidations.map((validation) => `- integration attempt ${validation.attempt}: ${validation.verdict} at ${validation.timestamp}`);
	const lines = [
		`# Execution Record ${record.runId}`, "", "## Directive", "",
		`Source plan \`${record.source.sourcePlanPath}\` is authoritative. Planning was performed externally${record.source.sourcePlanningRunId ? ` by sprint-planner run \`${record.source.sourcePlanningRunId}\`` : ""}; this version-${record.version} record contains execution evidence only.`,
		"", "## Stages", "",
		...record.frozen.phases.map((phase) => {
			const evidence = record.phases.find((item) => item.phase === phase)!;
			return `- ${phase}: wave-${String(record.frozen.waves[phase]).padStart(2, "0")}, implementation ${evidence.implementation ? "recorded" : "not recorded"}, validation ${phaseExecutionStatus(evidence)} (${evidence.validations.length} attempt(s))`;
		}),
		"", "## Artifacts", "",
		...record.source.files.map((file) => `- \`${file.path}\` — sha256 \`${file.sha256}\`, ${file.bytes} bytes`),
		"", "## Implementation Evidence", "",
		...(record.phases.filter((phase) => phase.implementation).map((phase) => `- \`${phase.phase}\`: ${phase.implementation!.timestamp}, ${phase.implementation!.changedFileObservations.length} changed-file observation(s), ${phase.implementation!.outsideDeclaredTargets.length} outside declared targets`)),
		...(record.phases.some((phase) => phase.implementation) ? [] : ["No implementation evidence recorded."]),
		"", "## Final Validation", "",
		...(phaseValidations.length ? phaseValidations : ["No phase validation recorded."]),
		...(integrationValidations.length ? integrationValidations : ["Integration validation not recorded."]),
		"", "## Outcome", "",
	];
	if (record.state === "completed") lines.push(`Completed at ${record.completedAt}.`);
	else if (record.state === "blocked") lines.push(`Blocked: ${record.blocker!.reason}`);
	else if (record.state === "interrupted") lines.push(`Interrupted: ${record.interrupted!.reason}`);
	else lines.push(`Active, revision ${record.revision}.`);
	lines.push("");
	return lines.join("\n");
}
async function writeManifest(runDirectory: string, record: ReadableExecutionRecord): Promise<void> {
	await atomicWriteFile(manifestPath(runDirectory), renderManifest(record));
}
async function recordManifestAgree(runDirectory: string, runId: string): Promise<{ agree: boolean; record?: ReadableExecutionRecord }> {
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

export function normalizePhaseName(record: ReadableExecutionRecord, phase: string): string {
	const canonical = phase.endsWith(".md") ? phase : `${phase}.md`;
	if (!record.frozen.phases.includes(canonical)) throw new Error(`Unknown phase "${phase}". Valid canonical phase names: ${record.frozen.phases.join(", ")}.`);
	return canonical;
}
function phaseEvidence(record: ReadableExecutionRecord, canonicalPhase: string): PhaseEvidence {
	const evidence = record.phases.find((item) => item.phase === canonicalPhase);
	if (!evidence) throw new Error(`Unknown phase "${canonicalPhase}". Valid canonical phase names: ${record.frozen.phases.join(", ")}.`);
	return evidence;
}
function pathAllowed(path: string, targets: readonly string[]): boolean {
	return targets.some((target) => path === target || path.startsWith(`${target}/`));
}
interface ChangedPathEvidence {
	observations: ChangedFileObservation[];
	outsideDeclaredTargets: string[];
}
async function observeChangedPaths(record: ReadableExecutionRecord, runId: string, changedPaths: readonly string[] | undefined, targets: readonly string[]): Promise<ChangedPathEvidence> {
	if (!changedPaths) return { observations: [], outsideDeclaredTargets: [] };
	if (changedPaths.length > MAX_CHANGED_PATHS || new Set(changedPaths).size !== changedPaths.length) throw new Error("Changed paths must be a unique bounded path set.");
	const observations: ChangedFileObservation[] = [];
	const outsideDeclaredTargets: string[] = [];
	for (const raw of changedPaths) {
		const path = assertSafeRelativePath(raw);
		if (path !== raw) throw new Error(`Changed-file path must be canonical project-relative text: ${raw}`);
		if (record.source.sourcePlanPath === "." || path === record.source.sourcePlanPath || path.startsWith(`${record.source.sourcePlanPath}/`)) throw new Error(`Changed-file path must not be in the source plan directory: ${path}`);
		const executionRoot = `.internal-dev/sprints/${runId}`;
		const anyExecutionRecord = path.match(/^\.internal-dev\/sprints\/(exec-[A-Za-z0-9][A-Za-z0-9_-]*)(?:\/|$)/);
		if (path === executionRoot || path.startsWith(`${executionRoot}/`) || anyExecutionRecord) throw new Error(`Changed-file path must not be in the execution record directory: ${path}`);
		observations.push(await observeChangedFile(record.source.projectRoot, path));
		if (!pathAllowed(path, targets)) outsideDeclaredTargets.push(path);
	}
	return { observations, outsideDeclaredTargets };
}
function checkpointWarnings(outsideDeclaredTargets: string[], phase?: string): CheckpointWarning[] {
	if (outsideDeclaredTargets.length === 0) return [];
	return [{
		code: "outside-declared-targets",
		...(phase ? { phase } : {}),
		paths: [...outsideDeclaredTargets],
		message: `Changed-file evidence includes ${outsideDeclaredTargets.length} path(s) outside the immutable declared scheduling targets. Treat this as plan drift and reassess overlap.`,
	}];
}
async function sourceUnchanged(record: ReadableExecutionRecord): Promise<boolean> {
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
): Promise<{ handle: ExecutionRecordHandle; revision: number; source: SourceDescriptor }> {
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
			source: snapshot.descriptor, frozen, phases: frozen.phases.map((phase) => ({ phase, validations: [] })),
			integrationValidations: [], createdAt: timestamp, updatedAt: timestamp,
		};
		parseExecutionRecord(`${JSON.stringify(record)}\n`, runDirectory, runId);
		const executionDirectory = dirname(recordPath(runDirectory));
		await mkdir(executionDirectory);
		const executionEntry = await lstat(executionDirectory);
		executionIdentity = { dev: String(executionEntry.dev), ino: String(executionEntry.ino) };
		ownedFiles.push(await atomicCreateOwnedFile(recordPath(runDirectory), `${JSON.stringify(record, null, 2)}\n`));
		ownedFiles.push(await atomicCreateOwnedFile(manifestPath(runDirectory), renderManifest(record)));
		if (!(await recordManifestAgree(runDirectory, runId)).agree) throw new Error("Initial record and manifest do not agree.");
		return { handle: { runId, runDirectory, leaseHandle }, revision: 0, source: { ...snapshot.descriptor, files: snapshot.descriptor.files.map((file) => ({ ...file })) } };
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
): Promise<CheckpointResult> {
	return serialized(handle.runDirectory, async () => {
		nonEmpty(report, "Checkpoint report");
		const lease: LeaseInspection = await inspectLease(handle.runDirectory, handle.leaseHandle);
		if (lease.ownership !== "owned-by-this-runtime" || lease.record?.runKind !== "execution") throw new Error("Execution record lease is no longer owned by this runtime.");
		const record = await readMutableRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.revision !== expectedRevision) throw new Error(`Revision mismatch: expected ${expectedRevision}, current ${record.revision}. Stale checkpoint rejected.`);
		if (record.state !== "active") throw new Error(`Execution record is ${record.state}; accepts no further checkpoints.`);
		if (!(await sourceUnchanged(record))) throw new Error("Source plan drift detected; checkpoint rejected without changing the immutable descriptor.");
		const timestamp = now();
		let warningPhase: string | undefined;
		let outsideDeclaredTargets: string[] = [];
		if (type === "implementation") {
			if (!phase) throw new Error("Implementation checkpoint requires phase.");
			const canonicalPhase = normalizePhaseName(record, phase);
			warningPhase = canonicalPhase;
			const evidence = phaseEvidence(record, canonicalPhase);
			if (evidence.implementation) throw new Error(`Phase ${canonicalPhase} already has implementation evidence.`);
			if (!(record.frozen.dependencies[canonicalPhase] ?? []).every((dependency) => latestValidation(phaseEvidence(record, dependency))?.verdict === "PASS")) throw new Error(`Cannot implement ${canonicalPhase}: not all dependencies have validator PASS as their latest verdict.`);
			const observed = await observeChangedPaths(record, handle.runId, changedPaths, record.frozen.targets[canonicalPhase]);
			outsideDeclaredTargets = observed.outsideDeclaredTargets;
			evidence.implementation = {
				agentModel: { ...IMPL_TUPLE }, report, changedFiles: observed.observations.map((item) => item.path),
				changedFileObservations: observed.observations, outsideDeclaredTargets: [...outsideDeclaredTargets], timestamp,
			};
		} else if (type === "phase_validation") {
			if (!phase) throw new Error("Phase validation checkpoint requires phase.");
			if (verdict !== "PASS" && verdict !== "BLOCKED") throw new Error("Phase validation requires verdict PASS or BLOCKED.");
			const canonicalPhase = normalizePhaseName(record, phase);
			warningPhase = canonicalPhase;
			const evidence = phaseEvidence(record, canonicalPhase);
			if (!evidence.implementation) throw new Error(`Phase ${canonicalPhase} has no implementation evidence — validator checkpoint rejected.`);
			if (latestValidation(evidence)?.verdict === "PASS") throw new Error(`Phase ${canonicalPhase} already has latest validator PASS evidence.`);
			if (record.integrationValidations.length > 0) throw new Error("Phase validation cannot follow integration validation evidence.");
			const observed = await observeChangedPaths(record, handle.runId, changedPaths, record.frozen.targets[canonicalPhase]);
			outsideDeclaredTargets = observed.outsideDeclaredTargets;
			evidence.validations.push({
				agentModel: { ...VAL_TUPLE }, attempt: evidence.validations.length + 1, verdict, report,
				changedFiles: observed.observations.map((item) => item.path), changedFileObservations: observed.observations,
				outsideDeclaredTargets: [...outsideDeclaredTargets], timestamp,
			});
		} else {
			if (verdict !== "PASS" && verdict !== "BLOCKED") throw new Error("Integration validation requires verdict PASS or BLOCKED.");
			if (!allPhasesPassed(record)) throw new Error("Integration validation requires every phase to have validator PASS as its latest verdict.");
			if (latestIntegration(record)?.verdict === "PASS") throw new Error("Integration validation already has latest PASS evidence.");
			const targets = [...new Set(Object.values(record.frozen.targets).flat())];
			const observed = await observeChangedPaths(record, handle.runId, changedPaths, targets);
			outsideDeclaredTargets = observed.outsideDeclaredTargets;
			record.integrationValidations.push({
				agentModel: { ...VAL_TUPLE }, attempt: record.integrationValidations.length + 1, verdict, report,
				changedFiles: observed.observations.map((item) => item.path), changedFileObservations: observed.observations,
				outsideDeclaredTargets: [...outsideDeclaredTargets], timestamp,
			});
		}
		record.revision++;
		record.updatedAt = timestamp;
		parseExecutionRecord(`${JSON.stringify(record)}\n`, handle.runDirectory, handle.runId);
		await persistTransition(handle, record);
		return { revision: record.revision, warnings: checkpointWarnings(outsideDeclaredTargets, warningPhase) };
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
		const record = await readMutableRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.revision !== expectedRevision) throw new Error(`Revision mismatch: expected ${expectedRevision}, current ${record.revision}. Stale finish rejected.`);
		if (record.state !== "active") throw new Error(`Execution record is already ${record.state}.`);
		const timestamp = now();
		const unchanged = await sourceUnchanged(record);
		const observed = await observeChangedPaths(record, handle.runId, changedPaths, [...new Set(Object.values(record.frozen.targets).flat())]);
		if (type === "completed") {
			if (!unchanged) throw new Error("Cannot finish completed: source plan bytes have changed since start.");
			if (!allPhasesPassed(record) || latestIntegration(record)?.verdict !== "PASS") throw new Error("Cannot finish completed: every phase's latest validation and the latest integration validation must PASS.");
			record.state = "completed";
			record.completedAt = timestamp;
			record.completion = { report: reason, timestamp, changedFileObservations: observed.observations, outsideDeclaredTargets: observed.outsideDeclaredTargets };
		} else if (type === "blocked") {
			record.state = "blocked";
			record.blocker = { reason, timestamp, changedFileObservations: observed.observations, outsideDeclaredTargets: observed.outsideDeclaredTargets };
		} else {
			record.state = "interrupted";
			record.interrupted = { reason, timestamp, changedFileObservations: observed.observations, outsideDeclaredTargets: observed.outsideDeclaredTargets };
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
		const record = await readMutableRecord(handle.runDirectory, handle.runId);
		const before = (await recordManifestAgree(handle.runDirectory, handle.runId)).agree;
		await reconcileManifest(handle, record);
		return !before;
	});
}

function finding(code: string, severity: DoctorSeverity, message: string, path?: string): DoctorFinding {
	return { code, severity, message, ...(path ? { path } : {}) };
}
export interface ExecutionDoctorResult {
	record?: ReadableExecutionRecord;
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
	let record: ReadableExecutionRecord;
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
	if (record.version === LEGACY_EXECUTION_RECORD_VERSION) findings.push(finding("exec-version-read-only", "info", `Execution record version ${record.version} is supported for read-only inspection; append operations require version ${EXECUTION_RECORD_VERSION}.`, recordPath(runDirectory)));
	if (record.state === "active") findings.push(finding("exec-active-progress", "info", `Active at revision ${record.revision}; ${record.phases.filter((phase) => phaseExecutionStatus(phase) === "passed").length}/${record.phases.length} phases PASS, ${record.phases.filter((phase) => phaseExecutionStatus(phase) === "blocked").length} unresolved BLOCKED.`, recordPath(runDirectory)));
	if (record.state === "completed") findings.push(finding("exec-completed", "info", `Execution completed at ${record.completedAt}.`, recordPath(runDirectory)));
	if (record.state === "blocked") findings.push(finding("exec-blocked", "warning", record.blocker!.reason, recordPath(runDirectory)));
	if (record.state === "interrupted") findings.push(finding("exec-interrupted", "info", record.interrupted!.reason, recordPath(runDirectory)));
	return { record, findings, leaseOwnership, manifestMismatch, state: record.state };
}

export async function loadExecutionRecord(runDirectory: string, runId: string): Promise<ReadableExecutionRecord | undefined> {
	try { return await readRecord(runDirectory, runId); } catch { return undefined; }
}

export async function interruptActiveRecord(handle: ExecutionRecordHandle, reason: string): Promise<boolean> {
	return serialized(handle.runDirectory, async () => {
		nonEmpty(reason, "Interruption reason");
		const lease = await inspectLease(handle.runDirectory, handle.leaseHandle);
		if (lease.ownership !== "owned-by-this-runtime" || lease.record?.runKind !== "execution") return false;
		const record = await readMutableRecord(handle.runDirectory, handle.runId);
		await reconcileManifest(handle, record);
		if (record.state !== "active") return false;
		const timestamp = now();
		record.state = "interrupted";
		record.interrupted = { reason, timestamp, changedFileObservations: [], outsideDeclaredTargets: [] };
		if (!(await sourceUnchanged(record))) record.sourceDrift = { observedAt: timestamp, reason: "Source entry set, type, or bytes differ from the immutable start descriptor." };
		record.terminalAt = timestamp;
		record.revision++; record.updatedAt = timestamp;
		parseExecutionRecord(`${JSON.stringify(record)}\n`, handle.runDirectory, handle.runId);
		await persistTransition(handle, record);
		await releaseLease(handle.leaseHandle);
		return true;
	});
}
