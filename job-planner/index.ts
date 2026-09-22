import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS_PER_ROUND,
	MIN_OPTIONS,
	OTHER_LABEL,
	publishJobPlan,
	validateJobPlan,
	validateQuestions,
	type JobPlanInput,
	type PublishedJobPlan,
} from "./core.ts";
import {
	PiJobPlanRedTeamValidator,
	JOB_PLAN_SCHEMA,
	JOB_PLAN_SECTIONS,
	type JobPlanRedTeamValidator,
	type ModelTuple,
	type PlanningAnswerEvidence,
	type RedTeamIssue,
	type RedTeamRepair,
} from "./red-team.ts";

const STATE_ENTRY = "job-planner-state-v1";
const STATUS_KEY = "job-planner";

type JobStatus = "active" | "completed" | "cancelled" | "blocked";

interface PendingValidation {
	correctedPlan: JobPlanInput;
	repairs: RedTeamRepair[];
	unresolvedIssues: RedTeamIssue[];
	model: ModelTuple;
	questionsAtHandoff: number;
	answerIndexAtHandoff: number;
}

interface JobState {
	version: 2;
	status: JobStatus;
	directive: string;
	rounds: number;
	questions: number;
	startedAt: string;
	planPath?: string;
	validationAttempts?: number;
	answers?: PlanningAnswerEvidence[];
	pendingValidation?: PendingValidation;
	restoreError?: string;
}

interface JobPlannerDependencies {
	redTeamValidator?: JobPlanRedTeamValidator;
	publishPlan?: (cwd: string, plan: JobPlanInput, interview: { rounds: number; questions: number }, validation: Parameters<typeof publishJobPlan>[3], signal?: AbortSignal) => Promise<PublishedJobPlan>;
	now?: () => string;
}

const validCounter = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const requiredText = (value: unknown, path: string): string => {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} is invalid.`);
	return value.trim();
};

function blockedRestoredState(value: unknown, error: unknown): JobState {
	const candidate = value && typeof value === "object" ? value as Partial<JobState> : {};
	return {
		version: 2,
		status: "blocked",
		directive: typeof candidate.directive === "string" && candidate.directive.trim() ? candidate.directive.trim() : "Invalid restored job-planning state",
		rounds: 0,
		questions: 0,
		validationAttempts: 0,
		answers: [],
		startedAt: typeof candidate.startedAt === "string" && candidate.startedAt.trim() ? candidate.startedAt.trim() : new Date(0).toISOString(),
		restoreError: error instanceof Error ? error.message : String(error),
	};
}

function parsePendingValidation(value: unknown, questionCount: number, answerCount: number): PendingValidation {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pendingValidation is invalid.");
	const candidate = value as Partial<PendingValidation>;
	if (!Array.isArray(candidate.repairs) || !Array.isArray(candidate.unresolvedIssues) || !candidate.unresolvedIssues.length) throw new Error("pendingValidation handoff lists are invalid.");
	const repairs = candidate.repairs.map((repair, index) => {
		if (!repair || !JOB_PLAN_SECTIONS.includes(repair.section)) throw new Error(`pendingValidation.repairs[${index}] is invalid.`);
		return { section: repair.section, issue: requiredText(repair.issue, `pendingValidation.repairs[${index}].issue`), correction: requiredText(repair.correction, `pendingValidation.repairs[${index}].correction`) };
	});
	const issueIds = new Set<string>();
	const unresolvedIssues = candidate.unresolvedIssues.map((issue, index) => {
		if (!issue || !JOB_PLAN_SECTIONS.includes(issue.section)) throw new Error(`pendingValidation.unresolvedIssues[${index}] is invalid.`);
		const id = requiredText(issue.id, `pendingValidation.unresolvedIssues[${index}].id`);
		if (issueIds.has(id.toLocaleLowerCase())) throw new Error(`pendingValidation contains duplicate issue ${id}.`);
		issueIds.add(id.toLocaleLowerCase());
		if (!Array.isArray(issue.options) || issue.options.length === 1 || issue.options.length > 5) throw new Error(`pendingValidation.unresolvedIssues[${index}].options is invalid.`);
		return {
			id,
			section: issue.section,
			summary: requiredText(issue.summary, `pendingValidation.unresolvedIssues[${index}].summary`),
			reasonUserDecisionIsRequired: requiredText(issue.reasonUserDecisionIsRequired, `pendingValidation.unresolvedIssues[${index}].reason`),
			question: requiredText(issue.question, `pendingValidation.unresolvedIssues[${index}].question`),
			options: issue.options.map((option, optionIndex) => ({
				label: requiredText(option?.label, `pendingValidation.unresolvedIssues[${index}].options[${optionIndex}].label`),
				...(option?.description === undefined ? {} : { description: requiredText(option.description, `pendingValidation.unresolvedIssues[${index}].options[${optionIndex}].description`) }),
			})),
		};
	});
	if (!candidate.model || typeof candidate.model.provider !== "string" || typeof candidate.model.model !== "string" || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(candidate.model.thinking))) throw new Error("pendingValidation.model is invalid.");
	if (!validCounter(candidate.questionsAtHandoff) || candidate.questionsAtHandoff > questionCount) throw new Error("pendingValidation.questionsAtHandoff is invalid.");
	if (!validCounter(candidate.answerIndexAtHandoff) || candidate.answerIndexAtHandoff > answerCount) throw new Error("pendingValidation.answerIndexAtHandoff is invalid.");
	return {
		correctedPlan: validateJobPlan(candidate.correctedPlan),
		repairs,
		unresolvedIssues,
		model: { ...candidate.model } as ModelTuple,
		questionsAtHandoff: candidate.questionsAtHandoff,
		answerIndexAtHandoff: candidate.answerIndexAtHandoff,
	};
}

function parseState(value: unknown): JobState {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Job-planning state is not an object.");
	const candidate = value as Partial<JobState>;
	const rawVersion = (value as { version?: number }).version;
	if (rawVersion === 1 && (candidate.status === "completed" || candidate.status === "cancelled")) {
		if (!validCounter(candidate.rounds) || !validCounter(candidate.questions) || typeof candidate.directive !== "string" || typeof candidate.startedAt !== "string") throw new Error("Legacy job-planning state is invalid.");
		return { ...candidate, version: 2, answers: [], validationAttempts: validCounter(candidate.validationAttempts) ? candidate.validationAttempts : 0 } as JobState;
	}
	if (rawVersion !== 2 || !["active", "completed", "cancelled", "blocked"].includes(String(candidate.status))) throw new Error("Job-planning state version or status is invalid.");
	const directive = requiredText(candidate.directive, "directive");
	const startedAt = requiredText(candidate.startedAt, "startedAt");
	if (!validCounter(candidate.rounds) || !validCounter(candidate.questions) || !validCounter(candidate.validationAttempts ?? 0)) throw new Error("Job-planning counters are invalid.");
	if (!Array.isArray(candidate.answers ?? [])) throw new Error("Job-planning answer evidence is invalid.");
	const answers = (candidate.answers ?? []).map((answer, index) => {
		if (!answer || !validCounter(answer.round) || answer.round < 1) throw new Error(`answers[${index}].round is invalid.`);
		return { round: answer.round, questionId: requiredText(answer.questionId, `answers[${index}].questionId`), question: requiredText(answer.question, `answers[${index}].question`), answer: requiredText(answer.answer, `answers[${index}].answer`) };
	});
	if (answers.length !== candidate.questions) throw new Error("Job-planning answer evidence does not match the question counter.");
	const pendingValidation = candidate.pendingValidation === undefined ? undefined : parsePendingValidation(candidate.pendingValidation, candidate.questions, answers.length);
	if (pendingValidation && candidate.status !== "active") throw new Error("Only an active workflow may contain a pending validation handoff.");
	return { ...candidate, directive, startedAt, rounds: candidate.rounds, questions: candidate.questions, validationAttempts: candidate.validationAttempts ?? 0, answers, pendingValidation } as JobState;
}

function latestState(ctx: ExtensionContext): JobState | undefined {
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY) continue;
		try {
			return parseState(candidate.data);
		} catch (error) {
			return blockedRestoredState(candidate.data, error);
		}
	}
	return undefined;
}

function planningPrompt(directive: string): string {
	return `Plan this job collaboratively. Do not implement it yet.\n\nDirective:\n${directive}\n\n` +
		"First inspect the repository, applicable instructions, specifications, tests, and relevant implementation so you do not ask for discoverable facts. For broader inspection you may run a read-only exploration team per the installed exploration skill (fixed openai-codex/gpt-6-luna:high read-only agents); exploration is context acquisition only and never edits files. Then interview me in iterative rounds using job_ask_choices for concrete decisions and job_ask_text only when meaningful choices cannot capture the needed nuance. Ask follow-up questions after each answer until you have a detailed, robust view of the requested behavior. Resolve scope, targets, constraints, assumptions, edge cases, compatibility, and validation. Do not stop after an arbitrary number of rounds, and do not finalize while a consequential ambiguity remains. Keep planning decisions, user questioning, and implementation authority on this root thread. When the task is fully understood, call job_plan_submit with the complete candidate plan. That tool runs mandatory red-team validation before publication. If it returns an unresolved-issues handoff, ask the user the required decisions with job_ask_choices or job_ask_text, incorporate the answers and validator repairs, and submit the full revised plan again. Exactly one successful validated publication is allowed; do not implement or create another plan manually.";
}

function handoffText(pending: PendingValidation): string {
	const issues = pending.unresolvedIssues.map((issue, index) => {
		const options = issue.options.length
			? `\n   Suggested choices:\n${issue.options.map((option) => `   - ${option.label}${option.description ? ` — ${option.description}` : ""}`).join("\n")}`
			: "\n   Use an open written question.";
		return `${index + 1}. [${issue.section}] (${issue.id}) ${issue.summary}\n   Why user authority is required: ${issue.reasonUserDecisionIsRequired}\n   Question: ${issue.question}${options}`;
	}).join("\n");
	const repairs = pending.repairs.length
		? pending.repairs.map((repair, index) => `${index + 1}. [${repair.section}] ${repair.issue}\n   Applied correction: ${repair.correction}`).join("\n")
		: "None.";
	return `Red-team validation requires user decisions before publication.\n\nApplied inferable repairs to preserve:\n${repairs}\n\nUnresolved-issue handoff:\n${issues}\n\nPreserved corrected plan:\n${JSON.stringify(pending.correctedPlan, null, 2)}\n\nAsk the user through the job-planning question tools using the issue ids and complete choice meanings above, incorporate every answer into this corrected plan, then call job_plan_submit again with the complete revised plan.`;
}

export default function jobPlannerExtension(pi: ExtensionAPI, dependencies: JobPlannerDependencies = {}) {
	const redTeamValidator = dependencies.redTeamValidator ?? new PiJobPlanRedTeamValidator(pi.events);
	const publishPlan = dependencies.publishPlan ?? publishJobPlan;
	const now = dependencies.now ?? (() => new Date().toISOString());
	let state: JobState | undefined;
	let rootContext: ExtensionContext | undefined;

	let submissionPhase: "validating" | "publishing" | undefined;

	function showStatus(ctx: ExtensionContext) {
		const validation = submissionPhase ? ` · ${submissionPhase} plan` : state?.pendingValidation ? ` · ${state.pendingValidation.unresolvedIssues.length} red-team decisions pending` : "";
		const text = state?.status === "active"
			? `job planning · ${state.rounds} rounds · ${state.questions} answers${validation}`
			: state?.status === "blocked" ? "job planning · blocked restored state" : undefined;
		ctx.ui.setStatus(STATUS_KEY, text);
	}

	function persist(next: JobState) {
		state = next;
		pi.appendEntry(STATE_ENTRY, next);
		if (rootContext) showStatus(rootContext);
	}

	async function handleJob(raw: string, ctx: ExtensionCommandContext) {
		rootContext = ctx;
		const input = raw.trim();
		if (input === "status") {
			if (!state) return ctx.ui.notify("No job planning state exists in this session.", "info");
			const suffix = state.planPath ? ` Plan: ${state.planPath}` : "";
			const validation = ` ${state.validationAttempts ?? 0} red-team validation attempt(s)` + (state.pendingValidation ? `; ${state.pendingValidation.unresolvedIssues.length} decision(s) pending.` : ".");
			return ctx.ui.notify(`Job planning is ${state.status}; ${state.rounds} interview rounds and ${state.questions} answered questions;${validation}${suffix}`, "info");
		}
		if (input === "cancel") {
			if (state?.status !== "active" && state?.status !== "blocked") return ctx.ui.notify("No active job planning workflow exists.", "info");
			if (!ctx.isIdle()) ctx.abort();
			persist({ ...state, status: "cancelled", pendingValidation: undefined });
			ctx.ui.notify("Job planning cancelled. No plan was published.", "info");
			return;
		}
		if (state?.status === "active" || state?.status === "blocked") return ctx.ui.notify("A job planning workflow is already active or blocked. Use /job status or /job cancel.", "warning");
		if (!ctx.hasUI) return ctx.ui.notify("Job planning requires an interactive Pi session.", "error");
		const directive = input || await ctx.ui.editor("Job to plan", "");
		if (!directive?.trim()) return ctx.ui.notify("Job planning cancelled; no directive was supplied.", "info");
		if (!ctx.isProjectTrusted()) return ctx.ui.notify("Trust this project before starting job planning.", "error");
		await ctx.waitForIdle();
		persist({ version: 2, status: "active", directive: directive.trim(), rounds: 0, questions: 0, validationAttempts: 0, answers: [], startedAt: now() });
		pi.sendUserMessage(planningPrompt(directive.trim()));
	}

	const questionOption = Type.Object({
		label: Type.String({ minLength: 1, description: "Concise option label." }),
		description: Type.Optional(Type.String({ minLength: 1, description: "Trade-off or consequence of this option." })),
	}, { additionalProperties: false });

	pi.registerTool({
		name: "job_ask_choices",
		label: "Ask job-planning questions",
		description: `Ask one to ${MAX_QUESTIONS_PER_ROUND} related planning decisions. Each question has ${MIN_OPTIONS}-${MAX_OPTIONS} meaningful options; ${OTHER_LABEL} is added automatically. Available only during an active /job workflow.`,
		promptSnippet: "Ask the user concrete job-planning decisions interactively",
		promptGuidelines: [
			"During an active /job workflow, use job_ask_choices repeatedly until every consequential task decision is resolved.",
			"Before using job_ask_choices, inspect the project and do not ask the user for safely discoverable facts.",
		],
		parameters: Type.Object({
			questions: Type.Array(Type.Object({
				id: Type.String({ minLength: 1 }),
				header: Type.String({ minLength: 1, maxLength: 32 }),
				question: Type.String({ minLength: 1 }),
				options: Type.Array(questionOption, { minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS }),
			}, { additionalProperties: false }), { minItems: 1, maxItems: MAX_QUESTIONS_PER_ROUND }),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootContext = ctx;
			if (state?.status !== "active") throw new Error("Start an interactive /job workflow before asking job-planning questions.");
			if (!ctx.hasUI) throw new Error("Job-planning questions require an interactive UI.");
			const answeringState = state;
			const questions = validateQuestions(params.questions);
			const answers: Array<{ id: string; answer: string; source: "option" | "other" }> = [];
			for (const question of questions) {
				if (signal?.aborted) return { content: [{ type: "text" as const, text: "Question round cancelled." }], details: { cancelled: true, answers: [] } };
				const renderedOptions = question.options.map((option) => ({ option, rendered: option.description ? `${option.label} — ${option.description}` : option.label }));
				const labels = [...renderedOptions.map(({ rendered }) => rendered), OTHER_LABEL];
				const selected = await ctx.ui.select(`${question.header}: ${question.question}`, labels, { signal });
				if (selected === undefined || signal?.aborted) return { content: [{ type: "text" as const, text: "User cancelled the question round." }], details: { cancelled: true, answers: [] } };
				if (selected === OTHER_LABEL) {
					const custom = await ctx.ui.input(`${question.header}: ${OTHER_LABEL}`, "Type your answer", { signal });
					if (!custom?.trim() || signal?.aborted) return { content: [{ type: "text" as const, text: "User cancelled the question round." }], details: { cancelled: true, answers: [] } };
					answers.push({ id: question.id, answer: custom.trim(), source: "other" });
				} else {
					const selectedOption = renderedOptions.find(({ rendered }) => selected === rendered);
					if (!selectedOption) throw new Error(`Could not resolve the selected answer for ${question.id}.`);
					answers.push({ id: question.id, answer: selectedOption.rendered, source: "option" });
				}
			}
			if (signal?.aborted || state?.status !== "active" || state.startedAt !== answeringState.startedAt) return { content: [{ type: "text" as const, text: "Question round cancelled because the planning workflow changed." }], details: { cancelled: true, answers: [] } };
			const round = answeringState.rounds + 1;
			const evidence = answers.map((answer) => ({
				round,
				questionId: answer.id,
				question: questions.find((question) => question.id === answer.id)!.question,
				answer: answer.answer,
			}));
			persist({ ...answeringState, rounds: round, questions: answeringState.questions + answers.length, answers: [...(answeringState.answers ?? []), ...evidence] });
			return { content: [{ type: "text" as const, text: answers.map((answer) => `${answer.id}: ${answer.answer}`).join("\n") }], details: { cancelled: false, answers, round } };
		},
	});

	pi.registerTool({
		name: "job_ask_text",
		label: "Ask nuanced job-planning question",
		description: "Ask one exceptional open-ended planning question when predefined choices cannot capture the user's required intent or authority. Available only during an active /job workflow.",
		promptSnippet: "Ask one nuanced written job-planning question",
		promptGuidelines: ["Prefer job_ask_choices. Use job_ask_text only when meaningful choices cannot represent the required answer."],
		parameters: Type.Object({ question: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootContext = ctx;
			if (state?.status !== "active") throw new Error("Start an interactive /job workflow before asking job-planning questions.");
			if (!ctx.hasUI) throw new Error("Job-planning questions require an interactive UI.");
			const answeringState = state;
			if (signal?.aborted) return { content: [{ type: "text" as const, text: "User cancelled the question." }], details: { cancelled: true, answer: null } };
			const answer = await ctx.ui.editor(params.question, "");
			if (answer === undefined || signal?.aborted || state?.status !== "active" || state.startedAt !== answeringState.startedAt) return { content: [{ type: "text" as const, text: "User cancelled the question." }], details: { cancelled: true, answer: null } };
			if (!answer.trim()) return { content: [{ type: "text" as const, text: "User submitted a blank answer." }], details: { cancelled: false, answer: null } };
			const round = answeringState.rounds + 1;
			const questionId = answeringState.pendingValidation?.unresolvedIssues.length === 1 ? answeringState.pendingValidation.unresolvedIssues[0].id : `text-${answeringState.questions + 1}`;
			const evidence = { round, questionId, question: params.question.trim(), answer: answer.trim() };
			persist({ ...answeringState, rounds: round, questions: answeringState.questions + 1, answers: [...(answeringState.answers ?? []), evidence] });
			return { content: [{ type: "text" as const, text: answer.trim() }], details: { cancelled: false, answer: answer.trim(), round } };
		},
	});

	pi.registerTool({
		name: "job_plan_submit",
		label: "Validate and publish job plan",
		description: "Submit a complete candidate plan for mandatory red-team validation. A passing corrected plan is exclusively published; unresolved issues are returned as a handoff for another user-question loop.",
		promptSnippet: "Red-team validate and publish a complete structured job plan",
		promptGuidelines: [
			"Call job_plan_submit only after at least one user question has been answered and the current candidate has no known consequential ambiguity.",
			"If job_plan_submit returns an unresolved-issues handoff, preserve its corrected plan, ask the user the required decisions with job_ask_choices or job_ask_text, and submit the complete revised plan again.",
			"A job plan is final only when job_plan_submit reports a red-team PASS and publishes it; exactly one successful publication is allowed.",
		],
		parameters: JOB_PLAN_SCHEMA,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			rootContext = ctx;
			if (signal?.aborted) throw new Error("Plan submission was cancelled.");
			if (state?.status !== "active") throw new Error("Start an interactive /job workflow before submitting a plan.");
			if (state.questions < 1) throw new Error("At least one user question must be answered before the job plan can be submitted.");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before validating and publishing a job plan.");
			if (submissionPhase) throw new Error("A job-plan validation or publication is already in progress.");
			if (state.pendingValidation && state.questions <= state.pendingValidation.questionsAtHandoff) {
				throw new Error("Resolve the pending red-team handoff through job_ask_choices or job_ask_text before resubmitting the plan.");
			}
			const activeState = state;
			const candidate = validateJobPlan(params);
			const previousHandoff = activeState.pendingValidation;
			const allAnswers = activeState.answers ?? [];
			const planningContext = {
				answers: allAnswers,
				...(previousHandoff ? {
					previousHandoff: {
						correctedPlan: previousHandoff.correctedPlan,
						repairs: previousHandoff.repairs,
						unresolvedIssues: previousHandoff.unresolvedIssues,
						answersSinceHandoff: allAnswers.slice(previousHandoff.answerIndexAtHandoff),
					},
				} : {}),
			};
			const validationAttempts = (activeState.validationAttempts ?? 0) + 1;
			persist({ ...activeState, validationAttempts });
			submissionPhase = "validating";
			showStatus(ctx);
			onUpdate?.({ content: [{ type: "text" as const, text: "Running mandatory red-team plan validation..." }], details: { validationAttempts } });
			let validation;
			try {
				validation = await redTeamValidator.validate(ctx.cwd, activeState.directive, candidate, planningContext, signal);
			} catch (error) {
				submissionPhase = undefined;
				showStatus(ctx);
				throw error;
			}
			if (signal?.aborted || state?.status !== "active" || state.startedAt !== activeState.startedAt) {
				submissionPhase = undefined;
				showStatus(ctx);
				throw new Error("The job-planning workflow changed or was cancelled while red-team validation was running.");
			}
			const accumulatedRepairs = [...(previousHandoff?.repairs ?? []), ...validation.repairs];
			if (validation.verdict === "needs-user") {
				const pendingValidation: PendingValidation = {
					correctedPlan: validation.correctedPlan,
					repairs: accumulatedRepairs,
					unresolvedIssues: validation.unresolvedIssues,
					model: validation.model,
					questionsAtHandoff: state.questions,
					answerIndexAtHandoff: (state.answers ?? []).length,
				};
				persist({ ...state, pendingValidation });
				submissionPhase = undefined;
				showStatus(ctx);
				ctx.ui.notify(`Red-team validation requires ${validation.unresolvedIssues.length} user decision(s). No plan was published.`, "warning");
				return {
					content: [{ type: "text" as const, text: handoffText(pendingValidation) }],
					details: {
						published: false,
						verdict: "needs-user",
						validationAttempts,
						model: validation.model,
						repairs: accumulatedRepairs,
						unresolvedIssues: validation.unresolvedIssues,
						correctedPlan: validation.correctedPlan,
					},
					usage: validation.usage,
				};
			}
			const validationRecord = {
				verdict: "PASS" as const,
				provider: validation.model.provider,
				model: validation.model.model,
				thinking: validation.model.thinking,
				attempts: validationAttempts,
				repairs: accumulatedRepairs.length,
				validatedAt: now(),
			};
			submissionPhase = "publishing";
			showStatus(ctx);
			let published;
			try {
				published = await publishPlan(ctx.cwd, validation.correctedPlan, { rounds: state.rounds, questions: state.questions }, validationRecord, signal);
			} catch (error) {
				submissionPhase = undefined;
				showStatus(ctx);
				throw error;
			}
			if (signal?.aborted || state?.status !== "active" || state.startedAt !== activeState.startedAt) {
				submissionPhase = undefined;
				showStatus(ctx);
				throw new Error("The job-planning workflow changed or was cancelled while the validated plan was being published.");
			}
			const relativePath = published.path.slice(published.projectRoot.length + 1);
			persist({ ...state, status: "completed", planPath: relativePath, pendingValidation: undefined });
			submissionPhase = undefined;
			showStatus(ctx);
			ctx.ui.notify(`Red-team validated job plan published: ${relativePath}`, "info");
			const startJog = await ctx.ui.confirm(
				"Start jogging this job?",
				"The plan passed red-team validation. Proceed directly to collaborative main-thread implementation with /skill:jog?",
				{ signal },
			);
			if (startJog) pi.sendUserMessage(`/skill:jog ${relativePath}`, { deliverAs: "followUp", expandPromptTemplates: true });
			return {
				content: [{
					type: "text" as const,
					text: startJog
						? `Job planning and red-team validation completed. Plan: ${relativePath}\nThe user chose to proceed; /skill:jog has been queued as a follow-up.`
						: `Job planning and red-team validation completed. Plan: ${relativePath}\nRun /skill:jog ${relativePath} when ready to implement it collaboratively on the main thread.`,
				}],
				details: {
					id: published.id,
					path: relativePath,
					rounds: state.rounds,
					questions: state.questions,
					jogQueued: startJog,
					published: true,
					verdict: "PASS",
					validation: validationRecord,
					repairs: accumulatedRepairs,
				},
				usage: validation.usage,
				terminate: true,
			};
		},
	});

	pi.registerCommand("job", {
		description: "Interactively inspect and interview until a robust single job plan is published. Use /job status or /job cancel to manage the active interview.",
		handler: handleJob,
		getArgumentCompletions: (prefix) => ["status", "cancel"].filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
	});

	pi.on("before_agent_start", async (event) => {
		if (state?.status === "blocked") return { systemPrompt: `${event.systemPrompt}\n\n[JOB PLANNING STATE BLOCKED]\nThe restored Job Planner state is invalid (${state.restoreError ?? "unknown error"}). Do not implement or modify project files. Tell the user to run /job cancel before starting another workflow.` };
		if (state?.status !== "active") return;
		const pending = state.pendingValidation ? `\n\n[PENDING RED-TEAM HANDOFF]\n${handoffText(state.pendingValidation)}` : "";
		return {
			systemPrompt: `${event.systemPrompt}\n\n[JOB PLANNING MODE]\nDo not implement or modify project files. Inspect first, then use job_ask_choices and job_ask_text for iterative user collaboration. Continue questioning until scope, targets, constraints, assumptions, decisions, edge cases, and validation are robustly resolved. For broad repository inspection you may run a read-only exploration team per the installed exploration skill (fixed openai-codex/gpt-6-luna:high read-only agents); never delegate planning decisions, user questioning, or implementation authority. Submit candidate plans only through job_plan_submit. Every candidate receives mandatory red-team validation using the configured redTeamValidator. A plan is not final and cannot be published without a PASS. If validation returns unresolved issues, ask the user through the job-planning question tools, preserve inferable validator repairs, and resubmit the complete revised plan. Do not create a plan with ordinary file tools.${pending}`,
		};
	});

	pi.on("tool_call", async (event) => {
		if ((state?.status === "active" || state?.status === "blocked") && (event.toolName === "edit" || event.toolName === "write")) {
			return { block: true, reason: "Project file mutations are disabled during an active /job planning interview. Finish or cancel the interview first." };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		rootContext = ctx;
		state = latestState(ctx);
		showStatus(ctx);
		if (state?.status === "active") ctx.ui.notify("An unfinished job-planning interview is active in this session. Continue the conversation, or use /job cancel.", "info");
		if (state?.status === "blocked") ctx.ui.notify(`The restored job-planning state is invalid and remains blocked: ${state.restoreError ?? "unknown error"}. Use /job cancel before starting another workflow.`, "error");
	});

	pi.on("session_tree", async (_event, ctx) => {
		rootContext = ctx;
		if (submissionPhase && !ctx.isIdle()) ctx.abort();
		state = latestState(ctx);
		showStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await redTeamValidator.abortAll();
		submissionPhase = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		rootContext = undefined;
	});
}
