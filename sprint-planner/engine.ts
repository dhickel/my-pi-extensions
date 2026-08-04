import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
	assertSafeRelativePath,
	atomicCreateOwnedFile,
	publishDirectoryExclusively,
	removeOwnedDirectory,
	removeOwnedFile,
	RunArtifactStore,
	sha256,
	SprintStateStore,
	type OwnedDirectoryPublication,
	type OwnedFilePublication,
} from "./artifacts.ts";
import {
	advancedConceptReviewPrompt,
	advancedDecompositionReviewPrompt,
	advancedOrchestrationReviewPrompt,
	advancedPhaseReviewPrompt,
	advancedPlanPrompt,
	brainstormPrompt,
	crossReviewPrompt,
	ironoutPrompt,
	ironoutReviewPrompt,
	redTeamPrompt,
	retryPrompt,
	routeRolesPrompt,
	synthesisPrompt,
} from "./prompts.ts";
import {
	acquireLease,
	assertValidRunDirectory,
	releaseLease,
	removeEmptyReservation,
	reserveSprintRun,
	sprintsRoot,
} from "./run-records.ts";
import {
	BRAINSTORM_HEADINGS,
	CONCEPT_HEADINGS,
	HANDOFF_HEADINGS,
	PHASE_HEADINGS,
	REVIEW_HEADINGS,
	inspectPlanDirectory,
	requiredHeadings,
	validateBrainstormFindings,
	validateConcept,
	validateDraftPlanShape,
	validateHandoff,
	validateOrchestration,
	validatePhase,
	validatePlanFiles,
	validateRoles,
	validateSubmission,
	validateSynthesisCoverage,
} from "./validation.ts";
import { loadDefaultSprintPlannerAgentConfiguration } from "./configs/index.ts";
import {
	DEFAULT_BRAINSTORM_AGENTS,
	MAX_STEP_ATTEMPTS,
	ORCHESTRATION_HEADINGS,
	SPRINT_STATE_VERSION,
	type SprintPlannerAgentConfiguration,
	type ArtifactRecord,
	type BrainstormRole,
	type EngineCallbacks,
	type EngineProgress,
	type ModelTuple,
	type ProgressStatus,
	type RunLeaseHandle,
	type SprintRunOptions,
	type SprintStage,
	type SprintState,
	type StandaloneRunOptions,
	type SubmittedFile,
	type WorkerRequest,
	type WorkerResult,
	type WorkerSubmission,
	type WorkflowName,
	type WorkflowRunner,
} from "./types.ts";

interface SprintBrainstormResult {
	roles: BrainstormRole[];
	reports: { path: string; content: string }[];
	synthesis: string;
	redTeam: string;
}

interface CorrectedPlanResult {
	files: SubmittedFile[];
	reviewSummary: string;
}

function seniorAdvisorModel(configuration: SprintPlannerAgentConfiguration, assignment: SprintPlannerAgentConfiguration[keyof SprintPlannerAgentConfiguration]): ModelTuple | undefined {
	return assignment.seniorAdvisor ? configuration[assignment.seniorAdvisor].model : undefined;
}

type OwnedPublication = OwnedFilePublication | OwnedDirectoryPublication;

// ── Scoped fan-out ─────────────────────────────────────────────────────────

class ScopeCancellation extends Error {
	readonly scopeLabel: string;

	constructor(scopeLabel: string) {
		super(`Planning scope cancelled: ${scopeLabel}`);
		this.name = "ScopeCancellation";
		this.scopeLabel = scopeLabel;
	}
}

class RootInterruption extends Error {
	readonly scopeLabel: string;

	constructor(scopeLabel: string) {
		super(`Root planning operation interrupted: ${scopeLabel}`);
		this.name = "RootInterruption";
		this.scopeLabel = scopeLabel;
	}
}

function isFanOutCancellation(error: unknown): error is ScopeCancellation | RootInterruption {
	return error instanceof ScopeCancellation || error instanceof RootInterruption;
}

/**
 * Run every factory, abort sibling scope on first non-cancellation failure,
 * await all started promises via allSettled, and return values in input order
 * or throw the first causal error with settlement evidence.
 */
async function scopedFanOut<T>(
	factories: readonly ((signal: AbortSignal) => Promise<T>)[],
	rootSignal: AbortSignal,
	scopeLabel: string,
): Promise<T[]> {
	const scopeController = new AbortController();
	const scopeReason = new ScopeCancellation(scopeLabel);
	const rootReason = new RootInterruption(scopeLabel);
	const onRootAbort = () => scopeController.abort(rootReason);
	rootSignal.addEventListener("abort", onRootAbort, { once: true });
	if (rootSignal.aborted) onRootAbort();

	let firstError: unknown;
	let firstErrorIndex = -1;
	const observe = (promise: Promise<T>, index: number): Promise<T> => promise.catch((error) => {
		if (firstError === undefined && !isFanOutCancellation(error)) {
			firstError = error;
			firstErrorIndex = index;
			scopeController.abort(scopeReason);
		}
		throw error;
	});
	const promises: Promise<T>[] = [];

	try {
		for (let index = 0; index < factories.length; index++) {
			try {
				// Invoke every declared factory, including those reached after a synchronous
				// failure. Later factories receive the already-cancelled local signal.
				promises.push(observe(Promise.resolve(factories[index](scopeController.signal)), index));
			} catch (error) {
				if (firstError === undefined && !isFanOutCancellation(error)) {
					firstError = error;
					firstErrorIndex = index;
					scopeController.abort(scopeReason);
				}
				promises.push(Promise.reject(error));
			}
		}

		const settlements = await Promise.allSettled(promises);
		if (firstError !== undefined) {
			const causeMsg = firstError instanceof Error ? firstError.message : String(firstError);
			throw Object.assign(
				new Error(`Fan-out ${scopeLabel}: sibling at index ${firstErrorIndex} failed: ${causeMsg}`),
				{ cause: firstError, settlements, scopeLabel },
			);
		}
		if (rootSignal.aborted) throw rootReason;

		const unexpected = settlements.find((settlement) => settlement.status === "rejected");
		if (unexpected?.status === "rejected") throw unexpected.reason;
		return settlements.map((settlement) => (settlement as PromiseFulfilledResult<T>).value);
	} finally {
		rootSignal.removeEventListener("abort", onRootAbort);
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizedFileContent(content: string): string {
	return content.endsWith("\n") ? content : `${content}\n`;
}

function fileRecord(path: string, content: string): ArtifactRecord {
	const normalized = normalizedFileContent(content);
	return { path, sha256: sha256(normalized), bytes: Buffer.byteLength(normalized) };
}

function fsCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function existingFileState(path: string, expected: string): Promise<"absent" | "exact"> {
	let entry;
	try {
		entry = await lstat(path);
	} catch (error) {
		if (fsCode(error) === "ENOENT") return "absent";
		throw error;
	}
	if (!entry.isFile() || entry.isSymbolicLink() || (await readFile(path, "utf8")) !== expected) throw new Error(`Publication target already exists with different content: ${path}`);
	return "exact";
}

async function existingPlanState(path: string, files: readonly SubmittedFile[]): Promise<"absent" | "exact"> {
	let entry;
	try {
		entry = await lstat(path);
	} catch (error) {
		if (fsCode(error) === "ENOENT") return "absent";
		throw error;
	}
	if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Publication target already exists and is not the expected plan: ${path}`);
	const entries = (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
	const expected = [...files].map((file) => file.path).sort();
	if (entries.length !== expected.length || entries.some((item, index) => !item.isFile() || item.isSymbolicLink() || item.name !== expected[index])) {
		throw new Error(`Publication target already exists with a different plan shape: ${path}`);
	}
	for (const file of files) {
		if ((await readFile(resolve(path, file.path), "utf8")) !== normalizedFileContent(file.content)) throw new Error(`Publication target already exists with different plan content: ${path}`);
	}
	const dirResult = await inspectPlanDirectory(path);
	if (!dirResult.valid) {
		const summary = dirResult.findings.map((f) => `- [${f.category}] ${f.message}`).join("\n");
		throw new Error(`Publication target plan is invalid: ${path}\n${summary}`);
	}
	return "exact";
}

async function rollbackPublications(publications: readonly OwnedPublication[]): Promise<boolean> {
	let complete = true;
	for (const publication of [...publications].reverse()) {
		const removed = publication.kind === "file" ? await removeOwnedFile(publication) : await removeOwnedDirectory(publication);
		if (!removed) complete = false;
	}
	return complete;
}

const standaloneStagingRoots = new WeakMap<RunArtifactStore, { dev: string; ino: string }>();

async function createStandaloneStaging(parent: string, id: string): Promise<RunArtifactStore> {
	const selectedId = assertSafeRelativePath(id);
	if (selectedId.includes("/")) throw new Error("A standalone workflow id must be one path segment.");
	const selectedParent = resolve(parent);
	const parentEntry = await lstat(selectedParent);
	if (!parentEntry.isDirectory() || parentEntry.isSymbolicLink()) throw new Error("Standalone publication parent is not a regular directory.");
	const stagingDirectory = resolve(selectedParent, `${selectedId}-staging`);
	try {
		await mkdir(stagingDirectory);
	} catch (error) {
		if (fsCode(error) === "EEXIST") throw new Error(`Standalone staging directory already exists: ${stagingDirectory}`);
		throw error;
	}
	const entry = await lstat(stagingDirectory);
	if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Standalone staging path is not a regular directory: ${stagingDirectory}`);
	const store = new RunArtifactStore(stagingDirectory);
	standaloneStagingRoots.set(store, { dev: String(entry.dev), ino: String(entry.ino) });
	return store;
}

async function writeStagedFiles(store: RunArtifactStore, prefix: string, files: readonly SubmittedFile[]): Promise<void> {
	for (const file of files) {
		const path = prefix ? `${prefix}/${assertSafeRelativePath(file.path)}` : assertSafeRelativePath(file.path);
		await store.write(path, file.content);
	}
}

async function readStagedFiles(store: RunArtifactStore, prefix: string, paths: readonly string[]): Promise<SubmittedFile[]> {
	return Promise.all(paths.map(async (path) => {
		const selected = assertSafeRelativePath(path);
		return { path: selected, content: await store.read(prefix ? `${prefix}/${selected}` : selected) };
	}));
}

async function removeStandaloneStaging(store: RunArtifactStore): Promise<void> {
	const expected = standaloneStagingRoots.get(store);
	const entry = await lstat(store.runDirectory);
	if (!expected || !entry.isDirectory() || entry.isSymbolicLink() || String(entry.dev) !== expected.dev || String(entry.ino) !== expected.ino) {
		throw new Error(`Standalone staging directory ownership could not be proven: ${store.runDirectory}`);
	}
	await rm(store.runDirectory, { recursive: true });
	standaloneStagingRoots.delete(store);
}

class PausedError extends Error {}

function now(): string {
	return new Date().toISOString();
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeAgents(value: number | undefined): number {
	const count = value ?? DEFAULT_BRAINSTORM_AGENTS;
	if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error("agents must be from 2 to 8.");
	return count;
}

function markdownExpectation(headings: string[]) {
	return { kind: "markdown" as const, headings: { artifact: headings } };
}

function filesByPath(submission: WorkerSubmission): Map<string, string> {
	return new Map((submission.files ?? []).map((file) => [file.path, file.content]));
}

function reviewSection(content: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return content.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mi"))?.[1]?.trim() || "No findings recorded.";
}

function summarizePlanReviews(reviews: readonly { path: string; content: string }[]): string {
	return [
		"# Advanced Plan Corrective Review Summary",
		"",
		...REVIEW_HEADINGS.flatMap((heading) => [
			`## ${heading}`,
			"",
			...reviews.flatMap((review) => [`### ${review.path}`, "", reviewSection(review.content, heading), ""]),
		]),
	].join("\n");
}

function planNames(files: readonly SubmittedFile[]): string[] {
	return files.map((file) => assertSafeRelativePath(file.path)).sort((a, b) => {
		if (a === "concepts.md") return -1;
		if (b === "concepts.md") return 1;
		if (a === "orchestration.md") return -1;
		if (b === "orchestration.md") return 1;
		return a.localeCompare(b);
	});
}

export class SprintPlannerEngine {
	readonly runner: WorkflowRunner;
	readonly callbacks: EngineCallbacks;
	readonly agentConfiguration: SprintPlannerAgentConfiguration;
	#controller?: AbortController;
	#state?: SprintState;
	#stateStore?: SprintStateStore;
	#artifactStore?: RunArtifactStore;
	#workflow: WorkflowName = "sprint";
	#runId = "";
	#lastStep?: string;
	#progressStatus: ProgressStatus = "starting";
	#requestedStop?: "paused" | "interrupted" | "cancelled";
	#leaseHandle?: RunLeaseHandle;
	#sprintsRoot?: string;
	#initialized: Promise<void> = Promise.resolve();
	#resolveInitialized?: () => void;
	#rejectInitialized?: (error: unknown) => void;
	#settled: Promise<void> = Promise.resolve();
	#resolveSettled?: () => void;
	#rejectSettled?: (error: unknown) => void;

	constructor(runner: WorkflowRunner, callbacks: EngineCallbacks = {}, agentConfiguration: SprintPlannerAgentConfiguration = loadDefaultSprintPlannerAgentConfiguration()) {
		this.runner = runner;
		this.callbacks = callbacks;
		this.agentConfiguration = agentConfiguration;
	}

	get progress(): EngineProgress | undefined {
		if (!this.#runId) return undefined;
		if (this.#state) {
			const steps = Object.values(this.#state.steps);
			return {
				workflow: "sprint",
				runId: this.#state.runId,
				status: this.#state.status,
				stage: this.#state.stage,
				completed: steps.filter((step) => step.status === "completed").length,
				total: steps.length,
				error: this.#state.error,
			};
		}
		const status: ProgressStatus = this.#controller?.signal.aborted ? "cancelled" : this.#progressStatus;
		return { workflow: this.#workflow, runId: this.#runId, status, stage: status === "starting" ? "starting" : "running", step: this.#lastStep, completed: 0, total: 0 };
	}

	/** Resolves after owned initialization is durable, or rejects before provider work on conflict. */
	get initialized(): Promise<void> {
		return this.#initialized;
	}

	/** Establish transient identity and emit starting before any filesystem or async init. */
	#beginRun(workflow: WorkflowName, runId: string): void {
		this.#workflow = workflow;
		this.#runId = runId;
		this.#progressStatus = "starting";
		this.#state = undefined;
		this.#stateStore = undefined;
		this.#artifactStore = undefined;
		this.#controller = new AbortController();
		this.#requestedStop = undefined;
		this.#lastStep = undefined;
		this.#leaseHandle = undefined;
		this.#sprintsRoot = undefined;
		this.#initialized = new Promise<void>((resolveInitialized, rejectInitialized) => {
			this.#resolveInitialized = resolveInitialized;
			this.#rejectInitialized = rejectInitialized;
		});
		this.#initialized.catch(() => undefined);
		this.#settled = new Promise<void>((resolveSettled, rejectSettled) => {
			this.#resolveSettled = resolveSettled;
			this.#rejectSettled = rejectSettled;
		});
		this.#settled.catch(() => undefined);
		this.#emitProgress();
	}

	async pause(interrupted = false): Promise<void> {
		this.#requestedStop = interrupted ? "interrupted" : "paused";
		this.#controller?.abort(interrupted ? "Session interrupted." : "Paused by user.");
		await this.runner.abortAll(interrupted ? "Session interrupted." : "Paused by user.");
		await this.#settled;
	}

	async cancel(): Promise<void> {
		this.#requestedStop = "cancelled";
		this.#controller?.abort("Cancelled by user.");
		await this.runner.abortAll("Cancelled by user.");
		if (this.#leaseHandle || this.#state) await this.#settled;
	}

	async runSprint(options: SprintRunOptions): Promise<SprintState> {
		this.#beginRun("sprint", options.runId);
		const directive = options.directive;
		if (!directive.trim()) {
			this.#runId = "";
			this.#controller = undefined;
			throw new Error("Sprint directive is blank.");
		}
			let runDirectory: string;
		let store: RunArtifactStore;
		let inputArtifact: ArtifactRecord;
		try {
			const reservation = await reserveSprintRun(options.internalDevPath, options.runId);
			runDirectory = reservation.path;
			try {
				this.#leaseHandle = await acquireLease(runDirectory, options.runId, "planning");
			} catch (leaseError) {
				await removeEmptyReservation(reservation);
				throw leaseError;
			}
			this.#sprintsRoot = await sprintsRoot(options.internalDevPath);
			store = new RunArtifactStore(runDirectory);
			inputArtifact = await store.write("input.md", `# Sprint Input\n\n${directive}`);
		} catch (error) {
			this.#rejectInitialized?.(error);
			if (!this.#leaseHandle) {
				this.#runId = "";
				this.#controller = undefined;
			}
			throw error;
		}
		const timestamp = now();
		const state: SprintState = {
			version: SPRINT_STATE_VERSION,
			runId: options.runId,
			projectRoot: resolve(options.projectRoot),
			runDirectory,
			status: "running",
			stage: "brainstorm",
			directivePath: "input.md",
			inputArtifact,
			agents: normalizeAgents(options.agents),
			steps: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.#attachSprint(state, store);
		try {
			await this.#saveState();
		} catch (error) {
			this.#rejectInitialized?.(error);
			throw error;
		}
		this.#resolveInitialized?.();
		return this.#trackDrive(this.#driveSprint(state, directive));
	}

	async resumeSprint(runDirectory: string, runId: string): Promise<SprintState> {
		this.#beginRun("sprint", assertSafeRelativePath(runId));
		const root = resolve(runDirectory, "..");
		await assertValidRunDirectory(root, runDirectory);
		try {
			this.#leaseHandle = await acquireLease(runDirectory, runId, "planning");
		} catch (error) {
			const failure = new Error(`Failed to acquire planning lease for resume: ${error instanceof Error ? error.message : String(error)}`);
			this.#rejectInitialized?.(failure);
			this.#runId = "";
			this.#controller = undefined;
			throw failure;
		}
		let stateStore: SprintStateStore;
		let state: SprintState;
		try {
			stateStore = new SprintStateStore(runDirectory);
			state = await stateStore.load();
			if (state.runId !== runId) throw new Error(`Sprint state run id ${state.runId} does not match requested run id ${runId}.`);
			if (state.status === "completed") throw new Error("Sprint is already complete.");
		} catch (error) {
			this.#rejectInitialized?.(error);
			try {
				await this.#releaseOwnedLease();
			} finally {
				this.#runId = "";
				this.#controller = undefined;
			}
			throw error;
		}
		this.#sprintsRoot = root;
		const store = new RunArtifactStore(runDirectory);
		this.#attachSprint(state, store, stateStore);
		try {
			await this.#revalidateCompletedSteps();
		} catch (error) {
			this.#rejectInitialized?.(error);
			throw error;
		}
		state.status = "running";
		state.error = undefined;
		state.updatedAt = now();
		for (const step of Object.values(state.steps)) {
			// Running or interrupted steps become pending; charged attempts and
			// lastRetryFeedback are preserved so retries continue from where they left off.
			if (step.status === "running" || step.status === "interrupted") {
				step.status = "pending";
			}
			// Failed steps with remaining budget may retry on resume.
			if (step.status === "failed" && step.attempts < MAX_STEP_ATTEMPTS) {
				step.status = "pending";
				step.error = undefined;
			}
		}
		try {
			await this.#saveState();
		} catch (error) {
			this.#rejectInitialized?.(error);
			throw error;
		}
		let directive: string;
		try {
			directive = await store.read(state.directivePath);
		} catch (error) {
			this.#rejectInitialized?.(error);
			throw error;
		}
		this.#resolveInitialized?.();
		return this.#trackDrive(this.#driveSprint(state, directive));
	}

	#attachSprint(state: SprintState, store: RunArtifactStore, stateStore = new SprintStateStore(state.runDirectory)): void {
		this.#workflow = "sprint";
		this.#runId = state.runId;
		this.#progressStatus = "running";
		this.#state = state;
		this.#artifactStore = store;
		this.#stateStore = stateStore;
		this.#controller = new AbortController();
		this.#requestedStop = undefined;
		this.#lastStep = undefined;
	}

	async #driveSprint(state: SprintState, directiveInput: string): Promise<SprintState> {
		const directive = directiveInput.replace(/^# Sprint Input\s*/i, "").trim();
		let publication: OwnedPublication[] = [];
		try {
			const brainstorm = await this.#sprintBrainstorm(directive, state.agents);
			const handoff = await this.#sprintIronout(brainstorm);
			const plan = await this.#sprintPlan(handoff);
			const manifest = this.#manifestContent(directive, brainstorm, plan);
			publication = await this.#publishFullSprint(plan, manifest);
			state.stage = "complete";
			state.status = "completed";
			state.error = undefined;
			state.completedAt = now();
			state.updatedAt = state.completedAt;
			await this.#saveState();
			await this.#artifactStore!.removeRuntimeFiles();
			this.#emitProgress();
			publication = [];
			// Release lease after clean finalization.
			await this.#releaseOwnedLease();
			return state;
		} catch (error) {
			let failure = errorText(error);
			if (publication.length && !(await rollbackPublications(publication))) failure += " Publication rollback stopped because ownership could not be proven.";
			if (state.stage === "complete") state.stage = "planning";
			delete state.completedAt;
			if (error instanceof PausedError || this.#controller?.signal.aborted) {
				state.status = this.#requestedStop ?? "paused";
				state.error = this.#requestedStop === "cancelled" ? "Cancelled by user." : state.error ?? failure;
			} else {
				state.status = "paused";
				state.error = failure;
			}
			state.updatedAt = now();
			await this.#saveState();
			this.#emitProgress();
			// Release lease after persisting failure state.
			await this.#releaseOwnedLease();
			return state;
		}
	}

	async #saveState(): Promise<void> {
		if (!this.#state || !this.#stateStore) return;
		this.#state.updatedAt = now();
		await this.#stateStore.save(this.#state);
		this.callbacks.onState?.(this.#state);
		this.#emitProgress();
	}

	#emitProgress(step?: string): void {
		const progress = this.progress;
		if (progress) this.callbacks.onProgress?.({ ...progress, ...(step ? { step } : {}) });
	}

	async #revalidateCompletedSteps(): Promise<void> {
		const state = this.#state!;
		if (!(await this.#artifactStore!.verify(state.inputArtifact))) throw new Error("The original sprint input is missing or changed; refusing to resume against a different directive.");
		let invalidateFollowing = false;
		for (const step of Object.values(state.steps)) {
			if (step.status !== "completed") continue;
			let failure: string | undefined;
			if (!invalidateFollowing) {
				const hashes = await Promise.all(step.artifacts.map((artifact) => this.#artifactStore!.verify(artifact)));
				if (!hashes.every(Boolean)) failure = "checkpointed artifact is missing or changed";
				else {
					try {
						await this.#validateCompletedStep(step.id, step.artifacts);
					} catch (error) {
						failure = `checkpointed artifact is semantically invalid: ${errorText(error)}`;
					}
				}
			}
			if (invalidateFollowing || failure) {
				invalidateFollowing = true;
				step.status = "pending";
				step.attempts = 0;
				step.error = `This step or an earlier ${failure ?? "invalid"}; downstream work must be regenerated.`;
				step.artifacts = [];
				step.lastRetryFeedback = undefined;
				delete step.completedAt;
				step.updatedAt = now();
			}
		}
	}

	async #validateCompletedStep(id: string, artifacts: readonly ArtifactRecord[]): Promise<void> {
		const read = async (path: string) => this.#artifactStore!.read(path);
		if (id === "ironout-author") return validateHandoff(await read("ironout/draft.md"));
		if (id === "ironout-review") return validateHandoff(await read("ironout/handoff.md"));
		if (id === "planning-author") {
			const files = await Promise.all(artifacts.filter((artifact) => artifact.path.startsWith("planning-draft/")).map(async (artifact) => ({ path: artifact.path.slice("planning-draft/".length), content: await read(artifact.path) })));
			validateDraftPlanShape(files);
			return;
		}
		if (id === "planning-decomposition") {
			const files = await Promise.all(artifacts.filter((artifact) => artifact.path.startsWith("planning-corrected/")).map(async (artifact) => ({ path: artifact.path.slice("planning-corrected/".length), content: await read(artifact.path) })));
			validatePlanFiles(files);
			requiredHeadings(await read("reviews/advanced-plan-components/decomposition.md"), REVIEW_HEADINGS, "decomposition.md");
			return;
		}
		if (id === "planning-review-concepts") return validateConcept(await read("planning-review-draft/concepts.md"));
		if (id === "planning-review-orchestration") {
			const decomp = this.#state!.steps["planning-decomposition"];
			const phasePaths = decomp?.artifacts
				? decomp.artifacts.filter((a) => a.path.startsWith("planning-corrected/")).map((a) => a.path.replace(/^planning-corrected\//, "")).filter((p) => /^phase-\d{2}-/.test(p)).sort()
				: this.#state!.steps["planning-author"].artifacts.map((a) => a.path.replace(/^planning-draft\//, "")).filter((p) => /^phase-\d{2}-/.test(p)).sort();
			validateOrchestration(await read("planning-review-draft/orchestration.md"), phasePaths);
			return;
		}
		if (id.startsWith("planning-review-phase-")) {
			const artifact = artifacts.find((item) => /^planning-review-draft\/phase-\d{2}-/.test(item.path));
			if (!artifact) throw new Error(`${id} is missing its corrected phase artifact.`);
			validatePhase(artifact.path.slice("planning-review-draft/".length), await read(artifact.path), await read("planning-review-draft/orchestration.md"));
		}
	}

	/**
	 * Persisted step with explicit boundaries:
	 * 1. Runner call (charged only when disposition is "completed")
	 * 2. Typed submission validation
	 * 3. Semantic validation (supplied `validate`)
	 * 4. Artifact persistence (supplied `persist` — operational, not retryable)
	 */
	async #step(
		id: string,
		stage: SprintStage,
		model: ModelTuple,
		request: Omit<WorkerRequest, "id" | "model" | "cwd" | "persistent" | "sessionDirectory" | "sessionPath">,
		validate: (submission: WorkerSubmission) => void,
		persist: (submission: WorkerSubmission) => Promise<ArtifactRecord[]>,
		operationSignal: AbortSignal = this.#controller!.signal,
	): Promise<WorkerSubmission | undefined> {
		const state = this.#state!;
		const store = this.#artifactStore!;
		let step = state.steps[id];
		if (step?.status === "completed" && (await Promise.all(step.artifacts.map((artifact) => store.verify(artifact)))).every(Boolean)) return undefined;
		if (!step) {
			step = state.steps[id] = { id, stage, status: "pending", attempts: 0, model: { ...model }, artifacts: [], updatedAt: now() };
		}
		state.stage = stage;
		if (operationSignal.aborted) {
			if (isFanOutCancellation(operationSignal.reason)) throw operationSignal.reason;
			throw new PausedError("Workflow is not running.");
		}
		const base: WorkerRequest = {
			...request,
			id: `${state.runId}-${id}`,
			model: { ...model },
			cwd: state.projectRoot,
			persistent: true,
			sessionDirectory: resolve(state.runDirectory, ".sessions"),
			sessionPath: step.sessionPath,
		};
		if (!step.sessionPath && this.runner.prepare) {
			const prepared = await this.runner.prepare(base);
			step.sessionPath = prepared.sessionPath;
			await this.#saveState();
		}

		while (step.attempts < MAX_STEP_ATTEMPTS) {
			if (operationSignal.aborted) {
				if (isFanOutCancellation(operationSignal.reason)) throw operationSignal.reason;
				throw new PausedError("Workflow paused.");
			}
			// Mark running without incrementing the charge count.
			step.status = "running";
			step.startedAt ??= now();
			step.updatedAt = now();
			step.error = undefined;
			await this.#saveState();

			const retryFeedback = step.lastRetryFeedback
				? retryPrompt(step.lastRetryFeedback, step.attempts + 1)
				: undefined;

			let result: WorkerResult;
			try {
				result = await this.runner.run(
					{ ...base, sessionPath: step.sessionPath, retryPrompt: retryFeedback },
					operationSignal,
				);
				if (result.sessionPath && result.sessionPath !== step.sessionPath) step.sessionPath = result.sessionPath;
			} catch (error) {
				if (isFanOutCancellation(operationSignal.reason)) {
					step.status = operationSignal.reason instanceof ScopeCancellation ? "pending" : "interrupted";
					step.updatedAt = now();
					await this.#saveState();
					throw operationSignal.reason;
				}
				// Runner setup/preflight failure is operational and is never charged.
				step.status = "failed";
				step.error = errorText(error);
				state.error = `${id} failed during setup: ${step.error}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			if (result.disposition !== "completed") {
				if (isFanOutCancellation(operationSignal.reason)) {
					step.status = operationSignal.reason instanceof ScopeCancellation ? "pending" : "interrupted";
					step.updatedAt = now();
					await this.#saveState();
					throw operationSignal.reason;
				}
				if (result.disposition === "interrupted" || this.#controller!.signal.aborted) {
					step.status = "interrupted";
					step.error = result.error ?? "Workflow interrupted.";
					step.updatedAt = now();
					await this.#saveState();
					throw new PausedError("Workflow paused.");
				}
				step.status = "failed";
				step.error = result.error ?? "Worker failed before provider start.";
				state.error = `${id} failed before provider start: ${step.error}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			// Charge and durably checkpoint the terminal provider completion before
			// typed or semantic validation begins.
			step.attempts++;
			step.updatedAt = now();
			await this.#saveState();

			if (this.#controller!.signal.aborted) throw new PausedError("Workflow paused.");

			if (!result.ok) {
				const failureKind = result.failureKind ?? "fatal";
				const msg = result.error ?? "Worker failed.";
				step.error = msg;
				step.lastRetryFeedback = {
					category: failureKind === "transient" ? "provider" : failureKind === "malformed" ? "typed" : "provider",
					message: msg,
				};
				step.updatedAt = now();
				if ((failureKind === "transient" || failureKind === "malformed") && step.attempts < MAX_STEP_ATTEMPTS) {
					step.status = "pending";
					await this.#saveState();
					continue;
				}
				step.status = "failed";
				state.error = `${id} failed after ${step.attempts} attempt(s): ${step.error}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			// Typed submission validation.
			let submission: WorkerSubmission;
			try {
				submission = validateSubmission(result.submission, request.expectation);
			} catch (error) {
				const msg = errorText(error);
				step.error = msg;
				step.lastRetryFeedback = { category: "typed", message: msg };
				step.updatedAt = now();
				if (step.attempts < MAX_STEP_ATTEMPTS) {
					step.status = "pending";
					await this.#saveState();
					continue;
				}
				step.status = "failed";
				state.error = `${id} exhausted retries after typed validation failure: ${msg}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			// Artifact persistence — operational failure (not retryable).
			// Persist BEFORE semantic validation so generated artifacts are not lost
			// if validation fails (e.g. phase review goal mismatch). The step will retry
			// validation on subsequent attempts, potentially overwriting these artifacts.
			let artifacts: ArtifactRecord[];
			try {
				artifacts = await persist(submission);
			} catch (error) {
				const msg = errorText(error);
				step.error = msg;
				step.status = "failed";
				state.error = `${id} artifact persistence failed: ${msg}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			// Semantic validation.
			try {
				validate(submission);
			} catch (error) {
				const msg = errorText(error);
				step.error = msg;
				step.lastRetryFeedback = { category: "semantic", message: msg };
				step.updatedAt = now();
				if (step.attempts < MAX_STEP_ATTEMPTS) {
					step.status = "pending";
					await this.#saveState();
					continue;
				}
				step.status = "failed";
				state.error = `${id} exhausted retries after semantic validation failure: ${msg}`;
				await this.#saveState();
				throw new PausedError(state.error);
			}

			// Remap per-session artifact paths through persisted artifacts once
			// validation passes.
			step.artifacts = artifacts;
			step.status = "completed";
			step.completedAt = now();
			step.updatedAt = step.completedAt;
			await this.#saveState();
			return submission;
		}
		throw new PausedError(`${id} exhausted its retries.`);
	}

	async #readStepArtifact(id: string, path?: string): Promise<string> {
		const step = this.#state!.steps[id];
		const selected = path ?? step?.artifacts[0]?.path;
		if (!selected) throw new Error(`Step ${id} has no artifact.`);
		return this.#artifactStore!.read(selected);
	}

	async #sprintBrainstorm(directive: string, count: number) {
		const store = this.#artifactStore!;
		const agents = this.agentConfiguration;
		const rolesSubmission = await this.#step(
			"brainstorm-route",
			"brainstorm",
			agents.roleRouter.model,
			{ role: "brainstorm role router", mode: "planning", prompt: routeRolesPrompt(directive, count), contextPaths: ["input.md"], expectation: { kind: "roles" } },
			(submission) => { validateRoles(submission.content, count); },
			async (submission) => [await store.write("brainstorm/roles.json", submission.content!)],
		);
		const roles = rolesSubmission ? validateRoles(rolesSubmission.content, count) : validateRoles(await store.read("brainstorm/roles.json"), count);

		// Scoped fan-out for findings.
		const findingFactory = (role: BrainstormRole) => ((signal: AbortSignal) =>
			this.#step(
				`brainstorm-findings-${role.id}`,
				"brainstorm",
				agents.brainstormWorker.model,
				{ role: `brainstorm worker: ${role.name}`, mode: "planning", prompt: brainstormPrompt(directive, role), contextPaths: ["input.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
				() => {},
				async (submission) => [await store.write(`brainstorm/${role.id}/findings.md`, submission.content!)],
				signal,
			)
		);
		await scopedFanOut(roles.map((role) => findingFactory(role)), this.#controller!.signal, "brainstorm-findings");

		const findings = await Promise.all(roles.map(async (role) => ({ path: `brainstorm/${role.id}/findings.md`, content: await store.read(`brainstorm/${role.id}/findings.md`) })));
		validateBrainstormFindings(findings, roles.map((role) => `brainstorm/${role.id}/findings.md`));

		// Scoped fan-out for cross-reviews.
		const crossFactory = (role: BrainstormRole) => ((signal: AbortSignal) => {
			const stepId = `brainstorm-findings-${role.id}`;
			const others = findings.filter((item) => item.path !== `brainstorm/${role.id}/findings.md`);
			const crossId = `brainstorm-cross-${role.id}`;
			if (!this.#state!.steps[crossId] && this.#state!.steps[stepId]?.sessionPath) {
				this.#state!.steps[crossId] = { id: crossId, stage: "brainstorm", status: "pending", attempts: 0, model: { ...agents.brainstormWorker.model }, artifacts: [], sessionPath: this.#state!.steps[stepId].sessionPath, updatedAt: now() };
			}
			return this.#step(
				crossId,
				"brainstorm",
				agents.brainstormWorker.model,
				{ role: `cross-review worker: ${role.name}`, mode: "planning", prompt: crossReviewPrompt(role, others), contextPaths: others.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
				() => {},
				async (submission) => [await store.write(`brainstorm/${role.id}/cross-review.md`, submission.content!)],
				signal,
			);
		});
		await scopedFanOut(roles.map((role) => crossFactory(role)), this.#controller!.signal, "brainstorm-cross-reviews");

		const reports = await Promise.all(
			roles.flatMap((role) => ["findings.md", "cross-review.md"].map(async (name) => ({ path: `brainstorm/${role.id}/${name}`, content: await store.read(`brainstorm/${role.id}/${name}`) }))),
		);
		const allReportPaths = reports.map((item) => item.path);
		await this.#step(
			"brainstorm-synthesis",
			"brainstorm",
			agents.brainstormSynthesis.model,
			{ role: "brainstorm synthesizer", mode: "planning", prompt: synthesisPrompt(directive, reports), contextPaths: reports.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
			(submission) => { validateSynthesisCoverage(submission.content!, allReportPaths); },
			async (submission) => [await store.write("brainstorm/synthesis.md", submission.content!)],
		);
		const synthesis = await store.read("brainstorm/synthesis.md");
		validateSynthesisCoverage(synthesis, allReportPaths);
		await this.#step(
			"brainstorm-red-team",
			"brainstorm",
			agents.brainstormRedTeam.model,
			{ role: "brainstorm red team", mode: "planning", prompt: redTeamPrompt(synthesis), contextPaths: ["brainstorm/synthesis.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
			() => {},
			async (submission) => [await store.write("brainstorm/red-team.md", submission.content!)],
		);
		return { roles, reports, synthesis, redTeam: await store.read("brainstorm/red-team.md") };
	}

	async #sprintIronout(brainstorm: SprintBrainstormResult) {
		const store = this.#artifactStore!;
		const agents = this.agentConfiguration;
		const reportPaths = brainstorm.reports.map((item) => item.path);
		await this.#step(
			"ironout-author",
			"ironout",
			agents.ironoutAuthor.model,
			{
				role: "autonomous ironout author", mode: "planning",
				prompt: ironoutPrompt(
					`${brainstorm.synthesis}\n\n<red-team>\n${brainstorm.redTeam}\n</red-team>`,
					// No raw reports — just path references for reduced context.
					[],
					false,
					reportPaths,
				),
				contextPaths: ["brainstorm/synthesis.md", "brainstorm/red-team.md"],
				expectation: markdownExpectation(HANDOFF_HEADINGS), allowQuestions: false,
			},
			(submission) => { validateHandoff(submission.content!); },
			async (submission) => [await store.write("ironout/draft.md", submission.content!)],
		);
		const draft = await store.read("ironout/draft.md");
		await this.#step(
			"ironout-review",
			"ironout",
			agents.ironoutReviewer.model,
			{ role: "corrective ironout reviewer", mode: "planning", prompt: ironoutReviewPrompt(draft), contextPaths: ["ironout/draft.md"], expectation: { kind: "files", allowedPaths: ["review.md", "handoff.md"], requiredPaths: ["review.md", "handoff.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "handoff.md": HANDOFF_HEADINGS } } },
			(submission) => { validateHandoff(filesByPath(submission).get("handoff.md")!); },
			async (submission) => {
				const files = filesByPath(submission);
				return [
					await store.write("reviews/ironout-review.md", files.get("review.md")!),
					await store.write("ironout/handoff.md", files.get("handoff.md")!),
				];
			},
		);
		const handoff = await store.read("ironout/handoff.md");
		validateHandoff(handoff);
		return handoff;
	}

	async #sprintPlan(handoff: string): Promise<CorrectedPlanResult> {
		const store = this.#artifactStore!;
		const agents = this.agentConfiguration;
		const draftSubmission = await this.#step(
			"planning-author",
			"planning",
			agents.planner.model,
			{ role: "advanced planner", mode: "planning", prompt: advancedPlanPrompt(handoff), contextPaths: ["ironout/handoff.md"], expectation: { kind: "files", minFiles: 4, maxFiles: 22 }, maxSeniorCalls: agents.planner.maxSeniorCalls, seniorModel: seniorAdvisorModel(agents, agents.planner) },
			(submission) => { validateDraftPlanShape(submission.files!); },
			async (submission) => Promise.all(submission.files!.map((file) => store.write(`planning-draft/${file.path}`, file.content))),
		);
		const draftFiles = draftSubmission?.files ?? (await Promise.all(this.#state!.steps["planning-author"].artifacts.map(async (artifact) => ({ path: artifact.path.replace(/^planning-draft\//, ""), content: await store.read(artifact.path) }))));
		validateDraftPlanShape(draftFiles);
		const draftNames = planNames(draftFiles);

		// ── Decomposition correction gate (medium reviewer; only point allowed to change phase set) ──
		await this.#step(
			"planning-decomposition",
			"planning",
			agents.decompositionReviewer.model,
			{ role: "advanced decomposition reviewer", mode: "planning", prompt: advancedDecompositionReviewPrompt(handoff, draftFiles), contextPaths: ["ironout/handoff.md", ...draftFiles.map((f) => `planning-draft/${f.path}`)], expectation: { kind: "files", minFiles: 5, maxFiles: 23 }, maxSeniorCalls: agents.decompositionReviewer.maxSeniorCalls, seniorModel: seniorAdvisorModel(agents, agents.decompositionReviewer) },
			(submission) => {
				const review = submission.files!.filter((file) => file.path === "review.md");
				if (review.length !== 1) throw new Error("Decomposition review must submit exactly one review.md.");
				requiredHeadings(review[0].content, REVIEW_HEADINGS, "review.md");
				const corrected = submission.files!.filter((file) => file.path !== "review.md");
				validatePlanFiles(corrected);
			},
			async (submission) => {
				const review = submission.files!.filter((file) => file.path === "review.md");
				const corrected = submission.files!.filter((file) => file.path !== "review.md");
				return Promise.all([
					...corrected.map((file) => store.write(`planning-corrected/${file.path}`, file.content)),
					store.write("reviews/advanced-plan-components/decomposition.md", review[0].content),
				]);
			},
		);
		// Build the corrected plan from the decomposition gate output first.
		const decompStep = this.#state!.steps["planning-decomposition"];
		const correctedArtifactPaths = decompStep?.status === "completed"
			? decompStep.artifacts.filter((a) => a.path.startsWith("planning-corrected/")).map((a) => a.path.replace(/^planning-corrected\//, ""))
			: [];
		const correctedArtifactSet = new Set(correctedArtifactPaths);
		const correctedPlanFiles: SubmittedFile[] = [];
		for (const originalPath of draftNames) {
			if (correctedArtifactSet.has(originalPath)) {
				correctedPlanFiles.push({ path: originalPath, content: await store.read(`planning-corrected/${originalPath}`) });
			} else if (originalPath.startsWith("phase-")) {
				continue;
			} else {
				correctedPlanFiles.push({ path: originalPath, content: await store.read(`planning-draft/${originalPath}`) });
			}
		}
		for (const p of correctedArtifactPaths) {
			if (!draftNames.includes(p)) {
				correctedPlanFiles.push({ path: p, content: await store.read(`planning-corrected/${p}`) });
			}
		}
		const finalPlanFiles = correctedPlanFiles;
		validatePlanFiles(finalPlanFiles);

		// ── Phase set is frozen from here ──
		const names = planNames(finalPlanFiles);
		const phasePaths = names.filter((path) => path !== "concepts.md" && path !== "orchestration.md");
		const baseConcepts = finalPlanFiles.find((file) => file.path === "concepts.md")!;
		const baseOrchestration = finalPlanFiles.find((file) => file.path === "orchestration.md")!;

		// Concepts corrective review (sequential, must complete before orchestration).
		await this.#step(
			"planning-review-concepts",
			"planning",
			agents.conceptsReviewer.model,
			{ role: "advanced concepts reviewer", mode: "planning", prompt: advancedConceptReviewPrompt(handoff, baseConcepts, phasePaths), contextPaths: ["ironout/handoff.md", "planning-corrected/concepts.md"], expectation: { kind: "files", allowedPaths: ["review.md", "concepts.md"], requiredPaths: ["review.md", "concepts.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "concepts.md": CONCEPT_HEADINGS } } },
			(submission) => { validateConcept(filesByPath(submission).get("concepts.md")!); },
			async (submission) => {
				const map = filesByPath(submission);
				return [
					await store.write("reviews/advanced-plan-components/concepts.md", map.get("review.md")!),
					await store.write("planning-review-draft/concepts.md", map.get("concepts.md")!),
				];
			},
		);
		const correctedConceptsFile = { path: "concepts.md", content: await store.read("planning-review-draft/concepts.md") };

		// Orchestration corrective review (sequential, must complete after concepts).
		await this.#step(
			"planning-review-orchestration",
			"planning",
			agents.orchestrationReviewer.model,
			{ role: "advanced orchestration reviewer", mode: "planning", prompt: advancedOrchestrationReviewPrompt(handoff, correctedConceptsFile, baseOrchestration, phasePaths), contextPaths: ["ironout/handoff.md", "planning-review-draft/concepts.md", "planning-corrected/orchestration.md"], expectation: { kind: "files", allowedPaths: ["review.md", "orchestration.md"], requiredPaths: ["review.md", "orchestration.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "orchestration.md": ORCHESTRATION_HEADINGS } } },
			(submission) => {
				const map = filesByPath(submission);
				validateOrchestration(map.get("orchestration.md")!, phasePaths);
			},
			async (submission) => {
				const map = filesByPath(submission);
				return [
					await store.write("reviews/advanced-plan-components/orchestration.md", map.get("review.md")!),
					await store.write("planning-review-draft/orchestration.md", map.get("orchestration.md")!),
				];
			},
		);
		const correctedOrchestrationFile = { path: "orchestration.md", content: await store.read("planning-review-draft/orchestration.md") };

		// ── Phase corrective reviews (concurrent — disjoint writes, only after both shared artifacts exist) ──
		const phaseFactories = phasePaths.map((phasePath) => (signal: AbortSignal) => {
			const phase = finalPlanFiles.find((file) => file.path === phasePath)!;
			const reviewPath = `reviews/advanced-plan-components/${phasePath.replace(/\.md$/, "")}.md`;
			return this.#step(
				`planning-review-${phasePath.replace(/\.md$/, "")}`,
				"planning",
				agents.phaseReviewer.model,
				{ role: `advanced phase reviewer: ${phasePath}`, mode: "planning", prompt: advancedPhaseReviewPrompt(correctedConceptsFile, correctedOrchestrationFile, phase, phasePaths), contextPaths: ["planning-review-draft/concepts.md", "planning-review-draft/orchestration.md", `planning-corrected/${phasePath}`], expectation: { kind: "files", allowedPaths: ["review.md", phasePath], requiredPaths: ["review.md", phasePath], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, [phasePath]: PHASE_HEADINGS } } },
				(submission) => {
					const map = filesByPath(submission);
					validatePhase(phasePath, map.get(phasePath)!, correctedOrchestrationFile.content);
				},
				async (submission) => {
					const map = filesByPath(submission);
					return [
						await store.write(reviewPath, map.get("review.md")!),
						await store.write(`planning-review-draft/${phasePath}`, map.get(phasePath)!),
					];
				},
				signal,
			);
		});

		// Run all phase reviews concurrently via scoped fan-out.
		const phaseResults = await scopedFanOut(phaseFactories, this.#controller!.signal, "planning-phase-reviews");

		// Assemble results in frozen phase order.
		const plan = await Promise.all(names.map(async (path) => ({ path, content: await store.read(`planning-review-draft/${path}`) })));
		validatePlanFiles(plan);
		const componentPaths = ["reviews/advanced-plan-components/decomposition.md", "reviews/advanced-plan-components/concepts.md", "reviews/advanced-plan-components/orchestration.md", ...phasePaths.map((path) => `reviews/advanced-plan-components/${path.replace(/\.md$/, "")}.md`)];
		const reviews = await Promise.all(componentPaths.map(async (path) => {
			try { return { path: path.split("/").at(-1)!, content: await store.read(path) }; } catch { return { path: path.split("/").at(-1)!, content: "Review not persisted." }; }
		}));
		return { files: plan, reviewSummary: summarizePlanReviews(reviews) };
	}

	#manifestContent(directive: string, brainstorm: { roles: BrainstormRole[] }, plan: CorrectedPlanResult): string {
		const steps = Object.values(this.#state!.steps);
		const finalArtifacts = [
			fileRecord("reviews/advanced-plan-review.md", plan.reviewSummary),
			...plan.files.map((file) => fileRecord(`planning/${file.path}`, file.content)),
		];
		const artifacts = [this.#state!.inputArtifact, ...steps.flatMap((step) => step.artifacts), ...finalArtifacts];
		const phaseCount = plan.files.filter((file) => /^phase-\d{2}-/.test(file.path)).length;
		return [
			`# Sprint ${this.#state!.runId}`,
			"",
			"## Directive",
			"",
			directive,
			"",
			"## Stages",
			"",
			`- Brainstorm: ${brainstorm.roles.length} roles, all findings and cross-reviews complete`,
			"- Ironout: corrective handoff signed off",
			`- Planning: ${phaseCount} corrected phases plus concepts and orchestration; this is the terminal extension stage`,
			"",
			"## Artifacts",
			"",
			...artifacts.map((artifact) => `- \`${artifact.path}\` — sha256 \`${artifact.sha256}\``),
			"",
			"## Implementation Evidence",
			"",
			"Not produced by sprint-planner. Implementation is intentionally delegated to the separately installed `orchestrate` skill.",
			"",
			"## Final Validation",
			"",
			"Not run by sprint-planner. The `orchestrate` skill owns phase implementation and validation.",
			"",
			"## Outcome",
			"",
			"Planning completed successfully. The corrected plan is ready in `planning/`; runtime state and private child-session checkpoints were removed.",
			"",
		].join("\n");
	}

	async #publishFullSprint(plan: CorrectedPlanResult, manifest: string): Promise<OwnedPublication[]> {
		const runDirectory = this.#state!.runDirectory;
		const reviewPath = resolve(runDirectory, "reviews", "advanced-plan-review.md");
		const manifestPath = resolve(runDirectory, "manifest.md");
		const planPath = resolve(runDirectory, "planning");
		const [reviewState, manifestState, planState] = await Promise.all([
			existingFileState(reviewPath, plan.reviewSummary),
			existingFileState(manifestPath, manifest),
			existingPlanState(planPath, plan.files),
		]);
		const owned: OwnedPublication[] = [];
		try {
			if (reviewState === "absent") owned.push(await atomicCreateOwnedFile(reviewPath, plan.reviewSummary));
			if (manifestState === "absent") owned.push(await atomicCreateOwnedFile(manifestPath, manifest));
			if (planState === "absent") owned.push(await publishDirectoryExclusively(runDirectory, "planning", plan.files));
			return owned;
		} catch (error) {
			if (!(await rollbackPublications(owned))) throw new Error(`${errorText(error)} Publication rollback stopped because ownership could not be proven.`);
			throw error;
		}
	}

	/**
	 * Standalone call with explicit disposition-based charging — same rules as #step
	 * but using local state rather than persisted step state.
	 */
	async #standaloneCall(
		request: WorkerRequest,
		validate?: (submission: WorkerSubmission) => void,
		operationSignal: AbortSignal = this.#controller!.signal,
	): Promise<WorkerSubmission> {
		if (this.#progressStatus === "starting") this.#progressStatus = "running";
		let lastFeedback: { category: "provider" | "typed" | "semantic"; message: string } | undefined;
		let charged = 0;
		while (charged < MAX_STEP_ATTEMPTS) {
			if (operationSignal.aborted) {
				if (isFanOutCancellation(operationSignal.reason)) throw operationSignal.reason;
				throw new PausedError("Standalone workflow cancelled.");
			}
			this.#lastStep = request.role;
			const current = this.progress;
			if (current) this.callbacks.onProgress?.({ ...current, step: request.role });

			const retry = lastFeedback ? retryPrompt(lastFeedback, charged + 1) : undefined;
			let result: WorkerResult;
			try {
				result = await this.runner.run(
					{ ...request, retryPrompt: retry },
					operationSignal,
				);
			} catch (error) {
				if (isFanOutCancellation(operationSignal.reason)) throw operationSignal.reason;
				throw error;
			}

			if (result.disposition !== "completed") {
				if (isFanOutCancellation(operationSignal.reason)) throw operationSignal.reason;
				if (result.disposition === "interrupted" || this.#controller!.signal.aborted) {
					throw new PausedError(result.error ?? "Standalone workflow interrupted.");
				}
				throw new Error(result.error ?? "Standalone worker failed before provider start.");
			}

			// Charged.
			charged++;

			if (!result.ok) {
				const kind = result.failureKind ?? "fatal";
				const msg = result.error ?? "Worker failed.";
				lastFeedback = { category: kind === "transient" ? "provider" : kind === "malformed" ? "typed" : "provider", message: msg };
				if (kind === "fatal" || kind === "cancelled" || charged >= MAX_STEP_ATTEMPTS) throw new Error(msg);
				continue;
			}

			let submission: WorkerSubmission;
			try {
				submission = validateSubmission(result.submission, request.expectation);
			} catch (error) {
				const msg = errorText(error);
				lastFeedback = { category: "typed", message: msg };
				if (charged >= MAX_STEP_ATTEMPTS) throw new Error(msg);
				continue;
			}

			try {
				validate?.(submission);
			} catch (error) {
				const msg = errorText(error);
				lastFeedback = { category: "semantic", message: msg };
				if (charged >= MAX_STEP_ATTEMPTS) throw new Error(msg);
				continue;
			}

			return submission;
		}
		throw new Error("Standalone call exhausted its retries.");
	}

	#startStandalone(workflow: WorkflowName, options: StandaloneRunOptions): void {
		this.#workflow = workflow;
		this.#runId = options.id;
		this.#progressStatus = "starting";
		this.#state = undefined;
		this.#stateStore = undefined;
		this.#artifactStore = undefined;
		this.#controller = new AbortController();
		this.#requestedStop = undefined;
		this.#lastStep = undefined;
		this.#emitProgress();
	}

	#reportStandaloneValidationFailure(error: unknown, stagingDirectory: string): void {
		this.#progressStatus = "failed";
		this.#lastStep = "final validation";
		const progress = this.progress;
		try {
			if (progress) this.callbacks.onProgress?.({
				...progress,
				error: `${errorText(error)} Staged artifacts retained at ${stagingDirectory}.`,
			});
		} catch {
			// Validation failures must retain and rethrow the original error even if reporting fails.
		}
	}

	#request(options: StandaloneRunOptions, request: Omit<WorkerRequest, "cwd" | "persistent">): WorkerRequest {
		return { ...request, cwd: resolve(options.projectRoot), persistent: false };
	}

	async runStandaloneBrainstorm(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("brainstorm", options);
		const agents = this.agentConfiguration;
		const parent = resolve(options.internalDevPath, "brainstorm");
		const staging = await createStandaloneStaging(parent, options.id);
		const count = normalizeAgents(options.agents);
		const rolesResult = await this.#standaloneCall(this.#request(options, { id: `${options.id}-route`, role: "brainstorm role router", model: agents.roleRouter.model, mode: "planning", prompt: routeRolesPrompt(options.directive, count), contextPaths: [], expectation: { kind: "roles" } }));
		await staging.write("roles.json", rolesResult.content!);
		const roles = validateRoles(rolesResult.content, count);

		// Scoped fan-out for standalone findings.
		const findingFactories = roles.map((role) => (signal: AbortSignal) =>
			this.#standaloneCall(this.#request(options, { id: `${options.id}-findings-${role.id}`, role: role.name, model: agents.brainstormWorker.model, mode: "planning", prompt: brainstormPrompt(options.directive, role), contextPaths: [], expectation: markdownExpectation(BRAINSTORM_HEADINGS), sessionPath: `memory:${options.id}:${role.id}` }), undefined, signal),
		);
		const findings = await scopedFanOut(findingFactories, this.#controller!.signal, "standalone-findings");
		const findingReports = findings.map((submission, index) => ({ path: `${roles[index].id}/findings.md`, content: submission.content! }));
		await writeStagedFiles(staging, "", findingReports);
		try {
			validateBrainstormFindings(findingReports, roles.map((role) => `${role.id}/findings.md`));
		} catch (error) {
			this.#reportStandaloneValidationFailure(error, staging.runDirectory);
			throw error;
		}

		// Scoped fan-out for standalone cross-reviews.
		const crossFactories = roles.map((role) => (signal: AbortSignal) =>
			this.#standaloneCall(this.#request(options, { id: `${options.id}-cross-${role.id}`, role: `${role.name} cross reviewer`, model: agents.brainstormWorker.model, mode: "planning", prompt: crossReviewPrompt(role, findingReports.filter((item) => item.path !== `${role.id}/findings.md`)), contextPaths: findingReports.filter((item) => item.path !== `${role.id}/findings.md`).map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS), sessionPath: `memory:${options.id}:${role.id}` }), undefined, signal),
		);
		const crosses = await scopedFanOut(crossFactories, this.#controller!.signal, "standalone-cross-reviews");

		const crossReports = crosses.map((submission, index) => ({ path: `${roles[index].id}/cross-review.md`, content: submission.content! }));
		await writeStagedFiles(staging, "", crossReports);
		const allReports = [...findingReports, ...crossReports];
		const allReportPaths = allReports.map((item) => item.path);
		const synthesis = await this.#standaloneCall(this.#request(options, { id: `${options.id}-synthesis`, role: "brainstorm synthesizer", model: agents.brainstormSynthesis.model, mode: "planning", prompt: synthesisPrompt(options.directive, allReports), contextPaths: allReports.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) }));
		await staging.write("synthesis.md", synthesis.content!);
		try {
			validateSynthesisCoverage(synthesis.content!, allReportPaths);
		} catch (error) {
			this.#reportStandaloneValidationFailure(error, staging.runDirectory);
			throw error;
		}
		const redTeam = await this.#standaloneCall(this.#request(options, { id: `${options.id}-red-team`, role: "brainstorm red team", model: agents.brainstormRedTeam.model, mode: "planning", prompt: redTeamPrompt(synthesis.content!), contextPaths: ["synthesis.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) }));
		await staging.write("red-team.md", redTeam.content!);
		const finalPaths = [...allReportPaths, "synthesis.md", "red-team.md"];
		const publication = await publishDirectoryExclusively(parent, options.id, await readStagedFiles(staging, "", finalPaths));
		try {
			await removeStandaloneStaging(staging);
		} catch (error) {
			if (!(await removeOwnedDirectory(publication))) throw new Error(`${errorText(error)} Publication rollback stopped because ownership could not be proven.`);
			throw error;
		}
		return publication.path;
	}

	async runStandaloneIronout(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("ironout", options);
		const agents = this.agentConfiguration;
		const parent = resolve(options.internalDevPath, "handoffs");
		const staging = await createStandaloneStaging(parent, options.id);
		const draft = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-author`, role: "ironout author", model: agents.ironoutAuthor.model, mode: "planning", prompt: ironoutPrompt(options.directive, [], options.interactive !== false), contextPaths: [], expectation: markdownExpectation(HANDOFF_HEADINGS), allowQuestions: options.interactive !== false, maxQuestionRounds: 3 }),
			(submission) => validateHandoff(submission.content!),
		);
		await staging.write("draft.md", draft.content!);
		const reviewed = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-review`, role: "corrective ironout reviewer", model: agents.ironoutReviewer.model, mode: "planning", prompt: ironoutReviewPrompt(draft.content!), contextPaths: [], expectation: { kind: "files", allowedPaths: ["review.md", "handoff.md"], requiredPaths: ["review.md", "handoff.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "handoff.md": HANDOFF_HEADINGS } } }),
			(submission) => validateHandoff(filesByPath(submission).get("handoff.md")!),
		);
		await writeStagedFiles(staging, "", reviewed.files!);
		const handoff = await staging.read("handoff.md");
		try {
			validateHandoff(handoff);
		} catch (error) {
			this.#reportStandaloneValidationFailure(error, staging.runDirectory);
			throw error;
		}
		const target = resolve(parent, `${options.id}.md`);
		const publication = await atomicCreateOwnedFile(target, handoff);
		try {
			await removeStandaloneStaging(staging);
		} catch (error) {
			if (!(await removeOwnedFile(publication))) throw new Error(`${errorText(error)} Publication rollback stopped because ownership could not be proven.`);
			throw error;
		}
		return target;
	}

	async runStandaloneAdvancePlan(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("advanceplan", options);
		const plansParent = resolve(options.internalDevPath, "plans");
		const staging = await createStandaloneStaging(plansParent, options.id);
		const agents = this.agentConfiguration;
		const draft = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-plan`, role: "advanced planner", model: agents.planner.model, mode: "planning", prompt: advancedPlanPrompt(options.directive), contextPaths: [], expectation: { kind: "files", minFiles: 4, maxFiles: 22 }, maxSeniorCalls: agents.planner.maxSeniorCalls, seniorModel: seniorAdvisorModel(agents, agents.planner) }),
			(submission) => validateDraftPlanShape(submission.files!),
		);
		await writeStagedFiles(staging, "planning-draft", draft.files!);

		// ── Decomposition correction gate ──
		const decomp = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-review-decomposition`, role: "advanced decomposition reviewer", model: agents.decompositionReviewer.model, mode: "planning", prompt: advancedDecompositionReviewPrompt(options.directive, draft.files!), contextPaths: [], expectation: { kind: "files", minFiles: 5, maxFiles: 23 }, maxSeniorCalls: agents.decompositionReviewer.maxSeniorCalls, seniorModel: seniorAdvisorModel(agents, agents.decompositionReviewer) }),
			(submission) => {
				const review = submission.files!.filter((file) => file.path === "review.md");
				if (review.length !== 1) throw new Error("Decomposition review must submit exactly one review.md.");
				requiredHeadings(review[0].content, REVIEW_HEADINGS, "review.md");
				validatePlanFiles(submission.files!.filter((file) => file.path !== "review.md"));
			},
		);
		const decompositionReview = decomp.files!.find((file) => file.path === "review.md")!.content;
		const correctedFiles = decomp.files!.filter((file) => file.path !== "review.md");
		await writeStagedFiles(staging, "planning-corrected", correctedFiles);
		await staging.write("reviews/advanced-plan-components/decomposition.md", decompositionReview);
		validatePlanFiles(correctedFiles);
		const names = planNames(correctedFiles);
		const phasePaths = names.filter((path) => path !== "concepts.md" && path !== "orchestration.md");
		const baseConcepts = correctedFiles.find((file) => file.path === "concepts.md")!;
		const baseOrchestration = correctedFiles.find((file) => file.path === "orchestration.md")!;

		// Concepts review.
		const conceptReview = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-review-concepts`, role: "advanced concepts reviewer", model: agents.conceptsReviewer.model, mode: "planning", prompt: advancedConceptReviewPrompt(options.directive, baseConcepts, phasePaths), contextPaths: ["concepts.md"], expectation: { kind: "files", allowedPaths: ["review.md", "concepts.md"], requiredPaths: ["review.md", "concepts.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "concepts.md": CONCEPT_HEADINGS } } }),
			(submission) => validateConcept(filesByPath(submission).get("concepts.md")!),
		);
		const conceptMap = filesByPath(conceptReview);
		const correctedConcepts = { path: "concepts.md", content: conceptMap.get("concepts.md")! };
		await staging.write("planning-review-draft/concepts.md", correctedConcepts.content);
		await staging.write("reviews/advanced-plan-components/concepts.md", conceptMap.get("review.md")!);
		const componentReviews = [{ path: "decomposition.md", content: decompositionReview }, { path: "concepts.md", content: conceptMap.get("review.md")! }];

		// Orchestration review.
		const orchReview = await this.#standaloneCall(
			this.#request(options, { id: `${options.id}-review-orchestration`, role: "advanced orchestration reviewer", model: agents.orchestrationReviewer.model, mode: "planning", prompt: advancedOrchestrationReviewPrompt(options.directive, correctedConcepts, baseOrchestration, phasePaths), contextPaths: ["concepts.md", "orchestration.md"], expectation: { kind: "files", allowedPaths: ["review.md", "orchestration.md"], requiredPaths: ["review.md", "orchestration.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "orchestration.md": ORCHESTRATION_HEADINGS } } }),
			(submission) => validateOrchestration(filesByPath(submission).get("orchestration.md")!, phasePaths),
		);
		const orchMap = filesByPath(orchReview);
		componentReviews.push({ path: "orchestration.md", content: orchMap.get("review.md")! });
		const correctedOrchestration = { path: "orchestration.md", content: orchMap.get("orchestration.md")! };
		await staging.write("planning-review-draft/orchestration.md", correctedOrchestration.content);
		await staging.write("reviews/advanced-plan-components/orchestration.md", orchMap.get("review.md")!);

		// Concurrent phase reviews via scoped fan-out.
		const phaseFactories = phasePaths.map((phasePath) => (signal: AbortSignal) => {
			const phase = correctedFiles.find((file) => file.path === phasePath)!;
			return this.#standaloneCall(
				this.#request(options, { id: `${options.id}-review-${phasePath.replace(/\.md$/, "")}`, role: `advanced phase reviewer: ${phasePath}`, model: agents.phaseReviewer.model, mode: "planning", prompt: advancedPhaseReviewPrompt(correctedConcepts, correctedOrchestration, phase, phasePaths), contextPaths: ["concepts.md", "orchestration.md", phasePath], expectation: { kind: "files", allowedPaths: ["review.md", phasePath], requiredPaths: ["review.md", phasePath], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, [phasePath]: PHASE_HEADINGS } } }),
				(submission) => validatePhase(phasePath, filesByPath(submission).get(phasePath)!, correctedOrchestration.content),
				signal,
			);
		});
		const phaseSubmissions = await scopedFanOut(phaseFactories, this.#controller!.signal, "standalone-phase-reviews");

		// Assemble in frozen phase order and durably retain every phase correction.
		const phaseReviews: SubmittedFile[] = [];
		const correctedPhases: SubmittedFile[] = phaseSubmissions.map((submission, index) => {
			const map = filesByPath(submission);
			const review = { path: phasePaths[index], content: map.get("review.md")! };
			phaseReviews.push(review);
			componentReviews.push(review);
			return { path: phasePaths[index], content: map.get(phasePaths[index])! };
		});
		await writeStagedFiles(staging, "planning-review-draft", correctedPhases);
		await writeStagedFiles(staging, "reviews/advanced-plan-components", phaseReviews);

		const plan = [correctedConcepts, correctedOrchestration, ...correctedPhases];
		await writeStagedFiles(staging, "planning", plan);
		const stagedPlan = await readStagedFiles(staging, "planning", plan.map((file) => file.path));
		try {
			validatePlanFiles(stagedPlan);
		} catch (error) {
			this.#reportStandaloneValidationFailure(error, staging.runDirectory);
			throw error;
		}
		const reviewSummary = summarizePlanReviews(componentReviews);
		const reviewPath = resolve(options.internalDevPath, "reviews", `${options.id}-advanced-plan-review.md`);
		const owned: OwnedPublication[] = [];
		try {
			owned.push(await atomicCreateOwnedFile(reviewPath, reviewSummary));
			const planPublication = await publishDirectoryExclusively(plansParent, options.id, stagedPlan);
			owned.push(planPublication);
			await removeStandaloneStaging(staging);
			return planPublication.path;
		} catch (error) {
			if (!(await rollbackPublications(owned))) throw new Error(`${errorText(error)} Publication rollback stopped because ownership could not be proven.`);
			throw error;
		}
	}

	#trackDrive(drive: Promise<SprintState>): Promise<SprintState> {
		drive.then(() => this.#resolveSettled?.(), (error) => this.#rejectSettled?.(error));
		return drive;
	}

	// ── Lease lifecycle ──────────────────────────────────────────────────

	/** Release only after retained identity and bytes still match; failures retain the handle and surface. */
	async #releaseOwnedLease(): Promise<void> {
		if (!this.#leaseHandle) return;
		const handle = this.#leaseHandle;
		await releaseLease(handle);
		if (this.#leaseHandle === handle) this.#leaseHandle = undefined;
	}

	/** Expose the sprints root for list/doctor consumers. */
	get sprintsRoot(): string | undefined {
		return this.#sprintsRoot;
	}

	/** Expose the retained lease handle for list/doctor consumers. */
	get retainedLeaseHandle(): RunLeaseHandle | undefined {
		return this.#leaseHandle;
	}

}
