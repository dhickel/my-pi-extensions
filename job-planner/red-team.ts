import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type EventBus,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validateJobPlan, type JobPlanInput } from "./core.ts";

export const AGENT_ASSIGNMENT_REQUEST_CHANNEL = "sprint-planner:agent-assignment:request:v1";
export const AGENT_ASSIGNMENT_RESPONSE_PREFIX = "sprint-planner:agent-assignment:response:v1:";
export const RED_TEAM_VALIDATOR_ROLE = "redTeamValidator";
export const RED_TEAM_SUBMIT_TOOL = "job_red_team_submit";

export const JOB_PLAN_SECTIONS = [
	"Feature",
	"Required Behavior",
	"Targets",
	"Constraints",
	"Assumptions",
	"Settled Decisions",
	"Implementation Approach",
	"Validation Criteria",
	"Out of Scope",
] as const;

export interface ModelTuple {
	provider: string;
	model: string;
	thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface RedTeamSectionReview {
	section: typeof JOB_PLAN_SECTIONS[number];
	assessment: string;
}

export interface RedTeamRepair {
	section: typeof JOB_PLAN_SECTIONS[number];
	issue: string;
	correction: string;
}

export interface RedTeamIssue {
	id: string;
	section: typeof JOB_PLAN_SECTIONS[number];
	summary: string;
	reasonUserDecisionIsRequired: string;
	question: string;
	options: Array<{ label: string; description?: string }>;
}

export interface PlanningAnswerEvidence {
	round: number;
	questionId: string;
	question: string;
	answer: string;
}

export interface RedTeamHandoffContext {
	correctedPlan: JobPlanInput;
	repairs: RedTeamRepair[];
	unresolvedIssues: RedTeamIssue[];
	answersSinceHandoff: PlanningAnswerEvidence[];
}

export interface RedTeamPlanningContext {
	answers: PlanningAnswerEvidence[];
	previousHandoff?: RedTeamHandoffContext;
}

export interface RedTeamHandoffReconciliation {
	issueId: string;
	status: "resolved" | "still-needs-user";
	resolution: string;
	evidence: string;
}

export interface RedTeamResult {
	verdict: "pass" | "needs-user";
	correctedPlan: JobPlanInput;
	sectionReviews: RedTeamSectionReview[];
	repairs: RedTeamRepair[];
	unresolvedIssues: RedTeamIssue[];
	handoffReconciliations: RedTeamHandoffReconciliation[];
	model: ModelTuple;
	usage?: Usage;
}

export interface JobPlanRedTeamValidator {
	validate(cwd: string, directive: string, candidate: JobPlanInput, context: RedTeamPlanningContext, signal?: AbortSignal): Promise<RedTeamResult>;
	abortAll(): Promise<void>;
}

const shortText = (maxLength = 100_000) => Type.String({ minLength: 1, maxLength });
const stringList = (minItems: number) => Type.Array(shortText(), { minItems, maxItems: 200 });

export const JOB_PLAN_SCHEMA = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 160 }),
	feature: shortText(),
	requirements: stringList(1),
	targets: Type.Array(Type.Object({
		target: Type.String({ minLength: 1, maxLength: 4096 }),
		change: shortText(),
	}, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
	constraints: stringList(1),
	assumptions: stringList(0),
	decisions: stringList(0),
	implementationSteps: stringList(1),
	validationCriteria: stringList(1),
	outOfScope: stringList(0),
}, { additionalProperties: false });

const sectionSchema = StringEnum(JOB_PLAN_SECTIONS);
const submissionSchema = Type.Object({
	verdict: StringEnum(["pass", "needs-user"] as const),
	correctedPlan: JOB_PLAN_SCHEMA,
	sectionReviews: Type.Array(Type.Object({
		section: sectionSchema,
		assessment: shortText(),
	}, { additionalProperties: false }), { minItems: JOB_PLAN_SECTIONS.length, maxItems: JOB_PLAN_SECTIONS.length }),
	repairs: Type.Array(Type.Object({
		section: sectionSchema,
		issue: shortText(),
		correction: shortText(),
	}, { additionalProperties: false }), { maxItems: 200 }),
	unresolvedIssues: Type.Array(Type.Object({
		id: Type.String({ minLength: 1, maxLength: 128 }),
		section: sectionSchema,
		summary: shortText(),
		reasonUserDecisionIsRequired: shortText(),
		question: shortText(),
		options: Type.Array(Type.Object({
			label: Type.String({ minLength: 1, maxLength: 160 }),
			description: Type.Optional(shortText()),
		}, { additionalProperties: false }), { maxItems: 5 }),
	}, { additionalProperties: false }), { maxItems: 100 }),
	handoffReconciliations: Type.Array(Type.Object({
		issueId: Type.String({ minLength: 1, maxLength: 128 }),
		status: StringEnum(["resolved", "still-needs-user"] as const),
		resolution: shortText(),
		evidence: shortText(),
	}, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });

type RawRedTeamSubmission = {
	verdict: "pass" | "needs-user";
	correctedPlan: JobPlanInput;
	sectionReviews: RedTeamSectionReview[];
	repairs: RedTeamRepair[];
	unresolvedIssues: RedTeamIssue[];
	handoffReconciliations: RedTeamHandoffReconciliation[];
};

function nonblank(value: unknown, path: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a nonblank string.`);
	return value.trim();
}

export function validateRedTeamSubmission(value: RawRedTeamSubmission, expectedHandoffIssueIds: readonly string[] = []): Omit<RedTeamResult, "model" | "usage"> {
	if (!value || typeof value !== "object") throw new Error("Red-team submission must be an object.");
	if (value.verdict !== "pass" && value.verdict !== "needs-user") throw new Error("Red-team verdict must be pass or needs-user.");
	const correctedPlan = validateJobPlan(value.correctedPlan);
	if (!Array.isArray(value.sectionReviews) || value.sectionReviews.length !== JOB_PLAN_SECTIONS.length) {
		throw new Error(`Red-team submission must review all ${JOB_PLAN_SECTIONS.length} plan sections exactly once.`);
	}
	const reviewed = new Set<string>();
	const sectionReviews = value.sectionReviews.map((review, index) => {
		if (!JOB_PLAN_SECTIONS.includes(review.section)) throw new Error(`sectionReviews[${index}].section is invalid.`);
		if (reviewed.has(review.section)) throw new Error(`Plan section ${review.section} was reviewed more than once.`);
		reviewed.add(review.section);
		return { section: review.section, assessment: nonblank(review.assessment, `sectionReviews[${index}].assessment`) };
	});
	for (const section of JOB_PLAN_SECTIONS) {
		if (!reviewed.has(section)) throw new Error(`Plan section ${section} was not reviewed.`);
	}
	const repairs = (value.repairs ?? []).map((repair, index) => {
		if (!JOB_PLAN_SECTIONS.includes(repair.section)) throw new Error(`repairs[${index}].section is invalid.`);
		return {
			section: repair.section,
			issue: nonblank(repair.issue, `repairs[${index}].issue`),
			correction: nonblank(repair.correction, `repairs[${index}].correction`),
		};
	});
	const issueIds = new Set<string>();
	const unresolvedIssues = (value.unresolvedIssues ?? []).map((issue, index) => {
		const id = nonblank(issue.id, `unresolvedIssues[${index}].id`);
		if (issueIds.has(id.toLocaleLowerCase())) throw new Error(`Duplicate unresolved issue id ${id}.`);
		issueIds.add(id.toLocaleLowerCase());
		if (!JOB_PLAN_SECTIONS.includes(issue.section)) throw new Error(`unresolvedIssues[${index}].section is invalid.`);
		if (!Array.isArray(issue.options) || issue.options.length === 1 || issue.options.length > 5) {
			throw new Error(`unresolvedIssues[${index}].options must be empty or contain between 2 and 5 choices.`);
		}
		return {
			id,
			section: issue.section,
			summary: nonblank(issue.summary, `unresolvedIssues[${index}].summary`),
			reasonUserDecisionIsRequired: nonblank(issue.reasonUserDecisionIsRequired, `unresolvedIssues[${index}].reasonUserDecisionIsRequired`),
			question: nonblank(issue.question, `unresolvedIssues[${index}].question`),
			options: issue.options.map((option, optionIndex) => ({
				label: nonblank(option.label, `unresolvedIssues[${index}].options[${optionIndex}].label`),
				...(option.description === undefined ? {} : { description: nonblank(option.description, `unresolvedIssues[${index}].options[${optionIndex}].description`) }),
			})),
		};
	});
	const reconciliationIds = new Set<string>();
	const handoffReconciliations = (value.handoffReconciliations ?? []).map((item, index) => {
		const issueId = nonblank(item.issueId, `handoffReconciliations[${index}].issueId`);
		const key = issueId.toLocaleLowerCase();
		if (reconciliationIds.has(key)) throw new Error(`Duplicate handoff reconciliation for ${issueId}.`);
		reconciliationIds.add(key);
		if (item.status !== "resolved" && item.status !== "still-needs-user") throw new Error(`handoffReconciliations[${index}].status is invalid.`);
		return {
			issueId,
			status: item.status,
			resolution: nonblank(item.resolution, `handoffReconciliations[${index}].resolution`),
			evidence: nonblank(item.evidence, `handoffReconciliations[${index}].evidence`),
		};
	});
	const expectedIds = new Set(expectedHandoffIssueIds.map((id) => id.toLocaleLowerCase()));
	if (reconciliationIds.size !== expectedIds.size || [...expectedIds].some((id) => !reconciliationIds.has(id))) {
		throw new Error("Red-team submission must reconcile every prior handoff issue exactly once and no others.");
	}
	if (value.verdict === "pass" && unresolvedIssues.length) throw new Error("A passing red-team submission cannot contain unresolved issues.");
	if (value.verdict === "pass" && handoffReconciliations.some((item) => item.status !== "resolved")) throw new Error("A passing red-team submission must resolve every prior handoff issue.");
	if (value.verdict === "needs-user" && !unresolvedIssues.length) throw new Error("A needs-user red-team submission must contain at least one unresolved issue.");
	const unresolvedIds = new Set(unresolvedIssues.map((issue) => issue.id.toLocaleLowerCase()));
	if (handoffReconciliations.some((item) => item.status === "still-needs-user" && !unresolvedIds.has(item.issueId.toLocaleLowerCase()))) throw new Error("A prior issue that still needs user authority must remain in unresolvedIssues with the same id.");
	return { verdict: value.verdict, correctedPlan, sectionReviews, repairs, unresolvedIssues, handoffReconciliations };
}

function validModelTuple(value: unknown): value is ModelTuple {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ModelTuple>;
	return typeof candidate.provider === "string" && Boolean(candidate.provider)
		&& typeof candidate.model === "string" && Boolean(candidate.model)
		&& ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(candidate.thinking));
}

export function requestRedTeamValidatorModel(events: EventBus, signal?: AbortSignal, timeoutMs = 500): Promise<ModelTuple> {
	const requestId = `job-red-team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const responseChannel = `${AGENT_ASSIGNMENT_RESPONSE_PREFIX}${requestId}`;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error, model?: ModelTuple) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			signal?.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolve(model!);
		};
		const unsubscribe = events.on(responseChannel, (data) => {
			const response = data as { version?: number; requestId?: string; agentId?: string; model?: unknown; error?: string };
			if (response?.version !== 1 || response.requestId !== requestId || response.agentId !== RED_TEAM_VALIDATOR_ROLE) return;
			if (response.error) return finish(new Error(response.error));
			if (!validModelTuple(response.model)) return finish(new Error("Sprint Planner returned an invalid redTeamValidator model tuple."));
			finish(undefined, { ...response.model });
		});
		const timer = setTimeout(() => finish(new Error("The Sprint Planner agent-configuration service is unavailable; redTeamValidator cannot be resolved.")), timeoutMs);
		const abort = () => finish(new Error("Red-team model resolution was cancelled."));
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) return abort();
		events.emit(AGENT_ASSIGNMENT_REQUEST_CHANNEL, { version: 1, requestId, agentId: RED_TEAM_VALIDATOR_ROLE });
	});
}

export function redTeamPrompt(directive: string, candidate: JobPlanInput, context: RedTeamPlanningContext = { answers: [] }): string {
	return `You are the mandatory red-team validator for a collaboratively prepared job plan. Review and correct the complete plan before publication.\n\n` +
		`Initial user directive (later interview answers may explicitly refine or amend it):\n<directive>\n${directive}\n</directive>\n\n` +
		`Authoritative planning evidence, including user answers and any prior validator handoff:\n<planning-evidence-json>\n${JSON.stringify(context, null, 2)}\n</planning-evidence-json>\n\n` +
		`Candidate structured plan:\n<plan-json>\n${JSON.stringify(candidate, null, 2)}\n</plan-json>\n\n` +
		`Inspect relevant repository files with read-only tools when needed. Step through every required plan section exactly once and test the plan as a whole for oversights, internal inconsistencies, architectural contradictions, incorrect targets or assumptions, missing edge/failure behavior, incomplete validation, scope drift, and conflicts with repository contracts.\n\n` +
		`Act in best faith to avoid unnecessary user questions. Correct every issue whose solution follows safely from the directive, repository evidence, settled decisions, or an unambiguous consistency repair. Preserve the user's scope and authority; do not invent product decisions, broaden the feature, or silently choose between materially different outcomes. After repairs, reread the entire corrected plan and return verdict pass only when it is coherent and has no consequential unresolved issue.\n\n` +
		`When a previous handoff is present, compare the new candidate against its corrected draft and repairs, use only recorded answersSinceHandoff as new user authority, and reconcile every previous unresolved issue exactly once in handoffReconciliations. Mark it resolved and cite the answer that resolves it, or mark it still-needs-user and retain the same issue id in unresolvedIssues when no relevant authority was supplied. An unrelated answer is not authority, and a dropped repair must be restored unless later user evidence supersedes it.\n\n` +
		`When a heavy contradiction, missing authority, or insufficient context prevents a safe correction, preserve all inferable repairs and return verdict needs-user with a concise handoff issue for each required decision. Supply 2-5 meaningful options when the choice can be represented that way, otherwise leave options empty for an open written answer.\n\n` +
		`Call ${RED_TEAM_SUBMIT_TOOL} exactly once with the complete corrected plan, one review entry for each section, every applied repair, all unresolved issues, and the exact prior-handoff reconciliations (empty when there was no prior handoff). Do not merely describe the review in prose and do not modify repository files.`;
}

function finalAssistant(messages: readonly unknown[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as { role?: string };
		if (message?.role === "assistant") return message as AssistantMessage;
	}
	return undefined;
}

interface ActiveValidationOperation {
	controller: AbortController;
	settled: Promise<void>;
}

function throwIfValidationAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new Error("Plan validation was cancelled.");
}

export function assertRedTeamProviderBoundary(ctx: { model?: { provider: string; id: string }; thinkingLevel?: string }, model: ModelTuple, signal: AbortSignal): void {
	throwIfValidationAborted(signal);
	if (ctx.model?.provider !== model.provider || ctx.model.id !== model.model || ctx.thinkingLevel !== model.thinking) {
		throw new Error(`Red-team provider boundary drifted from ${model.provider}/${model.model}:${model.thinking}.`);
	}
}

export function guardRedTeamStream<TModel extends { provider: string; id: string }, TArgs extends unknown[], TResult>(
	stream: (model: TModel, ...args: TArgs) => TResult,
	model: ModelTuple,
	signal: AbortSignal,
	thinkingLevel: () => ModelTuple["thinking"],
): (requestModel: TModel, ...args: TArgs) => TResult {
	return (requestModel, ...args) => {
		assertRedTeamProviderBoundary({ model: requestModel, thinkingLevel: thinkingLevel() }, model, signal);
		return stream(requestModel, ...args);
	};
}

export class PiJobPlanRedTeamValidator implements JobPlanRedTeamValidator {
	readonly events: EventBus;
	readonly #active = new Set<Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]>();
	readonly #operations = new Set<ActiveValidationOperation>();

	constructor(events: EventBus) {
		this.events = events;
	}

	async validate(cwd: string, directive: string, candidate: JobPlanInput, context: RedTeamPlanningContext, signal?: AbortSignal): Promise<RedTeamResult> {
		const controller = new AbortController();
		let resolveSettled!: () => void;
		const operation: ActiveValidationOperation = { controller, settled: new Promise((resolve) => { resolveSettled = resolve; }) };
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) controller.abort();
		this.#operations.add(operation);
		try {
			return await this.#runValidation(cwd, directive, candidate, context, controller.signal);
		} finally {
			signal?.removeEventListener("abort", abort);
			this.#operations.delete(operation);
			resolveSettled();
		}
	}

	async #runValidation(cwd: string, directive: string, candidate: JobPlanInput, context: RedTeamPlanningContext, signal: AbortSignal): Promise<RedTeamResult> {
		const normalizedCandidate = validateJobPlan(candidate);
		throwIfValidationAborted(signal);
		const modelTuple = await requestRedTeamValidatorModel(this.events, signal);
		throwIfValidationAborted(signal);
		const expectedHandoffIssueIds = context.previousHandoff?.unresolvedIssues.map((issue) => issue.id) ?? [];
		let submission: Omit<RedTeamResult, "model" | "usage"> | undefined;
		const submitTool = {
			name: RED_TEAM_SUBMIT_TOOL,
			label: "Submit red-team plan validation",
			description: "Submit the complete corrected job plan, exhaustive section review, applied repairs, unresolved user decisions, prior-handoff reconciliations, and final validation verdict.",
			parameters: submissionSchema,
			executionMode: "sequential" as const,
			async execute(_toolCallId: string, params: RawRedTeamSubmission) {
				if (submission) throw new Error("Red-team validation has already been submitted.");
				submission = validateRedTeamSubmission(params, expectedHandoffIssueIds);
				return {
					content: [{ type: "text" as const, text: "Red-team validation accepted. Finish without resubmitting." }],
					details: { accepted: true, verdict: submission.verdict },
					terminate: true,
				};
			},
		};

		const services = await createAgentSessionServices({ cwd, agentDir: getAgentDir(), modelRuntimeSignal: signal });
		throwIfValidationAborted(signal);
		const errors = services.diagnostics.filter((diagnostic) => diagnostic.type === "error");
		if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join("; "));
		const model = services.modelRuntime.getModel(modelTuple.provider, modelTuple.model);
		if (!model) throw new Error(`Required redTeamValidator model is unavailable: ${modelTuple.provider}/${modelTuple.model}`);
		if (!services.modelRuntime.hasConfiguredAuth(modelTuple.provider)) throw new Error(`Required redTeamValidator model has no configured authentication: ${modelTuple.provider}/${modelTuple.model}`);
		if (!getSupportedThinkingLevels(model).includes(modelTuple.thinking)) {
			throw new Error(`${modelTuple.provider}/${modelTuple.model} does not support required thinking level ${modelTuple.thinking}.`);
		}
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(cwd),
			model,
			thinkingLevel: modelTuple.thinking,
			tools: ["read", "grep", "find", "ls", RED_TEAM_SUBMIT_TOOL],
			customTools: [submitTool],
			sessionStartEvent: { type: "session_start", reason: "startup" },
		});
		const session = created.session;
		const stream = session.agent.streamFunction;
		session.agent.streamFunction = guardRedTeamStream(stream, modelTuple, signal, () => session.thinkingLevel as ModelTuple["thinking"]);
		this.#active.add(session);
		const abortSession = () => void session.abort().catch(() => undefined);
		signal.addEventListener("abort", abortSession, { once: true });
		try {
			throwIfValidationAborted(signal);
			const extensionErrors: string[] = [];
			await session.bindExtensions({ mode: "print", onError: (error) => extensionErrors.push(`${error.extensionPath}: ${error.error}`) });
			throwIfValidationAborted(signal);
			if (extensionErrors.length) throw new Error(extensionErrors.join("; "));
			if (session.model?.provider !== modelTuple.provider || session.model.id !== modelTuple.model || session.thinkingLevel !== modelTuple.thinking) {
				throw new Error(`Red-team child model tuple drifted from ${modelTuple.provider}/${modelTuple.model}:${modelTuple.thinking}.`);
			}
			await session.prompt(redTeamPrompt(directive, normalizedCandidate, context), { expandPromptTemplates: false, source: "extension" });
			const assistant = finalAssistant(session.messages);
			if (signal.aborted || assistant?.stopReason === "aborted") throw new Error("Plan validation was cancelled.");
			if (!assistant || assistant.stopReason === "error" || assistant.errorMessage) throw new Error(assistant?.errorMessage ?? "redTeamValidator failed without a terminal assistant response.");
			if (!submission) throw new Error(`redTeamValidator completed without calling ${RED_TEAM_SUBMIT_TOOL}.`);
			return { ...submission, model: modelTuple, usage: assistant.usage };
		} finally {
			signal.removeEventListener("abort", abortSession);
			this.#active.delete(session);
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => undefined);
			session.dispose();
		}
	}

	async abortAll(): Promise<void> {
		const operations = [...this.#operations];
		for (const operation of operations) operation.controller.abort();
		await Promise.allSettled([...this.#active].map((session) => session.abort()));
		await Promise.allSettled(operations.map((operation) => operation.settled));
	}
}
