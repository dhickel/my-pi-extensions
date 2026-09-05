import assert from "node:assert/strict";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import test from "node:test";
import jobPlannerExtension from "../index.ts";
import type { JobPlanInput } from "../core.ts";
import {
	AGENT_ASSIGNMENT_REQUEST_CHANNEL,
	AGENT_ASSIGNMENT_RESPONSE_PREFIX,
	assertRedTeamProviderBoundary,
	guardRedTeamStream,
	JOB_PLAN_SECTIONS,
	redTeamPrompt,
	requestRedTeamValidatorModel,
	validateRedTeamSubmission,
	type JobPlanRedTeamValidator,
	type ModelTuple,
	type RedTeamResult,
} from "../red-team.ts";

const plan: JobPlanInput = {
	title: "Validated job",
	feature: "Add a validated workflow.",
	requirements: ["Validate before publication"],
	targets: [{ target: "src/workflow.ts", change: "Add the validation gate." }],
	constraints: ["Preserve existing behavior"],
	assumptions: ["The extension is installed"],
	decisions: ["Use the configured validator"],
	implementationSteps: ["Add validation", "Publish only after PASS"],
	validationCriteria: ["Unresolved issues block publication"],
	outOfScope: [],
};

const sectionReviews = JOB_PLAN_SECTIONS.map((section) => ({ section, assessment: `${section} is coherent.` }));
const model = { provider: "openai-codex", model: "gpt-6-astra", thinking: "high" as const };

function result(overrides: Partial<RedTeamResult> = {}): RedTeamResult {
	return {
		verdict: "pass",
		correctedPlan: plan,
		sectionReviews,
		repairs: [],
		unresolvedIssues: [],
		handoffReconciliations: [],
		model,
		...overrides,
	};
}

test("red-team submissions require exhaustive section coverage and verdict consistency", () => {
	const accepted = validateRedTeamSubmission(result());
	assert.equal(accepted.sectionReviews.length, JOB_PLAN_SECTIONS.length);
	assert.throws(() => validateRedTeamSubmission(result({ sectionReviews: sectionReviews.slice(1) })), /review all 9 plan sections/i);
	assert.throws(() => validateRedTeamSubmission(result({
		unresolvedIssues: [{
			id: "architecture",
			section: "Targets",
			summary: "Two target architectures conflict.",
			reasonUserDecisionIsRequired: "The directive does not authorize either compatibility break.",
			question: "Which architecture should remain authoritative?",
			options: [{ label: "A" }, { label: "B" }],
		}],
	})), /passing.*cannot contain unresolved/i);
	assert.throws(() => validateRedTeamSubmission(result(), ["architecture"]), /reconcile every prior handoff issue/i);
	assert.doesNotThrow(() => validateRedTeamSubmission(result({ handoffReconciliations: [{ issueId: "architecture", status: "resolved", resolution: "Kept compatibility.", evidence: "User selected Compatible." }] }), ["architecture"]));
	assert.throws(() => validateRedTeamSubmission(result({ handoffReconciliations: [{ issueId: "architecture", status: "still-needs-user", resolution: "No authority supplied.", evidence: "No relevant answer." }] }), ["architecture"]), /must resolve every prior handoff issue/i);
});

test("red-team prompt requires best-faith repairs, whole-plan review, and user handoff only when needed", () => {
	const prompt = redTeamPrompt("Build the workflow", plan, { answers: [{ round: 1, questionId: "scope", question: "Keep scope?", answer: "Yes" }] });
	assert.match(prompt, /Step through every required plan section exactly once/i);
	assert.match(prompt, /oversights.*internal inconsistencies.*architectural contradictions/is);
	assert.match(prompt, /Act in best faith to avoid unnecessary user questions/i);
	assert.match(prompt, /Correct every issue whose solution follows safely/i);
	assert.match(prompt, /heavy contradiction.*insufficient context/is);
	assert.match(prompt, /planning evidence/i);
	assert.match(prompt, /reconcile every previous unresolved issue exactly once/i);
	assert.match(prompt, /verdict needs-user/i);
	assert.match(prompt, /do not modify repository files/i);
});

test("provider stream boundary blocks drift and cancellation after asynchronous preflight", async () => {
	const requestModel = { provider: model.provider, id: model.model };
	const active = new AbortController();
	assert.doesNotThrow(() => assertRedTeamProviderBoundary({ model: requestModel as any, thinkingLevel: "high" }, model, active.signal));
	assert.throws(() => assertRedTeamProviderBoundary({ model: requestModel as any, thinkingLevel: "medium" }, model, active.signal), /provider boundary drifted/i);
	let providerRequests = 0;
	let thinking: ModelTuple["thinking"] = "high";
	const guarded = guardRedTeamStream((_requestModel: typeof requestModel, _payload: string) => { providerRequests++; return "stream"; }, model, active.signal, () => thinking);
	await Promise.resolve(); // represents awaited input/before-agent-start preflight
	thinking = "medium";
	assert.throws(() => guarded(requestModel, "payload"), /provider boundary drifted/i);
	assert.equal(providerRequests, 0);
	thinking = "high";
	active.abort();
	assert.throws(() => guarded(requestModel, "payload"), /validation was cancelled/i);
	assert.equal(providerRequests, 0);
});

test("job planner resolves redTeamValidator through the sprint-planner event service", async () => {
	const events = createEventBus();
	events.on(AGENT_ASSIGNMENT_REQUEST_CHANNEL, (data) => {
		const request = data as { requestId: string; agentId: string };
		events.emit(`${AGENT_ASSIGNMENT_RESPONSE_PREFIX}${request.requestId}`, {
			version: 1,
			requestId: request.requestId,
			agentId: request.agentId,
			model,
		});
	});
	assert.deepEqual(await requestRedTeamValidatorModel(events), model);
});

test("malformed restored handoffs remain blocked until a durable cancellation", async () => {
	const handlers = new Map<string, any>();
	const commands = new Map<string, any>();
	const notifications: string[] = [];
	const entries: any[] = [{ type: "custom", customType: "job-planner-state-v1", data: { version: 2, status: "active", directive: " ", rounds: 1, questions: 1, answers: [], startedAt: " " } }];
	const pi: any = {
		events: createEventBus(),
		registerTool() {},
		registerCommand(name: string, command: any) { commands.set(name, command); },
		appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
		sendUserMessage() {},
		on(name: string, handler: any) { handlers.set(name, handler); },
	};
	jobPlannerExtension(pi, { redTeamValidator: { async validate() { return result(); }, async abortAll() {} } });
	const ctx: any = {
		hasUI: true,
		isIdle: () => true,
		sessionManager: { getBranch: () => entries },
		ui: { setStatus() {}, notify(message: string) { notifications.push(message); } },
	};
	await handlers.get("session_start")({}, ctx);
	assert.match(notifications.join("\n"), /state is invalid and remains blocked/i);
	assert.equal((await handlers.get("tool_call")({ toolName: "edit" })).block, true);
	await commands.get("job").handler("A replacement job", ctx);
	assert.match(notifications.at(-1)!, /active or blocked/i);
	await commands.get("job").handler("cancel", ctx);
	await handlers.get("session_start")({}, ctx);
	await commands.get("job").handler("status", ctx);
	assert.match(notifications.at(-1)!, /planning is cancelled/i);
});

test("job_plan_submit returns unresolved issues to another user loop and publishes only after PASS", async () => {
	const issue = {
		id: "compatibility",
		section: "Constraints" as const,
		summary: "Compatibility behavior is contradictory.",
		reasonUserDecisionIsRequired: "Either behavior is valid but user authority is required.",
		question: "Which compatibility behavior should the plan preserve?",
		options: [{ label: "Strict", description: "Break incompatible callers" }, { label: "Compatible", description: "Preserve existing callers" }],
	};
	const corrected = { ...plan, title: "Validator-corrected draft" };
	const validated = { ...corrected, title: "Validated final plan" };
	const outcomes = [
		result({ verdict: "needs-user", correctedPlan: corrected, repairs: [{ section: "Targets", issue: "Target was vague.", correction: "Named the target file." }], unresolvedIssues: [issue] }),
		result({ correctedPlan: validated, handoffReconciliations: [{ issueId: "compatibility", status: "resolved", resolution: "Preserved strict compatibility.", evidence: "User selected Strict." }] }),
	];
	const contexts: any[] = [];
	const validator: JobPlanRedTeamValidator = {
		async validate(_cwd, _directive, _candidate, context) {
			contexts.push(context);
			const next = outcomes.shift();
			if (!next) throw new Error("Unexpected validation call");
			return next;
		},
		async abortAll() {},
	};
	let publishedPlan: JobPlanInput | undefined;
	let publicationGate: Promise<void> | undefined;
	let releasePublication: (() => void) | undefined;
	let publicationStarted: (() => void) | undefined;
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: any[] = [];
	const pi: any = {
		events: createEventBus(),
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
		sendUserMessage() {},
		on() {},
	};
	jobPlannerExtension(pi, {
		redTeamValidator: validator,
		now: () => "2026-09-05T00:00:00.000Z",
		publishPlan: async (_cwd, candidate, _interview, _validation, signal) => {
			publicationStarted?.();
			if (publicationGate) await publicationGate;
			if (signal?.aborted) throw new Error("Job-plan publication was cancelled.");
			publishedPlan = candidate;
			return { id: "validated", directory: "/repo/.internal-dev/plans/validated", path: "/repo/.internal-dev/plans/validated/plan.md", projectRoot: "/repo" };
		},
	});
	const selections = ["Keep — Preserve existing behavior", "Strict — Break incompatible callers"];
	const ctx: any = {
		cwd: "/repo",
		hasUI: true,
		isProjectTrusted: () => true,
		isIdle: () => true,
		waitForIdle: async () => {},
		abort() {},
		sessionManager: { getBranch: () => entries },
		ui: {
			setStatus() {},
			notify() {},
			editor: async () => "",
			select: async () => selections.shift(),
			input: async () => "",
			confirm: async () => false,
		},
	};
	await commands.get("job").handler("Build a validated job plan", ctx);
	const ask = tools.get("job_ask_choices");
	const submit = tools.get("job_plan_submit");
	const signal = new AbortController().signal;
	await ask.execute("ask-1", { questions: [{ id: "baseline", header: "Baseline", question: "Keep behavior?", options: [{ label: "Keep", description: "Preserve existing behavior" }, { label: "Keep — Legacy", description: "Preserve only legacy behavior" }] }] }, signal, undefined, ctx);
	const first = await submit.execute("submit-1", plan, signal, undefined, ctx);
	assert.equal(first.details.verdict, "needs-user");
	assert.equal(first.details.published, false);
	assert.match(first.content[0].text, /Ask the user through the job-planning question tools/i);
	assert.match(first.content[0].text, /\(compatibility\)/);
	assert.match(first.content[0].text, /Strict — Break incompatible callers/);
	assert.match(first.content[0].text, /Applied correction: Named the target file/);
	assert.equal(publishedPlan, undefined);
	await assert.rejects(submit.execute("submit-too-soon", corrected, signal, undefined, ctx), /Resolve the pending red-team handoff/i);
	const cancelled = new AbortController();
	cancelled.abort();
	const cancelledText = await tools.get("job_ask_text").execute("ask-cancelled", { question: issue.question }, cancelled.signal, undefined, ctx);
	assert.equal(cancelledText.details.cancelled, true);
	await assert.rejects(submit.execute("submit-after-cancelled-answer", corrected, signal, undefined, ctx), /Resolve the pending red-team handoff/i);
	await ask.execute("ask-2", { questions: [{ id: "compatibility", header: "Compatibility", question: issue.question, options: issue.options }] }, signal, undefined, ctx);
	const second = await submit.execute("submit-2", corrected, signal, undefined, ctx);
	assert.equal(second.details.verdict, "PASS");
	assert.equal(second.details.published, true);
	assert.equal(second.terminate, true);
	assert.equal((publishedPlan as JobPlanInput | undefined)?.title, "Validated final plan");
	assert.equal(second.details.validation.attempts, 2);
	assert.equal(second.details.validation.repairs, 1);
	assert.equal(second.details.repairs[0].correction, "Named the target file.");
	assert.equal(contexts[1].previousHandoff.unresolvedIssues[0].id, "compatibility");
	assert.equal(contexts[1].previousHandoff.answersSinceHandoff[0].answer, "Strict — Break incompatible callers");
	assert.equal(contexts[0].answers[0].answer, "Keep — Preserve existing behavior");
	assert.equal(contexts[1].answers.length, 2);

	outcomes.push(result());
	selections.push("Keep");
	await commands.get("job").handler("Build another validated job plan", ctx);
	await ask.execute("ask-3", { questions: [{ id: "baseline-2", header: "Baseline", question: "Keep behavior?", options: [{ label: "Keep" }, { label: "Change" }] }] }, signal, undefined, ctx);
	publicationGate = new Promise<void>((resolve) => { releasePublication = resolve; });
	const started = new Promise<void>((resolve) => { publicationStarted = resolve; });
	const cancelledController = new AbortController();
	ctx.isIdle = () => false;
	ctx.abort = () => cancelledController.abort();
	const cancelledSubmission = submit.execute("submit-cancelled-publication", plan, cancelledController.signal, undefined, ctx);
	await started;
	await commands.get("job").handler("cancel", ctx);
	releasePublication!();
	await assert.rejects(cancelledSubmission, /publication was cancelled|workflow changed or was cancelled/i);
	assert.equal(entries.at(-1).data.status, "cancelled");
	assert.equal((publishedPlan as JobPlanInput | undefined)?.title, "Validated final plan");
});
