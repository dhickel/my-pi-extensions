export const SPRINT_STATE_VERSION = 2;
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
	ironoutReviewer: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
	advancedPlanner: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
	advancedAdvisor: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "max" },
	advancedReviewer: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
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
export type StepStatus = "pending" | "running" | "interrupted" | "completed" | "failed";
export type WorkerMode = "planning";
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

export interface WorkerResult {
	ok: boolean;
	submission?: WorkerSubmission;
	sessionPath?: string;
	finalText?: string;
	error?: string;
	failureKind?: WorkerFailureKind;
}

export interface PreparedWorker {
	sessionPath?: string;
}

export interface WorkflowRunner {
	prepare?(request: WorkerRequest): Promise<PreparedWorker>;
	run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult>;
	abortAll(reason?: string): Promise<void> | void;
}

export interface ArtifactSink {
	write(relativePath: string, content: string): Promise<ArtifactRecord>;
	read(relativePath: string): Promise<string>;
	exists(relativePath: string): Promise<boolean>;
	removeRuntimeFiles(): Promise<void>;
}

export interface BrainstormRole {
	id: string;
	name: string;
	lens: string;
}

export interface EngineProgress {
	workflow: WorkflowName;
	runId: string;
	status: RunStatus;
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
