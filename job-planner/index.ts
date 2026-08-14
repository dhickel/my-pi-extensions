import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS_PER_ROUND,
	MIN_OPTIONS,
	OTHER_LABEL,
	publishJobPlan,
	validateQuestions,
	type JobPlanInput,
} from "./core.ts";

const STATE_ENTRY = "job-planner-state-v1";
const STATUS_KEY = "job-planner";

type JobStatus = "active" | "completed" | "cancelled";

interface JobState {
	version: 1;
	status: JobStatus;
	directive: string;
	rounds: number;
	questions: number;
	startedAt: string;
	planPath?: string;
}

function latestState(ctx: ExtensionContext): JobState | undefined {
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY) continue;
		const state = candidate.data as Partial<JobState> | undefined;
		if (state?.version !== 1 || !["active", "completed", "cancelled"].includes(String(state.status))) return undefined;
		if (typeof state.directive !== "string" || typeof state.rounds !== "number" || typeof state.questions !== "number" || typeof state.startedAt !== "string") return undefined;
		return state as JobState;
	}
	return undefined;
}

function planningPrompt(directive: string): string {
	return `Plan this job collaboratively. Do not implement it yet.\n\nDirective:\n${directive}\n\n` +
		"First inspect the repository, applicable instructions, specifications, tests, and relevant implementation so you do not ask for discoverable facts. For broader inspection you may run a read-only exploration team per the installed exploration skill (fixed deepseek/deepseek-v4-flash:max read-only agents); exploration is context acquisition only and never edits files. Then interview me in iterative rounds using job_ask_choices for concrete decisions and job_ask_text only when meaningful choices cannot capture the needed nuance. Ask follow-up questions after each answer until you have a detailed, robust view of the requested behavior. Resolve scope, targets, constraints, assumptions, edge cases, compatibility, and validation. Do not stop after an arbitrary number of rounds, and do not finalize while a consequential ambiguity remains. Keep planning and questioning on this root thread; do not delegate planning decisions or any implementation to subagents. When the task is fully understood, call job_plan_submit exactly once. That tool publishes the only plan artifact; do not implement or create another plan manually.";
}

export default function jobPlannerExtension(pi: ExtensionAPI) {
	let state: JobState | undefined;
	let rootContext: ExtensionContext | undefined;

	function showStatus(ctx: ExtensionContext) {
		const text = state?.status === "active" ? `job planning · ${state.rounds} rounds · ${state.questions} answers` : undefined;
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
			return ctx.ui.notify(`Job planning is ${state.status}; ${state.rounds} interview rounds and ${state.questions} answered questions.${suffix}`, "info");
		}
		if (input === "cancel") {
			if (state?.status !== "active") return ctx.ui.notify("No active job planning workflow exists.", "info");
			if (!ctx.isIdle()) ctx.abort();
			persist({ ...state, status: "cancelled" });
			ctx.ui.notify("Job planning cancelled. No plan was published.", "info");
			return;
		}
		if (state?.status === "active") return ctx.ui.notify("A job planning workflow is already active. Use /job status or /job cancel.", "warning");
		if (!ctx.hasUI) return ctx.ui.notify("Job planning requires an interactive Pi session.", "error");
		const directive = input || await ctx.ui.editor("Job to plan", "");
		if (!directive?.trim()) return ctx.ui.notify("Job planning cancelled; no directive was supplied.", "info");
		if (!ctx.isProjectTrusted()) return ctx.ui.notify("Trust this project before starting job planning.", "error");
		await ctx.waitForIdle();
		persist({ version: 1, status: "active", directive: directive.trim(), rounds: 0, questions: 0, startedAt: new Date().toISOString() });
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
			const questions = validateQuestions(params.questions);
			const answers: Array<{ id: string; answer: string; source: "option" | "other" }> = [];
			for (const question of questions) {
				if (signal?.aborted) return { content: [{ type: "text" as const, text: "Question round cancelled." }], details: { cancelled: true, answers: [] } };
				const labels = [...question.options.map((option) => option.description ? `${option.label} — ${option.description}` : option.label), OTHER_LABEL];
				const selected = await ctx.ui.select(`${question.header}: ${question.question}`, labels, { signal });
				if (selected === undefined || signal?.aborted) return { content: [{ type: "text" as const, text: "User cancelled the question round." }], details: { cancelled: true, answers: [] } };
				if (selected === OTHER_LABEL) {
					const custom = await ctx.ui.input(`${question.header}: ${OTHER_LABEL}`, "Type your answer", { signal });
					if (!custom?.trim() || signal?.aborted) return { content: [{ type: "text" as const, text: "User cancelled the question round." }], details: { cancelled: true, answers: [] } };
					answers.push({ id: question.id, answer: custom.trim(), source: "other" });
				} else {
					const option = question.options.find((candidate) => selected === candidate.label || selected.startsWith(`${candidate.label} — `));
					if (!option) throw new Error(`Could not resolve the selected answer for ${question.id}.`);
					answers.push({ id: question.id, answer: option.label, source: "option" });
				}
			}
			persist({ ...state, rounds: state.rounds + 1, questions: state.questions + answers.length });
			return { content: [{ type: "text" as const, text: answers.map((answer) => `${answer.id}: ${answer.answer}`).join("\n") }], details: { cancelled: false, answers, round: state.rounds } };
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
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			rootContext = ctx;
			if (state?.status !== "active") throw new Error("Start an interactive /job workflow before asking job-planning questions.");
			if (!ctx.hasUI) throw new Error("Job-planning questions require an interactive UI.");
			const answer = await ctx.ui.editor(params.question, "");
			if (answer === undefined) return { content: [{ type: "text" as const, text: "User cancelled the question." }], details: { cancelled: true, answer: null } };
			if (!answer.trim()) return { content: [{ type: "text" as const, text: "User submitted a blank answer." }], details: { cancelled: false, answer: null } };
			persist({ ...state, rounds: state.rounds + 1, questions: state.questions + 1 });
			return { content: [{ type: "text" as const, text: answer.trim() }], details: { cancelled: false, answer: answer.trim(), round: state.rounds } };
		},
	});

	pi.registerTool({
		name: "job_plan_submit",
		label: "Publish job plan",
		description: "Validate and exclusively publish the single final plan for an active /job interview. Call only after repository inspection and iterative user questioning have resolved every consequential ambiguity.",
		promptSnippet: "Publish the final structured job plan after the interactive interview",
		promptGuidelines: [
			"Call job_plan_submit exactly once at the end of an active /job workflow, never before at least one user question has been answered.",
			"Do not use job_plan_submit while consequential open questions remain; ask the user another round instead.",
		],
		parameters: Type.Object({
			title: Type.String({ minLength: 1, maxLength: 160 }),
			feature: Type.String({ minLength: 1 }),
			requirements: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			targets: Type.Array(Type.Object({ target: Type.String({ minLength: 1 }), change: Type.String({ minLength: 1 }) }, { additionalProperties: false }), { minItems: 1 }),
			constraints: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			assumptions: Type.Array(Type.String({ minLength: 1 })),
			decisions: Type.Array(Type.String({ minLength: 1 })),
			implementationSteps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			validationCriteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
			outOfScope: Type.Array(Type.String({ minLength: 1 })),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootContext = ctx;
			if (signal?.aborted) throw new Error("Plan submission was cancelled.");
			if (state?.status !== "active") throw new Error("Start an interactive /job workflow before submitting a plan.");
			if (state.questions < 1) throw new Error("At least one user question must be answered before the job plan can be submitted.");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before publishing a job plan.");
			const published = await publishJobPlan(ctx.cwd, params as JobPlanInput, { rounds: state.rounds, questions: state.questions });
			const relativePath = published.path.slice(published.projectRoot.length + 1);
			persist({ ...state, status: "completed", planPath: relativePath });
			ctx.ui.notify(`Job plan published: ${relativePath}`, "info");
			const startJog = await ctx.ui.confirm(
				"Start jogging this job?",
				"The plan is complete. Proceed directly to collaborative main-thread implementation with /skill:jog?",
				{ signal },
			);
			if (startJog) pi.sendUserMessage(`/skill:jog ${relativePath}`, { deliverAs: "followUp" });
			return {
				content: [{
					type: "text" as const,
					text: startJog
						? `Job planning completed. Plan: ${relativePath}\nThe user chose to proceed; /skill:jog has been queued as a follow-up.`
						: `Job planning completed. Plan: ${relativePath}\nRun /skill:jog ${relativePath} when ready to implement it collaboratively on the main thread.`,
				}],
				details: { id: published.id, path: relativePath, rounds: state.rounds, questions: state.questions, jogQueued: startJog },
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
		if (state?.status !== "active") return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n[JOB PLANNING MODE]\nDo not implement or modify project files. Inspect first, then use job_ask_choices and job_ask_text for iterative user collaboration. Continue questioning until scope, targets, constraints, assumptions, decisions, edge cases, and validation are robustly resolved. For broad repository inspection you may run a read-only exploration team per the installed exploration skill (fixed deepseek/deepseek-v4-flash:max read-only agents); never delegate planning decisions, questioning, or implementation. Publish only through job_plan_submit; do not create a plan with ordinary file tools.`,
		};
	});

	pi.on("tool_call", async (event) => {
		if (state?.status === "active" && (event.toolName === "edit" || event.toolName === "write")) {
			return { block: true, reason: "Project file mutations are disabled during an active /job planning interview. Finish or cancel the interview first." };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		rootContext = ctx;
		state = latestState(ctx);
		showStatus(ctx);
		if (state?.status === "active") ctx.ui.notify("An unfinished job-planning interview is active in this session. Continue the conversation, or use /job cancel.", "info");
	});

	pi.on("session_tree", async (_event, ctx) => {
		rootContext = ctx;
		state = latestState(ctx);
		showStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		rootContext = undefined;
	});
}
