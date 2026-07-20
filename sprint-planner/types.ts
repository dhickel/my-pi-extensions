export const SPRINT_STATE_VERSION = 3;
export const PLAN_VALIDATION_RESULT_VERSION = 1;
export const LEASE_VERSION = 1;
export const RUN_RECORD_SCHEMA_VERSION = 1;
export const EXECUTION_RECORD_VERSION = 1;
export const DEFAULT_BRAINSTORM_AGENTS = 4;
export const MIN_BRAINSTORM_AGENTS = 2;
export const MAX_BRAINSTORM_AGENTS = 8;
export const MAX_STEP_ATTEMPTS = 3;

export const MODEL_ROUTES = {
	roleRouter: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	brainstormWorker: { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" },
	brainstormSynthesis: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	brainstormRedTeam: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	ironoutAuthor: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	ironoutReviewer: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
	advancedPlanner: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	advancedAdvisor: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "max" },
	advancedReviewer: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
} as const satisfies Record<string, ModelTuple>;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelTuple {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

export type WorkflowName = "sprint" | "brainstorm" | "ironout" | "advanceplan";
export type SprintStage = "brainstorm" | "ironout" | "planning" | "complete";
export type RunStatus = "running" | "paused" | "interrupted" | "failed" | "completed" | "cancelled";
export type ProgressStatus = RunStatus | "starting";
export type StepStatus = "pending" | "running" | "interrupted" | "completed" | "failed";
export type WorkerMode = "planning";
export type ScopeSize = "small" | "medium" | "large";

export const PHASE_BUDGETS: Record<ScopeSize, { min: number; max: number }> = {
	small: { min: 2, max: 3 },
	medium: { min: 3, max: 5 },
	large: { min: 6, max: 10 },
};

export const ORCHESTRATION_HEADINGS = ["Scope Size", "Phase Ledger", "Execution Waves", "Model Assignments", "Validation Gate", "Final Integration"];
export type SubmissionKind = "roles" | "markdown" | "files";

export interface ArtifactRecord {
	path: string;
	sha256: string;
	bytes: number;
}

export interface StepState {
	id: string;
	stage: SprintStage;
	status: StepStatus;
	attempts: number;
	model: ModelTuple;
	artifacts: ArtifactRecord[];
	sessionPath?: string;
	error?: string;
	/** Phase 02: exact retry feedback for the next attempt prompt. */
	lastRetryFeedback?: RetryFeedback;
	startedAt?: string;
	updatedAt: string;
	completedAt?: string;
}

export interface SprintState {
	version: typeof SPRINT_STATE_VERSION;
	runId: string;
	projectRoot: string;
	runDirectory: string;
	status: RunStatus;
	stage: SprintStage;
	directivePath: string;
	inputArtifact: ArtifactRecord;
	agents: number;
	steps: Record<string, StepState>;
	error?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface SubmittedFile {
	path: string;
	content: string;
}

export interface WorkerSubmission {
	kind: SubmissionKind;
	content?: string;
	files?: SubmittedFile[];
}

export interface SubmissionExpectation {
	kind: SubmissionKind;
	allowedPaths?: string[];
	requiredPaths?: string[];
	minFiles?: number;
	maxFiles?: number;
	headings?: Record<string, string[]>;
}

export interface WorkerRequest {
	id: string;
	role: string;
	model: ModelTuple;
	mode: WorkerMode;
	cwd: string;
	prompt: string;
	contextPaths: string[];
	expectation: SubmissionExpectation;
	persistent: boolean;
	sessionDirectory?: string;
	sessionPath?: string;
	allowQuestions?: boolean;
	maxQuestionRounds?: number;
	maxSeniorCalls?: number;
	seniorModel?: ModelTuple;
	retryPrompt?: string;
}

export type WorkerFailureKind = "transient" | "malformed" | "fatal" | "cancelled";

/** Runner disposition: whether the provider was reached and charged. */
export type RunnerDisposition = "completed" | "interrupted" | "not-started";

/** Retry-feedback category for exact model correction prompts. */
export type RetryCategory = "provider" | "typed" | "semantic";

/** Stored retry feedback carried across attempts. */
export interface RetryFeedback {
	category: RetryCategory;
	message: string;
}

export interface WorkerResult {
	ok: boolean;
	submission?: WorkerSubmission;
	sessionPath?: string;
	finalText?: string;
	error?: string;
	failureKind?: WorkerFailureKind;
	/** Disposition set by the runner so the engine can charge attempts correctly. */
	disposition?: RunnerDisposition;
}

export interface PreparedWorker {
	sessionPath?: string;
}

export interface WorkflowRunner {
	prepare?(request: WorkerRequest): Promise<PreparedWorker>;
	run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult>;
	abortAll(reason?: string): Promise<void> | void;
}

export interface BrainstormRole {
	id: string;
	name: string;
	lens: string;
}

export interface EngineProgress {
	workflow: WorkflowName;
	runId: string;
	status: ProgressStatus;
	stage: string;
	step?: string;
	completed: number;
	total: number;
	error?: string;
}

export interface EngineCallbacks {
	onProgress?(progress: EngineProgress): void;
	onState?(state: SprintState): void;
}

export interface SprintRunOptions {
	projectRoot: string;
	internalDevPath: string;
	runId: string;
	directive: string;
	agents?: number;
}

export interface StandaloneRunOptions {
	projectRoot: string;
	internalDevPath: string;
	id: string;
	directive: string;
	agents?: number;
	interactive?: boolean;
}

// ── Structured plan validation ──────────────────────────────────────────

export type PlanValidationCategory =
	| "root"
	| "shape"
	| "phase-budget"
	| "phase-metadata"
	| "dependency"
	| "wave"
	| "target"
	| "model-route"
	| "gate"
	| "integration"
	| "symbolic-link";

export interface PlanValidationFinding {
	code: string;
	category: PlanValidationCategory;
	message: string;
	path?: string;
}

export interface PlanValidationMetadata {
	phaseCount: number;
	scopeSize?: ScopeSize;
	phasePaths: readonly string[];
	waveCount: number;
}

export interface PlanValidationResult {
	version: typeof PLAN_VALIDATION_RESULT_VERSION;
	valid: boolean;
	metadata: PlanValidationMetadata;
	findings: readonly PlanValidationFinding[];
}

// ── Run records, leases, and discovery ──────────────────────────────────

export type RunKind = "planning" | "execution";

export interface RunLeaseRecord {
	version: typeof LEASE_VERSION;
	runId: string;
	runKind: RunKind;
	ownerId: string;
	pid: number;
	hostname: string;
	acquiredAt: string;
}

export interface RunLeaseHandle {
	path: string;
	record: RunLeaseRecord;
	expectedBytes: number;
	digest: string;
	byteCount: number;
	device: string;
	inode: string;
}

export interface RunReservation {
	path: string;
	device: string;
	inode: string;
}

export type LeaseOwnership = "owned-by-this-runtime" | "unleased" | "held-by-other" | "uncertain";

export type RunRecordKind = "planning" | "execution-only" | "ambiguous" | "malformed" | "unknown";

export interface RunRecordSummary {
	version: typeof RUN_RECORD_SCHEMA_VERSION;
	runId: string;
	kind: RunRecordKind;
	state: string;
	leaseOwnership: LeaseOwnership;
	leaseRunKind?: RunKind;
	markers: {
		state: boolean;
		manifest: boolean;
		execution: boolean;
	};
}

// ── Execution records ────────────────────────────────────────────────────

export type ExecutionRecordState = "active" | "completed" | "blocked" | "interrupted";

export interface SourceDescriptor {
	projectRoot: string;
	sourcePlanPath: string;
	sourcePlanningRunId?: string;
	aggregateDigest: string;
	files: ArtifactRecord[];
}

export interface FrozenOrchestrationSnapshot {
	scopeSize: string;
	phases: string[];
	dependencies: Record<string, string[]>;
	waves: Record<string, number>;
	goals: Record<string, string>;
	targets: Record<string, string[]>;
	implementationModel: ModelTuple;
	validationModel: ModelTuple;
}

export interface ChangedFileObservation {
	path: string;
	status: "present" | "deleted";
	digest?: string;
	bytes?: number;
}

export interface ExecutionEvidence {
	agentModel: ModelTuple;
	report: string;
	/** Compatibility index; observations below are authoritative. */
	changedFiles: string[];
	changedFileObservations: ChangedFileObservation[];
	timestamp: string;
}

export interface PhaseEvidence {
	phase: string;
	implementation?: ExecutionEvidence;
	validator?: ExecutionEvidence & { verdict: "PASS" | "BLOCKED" };
}

export interface SourceDriftEvidence {
	observedAt: string;
	reason: string;
}

export interface ExecutionRecord {
	version: typeof EXECUTION_RECORD_VERSION;
	runId: string;
	state: ExecutionRecordState;
	revision: number;
	source: SourceDescriptor;
	frozen: FrozenOrchestrationSnapshot;
	phases: PhaseEvidence[];
	integration?: ExecutionEvidence & { verdict: "PASS" | "BLOCKED" };
	blocker?: {
		reason: string;
		timestamp: string;
		changedFileObservations: ChangedFileObservation[];
	};
	interrupted?: {
		reason: string;
		timestamp: string;
		changedFileObservations: ChangedFileObservation[];
	};
	completion?: { report: string; timestamp: string; changedFileObservations: ChangedFileObservation[] };
	sourceDrift?: SourceDriftEvidence;
	terminalAt?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface ExecutionRecordManifest {
	runId: string;
	state: ExecutionRecordState;
	revision: number;
	sourceDescriptor: SourceDescriptor;
	frozenOrchestration: FrozenOrchestrationSnapshot;
	phases: PhaseEvidence[];
	integration?: ExecutionRecord["integration"];
	blocker?: ExecutionRecord["blocker"];
	interrupted?: ExecutionRecord["interrupted"];
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	terminalAt?: string;
}

export type CheckpointAction = "implementation" | "phase_validation" | "integration_validation";
export type FinishAction = "completed" | "blocked" | "interrupted";

export interface StartParams {
	action: "start";
	sourcePlanPath: string;
	sourcePlanningRunId?: string;
	name?: string;
}

export interface CheckpointParams {
	action: "checkpoint";
	runId: string;
	expectedRevision: number;
	type: CheckpointAction;
	phase?: string;
	verdict?: "PASS" | "BLOCKED";
	report: string;
	changedPaths?: string[];
}

export interface FinishParams {
	action: "finish";
	runId: string;
	expectedRevision: number;
	type: FinishAction;
	reason: string;
	changedPaths?: string[];
}

export type DoctorSeverity = "info" | "warning" | "error" | "critical";

export interface DoctorFinding {
	code: string;
	severity: DoctorSeverity;
	message: string;
	path?: string;
	action?: string;
}

export interface DoctorReport {
	version: typeof RUN_RECORD_SCHEMA_VERSION;
	runId: string;
	runKind: RunRecordKind;
	findings: readonly DoctorFinding[];
	leaseOwnership: LeaseOwnership;
	executionBaseline?: boolean;
}
