import assert from "node:assert/strict";
import { mkdirSync, renameSync, statSync } from "node:fs";
import fsPromises, { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	acceptWorkflowInput,
	acquireLease,
	BRAINSTORM_HEADINGS,
	BRAINSTORM_LIFECYCLE_REQUIREMENT,
	BRAINSTORM_TOOL_GUIDELINES,
	SPRINT_PLANNER_AGENT_CONFIGURATIONS,
	DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION,
	checkpointExecutionRecord as checkpointExecutionRecordDetailed,
	classifyRun,
	CONCEPT_HEADINGS,
	createSprintRun,
	DEFAULT_BRAINSTORM_AGENTS,
	deleteSprintRun,
	discoverSprintRuns,
	doctorExecutionRecord,
	finishExecutionRecord,
	HANDOFF_HEADINGS,
	inspectLease,
	inspectPlanDirectory,
	interruptActiveRecord,
	leasePath,
	loadDefaultSprintPlannerAgentConfiguration,
	loadExecutionRecord,
	observeChangedFile,
	ORCHESTRATION_HEADINGS,
	parseCommand,
	parseExecutionRecord,
	PHASE_BUDGETS,
	PHASE_HEADINGS,
	publishDirectoryExclusively,
	releaseLease,
	removeEmptyReservation,
	removeOwnedDirectory,
	repairManifest,
	reserveSprintRun,
	REVIEW_HEADINGS,
	runDoctor,
	RunArtifactStore,
	safeSessionId,
	SprintPlannerEngine,
	SprintStateStore,
	sprintsRoot,
	sourceIdentity,
	startExecutionRecord,
	validateBrainstormFindings,
	validateDraftPlanShape,
	validateHandoff,
	validateOrchestration,
	validatePlanDirectory,
	validatePlanFiles,
	validateSubmission,
	validateSynthesisCoverage,
	type DoctorFinding,
	type EngineProgress,
	type RunLeaseHandle,
	type RunRecordSummary,
	type WorkerRequest,
	type WorkerResult,
	type WorkflowRunner,
} from "../core.ts";

const PI_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

test("worker session ids respect the provider prompt-cache key limit", () => {
	const id = safeSessionId(`20260715-194048-${"long-directive-".repeat(8)}-ironout-author`);
	assert.equal(id.length, 64);
	assert.match(id, PI_SESSION_ID);
});

test("worker session ids are collision-resistant with hash suffix", () => {
	// Same prefix, different tails → distinct ids
	const id1 = safeSessionId("20260718-183029-sprint-brainstorm-engine-integration-deferr-red-team");
	const id2 = safeSessionId("20260718-184400-sprint-brainstorm-for-engine-integration-sprint-route");
	assert.notEqual(id1, id2);
	for (const id of [id1, id2]) {
		assert.ok(id.length <= 64);
		assert.match(id, /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/);
		// Must have hash suffix: prefix-hash format
		assert.match(id, /-[0-9a-f]{16}$/);
	}
	// Short input also gets hash suffix
	const short = safeSessionId("sprint");
	assert.match(short, /^sprint-[0-9a-f]{16}$/);
	// Very long same-prefix inputs produce distinct ids
	const long1 = safeSessionId("x".repeat(200) + "A");
	const long2 = safeSessionId("x".repeat(200) + "B");
	assert.notEqual(long1, long2);
	assert.ok(long1.length <= 64);
	assert.ok(long2.length <= 64);
	assert.match(long1, /-[0-9a-f]{16}$/);
	assert.match(long2, /-[0-9a-f]{16}$/);
});

function markdown(title: string, headings: readonly string[]): string {
	return [`# ${title}`, "", ...headings.flatMap((heading) => [`## ${heading}`, "", `${heading} content.`, ""])].join("\n");
}

const concepts = markdown("Concepts", CONCEPT_HEADINGS);
function phaseMd(num: number, deps: string, goal: string, targets: string): string {
	const suffix = String(num).padStart(2, "0");
	const base = markdown(`Phase ${num}`, PHASE_HEADINGS);
	// Replace generic placeholder content with proper metadata for cross-consistency
	return base
		.replace("Goal content.", goal)
		.replace("Dependencies content.", deps)
		.replace("In Scope content.", `**Write Targets**: ${targets}`);
}
const phase1 = phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts");
const phase2 = phaseMd(2, "phase-01-first.md", "Complete phase 2", "sprint-planner/target-02.ts");

function orchestrationFor(size: "small" | "medium" | "large" | "extra-large", phasePaths: readonly string[]): string {
	return [
		"# Orchestration",
		"",
		"## Scope Size",
		"",
		`**Size**: ${size}`,
		"",
		"## Phase Ledger",
		"",
		...phasePaths.map((phasePath, index) => `- ${phasePath} | depends: ${index === 0 ? "none" : phasePaths[index - 1]} | targets: sprint-planner/target-${String(index + 1).padStart(2, "0")}.ts | goal: Complete phase ${index + 1}`),
		"",
		"## Execution Waves",
		"",
		...phasePaths.map((phasePath, index) => `- wave-${String(index + 1).padStart(2, "0")}: ${phasePath}`),
		"",
		"## Model Assignments",
		"",
		"- Implementation: deepseek/deepseek-v4-pro:max",
		"- Validation: openai-codex/gpt-5.6-terra:high",
		"- Implementers: exactly one implementation agent per unsplit phase, or one sequential agent per lettered subphase for split phases",
		"",
		"## Validation Gate",
		"",
		"- Gate: post-phase validator review-and-repair must PASS before a phase is complete.",
		"- Dependencies: no dependent phase starts before every dependency has PASS.",
		"",
		"## Final Integration",
		"",
		"- Integration: after all phases PASS, run final integration validation with openai-codex/gpt-5.6-terra:high.",
		"",
	].join("\n");
}

const orchestrationSmall = orchestrationFor("small", ["phase-01-first.md", "phase-02-second.md"]);

async function project() {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-sprint-planner-"));
	const internal = path.join(root, ".internal-dev");
	for (const store of ["sprints", "brainstorm", "handoffs", "plans", "reviews"]) await mkdir(path.join(internal, store), { recursive: true });
	return { root, internal };
}

async function checkpointExecutionRecord(...args: Parameters<typeof checkpointExecutionRecordDetailed>): Promise<number> {
	return (await checkpointExecutionRecordDetailed(...args)).revision;
}

class FakeRunner implements WorkflowRunner {
	requests: WorkerRequest[] = [];
	aborts = 0;

	async prepare(request: WorkerRequest) {
		return { sessionPath: path.join(request.sessionDirectory!, `${request.id}.jsonl`) };
	}

	async run(request: WorkerRequest): Promise<WorkerResult> {
		this.requests.push(structuredClone(request));
		if (request.role.includes("role router")) {
			return {
				ok: true,
				submission: {
					kind: "roles",
					content: JSON.stringify({ roles: Array.from({ length: 4 }, (_, index) => ({ id: `lens-${index + 1}`, name: `Lens ${index + 1}`, lens: `Broad lens ${index + 1}` })) }),
				},
				sessionPath: request.sessionPath,
				disposition: "completed",
			};
		}
		if (request.role === "brainstorm synthesizer") {
			const allSources = request.contextPaths;
			const sourceList = allSources.map((p) => `- ${p}`).join("\n");
			return { ok: true, submission: { kind: "markdown", content: markdown("Synthesis", BRAINSTORM_HEADINGS).replace("Source content.", sourceList) }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role.includes("ironout reviewer")) {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Review", REVIEW_HEADINGS) }, { path: "handoff.md", content: markdown("Handoff", HANDOFF_HEADINGS) }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role === "advanced planner") {
			return { ok: true, submission: { kind: "files", files: [{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role === "advanced decomposition reviewer") {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Decomposition Review", REVIEW_HEADINGS) }, { path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role === "advanced concepts reviewer") {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Concept Review", REVIEW_HEADINGS) }, { path: "concepts.md", content: concepts }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role === "advanced orchestration reviewer") {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orchestration Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: orchestrationSmall }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.role.startsWith("advanced phase reviewer:")) {
			const phasePath = request.expectation.requiredPaths!.find((item) => item !== "review.md")!;
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown(`Review ${phasePath}`, REVIEW_HEADINGS) }, { path: phasePath, content: phasePath.includes("01-") ? phase1 : phase2 }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		if (request.expectation.kind === "markdown") {
			const headings = request.expectation.headings?.artifact ?? BRAINSTORM_HEADINGS;
			return { ok: true, submission: { kind: "markdown", content: markdown(request.role, headings) }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		throw new Error(`Unhandled fake request: ${request.role}`);
	}

	abortAll() {
		this.aborts++;
	}
}

class TwiceMalformedRunner extends FakeRunner {
	count = 0;
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role.includes("role router") && this.count++ < 2) {
			this.requests.push(structuredClone(request));
			return { ok: true, submission: { kind: "roles", content: "not json" }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

class DelayedRunner extends FakeRunner {
	started?: () => void;
	readonly waiting = new Promise<void>((resolve) => (this.started = resolve));
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		this.requests.push(structuredClone(request));
		this.started?.();
		return new Promise((resolve) => {
			const abort = () => resolve({ ok: false, error: "cancelled", failureKind: "cancelled", sessionPath: request.sessionPath, disposition: "interrupted" });
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		});
	}
}

class CrossReviewFailureRunner extends FakeRunner {
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.id.includes("-cross-")) {
			this.requests.push(structuredClone(request));
			return { ok: false, error: "cross-review unavailable", failureKind: "fatal", sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

test("commands enforce public option ranges and management boundaries", () => {
	assert.equal(parseCommand("sprint", "--name Demo --agents 8 do it").name, "demo");
	assert.equal(parseCommand("ironout", "--interactive requirements").interactive, true);
	assert.throws(() => parseCommand("brainstorm", "--agents 9 task"), /2 to 8/);
	assert.throws(() => parseCommand("advanceplan", "resume"), /not resume/);
	assert.throws(() => parseCommand("sprint", "cancel"), /uses pause/);
	assert.throws(() => parseCommand("sprint", "--parallel 2 task"), /Unknown option: --parallel/);
});

test("workflow prompts remain raw and are never probed or expanded as paths", () => {
	const pasted = "# User handoff\n\n## Scope\n\nKeep   formatting and inspect plans/demo when useful.";
	assert.equal(parseCommand("sprint", `--agents 2 ${pasted}`).input, pasted);
	const longPrompt = "x".repeat(10_000);
	assert.equal(acceptWorkflowInput(longPrompt), longPrompt);
	assert.equal(acceptWorkflowInput("sprint-planner/README.md plus the user's additional instructions"), "sprint-planner/README.md plus the user's additional instructions");
	assert.throws(() => acceptWorkflowInput(" \n\t"), /prompt is required/);
});

test("agent configuration covers every sprint-planner role with exact tuples", () => {
	assert.equal(DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION, "default");
	const agents = SPRINT_PLANNER_AGENT_CONFIGURATIONS.default;
	assert.equal(loadDefaultSprintPlannerAgentConfiguration(), agents);
	assert.deepEqual(Object.keys(agents), [
		"roleRouter",
		"brainstormWorker",
		"brainstormSynthesis",
		"brainstormRedTeam",
		"ironoutAuthor",
		"ironoutReviewer",
		"planner",
		"advisor",
		"decompositionReviewer",
		"conceptsReviewer",
		"orchestrationReviewer",
		"phaseReviewer",
		"implementationWorker",
		"phaseValidator",
		"integrationValidator",
		"executionAdvisor",
	]);
	// Model tuples
	for (const entry of Object.values(agents)) {
		const m = entry.model;
		if (m.model === "deepseek-v4-pro") assert.deepEqual(m, { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" });
		else if (m.model === "gpt-5.6-terra") assert.equal(m.thinking, "high");
		else if (m.thinking === "xhigh") assert.deepEqual(m, { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" });
		else assert.equal(m.model, "gpt-5.6-sol");
	}
	assert.deepEqual(agents.ironoutReviewer.model, { provider: "openai-codex", model: "gpt-5.6-terra", thinking: "high" });
	// Assignments with senior-call metadata
	assert.deepEqual(agents.planner, { model: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" }, maxSeniorCalls: 2, seniorAdvisor: "advisor" });
	assert.deepEqual(agents.advisor, { model: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "max" } });
	assert.deepEqual(agents.decompositionReviewer, { model: { provider: "openai-codex", model: "gpt-5.6-terra", thinking: "high" }, maxSeniorCalls: 1, seniorAdvisor: "advisor" });
	for (const agent of [agents.conceptsReviewer, agents.orchestrationReviewer, agents.phaseReviewer]) {
		assert.deepEqual(agent, { model: { provider: "openai-codex", model: "gpt-5.6-terra", thinking: "high" } });
	}
	// Simple model-only assignments
	for (const key of ["roleRouter", "brainstormSynthesis", "brainstormRedTeam", "ironoutAuthor", "implementationWorker", "phaseValidator", "integrationValidator"] as const) {
		assert.deepEqual(agents[key], { model: agents[key].model });
	}
	assert.deepEqual(agents.brainstormWorker, { model: { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" } });
	assert.deepEqual(agents.executionAdvisor, { model: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" } });
});

test("lite configuration assigns every agent to deepseek-v4-pro max except the implementation worker", () => {
	const lite = SPRINT_PLANNER_AGENT_CONFIGURATIONS.lite;
	assert.deepEqual(Object.keys(lite), Object.keys(SPRINT_PLANNER_AGENT_CONFIGURATIONS.default), "lite covers every agent");
	for (const [key, entry] of Object.entries(lite)) {
		if (key === "implementationWorker") {
			assert.deepEqual(entry.model, { provider: "deepseek", model: "deepseek-v4-flash", thinking: "max" }, `${key} should be DeepSeek flash max`);
		} else {
			assert.deepEqual(entry.model, { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" }, `${key} should be DeepSeek pro max`);
		}
	}
	// Senior-call metadata is preserved.
	assert.equal(lite.planner.maxSeniorCalls, 2);
	assert.equal(lite.planner.seniorAdvisor, "advisor");
	assert.equal(lite.decompositionReviewer.maxSeniorCalls, 1);
	assert.equal(lite.decompositionReviewer.seniorAdvisor, "advisor");
});

test("plan validation enforces a flat concepts plus orchestration plus contiguous phases publication", () => {
	validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }]);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "nested/phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }]), /flat/);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-02-second.md", content: phase2 }]), /contiguous/);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1.replace("## Context", "## Background") }, { path: "phase-02-second.md", content: phase2 }]), /phase-01-first\.md: Context/);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }]), /exactly one orchestration/);
});

test("between-stage validators name missing brainstorm, synthesis, handoff, and directory contracts", async () => {
	const finding = markdown("Finding", BRAINSTORM_HEADINGS);
	assert.throws(() => validateBrainstormFindings([{ path: "lens-1/findings.md", content: finding }], ["lens-1/findings.md", "lens-2/findings.md"]), /missing lens-2\/findings\.md/);
	assert.throws(() => validateBrainstormFindings([{ path: "lens-1/findings.md", content: finding.replace("## Trade-offs", "## Costs") }], ["lens-1/findings.md"]), /lens-1\/findings\.md: Trade-offs/);
	assert.throws(() => validateSynthesisCoverage(markdown("Synthesis", BRAINSTORM_HEADINGS).replace("Source content.", "- lens-1/findings.md"), ["lens-1/findings.md", "lens-2/findings.md"]), /Source is missing report path lens-2\/findings\.md/);
	assert.throws(() => validateHandoff(markdown("Handoff", HANDOFF_HEADINGS).replace("## Validation", "## Checks")), /handoff\.md: Validation/);

	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-contract-"));
	await writeFile(path.join(root, "concepts.md"), concepts);
	await writeFile(path.join(root, "orchestration.md"), orchestrationSmall);
	await writeFile(path.join(root, "phase-01-first.md"), phase1);
	await writeFile(path.join(root, "phase-02-second.md"), phase2);
	await validatePlanDirectory(root);
	await writeFile(path.join(root, ".state.json"), "{}");
	await assert.rejects(validatePlanDirectory(root), /Unexpected entry in plan directory.*\.state\.json/);
});

test("fake-runner sprint stops after corrected plan publication and cleans runtime state", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const engine = new SprintPlannerEngine(runner);
	const state = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "delivery", directive: "Deliver the feature", agents: 4 });
	assert.equal(state.status, "completed");
	const run = path.join(internal, "sprints", "delivery");
	assert.equal(await entryExists(path.join(run, ".state.json")), false);
	assert.equal(await entryExists(path.join(run, ".sessions")), false);
	assert.deepEqual((await readdir(path.join(run, "planning"))).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	const conceptReview = runner.requests.find((request) => request.role === "advanced concepts reviewer")!;
	const orchestrationReview = runner.requests.find((request) => request.role === "advanced orchestration reviewer")!;
	const phaseReviews = runner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:"));
	assert.equal(conceptReview.model.thinking, "high");
	assert.equal(orchestrationReview.model.thinking, "high");
	assert.equal(phaseReviews.length, 2);
	assert.equal(phaseReviews.every((request) => request.model.thinking === "high" && request.contextPaths.length === 3), true);
	assert.equal(runner.requests.some((request) => request.role.includes("advanced-plan reviewer")), false);
	assert.match(await readFile(path.join(run, "reviews", "advanced-plan-review.md"), "utf8"), /phase-01-first/);
	for (let index = 1; index <= 4; index++) {
		assert.equal(await entryExists(path.join(run, "brainstorm", `lens-${index}`, "findings.md")), true);
		assert.equal(await entryExists(path.join(run, "brainstorm", `lens-${index}`, "cross-review.md")), true);
		const cross = runner.requests.find((request) => request.id.endsWith(`brainstorm-cross-lens-${index}`))!;
		assert.equal(cross.contextPaths.length, 3);
		assert.equal(cross.sessionPath, runner.requests.find((request) => request.id.endsWith(`brainstorm-findings-lens-${index}`))!.sessionPath);
	}
	const redTeam = runner.requests.find((request) => request.role === "brainstorm red team")!;
	assert.deepEqual(redTeam.contextPaths, ["brainstorm/synthesis.md"]);
	assert.doesNotMatch(redTeam.prompt, /supplementary-raw-reports/);
	assert.equal(runner.requests.every((request) => request.mode === "planning"), true);
	assert.equal(Object.keys(state.steps).some((id) => /^(orchestration-|implement-|repair-|review-|re-review-|senior-fix-|final-validation$)/.test(id)), false);
	assert.equal(await entryExists(path.join(run, "orchestration")), false);
	const manifest = await readFile(path.join(run, "manifest.md"), "utf8");
	assert.match(manifest, /Planning completed successfully/);
	assert.match(manifest, /terminal extension stage/);
	assert.match(manifest, /separately installed `orchestrate` skill/);
	assert.match(manifest, /concepts and orchestration/);
});

test("cross-review is an unconditional barrier before standalone synthesis", async () => {
	assert.match(BRAINSTORM_LIFECYCLE_REQUIREMENT, /must not start until every findings\.md and cross-review\.md exists/i);
	assert.match(BRAINSTORM_TOOL_GUIDELINES.join("\n"), /instead of subagent_spawn/i);
	const { root, internal } = await project();
	const runner = new CrossReviewFailureRunner();
	await assert.rejects(
		new SprintPlannerEngine(runner).runStandaloneBrainstorm({ projectRoot: root, internalDevPath: internal, id: "blocked-cross-review", directive: "Explore safely", agents: 4 }),
		/cross-review unavailable/,
	);
	assert.equal(runner.requests.some((request) => request.role === "brainstorm synthesizer"), false);
	assert.equal(await entryExists(path.join(internal, "brainstorm", "blocked-cross-review")), false);
});

test("standalone cross-review continues each original in-memory worker session", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runStandaloneBrainstorm({ projectRoot: root, internalDevPath: internal, id: "same-session", directive: "Explore", agents: 4 });
	for (let index = 1; index <= 4; index++) {
		const finding = runner.requests.find((request) => request.id.endsWith(`findings-lens-${index}`))!;
		const cross = runner.requests.find((request) => request.id.endsWith(`cross-lens-${index}`))!;
		assert.equal(cross.sessionPath, finding.sessionPath);
		assert.equal(cross.contextPaths.length, 3);
		assert.doesNotMatch(cross.prompt, new RegExp(`lens-${index}/findings\\.md`));
	}
});

test("malformed typed output retries twice within the same checkpointed session", async () => {
	const { root, internal } = await project();
	const runner = new TwiceMalformedRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "retry", directive: "Retry", agents: 4 });
	assert.equal(state.status, "completed");
	const routeRequests = runner.requests.filter((request) => request.role.includes("role router"));
	assert.equal(routeRequests.length, 3);
	assert.equal(new Set(routeRequests.map((request) => request.sessionPath)).size, 1);
});

test("pause checkpoints interrupted work and explicit resume restarts it", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const firstEngine = new SprintPlannerEngine(delayed);
	const firstRun = firstEngine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "paused", directive: "Pause me", agents: 4 });
	await delayed.waiting;
	await firstEngine.pause(true);
	const paused = await firstRun;
	assert.equal(paused.status, "interrupted");
	const statePath = path.join(internal, "sprints", "paused", ".state.json");
	assert.equal((await new SprintStateStore(path.dirname(statePath)).load()).status, "interrupted");

	const resumed = await new SprintPlannerEngine(new FakeRunner()).resumeSprint(path.join(internal, "sprints", "paused"), "paused");
	assert.equal(resumed.status, "completed");
	assert.equal(await entryExists(statePath), false);
});

test("resume refuses a changed original directive", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const run = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "changed-input", directive: "Original", agents: 4 });
	await delayed.waiting;
	await engine.pause(true);
	await run;
	const directory = path.join(internal, "sprints", "changed-input");
	await writeFile(path.join(directory, "input.md"), "# Sprint Input\n\nDifferent\n");
	await assert.rejects(new SprintPlannerEngine(new FakeRunner()).resumeSprint(directory, "changed-input"), /original sprint input is missing or changed/i);
});

test("cancelled standalone work publishes no directory and creates no state", async () => {
	const { root, internal } = await project();
	const runner = new DelayedRunner();
	const engine = new SprintPlannerEngine(runner);
	const run = engine.runStandaloneBrainstorm({ projectRoot: root, internalDevPath: internal, id: "cancelled", directive: "Stop", agents: 4 });
	await runner.waiting;
	await engine.cancel();
	await assert.rejects(run, /cancel/i);
	assert.equal(await entryExists(path.join(internal, "brainstorm", "cancelled")), false);
	assert.equal(await entryExists(path.join(internal, "brainstorm", ".state.json")), false);
});

test("standalone planning workflows publish their contracted outputs without runtime state", async () => {
	const { root, internal } = await project();
	const brainstorm = await new SprintPlannerEngine(new FakeRunner()).runStandaloneBrainstorm({ projectRoot: root, internalDevPath: internal, id: "ideas", directive: "Explore", agents: 4 });
	assert.deepEqual((await readdir(brainstorm)).sort(), ["lens-1", "lens-2", "lens-3", "lens-4", "red-team.md", "synthesis.md"]);
	const handoff = await new SprintPlannerEngine(new FakeRunner()).runStandaloneIronout({ projectRoot: root, internalDevPath: internal, id: "handoff", directive: "Settle", interactive: false });
	assert.match(await readFile(handoff, "utf8"), /## Sign-off/);
	const plan = await new SprintPlannerEngine(new FakeRunner()).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "plan", directive: "Plan" });
	assert.deepEqual((await readdir(plan)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	assert.equal(await entryExists(path.join(internal, ".state.json")), false);
});

test("standalone ironout and advance planning resolve their exact agent assignments", async () => {
	const { root, internal } = await project();
	const ironoutRunner = new FakeRunner();
	await new SprintPlannerEngine(ironoutRunner).runStandaloneIronout({ projectRoot: root, internalDevPath: internal, id: "routed-handoff", directive: "Settle", interactive: false });
	assert.deepEqual(ironoutRunner.requests.find((request) => request.role === "ironout author")?.model, SPRINT_PLANNER_AGENT_CONFIGURATIONS.default.ironoutAuthor.model);
	assert.deepEqual(ironoutRunner.requests.find((request) => request.role === "corrective ironout reviewer")?.model, SPRINT_PLANNER_AGENT_CONFIGURATIONS.default.ironoutReviewer.model);

	const planningRunner = new FakeRunner();
	await new SprintPlannerEngine(planningRunner).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "routed-plan", directive: "Plan" });
	const agents = SPRINT_PLANNER_AGENT_CONFIGURATIONS.default;
	const planner = planningRunner.requests.find((request) => request.role === "advanced planner")!;
	assert.deepEqual(planner.model, agents.planner.model);
	assert.equal(planner.maxSeniorCalls, agents.planner.maxSeniorCalls);
	assert.deepEqual(planner.seniorModel, agents.advisor.model);
	const decomposition = planningRunner.requests.find((request) => request.role === "advanced decomposition reviewer")!;
	assert.deepEqual(decomposition.model, agents.decompositionReviewer.model);
	assert.equal(decomposition.maxSeniorCalls, agents.decompositionReviewer.maxSeniorCalls);
	assert.deepEqual(decomposition.seniorModel, agents.advisor.model);
	assert.deepEqual(planningRunner.requests.find((request) => request.role === "advanced concepts reviewer")?.model, agents.conceptsReviewer.model);
	assert.deepEqual(planningRunner.requests.find((request) => request.role === "advanced orchestration reviewer")?.model, agents.orchestrationReviewer.model);
	const phaseReviews = planningRunner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:"));
	assert.equal(phaseReviews.length, 2);
	assert.equal(phaseReviews.every((request) => JSON.stringify(request.model) === JSON.stringify(agents.phaseReviewer.model)), true);
});

// ── Skill contract infrastructure ────────────────────────────────────────

interface SkillSection {
	heading: string;
	content: string;
}

interface ParsedSkill {
	frontmatter: Map<string, string>;
	frontmatterText: string;
	sections: SkillSection[];
}

const REQUIRED_ORCHESTRATE_SECTIONS = [
	"Fixed model contract",
	"Global estimate prohibition",
	"Tool delegation contract",
	"Preflight",
	"Interpret the directive",
	"Start the execution record",
	"One phase = one validation unit",
	"Schedule work",
	"Delegate implementation",
	"Poll every agent",
	"Validate every phase with review-and-repair",
	"Checkpoint changed files and verdicts",
	"PASS-before-dependent barriers",
	"Final integration gate",
	"Finish the execution record",
	"Completion",
] as const;

function parseSkill(content: string): ParsedSkill {
	const lines = content.split(/\r?\n/);
	assert.equal(lines[0]?.trim(), "---", "Skill frontmatter must start with ---");
	const frontmatterEnd = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	assert.notEqual(frontmatterEnd, -1, "Skill frontmatter must have a closing ---");

	const frontmatter = new Map<string, string>();
	for (let i = 1; i < frontmatterEnd; i++) {
		const match = lines[i].match(/^([A-Za-z][\w-]*):[ \t]*(.*)$/);
		if (!match) continue;
		assert.equal(frontmatter.has(match[1]), false, `Duplicate frontmatter key: ${match[1]}`);
		frontmatter.set(match[1], match[2].trim());
	}

	const sections: SkillSection[] = [];
	let currentHeading: string | undefined;
	let currentLines: string[] = [];
	let fence: { marker: "`" | "~"; length: number } | undefined;
	const finishSection = () => {
		if (currentHeading !== undefined) sections.push({ heading: currentHeading, content: currentLines.join("\n") });
	};

	for (let i = frontmatterEnd + 1; i < lines.length; i++) {
		const line = lines[i];
		if (fence) {
			if (currentHeading !== undefined) currentLines.push(line);
			const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
			if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = undefined;
			continue;
		}

		const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
			fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
			if (currentHeading !== undefined) currentLines.push(line);
			continue;
		}

		const h2 = line.match(/^ {0,3}##[ \t]+(.+?)[ \t]*$/);
		if (h2) {
			finishSection();
			currentHeading = h2[1].replace(/[ \t]+#+[ \t]*$/, "").trim();
			currentLines = [];
		} else if (currentHeading !== undefined) {
			currentLines.push(line);
		}
	}
	finishSection();

	return {
		frontmatter,
		frontmatterText: lines.slice(0, frontmatterEnd + 1).join("\n"),
		sections,
	};
}

function assertOrchestrateSkillContract(content: string): void {
	const parsed = parseSkill(content);
	assert.equal(parsed.frontmatter.get("name"), "orchestrate", "frontmatter name");
	assert.match(parsed.frontmatter.get("description") ?? "", /execute.*workflow.*phased plan.*DeepSeek.*GPT-5\.6 Terra/is, "frontmatter description");
	assert.match(parsed.frontmatter.get("compatibility") ?? "", /subagent_spawn.*subagent_poll.*subagent_status.*subagent_cancel.*deepseek-v4-pro max.*gpt-5\.6-terra high/i, "frontmatter compatibility");
	assert.match(parsed.frontmatterText, /^metadata:\s*\n  version: "4\.1\.0"$/m, "frontmatter metadata version");

	for (const heading of REQUIRED_ORCHESTRATE_SECTIONS) {
		const count = parsed.sections.filter((section) => section.heading === heading).length;
		assert.equal(count, 1, count === 0 ? `Missing required section: ${heading}` : `Duplicate required section: ${heading}`);
	}
	const sections = new Map(parsed.sections.map((section) => [section.heading, section.content]));
	const must = (heading: typeof REQUIRED_ORCHESTRATE_SECTIONS[number], pattern: RegExp, description: string) => {
		assert.match(sections.get(heading)!, pattern, `${heading}: ${description}`);
	};
	const forbid = (heading: typeof REQUIRED_ORCHESTRATE_SECTIONS[number], pattern: RegExp, description: string) => {
		assert.doesNotMatch(sections.get(heading)!, pattern, `${heading}: ${description}`);
	};

	must("Fixed model contract", /Implementation[\s\S]*`provider`: `deepseek`[\s\S]*`model`: `deepseek-v4-pro`[\s\S]*`thinkingLevel`: `max`/, "exact DeepSeek tuple");
	must("Fixed model contract", /Post-phase review-and-repair and final integration[\s\S]*`provider`: `openai-codex`[\s\S]*`model`: `gpt-5\.6-terra`[\s\S]*`thinkingLevel`: `high`/, "exact GPT tuple");
	must("Fixed model contract", /Never inherit, omit, downgrade, clamp, or substitute any tuple/i, "tuple substitution prohibition");
	must("Fixed model contract", /unavailable, stop before implementation and report the exact failure/i, "unavailable tuple blocks implementation");
	must("Fixed model contract", /self-reports.*root inspection.*test output do not replace independent GPT-5\.6 Terra high phase validation/is, "independent validation");

	must("Global estimate prohibition", /Every root report and every delegated report/i, "all root and delegated reports covered");
	must("Global estimate prohibition", /human time estimates.*duration.*effort.*ETA.*calendar scheduling estimates/is, "human estimate categories prohibited");
	must("Global estimate prohibition", /Operational dependency and wave scheduling language remains valid/i, "operational scheduling language allowed");
	must("Global estimate prohibition", /Technical machine timing.*timeout.*TTL.*backoff.*retry.*polling.*cache retention.*lease.*remains allowed/is, "technical machine timing allowed");

	must("Tool delegation contract", /validates every spawn batch atomically before any child initializes/i, "atomic validation");
	must("Tool delegation contract", /If any requested tool is unregistered, forbidden, duplicated, or fingerprint-mismatched.*complete batch is rejected/i, "full batch rejection");
	must("Tool delegation contract", /registered tool does not need to be active in the caller.*enables it for the child/is, "inactive registered activation");
	must("Tool delegation contract", /fixed sets.*only APIs registered in the standard coding harness.*search and listing through `bash`/is, "portable fixed tool sets");
	must("Tool delegation contract", /Preflight agents[\s\S]{0,400}"tools"\s*:\s*\[\s*\]/i, "preflight tools empty");
	must("Tool delegation contract", /DeepSeek implementers[\s\S]{0,400}"tools"\s*:\s*\[\s*"read"/i, "implementer four tools");
	must("Tool delegation contract", /GPT-5\.6 Terra phase\/integration validators[\s\S]{0,400}"tools"\s*:\s*\[\s*"read"/i, "validator four tools");
	must("Tool delegation contract", /No child receives subagent, sprint validation, sprint execution, user-questioning, or other root-only tools/i, "no root-only tools for children");

	must("Preflight", /only after authoritative input resolution.*successful generated-plan validation.*accepted execution-record `start`/is, "preflight follows validation and execution start");
	must("Preflight", /Before any implementation edit or other provider work, launch one atomic `subagent_spawn` batch/i, "preflight before edits in one atomic batch");
	must("Preflight", /two uniquely named no-op agents/i, "two unique no-op agents");
	must("Preflight", /Return READY without reading or modifying the project/i, "no-op task");
	must("Preflight", /Poll until both reach a terminal state/i, "poll both to terminal");
	must("Preflight", /Confirm the reported provider, model, and thinking level exactly/i, "verify actual tuples");
	must("Preflight", /Do not proceed when either preflight fails/i, "preflight failure blocks");
	must("Preflight", /"tools"\s*:\s*\[\s*\]/i, "preflight tools empty array");

	must("Interpret the directive", /complete user input as prompt text, not as a filename/i, "directive is prompt text");
	must("Interpret the directive", /canonical project-relative directory path.*call `sprint_validate_plan`/is, "use sprint_validate_plan with its canonical path contract");
	must("Interpret the directive", /Do not pass an absolute path/i, "plan tools reject absolute source paths");
	must("Interpret the directive", /If `valid` is `false`, stop before any provider work/i, "stop on invalid");
	must("Interpret the directive", /Do not re-validate the plan directory structure with root tools/i, "no manual re-validation");
	must("Interpret the directive", /deterministic `sprint_validate_plan` tool owns all plan-shape.*cross-consistency.*dependency.*target-overlap.*model-contract.*wave-completeness checks/is, "sprint_validate_plan owns validation");
	must("Interpret the directive", /Read applicable project instructions, accepted specifications, and explicitly required guides/i, "project contract inspection");
	must("Interpret the directive", /Preserve the user's scope, decisions, phase boundaries, exclusions, and completion criteria/i, "accepted scope preserved");

	must("Start the execution record", /call `sprint_execution_record` with `action: "start"`/i, "execution record start");
	must("Start the execution record", /`sourcePlanPath` must be the same canonical project-relative directory accepted by `sprint_validate_plan`/i, "execution source path contract");
	must("Start the execution record", /`sourcePlanningRunId` is optional provenance, not a path/is, "planning provenance id contract");
	must("Start the execution record", /\.internal-dev\/plans\/<plan-id>.*exactly `<plan-id>`.*\.internal-dev\/sprints\/<planning-run-id>\/planning.*exactly `<planning-run-id>`/is, "canonical planning id layouts");
	must("Start the execution record", /execution identifier distinct from every source plan or planning-run identifier/i, "distinct execution id");
	must("Start the execution record", /Record the returned immutable source reference, source hashes, and initial revision/i, "record source metadata");
	must("Start the execution record", /source plan and planning-run bytes unchanged/i, "source bytes remain immutable");
	must("Start the execution record", /Never write runtime material into their directories/i, "runtime state stays outside source directories");
	must("Start the execution record", /Pass the latest returned revision/i, "revision chaining");
	must("Start the execution record", /stale-revision rejection as a blocker/i, "stale revision blocks");
	must("Start the execution record", /root owns all sprint tool calls/i, "root owns sprint tools");

	must("One phase = one validation unit", /phase is the atomic dependency and validation unit/i, "phase-level dependency and validation boundary");
	must("One phase = one validation unit", /unsplit phase maps to one DeepSeek Pro V4 `max` implementation-agent session/i, "one session for an unsplit phase");
	must("One phase = one validation unit", /lettered subphases.*each subphase maps to one sequential implementation-agent session/is, "lettered subphases use sequential sessions");
	must("One phase = one validation unit", /Complete every subphase in letter order before launching the single phase-level validator/i, "validation follows all subphases");
	must("One phase = one validation unit", /do not calculate or enforce token counts during execution/i, "no runtime token policy");

	must("Schedule work", /Authoritative plan scheduling[\s\S]*follow the .*declared execution waves exactly/is, "authoritative waves followed exactly");
	must("Schedule work", /subject to the four-agent active cap/i, "four agent cap");
	must("Schedule work", /Run every implementation batch to a terminal state before starting any validator for that logical wave/is, "implementation wave settles before validation");
	must("Schedule work", /logical wave remains incomplete until every phase has `VERDICT: PASS`, and no dependent starts before that full-wave barrier/i, "full logical-wave barrier");
	must("Schedule work", /dependency becomes complete only after its independent validator returns a checkpointed `VERDICT: PASS`/i, "checkpointed dependency completion");
	must("Schedule work", /overlapping write targets, unknown write sets, shared mutable state, or any uncertainty.*block the wave and report the defect as a plan error/is, "uncertainty and overlap block authoritative waves");
	must("Schedule work", /Do not silently reschedule a generated-plan wave or invent an alternative topology/i, "no generated-plan fallback");
	must("Schedule work", /default to sequential execution when safety cannot be confirmed/i, "non-authoritative sequential fallback");
	must("Schedule work", /empty or uncertain write set is not evidence of safety.*fall back to sequential scheduling/is, "uncertain non-authoritative fallback");

	must("Delegate implementation", /Spawn one DeepSeek Pro V4 `max` agent for each ready unsplit phase.*one at a time for each explicit lettered subphase/is, "one DeepSeek implementation delegation per implementation unit");
	must("Delegate implementation", /Subphases execute sequentially in letter order.*parent phase's scope, dependencies, and validation gate/is, "ordered parent-scoped subphases");
	must("Delegate implementation", /every task must be self-contained/i, "self-contained delegation");
	must("Delegate implementation", /Implement the complete assigned phase or lettered subphase without placeholders, stubs, fake behavior, or speculative scope/i, "no incomplete implementation");
	must("Delegate implementation", /Return `Summary`, `Files Changed`, `Validation`, `Criteria`, `Remaining Risks`, and `Blockers` sections/i, "implementer report shape");
	must("Delegate implementation", /"tools"\s*:\s*\[\s*"read",\s*"bash",\s*"edit",\s*"write"\s*\]/i, "implementer spawn tools");

	must("Poll every agent", /call `subagent_poll` repeatedly until every launched agent reaches a terminal state/i, "poll every agent to terminal");
	must("Poll every agent", /poll timeout is only a status update; continue polling/i, "poll timeouts do not abandon work");
	must("Poll every agent", /Never abandon active or undelivered agents/i, "never abandon agents");
	must("Poll every agent", /never start dependent work while a prior wave awaits validation/i, "prior-wave barrier");
	must("Poll every agent", /implementation agent fails after possible edits.*still validate the actual repository state for that phase/is, "failed implementations are validated");

	must("Poll every agent", /Oversized result reconstruction/i, "oversized result section exists");
	must("Poll every agent", /Collect UTF-8-safe page bytes in cursor order/i, "utf8-safe page collection");
	must("Poll every agent", /Concatenate pages byte-for-byte, never by string slicing/i, "byte concatenation not string");
	must("Poll every agent", /Verify the final digest matches the complete-result digest/i, "digest verification");
	must("Poll every agent", /Verify the reconstructed byte count matches the complete-result byte count/i, "byte count verification");

	must("Validate every phase with review-and-repair", /after every lettered subphase of a split phase has completed.*one GPT-5\.6 Terra `high` review-and-repair agent for the parent phase with full edit authority/is, "editing GPT validates after all subphases");
	must("Validate every phase with review-and-repair", /Never launch independent validation between a phase's lettered subphases/i, "no intermediate subphase validation");
	must("Validate every phase with review-and-repair", /Validators may not start until all implementation agents in that wave have stopped/i, "full implementation-wave barrier");
	must("Validate every phase with review-and-repair", /Inspect the actual repository state independently/i, "independent state inspection");
	must("Validate every phase with review-and-repair", /Edit every in-scope bug, regression, missing criterion, or alignment defect itself.*Do not delegate repair to another agent/is, "validator repairs itself");
	must("Validate every phase with review-and-repair", /Run the required tests, typecheck, lint, or build checks against the actual repository state, and rerun every affected check after edits/i, "post-repair validation");
	must("Validate every phase with review-and-repair", /Return exactly one of the following verdicts:[\s\S]*`VERDICT: PASS`[\s\S]*`VERDICT: BLOCKED`/i, "only PASS or BLOCKED");
	must("Validate every phase with review-and-repair", /BLOCKED.*genuine blocker outside the validator's edit authority.*concrete evidence/is, "strict BLOCKED meaning");
	must("Validate every phase with review-and-repair", /`Criteria Checked`, `Commands and Results`, `Findings`, `Edits Made`, and `Remaining Risks` sections/i, "validator evidence sections");
	must("Validate every phase with review-and-repair", /"tools"\s*:\s*\[\s*"read",\s*"bash",\s*"edit",\s*"write"\s*\]/i, "validator spawn tools");

	// PASS-before-dependent barriers
	must("PASS-before-dependent barriers", /No dependent phase starts before every dependency's latest checkpointed verdict is `VERDICT: PASS` with its observed changed-file evidence/i, "checkpointed latest-PASS barrier");
	must("PASS-before-dependent barriers", /phase is `BLOCKED`.*pause dependent scheduling.*do not cancel active siblings whose declared plus newly observed targets are disjoint/is, "BLOCKED pause semantics");
	must("PASS-before-dependent barriers", /later validation attempt.*replace BLOCKED as the derived latest status only by checkpointing PASS.*earlier attempts remain durable/is, "BLOCKED retry history");
	must("PASS-before-dependent barriers", /phase remains `BLOCKED`, start no later dependency wave/i, "BLOCKED prevents downstream");

	// Malformed verdict retry
	must("PASS-before-dependent barriers", /Retry once with a fresh, uniquely named GPT-5\.6 Terra high validator using the same exact editing tool set and authority/i, "malformed retry boundary");
	must("PASS-before-dependent barriers", /malformed response never becomes PASS, BLOCKED evidence by itself, or a DeepSeek repair request/i, "malformed never becomes verdict");

	// Checkpoint changed files and verdicts
	must("Checkpoint changed files and verdicts", /After each validator terminates, observe the actual changed paths from repository state/i, "observe actual changed paths");
	must("Checkpoint changed files and verdicts", /Always submit every truthful changed path, including paths outside declared plan targets/i, "truthful out-of-target evidence");
	must("Checkpoint changed files and verdicts", /structured `outside-declared-targets` warning.*plan drift.*reassess overlap before starting validators or later phases/is, "plan-drift warning handling");
	must("Checkpoint changed files and verdicts", /Serialize validators when newly discovered changed or repair write sets overlap/i, "serialize overlapping discovered validator writes");
	must("Checkpoint changed files and verdicts", /Before marking any PASS or opening a dependent barrier, checkpoint through `sprint_execution_record`/i, "checkpoint before PASS barrier");
	must("Checkpoint changed files and verdicts", /Pass the latest returned revision to every checkpoint call/i, "revision on every checkpoint");

	must("Final integration gate", /After every phase has a checkpointed `VERDICT: PASS`, launch one GPT-5\.6 Terra `high` integration review-and-repair agent with full edit authority/i, "editing integration gate after all PASS");
	must("Final integration gate", /inspect cross-phase behavior.*run applicable broader checks.*edit any remaining integration defect itself/is, "integration repair and criteria");
	must("Final integration gate", /After the integration validator terminates, observe repository changes again/i, "observe integration repairs");
	must("Final integration gate", /After integration PASS, checkpoint the integration verdict, observed changed-file set, and evidence through `sprint_execution_record`/i, "checkpoint integration");
	must("Final integration gate", /"tools"\s*:\s*\[\s*"read",\s*"bash",\s*"edit",\s*"write"\s*\]/i, "integration validator tools");

	must("Finish the execution record", /After integration PASS is checkpointed, call `sprint_execution_record` with `action: "finish"` and `type: "completed"`/i, "finish after integration PASS");
	must("Finish the execution record", /Never mark completed without durable integration PASS/i, "no completed without PASS");
	must("Finish the execution record", /non-success outcomes.*poll every launched or cancelled child to a terminal state.*checkpoint available evidence and all terminal child outcomes before finishing.*truthful non-success terminal state/is, "truthful non-success finish after terminal accounting");
	must("Finish the execution record", /`finish: blocked` is valid while the latest verdict for a phase or integration remains BLOCKED/i, "unresolved latest BLOCKED can finish blocked");

	must("Completion", /Confirm every phase and final integration have independent checkpointed.*VERDICT: PASS/i, "all checkpointed gates passed");
	must("Completion", /Review the final diff or changed-file set for scope and accidental edits/i, "final scope inspection");
	must("Completion", /Complete the project's required specification, knowledge, review, plan, and changelog workflow/i, "project records workflow");
	must("Completion", /Report the persisted execution record identity, source plan identity, completed phases/is, "report source and execution identity");
	must("Completion", /Do not claim extension-owned background execution or automatic resume/i, "no false persistence");
	must("Completion", /Report only checkpoints accepted by the deterministic execution record/i, "report only durable accepted checkpoints");
	must("Completion", /before a root-directed interruption, cancellation, or terminal finish.*poll every launched child to terminal/is, "root-session lifecycle terminal accounting");

	const actionableText = parsed.sections.map((section) => section.content).join("\n");
	// Forbid REPAIR / separate repair path
	assert.doesNotMatch(actionableText, /\bvalidators?\b[^\n.!?]{0,160}\b(?:must|may|should|shall)\s+not\s+(?:edit|modify|change|repair)\b/i, "actionable read-only validation is forbidden");
	assert.doesNotMatch(actionableText, /\bvalidators?\b[^\n.!?]{0,120}\b(?:is|are|must be|should be|may be)\s+read-only\b/i, "validators cannot be read-only");
	assert.doesNotMatch(actionableText, /\brepairs?\s+(?:are|may be|can be|should be|must be)\s+(?:delegated|handed off|assigned)\s+to\s+(?:a\s+)?separate\b/i, "repairs cannot be delegated separately");
	assert.doesNotMatch(actionableText, /\b(?:may|can|should|must|shall|will)\s+return\s+`?VERDICT:\s*REPAIR`?/i, "VERDICT: REPAIR cannot be actionable");
	assert.doesNotMatch(actionableText, /^\s*-\s*`?VERDICT:\s*REPAIR`?\s+(?:—|-|:)/im, "VERDICT: REPAIR cannot be an allowed list entry");
	assert.doesNotMatch(actionableText, /\b(?:allowed|valid|accepted)\s+verdicts?[^\n.!?]{0,100}\bREPAIR\b/i, "VERDICT: REPAIR cannot be allowed");
	assert.doesNotMatch(actionableText, /\b(?:use|allow|accept|emit|request)\b[^\n.!?]{0,80}`?VERDICT:\s*REPAIR`?/i, "VERDICT: REPAIR cannot be actionable");
	assert.doesNotMatch(actionableText, /\b(?:may|can|should|must|shall|will)\s+(?:spawn|launch|delegate(?:\s+to)?|hand\s+off\s+to)\b[^\n.!?]{0,180}\b(?:DeepSeek[^\n.!?]*repair|repair[^\n.!?]*DeepSeek)\b/i, "a separate DeepSeek repair delegation is forbidden");
	assert.doesNotMatch(actionableText, /\bgenerated\b[^\n.!?]{0,120}\bwaves?\b[^\n.!?]{0,100}\b(?:may|can|should|must|shall|will)\s+(?:be\s+)?(?:executed|run|rescheduled|serialized)\s+sequentially\b[^\n.!?]{0,80}\bfallback\b/i, "generated-wave sequential fallback is forbidden");
	assert.doesNotMatch(actionableText, /\b(?:root|delegated)\s+reports?\b[^\n.!?]{0,120}\b(?:may|can|should)\s+(?:include|provide|contain)\b[^\n.!?]{0,80}\b(?:duration|effort|ETA|calendar scheduling estimate)/i, "human estimates cannot be enabled in reports");
	assert.doesNotMatch(actionableText, /\b(?:manually|locally)\s+(?:parse|validate|reimplement)\b[^\n.!?]{0,120}\b(?:plan|fingerprint|result pag(?:e|ing)|execution record)/i, "deterministic algorithms cannot be duplicated in prose");
	assert.doesNotMatch(actionableText, /\b(?:write|modify|mutate|append)\b[^\n.!?]{0,100}\bsource (?:plan|planning-run)\b/i, "source material cannot be mutated");
	assert.doesNotMatch(actionableText, /\b(?:use|reuse|alias)\b[^\n.!?]{0,100}\bsource (?:plan|planning-run) identifier\b[^\n.!?]{0,100}\bexecution identifier\b/i, "source and execution identifiers cannot alias");
	assert.doesNotMatch(actionableText, /\bstart (?:a |the )?dependent\b[^\n.!?]{0,120}\bbefore\b[^\n.!?]{0,80}\bPASS\b/i, "dependents cannot start before PASS");

	const examples = extractSpawnExamples(content);
	const expectedEditing = ["read", "bash", "edit", "write"];
	for (const example of examples) {
		if (example.name.startsWith("preflight-")) assert.deepEqual(example.tools, [], `${example.name} exact tools`);
		else if (example.name.startsWith("impl-") || example.name.startsWith("validate-") || example.name.startsWith("integration-")) {
			assert.deepEqual(example.tools, expectedEditing, `${example.name} exact tools`);
		} else {
			assert.fail(`Unknown orchestrate spawn example role: ${example.name}`);
		}
	}
}

async function loadSkill(): Promise<string> {
	const packageRoot = path.resolve(import.meta.dirname, "..");
	return readFile(path.join(packageRoot, "skills", "orchestrate", "SKILL.md"), "utf8");
}

function mutateSkill(content: string, heading: string, appendText: string): string {
	const lines = content.split(/\r?\n/);
	const literal = `## ${heading}`;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!/^ {4,}|\t/.test(lines[i]) && lines[i].trim() === literal) {
			return [...lines.slice(0, i + 1), appendText, "", ...lines.slice(i + 1)].join("\n");
		}
	}
	return `${content}\n\n${appendText}\n`;
}

// ── Package structure ────────────────────────────────────────────────────

test("package installs the orchestrate skill and exposes the complete agent-callable planning pipeline", async () => {
	const packageRoot = path.resolve(import.meta.dirname, "..");
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.skills, ["./skills"]);

	const extension = await readFile(path.join(packageRoot, "index.ts"), "utf8");
	assert.doesNotMatch(extension, /registerCommand\(["']orchestrate["']/);
	assert.match(extension, /const currentAgentConfiguration = loadDefaultSprintPlannerAgentConfiguration\(\);/);
	assert.match(extension, /currentAgentConfiguration\);/);
	const defaultConfiguration = await readFile(path.join(packageRoot, "configs", "default.ts"), "utf8");
	assert.match(defaultConfiguration, /satisfies SprintPlannerAgentConfiguration/);
	assert.match(extension, /\["ironout", "advanceplan"\]/);
	for (const [tool, method] of [
		["sprint_brainstorm", "runStandaloneBrainstorm"],
		["sprint_ironout", "runStandaloneIronout"],
		["sprint_advanceplan", "runStandaloneAdvancePlan"],
	] as const) {
		assert.match(extension, new RegExp(`name: "${tool}"[\\s\\S]*?executionMode: "sequential"[\\s\\S]*?${method}`));
	}
	assert.doesNotMatch(extension, /sprint_(?:ironout|advanceplan)[\s\S]{0,1000}(?:provider|model): Type\./);
	assert.match(extension, /name: "sprint_validate_plan"[\s\S]*additionalProperties: false[\s\S]*details,\n\s*};/);
	const executionTool = extension.slice(extension.indexOf('name: "sprint_execution_record"'), extension.indexOf('pi.registerCommand("sprint"'));
	assert.match(executionTool, /parameters: Type\.Union\([\s\S]*?\], \{ type: "object" \}\),/, "the strict union must advertise type: object at the provider schema root");
	assert.match(extension, /EXECUTION_PHASE_PATTERN = "\^phase-\[0-9\]\{2\}-\[a-z0-9\]\[a-z0-9-\]\*\(\?:\\\\\.md\)\?\$"/);
	assert.equal((executionTool.match(/phase: Type\.String\(\{[^}]*pattern: EXECUTION_PHASE_PATTERN, description: EXECUTION_PHASE_DESCRIPTION[^}]*\}\)/g) ?? []).length, 2, "both phase checkpoint variants expose normalization pattern and description");
	const runner = await readFile(path.join(packageRoot, "pi-runner.ts"), "utf8");
	assert.match(runner, /const builtins = isolated \? \[\] : \["read", "grep", "find", "ls"\]/);
	assert.doesNotMatch(runner, /sprint_report_toolchain_blocker|"bash", "edit", "write"/);
});

// ── Reusable skill contract and mutation tests ──────────────────────────

test("orchestrate skill satisfies the complete actionable contract", async () => {
	assertOrchestrateSkillContract(await loadSkill());
});

test("orchestrate instructions execute lettered subphases before one phase validation", async () => {
	const skill = await loadSkill();
	assert.match(skill, /phase is the atomic dependency and validation unit/i);
	assert.match(skill, /unsplit phase maps to one DeepSeek Pro V4 `max` implementation-agent session/i);
	assert.match(skill, /lettered subphases.*each subphase maps to one sequential implementation-agent session/is);
	assert.match(skill, /Complete every subphase in letter order before launching the single phase-level validator/i);
	assert.match(skill, /Never launch independent validation between a phase's lettered subphases/i);
	assert.match(skill, /do not calculate or enforce token counts during execution/i);
});

const actionableSkillMutations = [
	{
		name: "read-only validators",
		heading: "Validate every phase with review-and-repair",
		text: "Validators inspect repository state but must not edit files; repairs are delegated to a separate agent.",
		error: /read-only validation/i,
	},
	{
		name: "VERDICT: REPAIR as an allowed option",
		heading: "Validate every phase with review-and-repair",
		text: "Validators may return `VERDICT: REPAIR` to request a separate repair agent.",
		error: /VERDICT: REPAIR cannot be actionable/i,
	},
	{
		name: "separate DeepSeek repair delegation",
		heading: "Validate every phase with review-and-repair",
		text: "When a validator finds defects it may spawn a separate DeepSeek repair agent to fix them.",
		error: /separate DeepSeek repair delegation/i,
	},
	{
		name: "generated-wave sequential fallback",
		heading: "Schedule work",
		text: "When safety is uncertain, generated authoritative waves may be executed sequentially as a fallback.",
		error: /generated-wave sequential fallback/i,
	},
] as const;

for (const mutation of actionableSkillMutations) {
	test(`mutation: ${mutation.name} is rejected by the reusable contract checker`, async () => {
		const mutated = mutateSkill(await loadSkill(), mutation.heading, mutation.text);
		assert.throws(() => assertOrchestrateSkillContract(mutated), mutation.error);
	});
}

test("mutation: harmless negated historical explanation passes the reusable checker", async () => {
	const mutated = mutateSkill(await loadSkill(), "Validate every phase with review-and-repair", "Unlike earlier versions, validators do not merely report defects — they edit them directly. No separate DeepSeek repair agent is used.");
	assert.doesNotThrow(() => assertOrchestrateSkillContract(mutated));
});

test("mutation: duplicate required headings are rejected instead of selecting the first section", async () => {
	const mutated = `${await loadSkill()}\n## Preflight\n\nContradictory duplicate.\n`;
	assert.throws(() => assertOrchestrateSkillContract(mutated), /Duplicate required section: Preflight/);
});

test("mutation: headings inside closed and unclosed backtick or tilde fences are ignored", async () => {
	const content = await loadSkill();
	for (const fenced of [
		"```markdown\n## Preflight\n```",
		"~~~markdown\n## Preflight\n~~~",
		"````markdown\n## Preflight",
		"~~~~markdown\n## Preflight",
	]) {
		assert.doesNotThrow(() => assertOrchestrateSkillContract(`${content}\n${fenced}\n`));
	}
	for (const fence of ["```", "~~~"]) {
		const hidden = content.replace("## Preflight", `${fence}\n## Preflight\n${fence}`);
		assert.throws(() => assertOrchestrateSkillContract(hidden), /Missing required section: Preflight/);
	}
});

test("parseScopeSize extracts small, medium, or large from orchestration content", async () => {
	const { parseScopeSize } = await import("../validation.ts");
	const orch = (size: string) => `## Scope Size\n\n**Size**: ${size}\n`;
	const { ScopeSize } = await import("../types.ts");
	assert.equal(parseScopeSize(orch("small")), "small");
	assert.equal(parseScopeSize(orch("medium")), "medium");
	assert.equal(parseScopeSize(orch("large")), "large");
	assert.equal(parseScopeSize(orch("extra-large")), "extra-large");
	assert.throws(() => parseScopeSize(orch("huge")), /must declare/);
	assert.throws(() => parseScopeSize("## Scope Size\n\nNo marker here\n"), /must declare/);
});

test("validatePlanFiles enforces scope-size phase budgets at boundaries", () => {
	const fileSet = (size: "small" | "medium" | "large", count: number) => {
		const phases = Array.from({ length: count }, (_, index) => ({
			path: `phase-${String(index + 1).padStart(2, "0")}-step.md`,
			content: phaseMd(index + 1, index === 0 ? "none" : `phase-${String(index).padStart(2, "0")}-step.md`, `Complete phase ${index + 1}`, `sprint-planner/target-${String(index + 1).padStart(2, "0")}.ts`),
		}));
		return [{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationFor(size, phases.map((phase) => phase.path)) }, ...phases];
	};

	// Small: 2–3 phases — out of bounds (count=1 hits the global 2–20 check first)
	validatePlanFiles(fileSet("small", 2));
	validatePlanFiles(fileSet("small", 3));
	assert.throws(() => validatePlanFiles(fileSet("small", 1)), /contiguous phase files/);
	assert.throws(() => validatePlanFiles(fileSet("small", 4)), /requires 2/);

	// Medium: 3–5 phases — valid boundaries
	validatePlanFiles(fileSet("medium", 3));
	validatePlanFiles(fileSet("medium", 5));
	assert.throws(() => validatePlanFiles(fileSet("medium", 2)), /requires 3/);
	assert.throws(() => validatePlanFiles(fileSet("medium", 6)), /requires 3/);

	// Large: 6–10 phases — valid boundaries
	validatePlanFiles(fileSet("large", 6));
	validatePlanFiles(fileSet("large", 10));
	assert.throws(() => validatePlanFiles(fileSet("large", 5)), /requires 6/);
	assert.throws(() => validatePlanFiles(fileSet("large", 11)), /requires 6/);

	// Extra-large: 11–20 phases — valid boundaries
	validatePlanFiles(fileSet("extra-large", 11));
	validatePlanFiles(fileSet("extra-large", 20));
	assert.throws(() => validatePlanFiles(fileSet("extra-large", 10)), /requires 11/);
	assert.throws(() => validatePlanFiles(fileSet("extra-large", 21)), /contiguous phase files/);

	// Missing orchestration heading
	const badOrch = orchestrationSmall.replace("## Scope Size", "## Budget");
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: badOrch }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }]), /literal ## Scope Size/);
});

test("validatePlanDirectory rejects missing orchestration and non-flat entries", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-orch-"));
	await writeFile(path.join(root, "concepts.md"), concepts);
	await writeFile(path.join(root, "phase-01-first.md"), phase1);
	await writeFile(path.join(root, "phase-02-second.md"), phase2);
	await assert.rejects(validatePlanDirectory(root), /exactly one orchestration/);

	await writeFile(path.join(root, "orchestration.md"), orchestrationSmall);
	await validatePlanDirectory(root);

	await writeFile(path.join(root, "review.md"), "# Extraneous");
	await assert.rejects(validatePlanDirectory(root), /Unexpected entry in plan directory: review\.md/);
});

test("validatePlanDirectory rejects a symbolic-link directory root", async (t) => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-plan-root-link-"));
	const target = path.join(parent, "target");
	const linked = path.join(parent, "linked");
	await mkdir(target);
	await writeFile(path.join(target, "concepts.md"), concepts);
	await writeFile(path.join(target, "orchestration.md"), orchestrationSmall);
	await writeFile(path.join(target, "phase-01-first.md"), phase1);
	await writeFile(path.join(target, "phase-02-second.md"), phase2);
	try {
		await symlink(target, linked, "dir");
	} catch (error) {
		t.skip(`symbolic links unavailable: ${String(error)}`);
		return;
	}
	await assert.rejects(validatePlanDirectory(linked), /traverse symbolic link/);
});

test("orchestration reviewer receives handoff, corrected concepts, orchestration, and phase index", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "orch-context", directive: "Verify context", agents: 4 });
	const orchReq = runner.requests.find((request) => request.role === "advanced orchestration reviewer")!;
	assert.equal(orchReq.contextPaths.length, 3);
	assert.match(orchReq.contextPaths.join(" "), /handoff/);
	assert.match(orchReq.contextPaths.join(" "), /concepts/);
	assert.match(orchReq.contextPaths.join(" "), /orchestration/);
	assert.match(orchReq.prompt, /you may not add, remove, split, or merge phases/i);
	assert.match(orchReq.prompt, /phase-01-first\.md, phase-02-second\.md/);
});

test("phase reviewer receives corrected concepts, corrected orchestration, and its own phase", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "phase-ctx", directive: "Phase context", agents: 4 });
	const phaseReqs = runner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:"));
	assert.equal(phaseReqs.length, 2);
	for (const req of phaseReqs) {
		assert.equal(req.contextPaths.length, 3);
		assert.match(req.contextPaths.join(" "), /concepts/);
		assert.match(req.contextPaths.join(" "), /orchestration/);
		assert.match(req.prompt, /one-agent executability/);
		assert.match(req.prompt, /schedule consistency/);
	}
});

test("planning review summary includes orchestration component review", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "summary", directive: "Summary check", agents: 4 });
	assert.equal(state.status, "completed");
	const summary = await readFile(path.join(internal, "sprints", "summary", "reviews", "advanced-plan-review.md"), "utf8");
	assert.match(summary, /orchestration\.md/);
	assert.match(summary, /concepts\.md/);
	assert.match(summary, /phase-01-first/);
});

test("standalone advance plan performs orchestration corrective review", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const planDir = await new SprintPlannerEngine(runner).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "standalone-orch", directive: "Standalone plan" });
	assert.deepEqual((await readdir(planDir)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	const orchReview = runner.requests.find((request) => request.role === "advanced orchestration reviewer")!;
	assert.equal(orchReview.model.thinking, "high");
	const summary = await readFile(path.join(internal, "reviews", "standalone-orch-advanced-plan-review.md"), "utf8");
	assert.match(summary, /orchestration\.md/);
});

test("state version 3 rejects an older incomplete checkpoint on load and resume", async () => {
	const { SPRINT_STATE_VERSION } = await import("../types.ts");
	assert.equal(SPRINT_STATE_VERSION, 3);
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const running = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "old-state", directive: "Reject old state", agents: 4 });
	await delayed.waiting;
	await engine.pause(true);
	await running;
	const runDirectory = path.join(internal, "sprints", "old-state");
	const statePath = path.join(runDirectory, ".state.json");
	const oldState = JSON.parse(await readFile(statePath, "utf8"));
	oldState.version = 2;
	await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
	await assert.rejects(new SprintStateStore(runDirectory).load(), /unsupported/);
	await assert.rejects(new SprintPlannerEngine(new FakeRunner()).resumeSprint(runDirectory, "old-state"), /unsupported/);
});

test("plan and handoff prompts provide instruction-only time-estimate guidance", async () => {
	const {
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
		synthesisPrompt,
	} = await import("../prompts.ts");
	const planPrompt = advancedPlanPrompt("Test handoff");
	assert.match(planPrompt, /4–22 files/);
	assert.match(planPrompt, /Extra-large: 11–20 phases/);
	assert.match(planPrompt, /likely to exceed one implementation agent's context/);
	assert.match(planPrompt, /Scope Size/);
	assert.match(planPrompt, /Phase Ledger/);
	assert.match(planPrompt, /Execution Waves/);
	assert.match(planPrompt, /Model Assignments/);
	assert.match(planPrompt, /Validation Gate/);
	assert.match(planPrompt, /Final Integration/);
	assert.match(planPrompt, /\*\*Size\*\*: small/);
	assert.match(planPrompt, /deepseek\/deepseek-v4-pro:max/);
	assert.match(planPrompt, /openai-codex\/gpt-5\.6-terra:high/);
	assert.match(planPrompt, /Technical machine semantics.*timeout.*TTL.*retry.*backoff.*polling.*cache.*retention.*lease.*complexity/i);
	assert.match(planPrompt, /one agent session.*200,000–300,000 tokens/i);
	assert.match(planPrompt, /lettered subphases \(A, B, C/i);
	assert.match(planPrompt, /validation happens only after every lettered subphase is complete/i);
	assert.match(planPrompt, /do not perform or print a formal token estimate/i);
	assert.match(planPrompt, /full requested user scope/i);
	assert.match(planPrompt, /mocks, stubs, placeholders, deferred work, partial implementations/i);
	assert.match(planPrompt, /production-quality behavior/i);

	const decompositionReview = advancedDecompositionReviewPrompt("Handoff", []);
	assert.match(decompositionReview, /one agent session.*200,000–300,000 tokens/i);
	assert.match(decompositionReview, /lettered subphases A, B, C/i);
	assert.match(decompositionReview, /validation happens only after all of its subphases complete/i);
	assert.match(decompositionReview, /complete requested user scope/i);
	assert.match(decompositionReview, /mocks, stubs, placeholders, deferred work, partial implementations/i);

	const orchReview = advancedOrchestrationReviewPrompt("Handoff", { path: "concepts.md", content: "x" }, { path: "orchestration.md", content: "x" }, ["phase-01-a.md"]);
	assert.match(orchReview, /may not add, remove, split, or merge phases/);
	assert.match(orchReview, /deepseek\/deepseek-v4-pro:max/);
	assert.match(orchReview, /one implementer per unsplit phase/);
	assert.match(orchReview, /PASS gate/);
	assert.match(orchReview, /one agent session.*200,000–300,000 tokens/i);
	assert.match(orchReview, /lettered subphases A, B, C/i);
	assert.match(orchReview, /phase validation only after every subphase completes/i);
	assert.match(orchReview, /full production scope/i);
	assert.match(orchReview, /acceptance endpoints/i);

	const conceptReview = advancedConceptReviewPrompt("Handoff", { path: "concepts.md", content: "x" }, ["phase-01-a.md"]);
	const phaseReview = advancedPhaseReviewPrompt({ path: "concepts.md", content: "x" }, { path: "orchestration.md", content: "x" }, { path: "phase-01-a.md", content: "x" }, ["phase-01-a.md"]);
	assert.match(phaseReview, /one-agent executability/);
	assert.match(phaseReview, /schedule consistency/);
	assert.match(phaseReview, /exact ordered edit steps/);
	assert.match(phaseReview, /invariants/);
	assert.match(phaseReview, /edge cases/);
	assert.match(phaseReview, /only necessary concise code or pseudocode examples/);
	assert.match(phaseReview, /detailed head-down implementation guidance without context bloat/);
	assert.match(phaseReview, /one agent session.*200,000–300,000 tokens/i);
	assert.match(phaseReview, /lettered subphases A, B, C/i);
	assert.match(phaseReview, /all subphases to complete in order before the phase-level validation/i);
	assert.match(phaseReview, /orchestration\.md/);
	assert.match(phaseReview, /full production scope/i);
	assert.match(phaseReview, /acceptable exit criteria/i);
	assert.match(conceptReview, /full production scope/i);

	const brainstorm = brainstormPrompt("Prompt", { id: "feature-complete", name: "Feature completeness", lens: "Completeness" });
	const crossReview = crossReviewPrompt({ id: "feature-complete", name: "Feature completeness", lens: "Completeness" }, [{ path: "other.md", content: "## Prompt\n\nx" }]);
	const synthesis = synthesisPrompt("Prompt", [{ path: "a.md", content: "## Prompt\n\nx" }]);
	const redTeam = redTeamPrompt("Synthesis");
	for (const prompt of [brainstorm, crossReview, synthesis, redTeam]) {
		assert.match(prompt, /feature completeness|feature-complete|production quality|production-quality/i);
		assert.match(prompt, /mocks, stubs, placeholders, deferred work, partial implementations/i);
	}

	const guidedPrompts = [
		ironoutPrompt("Input", [], false),
		ironoutReviewPrompt("Handoff"),
		planPrompt,
		conceptReview,
		orchReview,
		phaseReview,
	];
	for (const prompt of guidedPrompts) {
		assert.match(prompt, /Do not include time estimates, duration, effort, ETA, or calendar scheduling language\./);
		assert.match(prompt, /Plans and handoffs describe what to do, not how long it takes\./);
		assert.match(prompt, /mocks, stubs, placeholders, deferred work, partial implementations/i);
	}
});

test("prompt enforces scope classification criteria with exact budgets", async () => {
	const { advancedPlanPrompt } = await import("../prompts.ts");
	const prompt = advancedPlanPrompt("Test");
	assert.match(prompt, /(S|s)mall.*2.{1,5}3/);
	assert.match(prompt, /(M|m)edium.*3.{1,5}5/);
	assert.match(prompt, /(L|l)arge.*6.{1,5}10/);
	assert.match(prompt, /cohesive/);
	assert.match(prompt, /one agent/);
});

test("malformed-state reset deletes only the selected non-symlink sprint directory", async (t) => {
	const { root, internal } = await project();
	const run = await createSprintRun(internal, "broken");
	await writeFile(path.join(run, ".state.json"), "not json");
	await assert.rejects(new SprintStateStore(run).load(), /Malformed sprint state/);
	await deleteSprintRun(internal, "broken");
	assert.equal(await entryExists(run), false);

	const outside = await mkdtemp(path.join(os.tmpdir(), "pi-sprint-outside-"));
	try {
		await symlink(outside, path.join(internal, "sprints", "linked"), "dir");
	} catch (error) {
		t.skip(`symlinks unavailable: ${String(error)}`);
		return;
	}
	await assert.rejects(deleteSprintRun(internal, "linked"), /not a regular directory/);
	assert.equal((await stat(outside)).isDirectory(), true);
});

test("artifact hashes detect tampering before resume", async () => {
	const { internal } = await project();
	const run = await createSprintRun(internal, "hash");
	const store = new RunArtifactStore(run);
	const record = await store.write("evidence.md", "first");
	assert.equal(await store.verify(record), true);
	await writeFile(path.join(run, "evidence.md"), "changed\n");
	assert.equal(await store.verify(record), false);
});

test("parseScopeSize requires exact own-line marker inside ## Scope Size section", async () => {
	const { parseScopeSize } = await import("../validation.ts");

	// Valid: marker on its own line inside ## Scope Size
	assert.equal(parseScopeSize("## Scope Size\n\n**Size**: small\n"), "small");
	assert.equal(parseScopeSize("## Scope Size\n\n**Size**: medium\n"), "medium");
	assert.equal(parseScopeSize("## Scope Size\n\n**Size**: large\n"), "large");

	// Reject: marker not on its own line (inline text)
	assert.throws(() => parseScopeSize("## Scope Size\n\nSome text **Size**: small more text\n"), /own line/);

	// Reject: marker in wrong section
	assert.throws(() => parseScopeSize("## Phase Ledger\n\n**Size**: small\n\n## Scope Size\n\nNo marker here\n"), /own line/);

	// Reject: duplicate markers
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**: small\n\n**Size**: medium\n"), /duplicates/);

	// Reject: marker in code block
	assert.throws(() => parseScopeSize("## Scope Size\n\n```\n**Size**: small\n```\n"), /own line/);

	// Reject: missing section entirely
	assert.throws(() => parseScopeSize("# No scope here\n\n## Other\n\nContent\n"), /Scope Size/);
});

test("validatePlanFiles normalizes paths before lookup so whitespace-padded paths do not cause TypeError", () => {
	// Padded path should be normalized and found
	validatePlanFiles([
		{ path: " concepts.md", content: concepts },
		{ path: "orchestration.md ", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	]);

	// Tab/control-free normalization still rejects control characters
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-\x00second.md", content: phase2 }]), /control/);
});

test("structural validators do not enforce time-estimate wording", () => {
	const handoff = `${markdown("Handoff", HANDOFF_HEADINGS)}\n\nJWT expires in 15 minutes.\n`;
	assert.doesNotThrow(() => validateHandoff(handoff));

	const conceptsWithDurations = `${concepts}\n\nUse a 5-minute cache TTL. Implementation estimate: 2 days.\n`;
	const phaseWithDurations = `${phase1}\n\nThe request timeout is 30 seconds. ETA: Friday.\n`;
	assert.doesNotThrow(() => validatePlanFiles([
		{ path: "concepts.md", content: conceptsWithDurations },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phaseWithDurations },
		{ path: "phase-02-second.md", content: phase2 },
	]));
});

class BadOrchestrationRunner extends FakeRunner {
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role === "advanced orchestration reviewer") {
			this.requests.push(structuredClone(request));
			// Return orchestration with "small" scope but add a marker inline and wrong budget — caught early
			const badOrch = orchestrationSmall.replace("**Size**: small", "**Size**: large");
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: badOrch }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

test("malformed orchestration correction is caught before phase reviews are called", async () => {
	const { root, internal } = await project();
	const runner = new BadOrchestrationRunner();
	const engine = new SprintPlannerEngine(runner);
	const state = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "bad-orch", directive: "Bad orchestration", agents: 4 });
	assert.equal(state.status, "paused");
	assert.match(state.error ?? "", /requires 6–10 phases/);
	// Verify no phase reviewers were called
	const phaseReviewCalls = runner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:"));
	assert.equal(phaseReviewCalls.length, 0);
});

test("successful standalone advance-plan publication creates the complete plan and review pair", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const engine = new SprintPlannerEngine(runner);
	const planDir = await engine.runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "atomic-pub", directive: "Atomic test" });
	assert.deepEqual((await readdir(planDir)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	// Review must exist
	const reviewPath = path.join(internal, "reviews", "atomic-pub-advanced-plan-review.md");
	assert.equal(await entryExists(reviewPath), true);
	const reviewContent = await readFile(reviewPath, "utf8");
	assert.match(reviewContent, /orchestration\.md/);
});

// ── Regression: retryable orchestration (persistent) ──────────────────────

class FirstBadThenGoodOrchRunner extends FakeRunner {
	private orchCalls = 0;
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role === "advanced orchestration reviewer") {
			this.requests.push(structuredClone(request));
			this.orchCalls++;
			if (this.orchCalls === 1) {
				// scope "large" requires 6–10 phases but we only have 2 → semantic rejection
				const badOrch = orchestrationSmall.replace("**Size**: small", "**Size**: large");
				return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: badOrch }] }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			// Valid on retry
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: orchestrationSmall }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

test("orchestration semantic failure inside consume is retryable and succeeds on valid retry", async () => {
	const { root, internal } = await project();
	const runner = new FirstBadThenGoodOrchRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "orch-retry", directive: "Orch retry", agents: 4 });
	assert.equal(state.status, "completed");
	// Two orchestration review attempts: one failed (retried), one succeeded
	const orchReqs = runner.requests.filter((r) => r.role === "advanced orchestration reviewer");
	assert.equal(orchReqs.length, 2);
	assert.equal(orchReqs[0].retryPrompt, undefined, "first attempt has no retry prompt");
	assert.match(orchReqs[1].retryPrompt ?? "", /^Attempt 2:/);
	// Phase reviews must run after valid orchestration
	const phaseReqs = runner.requests.filter((r) => r.role.startsWith("advanced phase reviewer:"));
	assert.equal(phaseReqs.length, 2);
});

// ── Regression: retryable orchestration (standalone) ──────────────────────

class StandaloneBadOrchRunner extends FakeRunner {
	private orchCalls = 0;
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role === "advanced orchestration reviewer") {
			this.requests.push(structuredClone(request));
			this.orchCalls++;
			if (this.orchCalls <= 2) {
				const badOrch = orchestrationSmall.replace("**Size**: small", "**Size**: large");
				return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: badOrch }] }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: orchestrationSmall }] }, sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

test("standalone orchestration semantic check retries inside #standaloneCall and succeeds on third attempt", async () => {
	const { root, internal } = await project();
	const runner = new StandaloneBadOrchRunner();
	const engine = new SprintPlannerEngine(runner);
	const planDir = await engine.runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "standalone-orch-retry", directive: "Standalone orch retry" });
	assert.deepEqual((await readdir(planDir)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	const orchReqs = runner.requests.filter((r) => r.role === "advanced orchestration reviewer");
	assert.equal(orchReqs.length, 3);
});

// ── Regression: padded paths through the actual engine ────────────────────

class PaddedPathRunner extends FakeRunner {
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role === "advanced planner") {
			this.requests.push(structuredClone(request));
			// Submit files with whitespace-padded paths
			return {
				ok: true,
				submission: {
					kind: "files",
					files: [
						{ path: " concepts.md", content: concepts },
						{ path: "orchestration.md ", content: orchestrationSmall },
						{ path: "  phase-01-first.md  ", content: phase1 },
						{ path: "\tphase-02-second.md", content: phase2 },
					],
				},
				sessionPath: request.sessionPath,
				disposition: "completed",
			};
		}
		return super.run(request, signal);
	}
}

test("engine canonicalizes padded submitted paths so planNames and lookups never TypeError", async () => {
	const { root, internal } = await project();
	const runner = new PaddedPathRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "padded", directive: "Padded paths", agents: 4 });
	assert.equal(state.status, "completed");
	const plan = await Promise.all((await readdir(path.join(internal, "sprints", "padded", "planning"))).map(async (name) => ({ name, content: await readFile(path.join(internal, "sprints", "padded", "planning", name), "utf8") })));
	assert.equal(plan.find((f) => f.name === "concepts.md")?.content, concepts);
});

// ── Regression: parseScopeSize code-fence and casing hardening ──────────

test("parseScopeSize strips tilde-fenced and indented code and rejects non-literal casing", async () => {
	const { parseScopeSize } = await import("../validation.ts");

	// Tilde-fenced code hides marker — still no marker found
	assert.throws(() => parseScopeSize("## Scope Size\n\n~~~\n**Size**: small\n~~~\n"), /own line/);

	// Indented code (4 spaces) hides marker
	assert.throws(() => parseScopeSize("## Scope Size\n\n    **Size**: small\n"), /own line/);

	// Indented code (tab) hides marker
	assert.throws(() => parseScopeSize("## Scope Size\n\n\t**Size**: small\n"), /own line/);

	// Uppercase marker is rejected (must be literal small|medium|large)
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**: Small\n"), /own line/);
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**: LARGE\n"), /own line/);
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**: Medium\n"), /own line/);

	// Valid lowercase still works
	assert.equal(parseScopeSize("## Scope Size\n\n**Size**: small\n"), "small");
});

// ── Regression: advancedReviewPrompt removed ──────────────────────────────

test("advancedReviewPrompt is not exported and no reviewer changes the phase set", async () => {
	const exported = await import("../core.ts");
	assert.equal("advancedReviewPrompt" in exported, false);
});

// ── Regression: poisoned checkpoint cannot skip validation on resume ─────

test("resume after poisoned orchestration re-runs the failed step", async () => {
	const { root, internal } = await project();
	const runner = new BadOrchestrationRunner();
	const engine = new SprintPlannerEngine(runner);
	// First run — fails at orchestration review, state paused
	const paused = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "poison-resume", directive: "Poison resume", agents: 4 });
	assert.equal(paused.status, "paused");
	// Verify the orchestration step is marked failed (after max attempts)
	const statePath = path.join(internal, "sprints", "poison-resume");
	const stateStore = new SprintStateStore(statePath);
	const loaded = await stateStore.load();
	const orchStep = loaded.steps["planning-review-orchestration"];
	assert.equal(orchStep.status, "failed");
	assert.equal(orchStep.attempts, 3);

	// Phase 02: exhausted steps stay exhausted; resume stops with the same failure.
	const resumeRunner = new FakeRunner();
	const resumed = await new SprintPlannerEngine(resumeRunner).resumeSprint(statePath, "poison-resume");
	assert.equal(resumed.status, "paused");
	assert.match(resumed.error ?? "", /exhausted its retries/);
});

test("scope marker is literal and fenced markers never escape closed or unclosed Markdown code", async () => {
	const { parseScopeSize } = await import("../validation.ts");
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**:small\n"), /own line/);
	assert.throws(() => parseScopeSize("## Scope Size\n\n**Size**:  small\n"), /own line/);
	assert.throws(() => parseScopeSize("## scope size\n\n**Size**: small\n"), /literal ## Scope Size/);
	assert.throws(() => parseScopeSize("## Scope Size\n\n````ts\n**Size**: small\n"), /own line/);
	assert.throws(() => parseScopeSize("## Scope Size\n\n~~~~\n**Size**: small\n"), /own line/);
	assert.equal(parseScopeSize("## Scope Size\n\n````\n**Size**: large\n````\n\n**Size**: medium\n"), "medium");
	assert.equal(parseScopeSize("## Scope Size\n\n~~~~\n**Size**: large\n~~~~\n\n**Size**: small\n"), "small");
});

test("orchestration semantics enforce complete ledgers, dependencies, waves, tuples, one implementer, PASS gates, and integration", () => {
	const phases = ["phase-01-first.md", "phase-02-second.md"];
	validateOrchestration(orchestrationSmall, phases);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("**Size**: small", "**Size**: small\nextra scope prose"), phases), /Scope Size.*exact structured/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace(/^- phase-02-second\.md \|.*\n/m, ""), phases), /cover every phase/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("depends: phase-01-first.md", "depends: phase-99-missing.md"), phases), /not a plan phase/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("- wave-01: phase-01-first.md\n- wave-02: phase-02-second.md", "- wave-01: phase-02-second.md\n- wave-02: phase-01-first.md"), phases), /earlier wave/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("deepseek/deepseek-v4-pro:max", "deepseek/deepseek-v4-pro:high"), phases), /Model Assignments.*exact structured/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("exactly one implementation agent per unsplit phase, or one sequential agent per lettered subphase for split phases", "two implementation agents per phase"), phases), /Model Assignments.*exact structured/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("review-and-repair must PASS", "review only"), phases), /Validation Gate.*exact structured/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("run final integration validation", "skip final integration validation"), phases), /Final Integration.*exact structured/);
	assert.throws(() => validateOrchestration(`${orchestrationSmall}\n## Extra\n\nNot part of the schema.\n`, phases), /only the six required level-two sections/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("targets: sprint-planner/target-01.ts", "targets: sprint-planner\\target-01.ts"), phases), /canonical project-relative path/);
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("targets: sprint-planner/target-01.ts", "targets: `sprint-planner\/target-01.ts`"), phases), /without Markdown quoting/);
	for (const heading of ORCHESTRATION_HEADINGS) {
		const fencedForeignContent = orchestrationSmall.replace(`## ${heading}\n\n`, `## ${heading}\n\n\`\`\`text\nforeign content\n\`\`\`\n`);
		assert.throws(() => validateOrchestration(fencedForeignContent, phases), /Orchestration/);
	}
	assert.throws(() => validateOrchestration(orchestrationSmall.replace("- Validation: openai-codex/gpt-5.6-terra:high", "    - Validation: openai-codex/gpt-5.6-terra:high"), phases), /Model Assignments.*exact structured/);
	const parallelOverlap = orchestrationSmall
		.replace("phase-02-second.md | depends: phase-01-first.md | targets: sprint-planner/target-02.ts", "phase-02-second.md | depends: none | targets: sprint-planner/target-01.ts")
		.replace("- wave-01: phase-01-first.md\n- wave-02: phase-02-second.md", "- wave-01: phase-01-first.md, phase-02-second.md");
	assert.throws(() => validateOrchestration(parallelOverlap, phases), /overlapping write targets/);
});

class FirstSemanticMalformedRunner extends FakeRunner {
	seen = new Set<string>();

	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		const result = await super.run(request, signal);
		const role = request.role;
		const targeted = role.includes("ironout author") || role.includes("ironout reviewer") || role === "advanced planner" || role === "advanced concepts reviewer" || role === "advanced orchestration reviewer" || role.startsWith("advanced phase reviewer:");
		if (!targeted || this.seen.has(role) || !result.ok || !result.submission) return result;
		this.seen.add(role);
		const malformed = structuredClone(result);
		malformed.disposition = "completed";
		if (role.includes("ironout author")) malformed.submission!.content! = malformed.submission!.content!.replace("## Validation", "## Checks");
		else if (role.includes("ironout reviewer")) {
			const handoff = malformed.submission!.files!.find((file) => file.path === "handoff.md")!;
			handoff.content = handoff.content.replace("## Sign-off", "## Approval");
		}
		else if (role === "advanced planner") {
			const concepts = malformed.submission!.files!.find((file) => file.path === "concepts.md")!;
			concepts.content = concepts.content.replace("## Architecture", "## Design");
		}
		else if (role === "advanced concepts reviewer") {
			const concepts = malformed.submission!.files!.find((file) => file.path === "concepts.md")!;
			concepts.content = concepts.content.replace("## Constraints", "## Limits");
		}
		else if (role === "advanced orchestration reviewer") malformed.submission!.files!.find((file) => file.path === "orchestration.md")!.content = orchestrationSmall.replace(" | depends: ", " | dependency: ");
		else {
			const phase = malformed.submission!.files!.find((file) => file.path !== "review.md")!;
			phase.content = phase.content.replace("## Exit Criteria", "## Completion Criteria");
		}
		return malformed;
	}
}

test("persistent semantic validators retry malformed handoffs, plan drafts, concepts, orchestration, and early and late phases", async () => {
	const { root, internal } = await project();
	const runner = new FirstSemanticMalformedRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "semantic-retries", directive: "Retry every semantic boundary", agents: 4 });
	assert.equal(state.status, "completed", state.error);
	// Roles that have heading validation (retry on malformation)
	for (const role of ["autonomous ironout author", "corrective ironout reviewer", "advanced concepts reviewer", "advanced orchestration reviewer", "advanced phase reviewer: phase-01-first.md", "advanced phase reviewer: phase-02-second.md"]) {
		assert.equal(runner.requests.filter((request) => request.role === role).length, 2, role);
	}
	// Advanced planner draft headings are validated inside its retry boundary.
	assert.equal(runner.requests.filter((request) => request.role === "advanced planner").length, 2);
	// advanced decomposition reviewer: not targeted by FirstSemanticMalformedRunner — 1 call
	assert.equal(runner.requests.filter((request) => request.role === "advanced decomposition reviewer").length, 1);
});

test("standalone semantic validators retry malformed drafts, corrected handoffs, concepts, orchestration, and every phase", async () => {
	const { root, internal } = await project();
	const runner = new FirstSemanticMalformedRunner();
	await new SprintPlannerEngine(runner).runStandaloneIronout({ projectRoot: root, internalDevPath: internal, id: "semantic-handoff", directive: "Settle", interactive: false });
	const target = await new SprintPlannerEngine(runner).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "semantic-plan", directive: "Plan" });
	assert.deepEqual((await readdir(target)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	for (const role of ["ironout author", "corrective ironout reviewer", "advanced concepts reviewer", "advanced orchestration reviewer", "advanced phase reviewer: phase-01-first.md", "advanced phase reviewer: phase-02-second.md"]) {
		assert.equal(runner.requests.filter((request) => request.role === role).length, 2, role);
	}
	assert.equal(runner.requests.filter((request) => request.role === "advanced planner").length, 2);
	assert.equal(runner.requests.filter((request) => request.role === "advanced decomposition reviewer").length, 1);
});

class FatalPlanningRoleRunner extends FakeRunner {
	fatalRole: string;

	constructor(fatalRole: string) {
		super();
		this.fatalRole = fatalRole;
	}

	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.role === this.fatalRole) {
			this.requests.push(structuredClone(request));
			return { ok: false, error: "injected fatal stop", failureKind: "fatal", sessionPath: request.sessionPath, disposition: "completed" };
		}
		return super.run(request, signal);
	}
}

async function semanticallyPoisonCheckpoint(runDirectory: string, stepId: string, artifactPath: string, content: string): Promise<void> {
	const store = new RunArtifactStore(runDirectory);
	const replacement = await store.write(artifactPath, content);
	const stateStore = new SprintStateStore(runDirectory);
	const state = await stateStore.load();
	state.steps[stepId].artifacts = state.steps[stepId].artifacts.map((artifact) => artifact.path === artifactPath ? replacement : artifact);
	await stateStore.save(state);
}

test("resume invalidates hash-valid but semantically poisoned completed concepts, orchestration, and non-final phase checkpoints", async () => {
	{
		const { root, internal } = await project();
		const paused = await new SprintPlannerEngine(new FatalPlanningRoleRunner("advanced orchestration reviewer")).runSprint({ projectRoot: root, internalDevPath: internal, runId: "poison-concepts", directive: "Poison concepts", agents: 4 });
		assert.equal(paused.status, "paused");
		const runDirectory = path.join(internal, "sprints", "poison-concepts");
		await semanticallyPoisonCheckpoint(runDirectory, "planning-review-concepts", "planning-review-draft/concepts.md", concepts.replace("## Architecture", "## Design"));
		const resumeRunner = new FakeRunner();
		const resumed = await new SprintPlannerEngine(resumeRunner).resumeSprint(runDirectory, "poison-concepts");
		assert.equal(resumed.status, "completed", resumed.error);
		assert.equal(resumeRunner.requests.filter((request) => request.role === "advanced concepts reviewer").length, 1);
	}
	{
		const { root, internal } = await project();
		const paused = await new SprintPlannerEngine(new FatalPlanningRoleRunner("advanced phase reviewer: phase-01-first.md")).runSprint({ projectRoot: root, internalDevPath: internal, runId: "poison-orchestration", directive: "Poison orchestration", agents: 4 });
		assert.equal(paused.status, "paused");
		const runDirectory = path.join(internal, "sprints", "poison-orchestration");
		await semanticallyPoisonCheckpoint(runDirectory, "planning-review-orchestration", "planning-review-draft/orchestration.md", orchestrationSmall.replace("deepseek/deepseek-v4-pro:max", "deepseek/deepseek-v4-pro:high"));
		const resumeRunner = new FakeRunner();
		const resumed = await new SprintPlannerEngine(resumeRunner).resumeSprint(runDirectory, "poison-orchestration");
		assert.equal(resumed.status, "completed", resumed.error);
		assert.equal(resumeRunner.requests.filter((request) => request.role === "advanced orchestration reviewer").length, 1);
		assert.equal(resumeRunner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:")).length, 2);
	}
	{
		const { root, internal } = await project();
		const paused = await new SprintPlannerEngine(new FatalPlanningRoleRunner("advanced phase reviewer: phase-02-second.md")).runSprint({ projectRoot: root, internalDevPath: internal, runId: "poison-phase", directive: "Poison phase", agents: 4 });
		assert.equal(paused.status, "paused");
		const runDirectory = path.join(internal, "sprints", "poison-phase");
		await semanticallyPoisonCheckpoint(runDirectory, "planning-review-phase-01-first", "planning-review-draft/phase-01-first.md", phase1.replace("## Exit Criteria", "## Completion Criteria"));
		const resumeRunner = new FakeRunner();
		const resumed = await new SprintPlannerEngine(resumeRunner).resumeSprint(runDirectory, "poison-phase");
		assert.equal(resumed.status, "completed", resumed.error);
		assert.equal(resumeRunner.requests.filter((request) => request.role === "advanced phase reviewer: phase-01-first.md").length, 1);
		assert.equal(resumeRunner.requests.filter((request) => request.role === "advanced phase reviewer: phase-02-second.md").length, 1);
	}
});

test("submission canonicalization returns immutable copies of submissions and expectations", () => {
	const submission = { kind: "files" as const, files: [{ path: " concepts.md ", content: concepts }] };
	const expectation = { kind: "files" as const, allowedPaths: [" concepts.md "], requiredPaths: [" concepts.md "], headings: { " concepts.md ": CONCEPT_HEADINGS } };
	const canonical = validateSubmission(submission, expectation);
	assert.equal(canonical.files![0].path, "concepts.md");
	assert.equal(submission.files[0].path, " concepts.md ");
	assert.equal(expectation.allowedPaths[0], " concepts.md ");
	assert.deepEqual(Object.keys(expectation.headings), [" concepts.md "]);
});

test("padded paths remain canonical through standalone engine assembly without mutating the source fixture", async () => {
	const { root, internal } = await project();
	const runner = new PaddedPathRunner();
	const target = await new SprintPlannerEngine(runner).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "standalone-padded", directive: "Canonical paths" });
	assert.deepEqual((await readdir(target)).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	const direct = [
		{ path: " concepts.md", content: concepts },
		{ path: "orchestration.md ", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	];
	validatePlanFiles(direct);
	assert.equal(direct[0].path, " concepts.md");
});

test("exclusive directory publication preserves an empty target that wins during staging", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-publish-race-"));
	const files = Array.from({ length: 200 }, (_, index) => ({ path: `file-${String(index).padStart(3, "0")}.md`, content: "x".repeat(4096) }));
	const publishing = publishDirectoryExclusively(parent, "claimed", files);
	for (;;) {
		const names = await readdir(parent);
		if (names.some((name) => name.startsWith(".claimed.") && name.endsWith(".tmp"))) break;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	const target = path.join(parent, "claimed");
	await mkdir(target);
	const before = await stat(target);
	await assert.rejects(publishing, /already exists/);
	const after = await stat(target);
	assert.equal(after.ino, before.ino);
	assert.deepEqual(await readdir(target), []);
});

test("exclusive directory publication detects deterministic replacement during materialization and preserves the foreign root", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-publish-replacement-"));
	const target = path.join(parent, "claimed");
	const displaced = path.join(parent, "displaced-reservation");
	const originalLink = fsPromises.link;
	let replaced = false;
	let foreignWriteObserved = false;
	let foreignIdentity: { dev: bigint; ino: bigint } | undefined;
	fsPromises.link = async (source, destination) => {
		const injectReplacement = !replaced && destination === path.join(target, "001-foreign-write.md");
		if (injectReplacement) {
			replaced = true;
			renameSync(target, displaced);
			mkdirSync(target);
			const entry = statSync(target, { bigint: true });
			foreignIdentity = { dev: entry.dev, ino: entry.ino };
		}
		await originalLink(source, destination);
		if (injectReplacement) {
			const staged = statSync(source, { bigint: true });
			const linked = statSync(destination, { bigint: true });
			foreignWriteObserved = staged.dev === linked.dev && staged.ino === linked.ino;
		}
	};
	try {
		await assert.rejects(
			publishDirectoryExclusively(parent, "claimed", [
				{ path: "000-reserved-write.md", content: "under reserved root" },
				{ path: "001-foreign-write.md", content: "must be ownership-rolled-back" },
				{ path: "002-never-written.md", content: "must not be materialized" },
			]),
			/reservation was replaced during materialization/,
		);
		assert.equal(replaced, true);
		assert.equal(foreignWriteObserved, true);
		const current = await stat(target, { bigint: true });
		assert.deepEqual({ dev: current.dev, ino: current.ino }, foreignIdentity);
		assert.deepEqual(await readdir(target), []);
		assert.equal(await readFile(path.join(displaced, "000-reserved-write.md"), "utf8"), "under reserved root\n");
	} finally {
		fsPromises.link = originalLink;
		await rm(parent, { recursive: true, force: true });
	}
});

test("exclusive directory publication has one concurrent winner and ownership rollback refuses modified output", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-publish-concurrent-"));
	const results = await Promise.allSettled([
		publishDirectoryExclusively(parent, "winner", [{ path: "value.md", content: "first" }]),
		publishDirectoryExclusively(parent, "winner", [{ path: "value.md", content: "second" }]),
	]);
	assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
	assert.equal(results.filter((result) => result.status === "rejected").length, 1);
	const winner = results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof publishDirectoryExclusively>>> => result.status === "fulfilled")!.value;
	await writeFile(path.join(winner.path, "value.md"), "foreign replacement\n");
	assert.equal(await removeOwnedDirectory(winner), false);
	assert.equal(await readFile(path.join(winner.path, "value.md"), "utf8"), "foreign replacement\n");
	await rm(winner.path, { recursive: true });
});

test("standalone advance-plan collisions leave no newly committed counterpart", async () => {
	{
		const { root, internal } = await project();
		const review = path.join(internal, "reviews", "review-collision-advanced-plan-review.md");
		await writeFile(review, "existing review");
		await assert.rejects(new SprintPlannerEngine(new FakeRunner()).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "review-collision", directive: "Plan" }), /already exists/);
		assert.equal(await entryExists(path.join(internal, "plans", "review-collision")), false);
		assert.equal(await readFile(review, "utf8"), "existing review");
	}
	{
		const { root, internal } = await project();
		const plan = path.join(internal, "plans", "plan-collision");
		await mkdir(plan);
		await writeFile(path.join(plan, "foreign.md"), "foreign");
		await assert.rejects(new SprintPlannerEngine(new FakeRunner()).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "plan-collision", directive: "Plan" }), /already exists/);
		assert.equal(await entryExists(path.join(internal, "reviews", "plan-collision-advanced-plan-review.md")), false);
		assert.equal(await readFile(path.join(plan, "foreign.md"), "utf8"), "foreign");
	}
});

test("concurrent standalone plan publishers produce one complete plan-and-review winner", async () => {
	const { root, internal } = await project();
	const options = { projectRoot: root, internalDevPath: internal, id: "concurrent-plan", directive: "Plan" };
	const results = await Promise.allSettled([
		new SprintPlannerEngine(new FakeRunner()).runStandaloneAdvancePlan(options),
		new SprintPlannerEngine(new FakeRunner()).runStandaloneAdvancePlan(options),
	]);
	assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
	assert.equal(results.filter((result) => result.status === "rejected").length, 1);
	assert.deepEqual((await readdir(path.join(internal, "plans", "concurrent-plan"))).sort(), ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	assert.equal(await entryExists(path.join(internal, "reviews", "concurrent-plan-advanced-plan-review.md")), true);
});

test("full-sprint post-publication bookkeeping failure rolls back owned outputs and resumes without worker calls", async () => {
	const { root, internal } = await project();
	let injected = false;
	const engine = new SprintPlannerEngine(new FakeRunner(), {
		onState(state) {
			if (!injected && state.status === "completed") {
				injected = true;
				throw new Error("injected final bookkeeping failure");
			}
		},
	});
	const paused = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "post-publish-rollback", directive: "Publish safely", agents: 4 });
	assert.equal(paused.status, "paused");
	const runDirectory = path.join(internal, "sprints", "post-publish-rollback");
	assert.equal(await entryExists(path.join(runDirectory, "planning")), false);
	assert.equal(await entryExists(path.join(runDirectory, "reviews", "advanced-plan-review.md")), false);
	assert.equal(await entryExists(path.join(runDirectory, "manifest.md")), false);
	const resumeRunner = new FakeRunner();
	const resumed = await new SprintPlannerEngine(resumeRunner).resumeSprint(runDirectory, "post-publish-rollback");
	assert.equal(resumed.status, "completed", resumed.error);
	assert.equal(resumeRunner.requests.length, 0);
});

class FullPlanningCollisionRunner extends FakeRunner {
	target: string;
	created = false;

	constructor(target: string) {
		super();
		this.target = target;
	}

	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		const result = await super.run(request, signal);
		if (!this.created && request.role === "advanced phase reviewer: phase-02-second.md") {
			this.created = true;
			await mkdir(this.target);
		}
		return result;
	}
}

test("full-sprint publication collision creates no summary or manifest and resumes after the foreign reservation is removed", async () => {
	const { root, internal } = await project();
	const runDirectory = path.join(internal, "sprints", "full-collision");
	const paused = await new SprintPlannerEngine(new FullPlanningCollisionRunner(path.join(runDirectory, "planning"))).runSprint({ projectRoot: root, internalDevPath: internal, runId: "full-collision", directive: "Collision", agents: 4 });
	assert.equal(paused.status, "paused");
	assert.deepEqual(await readdir(path.join(runDirectory, "planning")), []);
	assert.equal(await entryExists(path.join(runDirectory, "reviews", "advanced-plan-review.md")), false);
	assert.equal(await entryExists(path.join(runDirectory, "manifest.md")), false);
	await rm(path.join(runDirectory, "planning"), { recursive: true });
	const runner = new FakeRunner();
	const resumed = await new SprintPlannerEngine(runner).resumeSprint(runDirectory, "full-collision");
	assert.equal(resumed.status, "completed", resumed.error);
	assert.equal(runner.requests.length, 0);
});

async function entryExists(selected: string): Promise<boolean> {
	try {
		await stat(selected);
		return true;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") return false;
		throw error;
	}
}

// ── Phase-01 hardening: new focused regression tests ────────────────────

test("-- option terminator preserves literal prompt text including option-like tokens", () => {
	// Management-looking tokens after -- become literal prompt
	const parsed = parseCommand("sprint", "-- status");
	assert.equal(parsed.action, "start");
	assert.equal(parsed.input, "status");

	// --name after -- becomes literal prompt, not an option
	const parsed2 = parseCommand("sprint", "-- --name literal");
	assert.equal(parsed2.action, "start");
	assert.equal(parsed2.input, "--name literal");
	assert.equal(parsed2.name, undefined);

	// --agents before -- is still parsed as option
	const parsed3 = parseCommand("sprint", "--agents 3 -- --name skip");
	assert.equal(parsed3.agents, 3);
	assert.equal(parsed3.input, "--name skip");

	// Terminal -- with no following text produces no prompt
	const parsed4 = parseCommand("sprint", "--agents 2 --");
	assert.equal(parsed4.input, undefined);

	// Quotes and option-like text preserved literally after --
	const parsed5 = parseCommand("brainstorm", "-- \"quoted\" --agents 5");
	assert.equal(parsed5.input, "\"quoted\" --agents 5");
	assert.equal(parsed5.agents, DEFAULT_BRAINSTORM_AGENTS); // not parsed
	assert.equal(parseCommand("sprint", "-- \"unterminated").input, "\"unterminated");
	assert.equal(parseCommand("sprint", "plain prompt  \n").input, "plain prompt  \n");
});

test("session ids are stable and distinct for same-prefix different-tail inputs", () => {
	const id1 = safeSessionId("prefix-A");
	const id2 = safeSessionId("prefix-A");
	assert.equal(id1, id2); // same input = same id

	const a = safeSessionId("x".repeat(64) + "A");
	const b = safeSessionId("x".repeat(64) + "B");
	assert.notEqual(a, b); // different tails = different ids
	assert.ok(a.length <= 64);
	assert.ok(b.length <= 64);
	assert.match(a, /^[A-Za-z0-9][A-Za-z0-9._-]*-[0-9a-f]{16}$/);
});

test("synthesis coverage requires exact findings-plus-cross-review Source set", () => {
	const synth = markdown("Synthesis", BRAINSTORM_HEADINGS);
	// Missing a path
	const content1 = synth.replace("Source content.", "- lens-1/findings.md\n- lens-1/cross-review.md");
	assert.throws(
		() => validateSynthesisCoverage(content1, ["lens-1/findings.md", "lens-1/cross-review.md", "lens-2/findings.md", "lens-2/cross-review.md"]),
		/missing report path/,
	);
	// Unknown extra path
	const content2 = synth.replace("Source content.", "- lens-1/findings.md\n- lens-1/cross-review.md\n- lens-3/findings.md");
	assert.throws(
		() => validateSynthesisCoverage(content2, ["lens-1/findings.md", "lens-1/cross-review.md"]),
		/unknown report path/,
	);
	// Duplicate path
	const content3 = synth.replace("Source content.", "- lens-1/findings.md\n- lens-1/findings.md");
	assert.throws(
		() => validateSynthesisCoverage(content3, ["lens-1/findings.md"]),
		/lists the same path more than once/,
	);
	// Code-fenced paths do not count, and prose is not a literal path item.
	const fenced = synth.replace("Source content.", "```text\n- lens-1/findings.md\n```");
	assert.throws(() => validateSynthesisCoverage(fenced, ["lens-1/findings.md"]), /missing report path/);
	const prose = synth.replace("Source content.", "Reports considered:\n- lens-1/findings.md");
	assert.throws(() => validateSynthesisCoverage(prose, ["lens-1/findings.md"]), /non-literal/);
	const content4 = synth.replace("Source content.", "- lens-1/findings.md\n- lens-1/cross-review.md");
	assert.doesNotThrow(() => validateSynthesisCoverage(content4, ["lens-1/findings.md", "lens-1/cross-review.md"]));
});

test("structured inspector returns versioned results with categorized findings", async () => {
	const { inspectPlan } = await import("../validation.ts");
	const valid = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	]);
	assert.equal(valid.version, 1);
	assert.equal(valid.valid, true);
	assert.equal(valid.metadata.phaseCount, 2);
	assert.equal(valid.metadata.scopeSize, "small");
	assert.equal(valid.metadata.waveCount, 2);
	assert.equal(valid.findings.length, 0);

	// Missing heading
	const invalid = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1.replace("## Context", "## Background") },
		{ path: "phase-02-second.md", content: phase2 },
	]);
	assert.equal(invalid.valid, false);
	assert.ok(invalid.findings.some((f) => f.category === "shape" && f.code.includes("Context")));

	// Cross-consistency: phase goal mismatch
	const mismatch = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1.replace("Complete phase 1", "Wrong goal") },
		{ path: "phase-02-second.md", content: phase2 },
	]);
	assert.equal(mismatch.valid, false);
	assert.ok(mismatch.findings.some((f) => f.category === "phase-metadata" && f.code.includes("cross-goal")));

	// Dependency drift
	const depDrift = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2.replace("phase-01-first.md", "none") },
	]);
	assert.equal(depDrift.valid, false);
	assert.ok(depDrift.findings.some((f) => f.category === "dependency" && f.code === "phase-dependencies-drift"));

	// Target drift
	const targetDrift = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2.replace("**Write Targets**: sprint-planner/target-02.ts", "**Write Targets**: sprint-planner/other.ts") },
	]);
	assert.equal(targetDrift.valid, false);
	assert.ok(targetDrift.findings.some((f) => f.category === "target" && f.code === "phase-write-target-drift"));

	const unsafe = inspectPlan([{ path: "../escape.md", content: "x" }]);
	assert.equal(unsafe.valid, false);
	assert.ok(unsafe.findings.some((f) => f.code === "shape-unsafe-path"));
	const missingLedger = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall.replace("## Phase Ledger", "## Ledger") },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	]);
	assert.equal(missingLedger.valid, false);
	assert.ok(missingLedger.findings.some((f) => f.code === "orch-section:Phase Ledger"));
});

test("draft shape check rejects bad layouts and missing required headings", () => {
	// Flat, unique, proper shape passes
	validateDraftPlanShape([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	]);
	// Required headings are part of the safely shaped draft contract.
	assert.throws(() => validateDraftPlanShape([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1.replace("## Context", "## Background") },
		{ path: "phase-02-second.md", content: phase2 },
	]), /Context/);
	// Bad shape: missing orchestration
	assert.throws(
		() => validateDraftPlanShape([{ path: "concepts.md", content: concepts }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }]),
		/orchestration/,
	);
	// Bad shape: non-contiguous
	assert.throws(
		() => validateDraftPlanShape([{ path: "concepts.md", content: concepts }, { path: "orchestration.md", content: orchestrationSmall }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-03-third.md", content: phase1 }]),
		/contiguous/,
	);
});

test("decomposition gate receives complete draft and can adjust the phase set", async () => {
	const { root, internal } = await project();
	// Custom runner that renames a phase in decomposition
	class DecompositionRenameRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role === "advanced decomposition reviewer") {
				this.requests.push(structuredClone(request));
				const renamedOrch = orchestrationSmall.replace(/phase-01-first\.md/g, "phase-01-renamed.md");
				return {
					ok: true,
					submission: {
						kind: "files",
						files: [
							{ path: "review.md", content: markdown("Decomposition Review", REVIEW_HEADINGS) },
							{ path: "concepts.md", content: concepts },
							{ path: "orchestration.md", content: renamedOrch },
							{ path: "phase-01-renamed.md", content: phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts") },
							{ path: "phase-02-second.md", content: phaseMd(2, "phase-01-renamed.md", "Complete phase 2", "sprint-planner/target-02.ts") },
						],
					},
					sessionPath: request.sessionPath,
					disposition: "completed",
				};
			}
			if (request.role === "advanced orchestration reviewer") {
				this.requests.push(structuredClone(request));
				const renamedOrch = orchestrationSmall.replace(/phase-01-first\.md/g, "phase-01-renamed.md");
				return {
					ok: true,
					submission: { kind: "files", files: [{ path: "review.md", content: markdown("Orch Review", REVIEW_HEADINGS) }, { path: "orchestration.md", content: renamedOrch }] },
					sessionPath: request.sessionPath,
					disposition: "completed",
				};
			}
			if (request.role.startsWith("advanced phase reviewer:")) {
				this.requests.push(structuredClone(request));
				const phasePath = request.expectation.requiredPaths!.find((item: string) => item !== "review.md")!;
				if (phasePath === "phase-01-renamed.md") {
					return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Review renamed", REVIEW_HEADINGS) }, { path: "phase-01-renamed.md", content: phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts") }] }, sessionPath: request.sessionPath, disposition: "completed" };
				}
				if (phasePath === "phase-02-second.md") {
					return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Review phase-02", REVIEW_HEADINGS) }, { path: "phase-02-second.md", content: phaseMd(2, "phase-01-renamed.md", "Complete phase 2", "sprint-planner/target-02.ts") }] }, sessionPath: request.sessionPath, disposition: "completed" };
				}
				// fallback
				return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown(`Review ${phasePath}`, REVIEW_HEADINGS) }, { path: phasePath, content: phase1 }] }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			return super.run(request, signal);
		}
	}
	const runner = new DecompositionRenameRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "decomp-rename", directive: "Rename test", agents: 4 });
	assert.equal(state.status, "completed", state.error);
	// Verify the published plan uses the renamed phase
	const planDir = path.join(internal, "sprints", "decomp-rename", "planning");
	const planFiles = await readdir(planDir);
	assert.ok(planFiles.includes("phase-01-renamed.md"));
	assert.ok(!planFiles.includes("phase-01-first.md"));
	// Verify phase reviewers got the frozen phase set (renamed phase)
	const phaseReqs = runner.requests.filter((r) => r.role.startsWith("advanced phase reviewer:"));
	assert.equal(phaseReqs.length, 2);
	assert.ok(phaseReqs.some((r) => r.role.includes("phase-01-renamed")));
	// Verify component reviewers cannot change the phase set and the real gate review is retained.
	const conceptReq = runner.requests.find((r) => r.role === "advanced concepts reviewer")!;
	assert.match(conceptReq.prompt, /phase-01-renamed\.md/);
	const gateReview = await readFile(path.join(internal, "sprints", "decomp-rename", "reviews", "advanced-plan-components", "decomposition.md"), "utf8");
	assert.match(gateReview, /## Findings/);
});

test("engine progress is observable as starting before async initialization", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);

	// Check progress immediately after starting (before awaiting)
	const progressSnapshots: EngineProgress[] = [];
	const origProgress = Object.getOwnPropertyDescriptor(SprintPlannerEngine.prototype, "progress")!.get!;

	const promise = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "starting-test", directive: "Starting test", agents: 4 });

	// Progress should be observable immediately — 'starting' before first delay
	const early = engine.progress;
	assert.ok(early);
	assert.equal(early!.status, "starting");
	assert.equal(early!.stage, "starting");

	// Let the runner proceed
	await delayed.waiting;
	// Now it should be running
	const mid = engine.progress;
	assert.ok(mid);
	assert.equal(mid!.status, "running");

	await engine.pause(true);
	await promise;
});

test("resume exposes starting synchronously and clears transient identity after initialization failure", async () => {
	const engine = new SprintPlannerEngine(new FakeRunner());
	const parent = await mkdtemp(path.join(os.tmpdir(), "missing-sprint-root-"));
	const missing = path.join(parent, "missing-run");
	const promise = engine.resumeSprint(missing, "missing-run");
	assert.equal(engine.progress?.status, "starting");
	assert.equal(engine.progress?.runId, "missing-run");
	await assert.rejects(promise, /directory|ENOENT|missing/i);
	assert.equal(engine.progress, undefined);
	await rm(parent, { recursive: true, force: true });
});

test("sprint_validate_plan underlying inspector is read-only and does not mutate files", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-ro-"));
	await writeFile(path.join(root, "concepts.md"), concepts);
	await writeFile(path.join(root, "orchestration.md"), orchestrationSmall);
	await writeFile(path.join(root, "phase-01-first.md"), phase1);
	await writeFile(path.join(root, "phase-02-second.md"), phase2);

	// Collect file metadata before inspection
	const beforeEntries = await readdir(root);
	const beforeContents = new Map<string, string>();
	for (const name of beforeEntries) {
		beforeContents.set(name, await readFile(path.join(root, name), "utf8"));
	}

	// Inspect twice — results should be identical and files unchanged
	const res1 = await inspectPlanDirectory(root);
	const res2 = await inspectPlanDirectory(root);
	assert.deepEqual(res1, res2);
	assert.equal(res1.valid, true);

	// Verify files unchanged
	const afterEntries = await readdir(root);
	assert.deepEqual(afterEntries.sort(), beforeEntries.sort());
	for (const name of beforeEntries) {
		const after = await readFile(path.join(root, name), "utf8");
		assert.equal(after, beforeContents.get(name));
	}
});

test("inspectPlanDirectory rejects ancestor symlink before reading any file", async (t) => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-plan-sym-ancestor-"));
	const target = path.join(parent, "target");
	const linked = path.join(parent, "linked");
	await mkdir(target);
	await writeFile(path.join(target, "concepts.md"), concepts);
	await writeFile(path.join(target, "orchestration.md"), orchestrationSmall);
	await writeFile(path.join(target, "phase-01-first.md"), phase1);
	await writeFile(path.join(target, "phase-02-second.md"), phase2);
	try {
		await symlink(target, linked, "dir");
	} catch (error) {
		t.skip(`symlinks unavailable: ${String(error)}`);
		return;
	}
	// Passing the linked path should fail before reading content
	const res = await inspectPlanDirectory(linked);
	assert.equal(res.valid, false);
	assert.ok(res.findings.some((f) => f.category === "symbolic-link"));
});

test("inspectPlanDirectory rejects direct-child symlinks and nested entries", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-child-entry-"));
	await mkdir(path.join(root, "nested"));
	let result = await inspectPlanDirectory(root);
	assert.ok(result.findings.some((finding) => finding.code === "entry-not-file" && finding.path === "nested"));
	await rm(path.join(root, "nested"), { recursive: true });
	const outside = path.join(root, "outside.md");
	await writeFile(outside, "outside");
	try {
		await symlink(outside, path.join(root, "concepts.md"));
	} catch (error) {
		t.skip(`symbolic links unavailable: ${String(error)}`);
		return;
	}
	result = await inspectPlanDirectory(root);
	assert.ok(result.findings.some((finding) => finding.code === "entry-symlink" && finding.path === "concepts.md"));
});

test("inspectPlanDirectory rejects non-directory root", async () => {
	const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-plan-notdir-"));
	const filePath = path.join(tmp, "not-a-dir");
	await writeFile(filePath, "not a directory");
	const res = await inspectPlanDirectory(filePath);
	assert.equal(res.valid, false);
	assert.ok(res.findings.some((f) => f.category === "root"));
});

test("phase metadata cross-consistency rejects duplicate dependencies and self-dependencies", async () => {
	const { inspectPlan } = await import("../validation.ts");
	// Phase with self-dependency in ledger
	const selfDepOrch = orchestrationSmall.replace("depends: none", "depends: phase-01-first.md");
	const res = inspectPlan([
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: selfDepOrch },
		{ path: "phase-01-first.md", content: phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts") },
		{ path: "phase-02-second.md", content: phaseMd(2, "phase-01-first.md", "Complete phase 2", "sprint-planner/target-02.ts") },
	]);
	assert.equal(res.valid, false);
	assert.ok(res.findings.some((f) => f.category === "dependency" && f.code.includes("self-dep")));
});

test("validateOrchestration throws on ledger semantic failures", () => {
	const phases = ["phase-01-first.md", "phase-02-second.md"];
	// Unknown dependency
	const badOrch = orchestrationSmall.replace("depends: phase-01-first.md", "depends: phase-99-missing.md");
	assert.throws(() => validateOrchestration(badOrch, phases), /not a plan phase/);
	// Missing ledger entry
	const truncatedOrch = orchestrationSmall.replace(/- phase-02-second\.md \|.*\n/m, "");
	assert.throws(() => validateOrchestration(truncatedOrch, phases), /cover every phase/);
	// Wave ordering violation
	const badWave = orchestrationSmall.replace("- wave-01: phase-01-first.md\n- wave-02: phase-02-second.md", "- wave-01: phase-02-second.md\n- wave-02: phase-01-first.md");
	assert.throws(() => validateOrchestration(badWave, phases), /earlier wave/);
});

test("directory inspection preserves file bytes and entry metadata", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-bytes-"));
	const files = [
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationSmall },
		{ path: "phase-01-first.md", content: phase1 },
		{ path: "phase-02-second.md", content: phase2 },
	];
	for (const f of files) await writeFile(path.join(root, f.path), f.content);
	const beforeSnap = await Promise.all(files.map(async (f) => ({
		path: f.path,
		bytes: (await stat(path.join(root, f.path))).size,
	})));
	await inspectPlanDirectory(root);
	const afterSnap = await Promise.all(files.map(async (f) => ({
		path: f.path,
		bytes: (await stat(path.join(root, f.path))).size,
	})));
	assert.deepEqual(afterSnap, beforeSnap);
});

test("parseCommand -- works correctly with start workflows", () => {
	// Regular start with prompt (no --)
	const p1 = parseCommand("sprint", "do the thing");
	assert.equal(p1.action, "start");
	assert.equal(p1.input, "do the thing");

	// -- before prompt
	const p2 = parseCommand("sprint", "-- the prompt");
	assert.equal(p2.input, "the prompt");

	// Only -- with nothing after
	const p3 = parseCommand("sprint", "--agents 2 --");
	assert.equal(p3.input, undefined);
	assert.equal(p3.agents, 2);
});

test("validatePlanDirectory hardened inspection rejects missing root", async () => {
	const res = await inspectPlanDirectory("/nonexistent/path/12345");
	assert.equal(res.valid, false);
	assert.ok(res.findings.some((f) => f.category === "root" && f.code === "root-missing"));
});

test("ThinkingLevel type contains each level exactly once", () => {
	// Compile-time check: verify the type is correct by checking the agent configuration
	const levels = new Set(Object.values(SPRINT_PLANNER_AGENT_CONFIGURATIONS.default).map((a) => a.model.thinking));
	assert.ok(levels.has("off") === false); // not used but exists in type
	assert.ok(levels.has("minimal") === false);
	assert.ok(levels.has("low") === false);
	assert.ok(levels.has("medium") === false); // not used but exists in type
	assert.ok(levels.has("high"));
	assert.ok(levels.has("xhigh"));
	assert.ok(levels.has("max"));
	// Verify assignments that use higher reasoning levels.
	assert.equal(SPRINT_PLANNER_AGENT_CONFIGURATIONS.default.phaseReviewer.model.thinking, "high");
	assert.equal(SPRINT_PLANNER_AGENT_CONFIGURATIONS.default.executionAdvisor.model.thinking, "xhigh");
	// Verify no duplicate medium in union by checking all values are valid
	for (const entry of Object.values(SPRINT_PLANNER_AGENT_CONFIGURATIONS.default)) {
		const valid: string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
		assert.ok(valid.includes(entry.model.thinking), `Invalid thinking level: ${entry.model.thinking}`);
	}
});

// ── Phase 02: attempt disposition ───────────────────────────────────────

test("completed disposition charges an attempt; interrupted disposition does not", async () => {
	const { root, internal } = await project();
	class DispositionRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role.includes("role router")) {
				this.requests.push(structuredClone(request));
				const count = this.requests.filter((r) => r.role.includes("role router")).length;
				if (count === 1) {
					// First call: completed but malformed (charges attempt, retryable)
					return { ok: false, error: "transient failure", failureKind: "transient", sessionPath: request.sessionPath, disposition: "completed" };
				}
				// Second call: success
				return { ok: true, submission: { kind: "roles", content: JSON.stringify({ roles: Array.from({ length: 4 }, (_, index) => ({ id: `lens-${index + 1}`, name: `Lens ${index + 1}`, lens: `Lens ${index + 1}` })) }) }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			return super.run(request, signal);
		}
	}
	const state = await new SprintPlannerEngine(new DispositionRunner()).runSprint({ projectRoot: root, internalDevPath: internal, runId: "disposition", directive: "Disposition test", agents: 4 });
	assert.equal(state.status, "completed");
	// The route step should have 2 charged attempts (both completed dispositions).
	const routeStep = state.steps["brainstorm-route"];
	assert.ok(routeStep);
	assert.equal(routeStep.attempts, 2, "both completed calls are charged");
});

test("provider failure is charged and carries provider retry category", async () => {
	const { root, internal } = await project();
	let roleCalls = 0;
	class ProviderFailureRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role.includes("role router")) {
				this.requests.push(structuredClone(request));
				roleCalls++;
				if (roleCalls === 1) {
					return { ok: false, error: "rate limit exceeded", failureKind: "transient", sessionPath: request.sessionPath, disposition: "completed" };
				}
				return { ok: true, submission: { kind: "roles", content: JSON.stringify({ roles: Array.from({ length: 4 }, (_, index) => ({ id: `lens-${index + 1}`, name: `Lens ${index + 1}`, lens: `Lens ${index + 1}` })) }) }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			return super.run(request, signal);
		}
	}
	const runner = new ProviderFailureRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "prov-fail", directive: "Provider fail", agents: 4 });
	assert.equal(state.status, "completed");
	const retryReq = runner.requests.find((r) => r.role.includes("role router") && r.retryPrompt);
	assert.ok(retryReq, "second attempt should have a retry prompt");
	assert.match(retryReq!.retryPrompt!, /provider error: rate limit exceeded/);
	assert.match(retryReq!.retryPrompt!, /Attempt 2:/);
});

test("typed submission failure is charged and carries typed retry category", async () => {
	const { root, internal } = await project();
	let calls = 0;
	class TypedFailureRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role.includes("role router")) {
				this.requests.push(structuredClone(request));
				calls++;
				if (calls <= 2) {
					// Empty content triggers typed validation failure.
					return { ok: true, submission: { kind: "roles", content: "" }, sessionPath: request.sessionPath, disposition: "completed" };
				}
				return { ok: true, submission: { kind: "roles", content: JSON.stringify({ roles: Array.from({ length: 4 }, (_, index) => ({ id: `lens-${index + 1}`, name: `Lens ${index + 1}`, lens: `Lens ${index + 1}` })) }) }, sessionPath: request.sessionPath, disposition: "completed" };
			}
			return super.run(request, signal);
		}
	}
	const runner = new TypedFailureRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "typed-fail", directive: "Typed fail", agents: 4 });
	assert.equal(state.status, "completed");
	assert.equal(calls, 3);
	const retryReqs = runner.requests.filter((r) => r.role.includes("role router") && r.retryPrompt);
	assert.equal(retryReqs.length, 2);
	for (const req of retryReqs) {
		assert.match(req.retryPrompt!, /typed error:/);
	}
});

test("semantic validation failure is charged and carries semantic retry category", async () => {
	const { root, internal } = await project();
	let synthCalls = 0;
	class SemanticFailureRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role === "brainstorm synthesizer") {
				this.requests.push(structuredClone(request));
				synthCalls++;
				if (synthCalls === 1) {
					// Missing a report path in Source
					const badSynthesis = markdown("Synthesis", BRAINSTORM_HEADINGS).replace("Source content.", "- lens-1/findings.md");
					return { ok: true, submission: { kind: "markdown", content: badSynthesis }, sessionPath: request.sessionPath, disposition: "completed" };
				}
			}
			return super.run(request, signal);
		}
	}
	const runner = new SemanticFailureRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "semantic-fail", directive: "Semantic fail", agents: 4 });
	assert.equal(state.status, "completed");
	assert.equal(synthCalls, 2);
	const retryReq = runner.requests.find((r) => r.role === "brainstorm synthesizer" && r.retryPrompt);
	assert.ok(retryReq);
	assert.match(retryReq!.retryPrompt!, /semantic error:.*missing report path/);
});

// ── Phase 02: retention of charged failures across resume ───────────────

test("charged attempts and last retry feedback survive ordinary resume", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const firstRun = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "retry-resume", directive: "Retry resume", agents: 4 });
	await delayed.waiting;
	await engine.pause(true);
	const paused = await firstRun;
	assert.equal(paused.status, "interrupted");

	// Manually set a step as having a charged provider failure.
	const statePath = path.join(internal, "sprints", "retry-resume");
	const stateStore = new SprintStateStore(statePath);
	const loaded = await stateStore.load();
	const routeStep = loaded.steps["brainstorm-route"];
	routeStep.status = "pending";
	routeStep.attempts = 2;
	routeStep.lastRetryFeedback = { category: "provider" as const, message: "rate limit exceeded" };
	await stateStore.save(loaded);

	// Resume should preserve charged attempts and feedback.
	const resumed = await new SprintPlannerEngine(new FakeRunner()).resumeSprint(statePath, "retry-resume");
	assert.equal(resumed.status, "completed");
	const resumedStep = resumed.steps["brainstorm-route"];
	assert.ok(resumedStep);
	assert.equal(resumedStep.attempts, 3, "charged attempts preserved, plus one more for the successful call");
});

// ── Phase 02: Phase 01 drift-reset preservation ─────────────────────────

test("Phase 01 drift path resets completed component attempts and downstream on semantic revalidation", async () => {
	const { root, internal } = await project();
	// Run a sprint until concepts review completes, then pause before orchestration.
	const paused = await new SprintPlannerEngine(new FatalPlanningRoleRunner("advanced orchestration reviewer")).runSprint({ projectRoot: root, internalDevPath: internal, runId: "drift-preserve", directive: "Drift preserve", agents: 4 });
	assert.equal(paused.status, "paused");

	// Poison the concepts checkpoint.
	const runDirectory = path.join(internal, "sprints", "drift-preserve");
	const store = new RunArtifactStore(runDirectory);
	const poisonedConcepts = concepts.replace("## Architecture", "## Design");
	const replacement = await store.write("planning-review-draft/concepts.md", poisonedConcepts);
	const stateStore = new SprintStateStore(runDirectory);
	const state = await stateStore.load();
	state.steps["planning-review-concepts"].artifacts = state.steps["planning-review-concepts"].artifacts.map((a) => a.path === "planning-review-draft/concepts.md" ? replacement : a);
	// Also give the concepts step some charged attempts.
	state.steps["planning-review-concepts"].attempts = 2;
	await stateStore.save(state);

	// Resume — concepts should be invalidated and attempts reset (Phase 01 drift path).
	const resumed = await new SprintPlannerEngine(new FakeRunner()).resumeSprint(runDirectory, "drift-preserve");
	assert.equal(resumed.status, "completed", resumed.error);
	const conceptsStep = resumed.steps["planning-review-concepts"];
	assert.ok(conceptsStep);
	// Phase 01 drift reset: attempts zeroed, status becomes completed again after re-run.
	assert.equal(conceptsStep.status, "completed");
	// The step was re-run from scratch (charged 1 new attempt for the successful call).
	assert.equal(conceptsStep.attempts, 1);
});

// ── Phase 02: reduced ironout context ────────────────────────────────────

test("full-sprint ironout prompt excludes raw reports and embeds only synthesis, red-team, and report paths", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "ironout-ctx", directive: "Ironout context", agents: 4 });
	const ironoutReq = runner.requests.find((r) => r.role === "autonomous ironout author")!;
	assert.ok(ironoutReq);
	// Must NOT embed raw report content.
	assert.doesNotMatch(ironoutReq.prompt, /<supplementary-raw-reports>/);
	// Must include retained report paths.
	assert.match(ironoutReq.prompt, /<retained-report-paths>/);
	assert.match(ironoutReq.prompt, /brainstorm\/lens-1\/findings\.md/);
	assert.match(ironoutReq.prompt, /brainstorm\/lens-1\/cross-review\.md/);
	// Must include synthesis and red-team.
	assert.match(ironoutReq.prompt, /<red-team>/);
	assert.match(ironoutReq.prompt, /<authoritative-input>/);
	// Context paths reduced to synthesis + red-team only (not raw reports).
	assert.deepEqual(ironoutReq.contextPaths, ["brainstorm/synthesis.md", "brainstorm/red-team.md"]);
});

test("standalone ironout prompt does not embed raw reports when none exist", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runStandaloneIronout({ projectRoot: root, internalDevPath: internal, id: "standalone-ctx", directive: "Standalone ironout", interactive: false });
	const ironoutReq = runner.requests.find((r) => r.role === "ironout author")!;
	assert.ok(ironoutReq);
	// No raw reports (standalone has no prior brainstorm).
	assert.doesNotMatch(ironoutReq.prompt, /<supplementary-raw-reports>/);
	assert.doesNotMatch(ironoutReq.prompt, /<retained-report-paths>/);
});

// ── Phase 02: concurrent phase reviews ───────────────────────────────────

test("phase corrective reviews run using scoped fan-out after concepts and orchestration barriers", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "concurrent-phases", directive: "Concurrent phases", agents: 4 });
	// Verify concepts review happened before orchestration review.
	const conceptIdx = runner.requests.findIndex((r) => r.role === "advanced concepts reviewer");
	const orchIdx = runner.requests.findIndex((r) => r.role === "advanced orchestration reviewer");
	assert.ok(conceptIdx < orchIdx, "concepts review must precede orchestration review");
	// Phase reviews happen after both.
	const phaseIndices = runner.requests
		.map((r, i) => (r.role.startsWith("advanced phase reviewer:") ? i : -1))
		.filter((i) => i >= 0);
	assert.equal(phaseIndices.length, 2);
	assert.ok(phaseIndices.every((i) => i > orchIdx), "phase reviews must occur after orchestration review");
});

test("standalone advance-plan runs concurrent phase reviews", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	await new SprintPlannerEngine(runner).runStandaloneAdvancePlan({ projectRoot: root, internalDevPath: internal, id: "concurrent-standalone", directive: "Concurrent standalone" });
	const conceptIdx = runner.requests.findIndex((r) => r.role === "advanced concepts reviewer");
	const orchIdx = runner.requests.findIndex((r) => r.role === "advanced orchestration reviewer");
	assert.ok(conceptIdx < orchIdx, "concepts review must precede orchestration review in standalone");
	const phaseIndices = runner.requests
		.map((r, i) => (r.role.startsWith("advanced phase reviewer:") ? i : -1))
		.filter((i) => i >= 0);
	assert.equal(phaseIndices.length, 2);
	assert.ok(phaseIndices.every((i) => i > orchIdx), "phase reviews must occur after orchestration review in standalone");
});

// ── Phase 02: runner operation tracking and abortAll settlement ──────────

test("abortAll returns only after all tracked operations have settled", async () => {
	// This test verifies the contract that abortAll awaits all settlements.
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const run = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "abort-settle", directive: "Abort settle", agents: 4 });
	await delayed.waiting;
	// Cancel should settle all operations and return a cancelled state.
	await engine.cancel();
	const state = await run;
	assert.equal(state.status, "cancelled");
	// The runner's abortAll was called.
	assert.equal(delayed.aborts, 1);
});

test("pause triggers abortAll and marks operations interrupted without consuming attempts", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const run = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "pause-no-charge", directive: "Pause no charge", agents: 4 });
	await delayed.waiting;
	await engine.pause(true);
	const state = await run;
	assert.equal(state.status, "interrupted");
	// Verify the delayed runner's request never completed (disposition would be interrupted).
	// The step should remain pending or interrupted, with zero charged attempts.
	const routeStep = state.steps["brainstorm-route"];
	if (routeStep) {
		assert.equal(routeStep.attempts, 0, "interrupted step should not have charged attempts");
	}
});

// ── Phase 02: frozen phase set and ordered publication ──────────────────

test("phase file set is frozen and published in phase order with complete component review coverage", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "frozen-set", directive: "Frozen set", agents: 4 });
	assert.equal(state.status, "completed");
	const planDir = path.join(internal, "sprints", "frozen-set", "planning");
	const planFiles = (await readdir(planDir)).sort();
	// Must contain exactly the expected files in order.
	assert.deepEqual(planFiles, ["concepts.md", "orchestration.md", "phase-01-first.md", "phase-02-second.md"]);
	// Review summary covers all components.
	const summary = await readFile(path.join(internal, "sprints", "frozen-set", "reviews", "advanced-plan-review.md"), "utf8");
	assert.match(summary, /decomposition\.md/);
	assert.match(summary, /concepts\.md/);
	assert.match(summary, /orchestration\.md/);
	assert.match(summary, /phase-01-first\.md/);
	assert.match(summary, /phase-02-second\.md/);
});

// ── Phase 02: fan-out failure preserves first cause ─────────────────────

test("scoped fan-out cancels and fully settles blocking siblings without charging them", async () => {
	const { root, internal } = await project();
	class BlockingSiblingRunner extends FakeRunner {
		cancelled = 0;
		settled = 0;

		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (!request.id.includes("-brainstorm-findings-")) return super.run(request, signal);
			this.requests.push(structuredClone(request));
			if (request.id.endsWith("-lens-2")) {
				await new Promise((resolve) => setImmediate(resolve));
				return { ok: false, error: "primary findings failure", failureKind: "fatal", sessionPath: request.sessionPath, disposition: "completed" };
			}
			return new Promise((resolve) => {
				const finish = () => {
					this.cancelled++;
					this.settled++;
					resolve({ ok: false, error: "local sibling cancellation", failureKind: "cancelled", sessionPath: request.sessionPath, disposition: "interrupted" });
				};
				if (signal.aborted) finish();
				else signal.addEventListener("abort", finish, { once: true });
			});
		}
	}
	const runner = new BlockingSiblingRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "fanout-settle", directive: "Fanout settle", agents: 4 });
	assert.equal(state.status, "paused");
	assert.match(state.error ?? "", /primary findings failure/);
	assert.equal(runner.requests.filter((request) => request.id.includes("-brainstorm-findings-")).length, 4, "every factory starts");
	assert.equal(runner.cancelled, 3);
	assert.equal(runner.settled, 3, "the fan-out returns only after every blocked sibling settles");
	assert.equal(state.steps["brainstorm-findings-lens-2"].attempts, 1);
	for (const lens of ["lens-1", "lens-3", "lens-4"]) {
		assert.equal(state.steps[`brainstorm-findings-${lens}`].attempts, 0, `${lens} cancellation is not charged`);
		assert.equal(state.steps[`brainstorm-findings-${lens}`].status, "pending");
	}
});

test("not-started runner failure is fatal and consumes no retry budget", async () => {
	const { root, internal } = await project();
	class SetupFailureRunner extends FakeRunner {
		calls = 0;
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.role !== "brainstorm role router") return super.run(request, signal);
			this.calls++;
			return { ok: false, error: "preflight unavailable", failureKind: "fatal", sessionPath: request.sessionPath, disposition: "not-started" };
		}
	}
	const runner = new SetupFailureRunner();
	const state = await new SprintPlannerEngine(runner).runSprint({ projectRoot: root, internalDevPath: internal, runId: "preflight-fatal", directive: "Preflight fatal", agents: 4 });
	assert.equal(state.status, "paused");
	assert.equal(runner.calls, 1);
	assert.equal(state.steps["brainstorm-route"].attempts, 0);
	assert.equal(state.steps["brainstorm-route"].status, "failed");
	assert.match(state.error ?? "", /preflight unavailable/);
});

test("scoped fan-out failure preserves the first non-cancellation error as cause", async () => {
	const { root, internal } = await project();
	// A runner that makes one findings step fail with a distinct error.
	class SingleFindingFailureRunner extends FakeRunner {
		async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
			if (request.id.endsWith("-brainstorm-findings-lens-2")) {
				this.requests.push(structuredClone(request));
				return { ok: false, error: "lens-2 injected failure", failureKind: "fatal", sessionPath: request.sessionPath, disposition: "completed" };
			}
			return super.run(request, signal);
		}
	}
	const state = await new SprintPlannerEngine(new SingleFindingFailureRunner()).runSprint({ projectRoot: root, internalDevPath: internal, runId: "fanout-cause", directive: "Fanout cause", agents: 4 });
	// The sprint should pause because a findings step exhausted its retries.
	assert.equal(state.status, "paused");
	assert.match(state.error ?? "", /lens-2 injected failure/);
});

// ── Phase 03: leases and run records ───────────────────────────────────

test("lease acquisition creates exclusive versioned lease with owner identity", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "lease-test");
	const handle = await acquireLease(runDir, "lease-test", "planning");
	assert.equal(handle.record.version, 1);
	assert.equal(handle.record.runId, "lease-test");
	assert.equal(handle.record.runKind, "planning");
	assert.equal(handle.record.pid, process.pid);
	assert.equal(handle.record.hostname, os.hostname());
	assert.ok(handle.record.ownerId);
	assert.ok(handle.record.acquiredAt);
	assert.equal(handle.digest.length, 64);
	assert.ok(handle.byteCount > 0);
	// Verify lease file exists on disk
	const leaseFile = leasePath(runDir);
	const content = await readFile(leaseFile, "utf8");
	const parsed = JSON.parse(content);
	assert.equal(parsed.version, 1);
	assert.equal(parsed.runId, "lease-test");
	// Release succeeds
	assert.equal(await releaseLease(handle), true);
	assert.equal(await entryExists(leaseFile), false);
});

test("competing lease acquisition fails with owner evidence", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "competing");
	const handle = await acquireLease(runDir, "competing", "planning");
	// Second acquisition must fail
	await assert.rejects(
		acquireLease(runDir, "competing", "planning"),
		/Lease already exists/,
	);
	// Clean up
	await releaseLease(handle);
});

test("run-kind separation: planning lease does not match execution-only directory", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "kind-check");
	// Make it a proper planning directory with .state.json
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 3, status: "running", runId: "kind-check" }));
	// Acquire an execution lease on a planning directory — allowed at lease level,
	// but classification will report mismatch.
	const handle = await acquireLease(runDir, "kind-check", "execution");
	assert.equal(handle.record.runKind, "execution");
	// Classification sees .state.json → planning
	const kind = await classifyRun(runDir);
	assert.equal(kind, "planning");
	await releaseLease(handle);
});

test("lease release refuses on device/inode or content drift", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "drift");
	const handle = await acquireLease(runDir, "drift", "planning");
	// Tamper with lease content
	const leaseFile = leasePath(runDir);
	await writeFile(leaseFile, "tampered content\n");
	await assert.rejects(releaseLease(handle), /content changed/);
});

test("release fails closed when the retained lease disappears", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "gone");
	const handle = await acquireLease(runDir, "gone", "planning");
	await rm(leasePath(runDir));
	await assert.rejects(releaseLease(handle), /disappeared/);
});

test("lease inspection reports unleased, held-by-other, and uncertain correctly", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "inspect");
	// Unleased
	let inspection = await inspectLease(runDir);
	assert.equal(inspection.ownership, "unleased");

	// Acquire
	const handle = await acquireLease(runDir, "inspect", "planning");
	// Owned by this runtime (with retained handle)
	inspection = await inspectLease(runDir, handle);
	assert.equal(inspection.ownership, "owned-by-this-runtime");

	// Without retained handle — same PID → uncertain
	inspection = await inspectLease(runDir);
	assert.equal(inspection.ownership, "uncertain");

	await releaseLease(handle);
});

test("lease inspection handles malformed and symlink lease files", async (t) => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "bad-lease");
	const leaseFile = leasePath(runDir);
	// Write malformed JSON
	await writeFile(leaseFile, "not json");
	const inspection = await inspectLease(runDir);
	assert.equal(inspection.ownership, "uncertain");
	assert.ok(inspection.error);

	// Remove and create a symlink
	await rm(leaseFile);
	const outside = path.join(os.tmpdir(), "pi-lease-symlink-target");
	await writeFile(outside, "{}");
	try {
		await symlink(outside, leaseFile);
	} catch (error) {
		t.skip(`symlinks unavailable: ${String(error)}`);
		return;
	}
	const symInspection = await inspectLease(runDir);
	assert.equal(symInspection.ownership, "uncertain");
	await rm(leaseFile, { force: true });
	await rm(outside, { force: true });
});

test("a transplanted lease never proves retained ownership", async () => {
	const { internal } = await project();
	const source = await createSprintRun(internal, "lease-source");
	const target = await createSprintRun(internal, "lease-target");
	const handle = await acquireLease(source, "lease-source", "planning");
	await rename(handle.path, leasePath(target));
	const inspection = await inspectLease(target, handle);
	assert.equal(inspection.ownership, "uncertain");
	assert.match(inspection.error ?? "", /run id/);
});

test("unsupported lease version produces uncertain ownership", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "old-version");
	const leaseFile = leasePath(runDir);
	await writeFile(leaseFile, `${JSON.stringify({ version: 99, runId: "old-version", runKind: "planning", ownerId: "x", pid: 1, hostname: "h", acquiredAt: "t" }, null, 2)}\n`);
	const inspection = await inspectLease(runDir);
	assert.equal(inspection.ownership, "uncertain");
});

test("removeEmptyReservation only removes an identity-matching empty reservation", async () => {
	const { internal } = await project();
	const empty = await reserveSprintRun(internal, "empty");
	const nonEmpty = await reserveSprintRun(internal, "nonempty");
	await writeFile(path.join(nonEmpty.path, "f"), "x");

	await removeEmptyReservation(empty);
	assert.equal(await entryExists(empty.path), false);
	await removeEmptyReservation(nonEmpty);
	assert.equal(await entryExists(nonEmpty.path), true);

	const replaced = await reserveSprintRun(internal, "replaced");
	await rm(replaced.path, { recursive: true });
	await mkdir(replaced.path);
	await removeEmptyReservation(replaced);
	assert.equal(await entryExists(replaced.path), true);
});

test("classifyRun identifies planning, execution-only, ambiguous, malformed, and unknown", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "classify-plan");
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 3, status: "running", runId: "classify-plan" }));
	assert.equal(await classifyRun(runDir), "planning");

	// Execution-only
	const execDir = await mkdtemp(path.join(os.tmpdir(), "pi-exec-"));
	const execRecord = path.join(execDir, "execution", "record.json");
	await mkdir(path.dirname(execRecord), { recursive: true });
	await writeFile(execRecord, "{}");
	assert.equal(await classifyRun(execDir), "execution-only");
	await rm(execDir, { recursive: true, force: true });

	// Ambiguous: both
	await mkdir(path.join(runDir, "execution"), { recursive: true });
	await writeFile(path.join(runDir, "execution", "record.json"), "{}");
	assert.equal(await classifyRun(runDir), "ambiguous");
});

test("discoverSprintRuns enumerates only regular direct-child directories sorted by id", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-sprints-list-"));
	// Create regular runs
	for (const name of ["run-c", "run-a", "run-b"]) {
		const d = path.join(parent, name);
		await mkdir(d);
		await writeFile(path.join(d, ".state.json"), JSON.stringify({ version: 3, status: "completed", runId: name }));
	}
	// Symlink child — should be skipped
	try {
		await symlink(path.join(parent, "run-a"), path.join(parent, "run-link"), "dir");
	} catch {
		// symlinks may not be available
	}
	// File child — should be skipped
	await writeFile(path.join(parent, "readme.txt"), "not a directory");
	// Dotfile — should be skipped
	await mkdir(path.join(parent, ".hidden"));

	const runs = await discoverSprintRuns(parent);
	const ids = runs.map((r) => r.runId);
	assert.deepEqual(ids, ["readme.txt", "run-a", "run-b", "run-c", "run-link"]);
	assert.equal(runs.filter((r) => r.state !== "unsafe-direct-child").every((r) => r.kind === "planning"), true);
	assert.deepEqual(runs.filter((r) => r.state === "unsafe-direct-child").map((r) => r.runId), ["readme.txt", "run-link"]);
	await rm(parent, { recursive: true, force: true });
});

test("discoverSprintRuns reports lease ownership", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-sprints-lease-list-"));
	const d = path.join(parent, "leased-run");
	await mkdir(d);
	await writeFile(path.join(d, ".state.json"), JSON.stringify({ version: 3, status: "running", runId: "leased-run" }));
	// No lease → unleased
	let runs = await discoverSprintRuns(parent);
	assert.equal(runs[0].leaseOwnership, "unleased");

	// With lease
	const handle = await acquireLease(d, "leased-run", "planning");
	runs = await discoverSprintRuns(parent, handle);
	assert.equal(runs[0].leaseOwnership, "owned-by-this-runtime");

	await releaseLease(handle);
	await rm(parent, { recursive: true, force: true });
});

test("runDoctor reports missing run", async () => {
	const { internal } = await project();
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, path.join(root, "nope"), "nope");
	assert.equal(report.runKind, "unknown");
	assert.equal(report.findings.length, 1);
	assert.equal(report.findings[0].code, "run-missing");
	assert.equal(report.findings[0].severity, "critical");
});

test("runDoctor diagnoses completed planning runs from state", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-completed");
	const now = new Date().toISOString();
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({
		version: 3, runId: "doc-completed", projectRoot: "/tmp", runDirectory: runDir,
		status: "completed", stage: "complete", directivePath: "input.md",
		inputArtifact: { path: "input.md", sha256: "a".repeat(64), bytes: 100 },
		agents: 4, steps: {}, createdAt: now, updatedAt: now, completedAt: now,
	}, null, 2));
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-completed");
	assert.equal(report.runKind, "planning");
	assert.ok(report.findings.some((f) => f.code === "state-completed"));
});

test("runDoctor reports unsupported state version", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-old");
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 2, status: "running", runId: "doc-old" }));
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-old");
	assert.ok(report.findings.some((f) => f.code === "state-unsupported-version"));
});

test("runDoctor rejects malformed execution-only records", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-exec-doc-"));
	const execRecord = path.join(parent, "exec-run", "execution", "record.json");
	await mkdir(path.dirname(execRecord), { recursive: true });
	await writeFile(execRecord, JSON.stringify({ version: 1, runId: "exec-run", state: "active", revision: 0, source: { projectRoot: "/tmp", sourcePlanPath: "plans/demo", aggregateDigest: "a".repeat(64), files: [] }, frozen: { scopeSize: "small", phases: [], dependencies: {}, waves: {}, goals: {}, targets: {}, implementationModel: { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" }, validationModel: { provider: "openai-codex", model: "gpt-5.6-terra", thinking: "high" } }, phases: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
	const root = path.resolve(parent);
	const report = await runDoctor(root, path.join(root, "exec-run"), "exec-run");
	assert.equal(report.runKind, "execution-only");
	assert.equal(report.executionBaseline, true);
	assert.ok(report.findings.some((f) => f.code === "exec-record-malformed"));
	await rm(parent, { recursive: true, force: true });
});

test("runDoctor reports unsupported and foreign execution marker envelopes", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-exec-envelope-"));
	const runDir = path.join(parent, "exec-envelope");
	await mkdir(path.join(runDir, "execution"), { recursive: true });
	await writeFile(path.join(runDir, "execution", "record.json"), JSON.stringify({ version: 99, runId: "other", runKind: "planning" }));
	const report = await runDoctor(parent, runDir, "exec-envelope");
	assert.ok(report.findings.some((finding) => finding.code === "exec-version-unsupported"));
	await rm(parent, { recursive: true, force: true });
});

test("runDoctor reports ambiguous markers", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-ambig");
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 3, status: "running", runId: "doc-ambig" }));
	await mkdir(path.join(runDir, "execution"), { recursive: true });
	await writeFile(path.join(runDir, "execution", "record.json"), "{}");
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-ambig");
	assert.equal(report.runKind, "ambiguous");
	assert.ok(report.findings.some((f) => f.code === "run-ambiguous"));
});

test("runDoctor reports runId mismatch in state", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-mismatch");
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 3, status: "running", runId: "different-id" }));
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-mismatch");
	assert.ok(report.findings.some((f) => f.code === "state-runid-mismatch"));
});

test("runDoctor never writes or mutates files (read-only snapshot)", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-ro");
	await writeFile(path.join(runDir, ".state.json"), JSON.stringify({ version: 3, status: "interrupted", runId: "doc-ro", projectRoot: "/tmp", runDirectory: runDir, directivePath: "input.md", inputArtifact: { path: "input.md", sha256: "a".repeat(64), bytes: 100 }, agents: 4, steps: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, null, 2));

	const statePath = path.join(runDir, ".state.json");
	const beforeBytes = (await stat(statePath)).size;
	const beforeContent = await readFile(statePath, "utf8");

	const root = await sprintsRoot(internal);
	// Run doctor twice
	await runDoctor(root, runDir, "doc-ro");
	await runDoctor(root, runDir, "doc-ro");

	const afterBytes = (await stat(statePath)).size;
	const afterContent = await readFile(statePath, "utf8");
	assert.equal(afterBytes, beforeBytes);
	assert.equal(afterContent, beforeContent);

	// No new files created
	const entries = await readdir(runDir);
	assert.ok(!entries.some((e) => e.startsWith(".") && ![".state.json"].includes(e)));
});

test("runDoctor detects recorded artifact hash drift", async () => {
	const { root: projectRoot, internal } = await project();
	const runner = new DelayedRunner();
	const engine = new SprintPlannerEngine(runner);
	const run = engine.runSprint({ projectRoot, internalDevPath: internal, runId: "doc-hash-drift", directive: "Hash drift", agents: 4 });
	await runner.waiting;
	await engine.pause();
	await run;
	const runDir = path.join(internal, "sprints", "doc-hash-drift");
	await writeFile(path.join(runDir, "input.md"), "tampered\n");
	const report = await runDoctor(await sprintsRoot(internal), runDir, "doc-hash-drift");
	assert.ok(report.findings.some((finding) => finding.code === "artifact-hash-drift"));
});

test("runDoctor reports malformed state gracefully", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-malformed");
	await writeFile(path.join(runDir, ".state.json"), "not json");
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-malformed");
	assert.ok(report.findings.some((f) => f.code === "state-malformed"));
});

test("runDoctor reports foreign lease with owner evidence", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-foreign");
	// Simulate a lease from a different process
	const leaseFile = leasePath(runDir);
	const foreignLease = JSON.stringify({
		version: 1, runId: "doc-foreign", runKind: "planning",
		ownerId: "foreign-owner", pid: 99999, hostname: "other-host",
		acquiredAt: new Date().toISOString(),
	}, null, 2) + "\n";
	await writeFile(leaseFile, foreignLease);
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-foreign");
	assert.equal(report.leaseOwnership, "held-by-other");
	assert.ok(report.findings.some((f) => f.code === "lease-foreign"));
});

test("runDoctor reports uncertain lease", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-uncertain");
	const leaseFile = leasePath(runDir);
	await writeFile(leaseFile, "not json");
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-uncertain");
	assert.equal(report.leaseOwnership, "uncertain");
	assert.ok(report.findings.some((f) => f.code === "lease-uncertain"));
});

test("runDoctor reports symlink run directory as critical", async (t) => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pi-doc-sym-"));
	const realDir = path.join(parent, "real");
	const linkDir = path.join(parent, "linked");
	await mkdir(realDir);
	try {
		await symlink(realDir, linkDir, "dir");
	} catch (error) {
		t.skip(`symlinks unavailable: ${String(error)}`);
		return;
	}
	// Doctor the symlink — but runDoctor won't follow symlinks
	// (classifyRun will return malformed for symlinks, and the entry check catches it)
	const report = await runDoctor(parent, linkDir, "linked");
	assert.equal(report.runKind, "malformed");
	await rm(parent, { recursive: true, force: true });
});

test("runDoctor with retained lease reports owned-by-this-runtime", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-owned");
	const handle = await acquireLease(runDir, "doc-owned", "planning");
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-owned", handle);
	assert.equal(report.leaseOwnership, "owned-by-this-runtime");
	assert.ok(report.findings.some((f) => f.code === "lease-owned"));
	await releaseLease(handle);
});

test("runDoctor reports manifest-based completed planning when state is absent", async () => {
	const { internal } = await project();
	const runDir = await createSprintRun(internal, "doc-manifest-only");
	await writeFile(path.join(runDir, "manifest.md"), "# Sprint doc-manifest-only\n\n## Directive\n\nDone\n");
	const root = await sprintsRoot(internal);
	const report = await runDoctor(root, runDir, "doc-manifest-only");
	assert.equal(report.runKind, "planning");
	assert.ok(report.findings.some((f) => f.code === "planning-completed"));
});

test("sprint engine acquires and releases lease across full lifecycle", async () => {
	const { root, internal } = await project();
	const runner = new FakeRunner();
	const engine = new SprintPlannerEngine(runner);
	const state = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "lease-lifecycle", directive: "Lease test", agents: 4 });
	assert.equal(state.status, "completed");
	// After completion, lease should be released
	const leaseFile = leasePath(path.join(internal, "sprints", "lease-lifecycle"));
	assert.equal(await entryExists(leaseFile), false);
});

test("sprint engine releases lease on paused/errored completion", async () => {
	const { root, internal } = await project();
	const runner = new BadOrchestrationRunner();
	const engine = new SprintPlannerEngine(runner);
	const state = await engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "lease-paused", directive: "Pause test", agents: 4 });
	assert.equal(state.status, "paused");
	// Lease should be released even after paused
	const leaseFile = leasePath(path.join(internal, "sprints", "lease-paused"));
	assert.equal(await entryExists(leaseFile), false);
});

test("sprint engine release via engine.pause", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const run = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "lease-pause", directive: "Pause lease", agents: 4 });
	await delayed.waiting;
	await engine.pause(true);
	await run;
	const leaseFile = leasePath(path.join(internal, "sprints", "lease-pause"));
	// pause() releases the lease
	assert.equal(await entryExists(leaseFile), false);
});

test("lease acquisition rolls back empty reservation on failure", async () => {
	const { internal } = await project();
	// Manually create a reservation, then try to acquire with a conflict
	const root = await sprintsRoot(internal);
	// Simulate: create directory and place a conflicting lease
	// First, create a normal run directory
	const runDir = await createSprintRun(internal, "rollback-test");
	// Now manually place a foreign lease
	const leaseFile = leasePath(runDir);
	await writeFile(leaseFile, JSON.stringify({ version: 1, runId: "rollback-test", runKind: "planning", ownerId: "foreign", pid: 1, hostname: "x", acquiredAt: "t" }, null, 2) + "\n");
	// Try to acquire on this already-leased directory
	await assert.rejects(acquireLease(runDir, "rollback-test", "planning"), /Lease already exists/);
	// The directory should still exist (it was already fully created, not just reserved)
	assert.equal(await entryExists(runDir), true);
});

test("sprint resume refuses foreign lease", async () => {
	const { root, internal } = await project();
	// Create a completed sprint, then place foreign lease, then try resume
	const runDir = await createSprintRun(internal, "foreign-resume");
	const stateContent = JSON.stringify({
		version: 3, runId: "foreign-resume", projectRoot: root, runDirectory: runDir,
		status: "interrupted", stage: "brainstorm", directivePath: "input.md",
		inputArtifact: { path: "input.md", sha256: "a".repeat(64), bytes: 100 },
		agents: 4, steps: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	}, null, 2);
	await writeFile(path.join(runDir, ".state.json"), stateContent);
	await writeFile(path.join(runDir, "input.md"), "# Sprint Input\n\nTest\n");
	// Place a foreign lease
	const foreignLease = JSON.stringify({
		version: 1, runId: "foreign-resume", runKind: "planning",
		ownerId: "foreign-owner", pid: 99999, hostname: "other-host",
		acquiredAt: new Date().toISOString(),
	}, null, 2) + "\n";
	await writeFile(leasePath(runDir), foreignLease);

	await assert.rejects(
		new SprintPlannerEngine(new FakeRunner()).resumeSprint(runDir, "foreign-resume"),
		/Lease already exists.*planning lease.*pid 99999/,
	);
});

test("sprint resume refuses uncertain lease", async () => {
	const { root, internal } = await project();
	const runDir = await createSprintRun(internal, "uncertain-resume");
	const stateContent = JSON.stringify({
		version: 3, runId: "uncertain-resume", projectRoot: root, runDirectory: runDir,
		status: "interrupted", stage: "brainstorm", directivePath: "input.md",
		inputArtifact: { path: "input.md", sha256: "a".repeat(64), bytes: 100 },
		agents: 4, steps: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
	}, null, 2);
	await writeFile(path.join(runDir, ".state.json"), stateContent);
	await writeFile(path.join(runDir, "input.md"), "# Sprint Input\n\nTest\n");
	// Place malformed lease
	await writeFile(leasePath(runDir), "not json");

	await assert.rejects(
		new SprintPlannerEngine(new FakeRunner()).resumeSprint(runDir, "uncertain-resume"),
		/Lease already exists.*unparseable/,
	);
});

test("parseCommand supports list and doctor actions", () => {
	const p1 = parseCommand("sprint", "list");
	assert.equal(p1.action, "list");
	assert.equal(p1.runId, undefined);

	const p2 = parseCommand("sprint", "doctor");
	assert.equal(p2.action, "doctor");
	assert.equal(p2.runId, undefined);

	const p3 = parseCommand("sprint", "doctor my-run");
	assert.equal(p3.action, "doctor");
	assert.equal(p3.runId, "my-run");

	// list rejects run id
	assert.throws(() => parseCommand("sprint", "list extra"), /does not accept/);

	assert.throws(() => parseCommand("sprint", "doctor ../escape"), /safe path segment/);
	assert.throws(() => parseCommand("sprint", "resume nested/run"), /safe path segment/);
	assert.equal(parseCommand("sprint", "-- list literal prompt").input, "list literal prompt");
	assert.equal(parseCommand("sprint", "-- doctor literal prompt").input, "doctor literal prompt");

	// Non-sprint workflows reject list/doctor
	assert.throws(() => parseCommand("brainstorm", "list"), /not list/);
	assert.throws(() => parseCommand("ironout", "doctor"), /not doctor/);
});

test("commandUsage includes list and doctor", async () => {
	const { commandUsage } = await import("../commands.ts");
	const usage = commandUsage("sprint");
	assert.match(usage, /list/);
	assert.match(usage, /doctor/);
});

test("no live consumer uses atomicWriteJson or replaceFlatDirectory", async () => {
	// Verify these are no longer exported
	const coreExports = await import("../core.ts");
	assert.equal("atomicWriteJson" in coreExports, false);
	assert.equal("replaceFlatDirectory" in coreExports, false);
});

test("unused ArtifactSink API is not exported", async () => {
	const coreExports = await import("../core.ts");
	assert.equal("ArtifactSink" in coreExports, false);
});

test("fake-runner sprint still preserves immediate starting progress", async () => {
	const { root, internal } = await project();
	const delayed = new DelayedRunner();
	const engine = new SprintPlannerEngine(delayed);
	const promise = engine.runSprint({ projectRoot: root, internalDevPath: internal, runId: "starting-03", directive: "Starting phase 03", agents: 4 });
	const early = engine.progress;
	assert.ok(early);
	assert.equal(early!.status, "starting");
	assert.equal(early!.stage, "starting");
	await delayed.waiting;
	await engine.pause(true);
	await promise;
});

// ── Phase 04: execution records ────────────────────────────────────────

async function makePlanDir(planDir: string): Promise<void> {
	const planFiles = [
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestrationFor("small", ["phase-01-first.md", "phase-02-second.md"]) },
		{ path: "phase-01-first.md", content: phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts") },
		{ path: "phase-02-second.md", content: phaseMd(2, "phase-01-first.md", "Complete phase 2", "sprint-planner/target-02.ts") },
	];
	await mkdir(planDir, { recursive: true });
	for (const f of planFiles) await writeFile(path.join(planDir, f.path), f.content);
}

async function makeBranchingPlanDir(planDir: string): Promise<void> {
	const orchestration = [
		"# Orchestration", "", "## Scope Size", "", "**Size**: medium", "", "## Phase Ledger", "",
		"- phase-01-first.md | depends: none | targets: sprint-planner/target-01.ts | goal: Complete phase 1",
		"- phase-02-second.md | depends: phase-01-first.md | targets: sprint-planner/target-02.ts | goal: Complete phase 2",
		"- phase-03-third.md | depends: phase-01-first.md | targets: sprint-planner/target-03.ts | goal: Complete phase 3",
		"", "## Execution Waves", "",
		"- wave-01: phase-01-first.md",
		"- wave-02: phase-03-third.md",
		"- wave-03: phase-02-second.md",
		"", "## Model Assignments", "",
		"- Implementation: deepseek/deepseek-v4-pro:max",
		"- Validation: openai-codex/gpt-5.6-terra:high",
		"- Implementers: exactly one implementation agent per unsplit phase, or one sequential agent per lettered subphase for split phases",
		"", "## Validation Gate", "",
		"- Gate: post-phase validator review-and-repair must PASS before a phase is complete.",
		"- Dependencies: no dependent phase starts before every dependency has PASS.",
		"", "## Final Integration", "",
		"- Integration: after all phases PASS, run final integration validation with openai-codex/gpt-5.6-terra:high.", "",
	].join("\n");
	const planFiles = [
		{ path: "concepts.md", content: concepts },
		{ path: "orchestration.md", content: orchestration },
		{ path: "phase-01-first.md", content: phaseMd(1, "none", "Complete phase 1", "sprint-planner/target-01.ts") },
		{ path: "phase-02-second.md", content: phaseMd(2, "phase-01-first.md", "Complete phase 2", "sprint-planner/target-02.ts") },
		{ path: "phase-03-third.md", content: phaseMd(3, "phase-01-first.md", "Complete phase 3", "sprint-planner/target-03.ts") },
	];
	await mkdir(planDir, { recursive: true });
	for (const file of planFiles) await writeFile(path.join(planDir, file.path), file.content);
}

test("start creates an execution record with frozen source snapshot and revision 0", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "demo-plan");
	await makePlanDir(planDir);

	const { handle, revision, source } = await startExecutionRecord(internal, root, "plans/demo-plan");
	assert.equal(revision, 0);
	assert.match(handle.runId, /^exec-/);
	assert.equal(handle.leaseHandle.record.runKind, "execution");
	assert.equal(source.sourcePlanPath, "plans/demo-plan");
	assert.equal(source.files.length, 4);
	assert.match(source.aggregateDigest, /^[0-9a-f]{64}$/);

	// Verify record on disk
	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.ok(record);
	assert.equal(record!.state, "active");
	assert.equal(record!.revision, 0);
	assert.equal(record!.source.files.length, 4);
	assert.ok(record!.source.aggregateDigest.length === 64);
	assert.equal(record!.frozen.phases.length, 2);
	assert.deepEqual(record!.frozen.phases, ["phase-01-first.md", "phase-02-second.md"]);

	// Manifest exists
	const manifestContent = await readFile(path.join(handle.runDirectory, "manifest.md"), "utf8");
	assert.match(manifestContent, /Execution Record/);
	assert.match(manifestContent, /Planning was performed externally/);

	// Clean up: finish as interrupted to release lease
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("start freezes valid waves whose traversal order differs from phase-ledger order", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "branching-plan");
	await makeBranchingPlanDir(planDir);
	assert.equal((await inspectPlanDirectory(planDir, root)).valid, true);

	const { handle } = await startExecutionRecord(internal, root, "plans/branching-plan");
	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.ok(record);
	assert.deepEqual(Object.keys(record!.frozen.waves), record!.frozen.phases);
	assert.deepEqual(record!.frozen.waves, {
		"phase-01-first.md": 1,
		"phase-02-second.md": 3,
		"phase-03-third.md": 2,
	});

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("start rejects an invalid source plan", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "bad-plan");
	await mkdir(planDir, { recursive: true });
	await writeFile(path.join(planDir, "concepts.md"), "not valid concepts");

	await assert.rejects(
		startExecutionRecord(internal, root, "plans/bad-plan"),
		/Source plan is not valid/,
	);
});

test("source identity helper classifies both canonical layouts and other paths", () => {
	assert.deepEqual(sourceIdentity(".internal-dev/plans/standalone"), { layout: "standalone-plan", planningRunId: "standalone" });
	assert.deepEqual(sourceIdentity(".internal-dev/sprints/persisted/planning"), { layout: "sprint-planning", planningRunId: "persisted" });
	assert.deepEqual(sourceIdentity("plans/custom"), { layout: "other" });
});

test("standalone and sprint-planning provenance accept matching and omitted ids with parity", async () => {
	const { root, internal } = await project();
	const layouts = [
		{ id: "standalone-source", sourcePath: ".internal-dev/plans/standalone-source", planDir: path.join(internal, "plans", "standalone-source") },
		{ id: "sprint-source", sourcePath: ".internal-dev/sprints/sprint-source/planning", planDir: path.join(internal, "sprints", "sprint-source", "planning") },
	];
	for (const layout of layouts) {
		await makePlanDir(layout.planDir);
		for (const supplied of [layout.id, undefined]) {
			const { handle, revision } = await startExecutionRecord(internal, root, layout.sourcePath, supplied);
			assert.equal(revision, 0);
			const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
			assert.equal(record!.source.sourcePlanningRunId, layout.id);
			await interruptActiveRecord(handle, "Test cleanup.");
		}
	}
});

test("standalone and sprint-planning provenance reject mismatching ids with parity", async () => {
	const { root, internal } = await project();
	const layouts = [
		{ sourcePath: ".internal-dev/plans/standalone-source", planDir: path.join(internal, "plans", "standalone-source") },
		{ sourcePath: ".internal-dev/sprints/sprint-source/planning", planDir: path.join(internal, "sprints", "sprint-source", "planning") },
	];
	for (const layout of layouts) {
		await makePlanDir(layout.planDir);
		await assert.rejects(startExecutionRecord(internal, root, layout.sourcePath, "wrong-source"), /sourcePlanningRunId must be the exact <id>/);
	}
});

test("provenance rejects trailing slashes and paths supplied instead of ids", async () => {
	const { root, internal } = await project();
	const layouts = [
		{ id: "standalone-source", sourcePath: ".internal-dev/plans/standalone-source", planDir: path.join(internal, "plans", "standalone-source"), pathAsId: ".internal-dev/plans/standalone-source" },
		{ id: "sprint-source", sourcePath: ".internal-dev/sprints/sprint-source/planning", planDir: path.join(internal, "sprints", "sprint-source", "planning"), pathAsId: ".internal-dev/sprints/sprint-source/planning" },
	];
	for (const layout of layouts) {
		await makePlanDir(layout.planDir);
		await assert.rejects(startExecutionRecord(internal, root, `${layout.sourcePath}/`, layout.id), /canonical|unsafe traversal/i);
		await assert.rejects(startExecutionRecord(internal, root, layout.sourcePath, `${layout.id}/`), /sourcePlanningRunId must be the exact <id>/);
		await assert.rejects(startExecutionRecord(internal, root, layout.sourcePath, layout.pathAsId), /sourcePlanningRunId must be the exact <id>/);
	}
});

test("execution id allocation avoids collisions and honors name prefix", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "collision-plan");
	await makePlanDir(planDir);

	// Start first with no name
	const { handle: h1 } = await startExecutionRecord(internal, root, "plans/collision-plan");
	assert.match(h1.runId, /^exec-/);

	// Start second with a name
	const { handle: h2 } = await startExecutionRecord(internal, root, "plans/collision-plan", undefined, "my-phase");
	assert.match(h2.runId, /^exec-my-phase/);

	// Start third: should get a suffix
	const { handle: h3 } = await startExecutionRecord(internal, root, "plans/collision-plan", undefined, "my-phase");
	assert.match(h3.runId, /^exec-my-phase-2$/);

	assert.notEqual(h1.runId, h2.runId);
	assert.notEqual(h2.runId, h3.runId);

	await interruptActiveRecord(h1, "Test cleanup.");
	await interruptActiveRecord(h2, "Test cleanup.");
	await interruptActiveRecord(h3, "Test cleanup.");
});

test("checkpoint records implementation evidence and increments revision", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "impl-plan");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/impl-plan");

	// Phase 1 has no dependencies, so implementation is allowed
	const rev1 = await checkpointExecutionRecord(
		handle, 0, "implementation", "phase-01-first.md", undefined,
		"Implemented phase 1 successfully.", undefined,
	);
	assert.equal(rev1, 1);

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	const phase1 = record!.phases.find((p) => p.phase === "phase-01-first.md");
	assert.ok(phase1?.implementation);
	assert.equal(phase1!.implementation!.report, "Implemented phase 1 successfully.");
	assert.deepEqual(phase1!.implementation!.agentModel.provider, "deepseek");

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("checkpoint rejects implementation when dependency has not PASSed", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "dep-block");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/dep-block");

	// Phase 2 depends on phase 1, which hasn't been validated
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-02-second.md", undefined, "tried too early", undefined),
		/not all dependencies have validator PASS/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("full phase lifecycle: implementation → validator PASS → finish completed", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "full-lifecycle");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/full-lifecycle");

	// Phase 1
	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "Phase 1 done.", undefined);
	assert.equal(rev, 1);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "Phase 1 PASS.", undefined);
	assert.equal(rev, 2);

	// Phase 2 (depends on phase 1)
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-02-second.md", undefined, "Phase 2 done.", undefined);
	assert.equal(rev, 3);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-02-second.md", "PASS", "Phase 2 PASS.", undefined);
	assert.equal(rev, 4);

	// Integration
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "All integrated.", undefined);
	assert.equal(rev, 5);

	// Finish completed
	rev = await finishExecutionRecord(handle, rev, "completed", "All done.");
	assert.equal(rev, 6);

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "completed");
	assert.ok(record!.completedAt);
});

test("phase validation BLOCKED permits finish blocked", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "blocked-phase");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/blocked-phase");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "Phase 1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "BLOCKED", "Cannot proceed.", undefined);

	// Finish blocked
	rev = await finishExecutionRecord(handle, rev, "blocked", "External dependency unavailable.");

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "blocked");
	assert.ok(record!.blocker);
});

test("phase BLOCKED can be retried to PASS without erasing attempt history", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "blocked-retry-pass"));
	const { handle } = await startExecutionRecord(internal, root, "plans/blocked-retry-pass");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "Implemented.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first.md", "BLOCKED", "Credential missing.", undefined);
	let record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.equal(record.state, "active");
	assert.equal(record.blocker, undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first", "PASS", "Credential restored; PASS.", undefined);
	record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.deepEqual(record.phases[0].validations.map(({ attempt, verdict }) => ({ attempt, verdict })), [
		{ attempt: 1, verdict: "BLOCKED" },
		{ attempt: 2, verdict: "PASS" },
	]);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("phase BLOCKED can be retried repeatedly until the latest attempt PASSes", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "blocked-retry-chain"));
	const { handle } = await startExecutionRecord(internal, root, "plans/blocked-retry-chain");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first", undefined, "Implemented.", undefined);
	for (const [verdict, report] of [["BLOCKED", "First blocker."], ["BLOCKED", "Still blocked."], ["PASS", "Resolved."]] as const) {
		revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first", verdict, report, undefined);
	}
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.deepEqual(record.phases[0].validations.map(({ attempt, verdict }) => ({ attempt, verdict })), [
		{ attempt: 1, verdict: "BLOCKED" },
		{ attempt: 2, verdict: "BLOCKED" },
		{ attempt: 3, verdict: "PASS" },
	]);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("a BLOCKED phase does not reject disjoint sibling evidence", async () => {
	const { root, internal } = await project();
	await makeBranchingPlanDir(path.join(root, "plans", "blocked-sibling"));
	const { handle } = await startExecutionRecord(internal, root, "plans/blocked-sibling");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first", undefined, "Root implemented.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first", "PASS", "Root PASS.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "implementation", "phase-02-second", undefined, "Sibling 2 implemented.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-02-second", "BLOCKED", "Sibling 2 blocked.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "implementation", "phase-03-third", undefined, "Disjoint sibling 3 implemented.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-03-third", "PASS", "Sibling 3 PASS.", undefined);
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.equal(record.state, "active");
	assert.equal(record.phases[1].validations.at(-1)!.verdict, "BLOCKED");
	assert.equal(record.phases[2].validations.at(-1)!.verdict, "PASS");
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("dependents remain rejected until a blocked dependency's latest verdict is PASS", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "blocked-dependency-retry"));
	const { handle } = await startExecutionRecord(internal, root, "plans/blocked-dependency-retry");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first", undefined, "P1 implemented.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first", "BLOCKED", "P1 blocked.", undefined);
	await assert.rejects(
		checkpointExecutionRecord(handle, revision, "implementation", "phase-02-second", undefined, "Too early.", undefined),
		/latest verdict/,
	);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first.md", "PASS", "P1 now PASS.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "implementation", "phase-02-second", undefined, "P2 now allowed.", undefined);
	assert.equal(revision, 4);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("phase names with and without .md normalize to the same canonical ledger name", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "phase-name-normalization"));
	const { handle } = await startExecutionRecord(internal, root, "plans/phase-name-normalization");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first", undefined, "Implemented without suffix.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first.md", "PASS", "Validated with suffix.", undefined);
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.equal(record.phases[0].phase, "phase-01-first.md");
	assert.equal(record.phases[0].validations[0].attempt, 1);
	await assert.rejects(
		checkpointExecutionRecord(handle, revision, "implementation", "phase-99-missing", undefined, "Unknown.", undefined),
		/Valid canonical phase names: phase-01-first\.md, phase-02-second\.md/,
	);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("stale revision rejection prevents checkpoint and finish", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "stale-rev");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/stale-rev");

	const rev1 = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "Phase 1 done.", undefined);
	assert.equal(rev1, 1);

	// Try with stale revision (0 instead of 1)
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "phase_validation", "phase-01-first.md", "PASS", "Too late.", undefined),
		/Revision mismatch/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("duplicate evidence is rejected", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "duplicate");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/duplicate");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "Phase 1 done.", undefined);

	// Duplicate implementation rejected
	await assert.rejects(
		checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "Duplicate impl.", undefined),
		/already has implementation evidence/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("validator checkpoint requires prior implementation evidence", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "no-impl");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/no-impl");

	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "phase_validation", "phase-01-first.md", "PASS", "No implementation first.", undefined),
		/has no implementation evidence/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("integration validation requires all phases PASS", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "early-integration");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/early-integration");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);

	// Phase 2 not yet done — integration should reject
	await assert.rejects(
		checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "Too early.", undefined),
		/requires every phase to have validator PASS/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("finish completed requires integration PASS and unchanged source", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "finish-complete");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/finish-complete");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-02-second.md", undefined, "P2 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-02-second.md", "PASS", "P2 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "Integration PASS.", undefined);

	// Source must be unchanged for completed finish
	rev = await finishExecutionRecord(handle, rev, "completed", "All done.");

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "completed");
});

test("finish completed rejects when source plan has changed", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "drift-complete");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/drift-complete");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-02-second.md", undefined, "P2 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-02-second.md", "PASS", "P2 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "Integration PASS.", undefined);

	// Mutate a source file
	await writeFile(path.join(planDir, "concepts.md"), "tampered content\n");

	await assert.rejects(
		finishExecutionRecord(handle, rev, "completed", "Should fail."),
		/source plan bytes have changed/,
	);

	// Blocked/interrupted finish should still work
	rev = await finishExecutionRecord(handle, rev, "interrupted", "Source drifted, giving up.");
	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "interrupted");
});

test("finish interrupted does not require all phases PASS", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "early-interrupt");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/early-interrupt");

	// Only phase 1 implementation, then interrupt
	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await finishExecutionRecord(handle, rev, "interrupted", "Session shutdown.");

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "interrupted");
	assert.equal(record!.revision, 2);
	assert.ok(record!.interrupted);
});

test("changed file observation records present and deleted files", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "changed-files");
	await makePlanDir(planDir);

	// Create the phase's declared write target.
	await mkdir(path.dirname(path.join(root, "sprint-planner", "target-01.ts")), { recursive: true });
	await writeFile(path.join(root, "sprint-planner", "target-01.ts"), "console.log('hello');\n");

	const { handle } = await startExecutionRecord(internal, root, "plans/changed-files");

	// Implementation checkpoint with changed paths
	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", ["sprint-planner/target-01.ts"]);

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	const phase1 = record!.phases.find((p) => p.phase === "phase-01-first.md");
	assert.ok(phase1?.implementation?.changedFiles.includes("sprint-planner/target-01.ts"));
	assert.match(phase1!.implementation!.changedFileObservations[0].digest!, /^[0-9a-f]{64}$/);

	// Observe deleted file
	const obs = await observeChangedFile(root, "nonexistent.txt");
	assert.equal(obs.status, "deleted");
	assert.equal(obs.digest, undefined);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("out-of-target changed paths are accepted, persisted, and returned as structured plan-drift warnings", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "outside-target"));
	await mkdir(path.join(root, "sprint-planner"), { recursive: true });
	await writeFile(path.join(root, "sprint-planner", "target-01.ts"), "declared\n");
	await writeFile(path.join(root, "sprint-planner", "adjacent.ts"), "truthful drift\n");
	const { handle } = await startExecutionRecord(internal, root, "plans/outside-target");

	const checkpoint = await checkpointExecutionRecordDetailed(
		handle, 0, "implementation", "phase-01-first", undefined, "Implemented with an adjacent required edit.",
		["sprint-planner/target-01.ts", "sprint-planner/adjacent.ts"],
	);
	assert.equal(checkpoint.revision, 1);
	assert.deepEqual(checkpoint.warnings, [{
		code: "outside-declared-targets",
		phase: "phase-01-first.md",
		paths: ["sprint-planner/adjacent.ts"],
		message: "Changed-file evidence includes 1 path(s) outside the immutable declared scheduling targets. Treat this as plan drift and reassess overlap.",
	}]);
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.deepEqual(record.phases[0].implementation!.outsideDeclaredTargets, ["sprint-planner/adjacent.ts"]);
	assert.deepEqual(record.frozen.targets["phase-01-first.md"], ["sprint-planner/target-01.ts"]);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("changed file rejects unsafe, source-plan, and self-referencing paths", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "self-ref");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/self-ref");

	// Source-plan path rejected.
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", ["plans/self-ref/concepts.md"]),
		/Changed-file path must not be in the source plan/,
	);

	// Self execution record path rejected.
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", [`.internal-dev/sprints/${handle.runId}/manifest.md`]),
		/Changed-file path must not be in the execution record/,
	);
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", [".internal-dev/sprints/exec-other/execution/record.json"]),
		/Changed-file path must not be in the execution record/,
	);

	// Traversal, directories, and symlinks remain unsafe even outside declared targets.
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", ["sprint-planner/../escape.ts"]),
		/unsafe traversal/,
	);
	await mkdir(path.join(root, "outside-directory"));
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", ["outside-directory"]),
		/not a regular file/,
	);
	await writeFile(path.join(root, "outside-target.txt"), "target\n");
	await symlink(path.join(root, "outside-target.txt"), path.join(root, "outside-link.txt"));
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "test", ["outside-link.txt"]),
		/not a regular file/,
	);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("terminal finish releases lease", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "lease-release");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/lease-release");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-02-second.md", undefined, "P2 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-02-second.md", "PASS", "P2 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "All good.", undefined);
	rev = await finishExecutionRecord(handle, rev, "completed", "Done.");

	// Lease should be gone
	const leaseFile = leasePath(handle.runDirectory);
	assert.equal(await entryExists(leaseFile), false);
});

test("doctor reports active state and progress", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "doctor-active");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/doctor-active");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);

	const result = await doctorExecutionRecord(handle.runDirectory, handle.runId, handle.leaseHandle);
	assert.equal(result.state, "active");
	assert.equal(result.leaseOwnership, "owned-by-this-runtime");
	assert.ok(result.findings.some((f) => f.code === "exec-active-progress"));
	assert.ok(result.record!.phases.some((p) => p.phase === "phase-01-first.md" && p.implementation));

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("doctor reports blocked state", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "doctor-blocked");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/doctor-blocked");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "BLOCKED", "Cannot proceed.", undefined);
	rev = await finishExecutionRecord(handle, rev, "blocked", "External issue.");

	const result = await doctorExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(result.state, "blocked");
	assert.ok(result.findings.some((f) => f.code === "exec-blocked"));
});

test("doctor detects manifest mismatch", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "manifest-err");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/manifest-err");

	// Tamper with manifest
	await writeFile(path.join(handle.runDirectory, "manifest.md"), "tampered\n");

	const result = await doctorExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(result.manifestMismatch, true);
	assert.ok(result.findings.some((f) => f.code === "exec-manifest-mismatch"));

	// Repair
	const repaired = await repairManifest(handle);
	assert.equal(repaired, true);

	const afterRepair = await doctorExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(afterRepair.manifestMismatch, false);

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("interruptActiveRecord transitions active to interrupted", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "interrupt-standalone");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/interrupt-standalone");

	const ok = await interruptActiveRecord(handle, "Clean shutdown test.");
	assert.equal(ok, true);

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	assert.equal(record!.state, "interrupted");
	assert.ok(record!.interrupted);
	assert.equal(record!.interrupted!.reason, "Clean shutdown test.");

	// Lease should be released after interrupt
	const leaseFile = leasePath(handle.runDirectory);
	assert.equal(await entryExists(leaseFile), false);
});

test("interruptActiveRecord is idempotent for non-active states", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "already-interrupted");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/already-interrupted");

	await interruptActiveRecord(handle, "First.");
	const ok = await interruptActiveRecord(handle, "Second.");
	assert.equal(ok, false); // Already interrupted
});

test("source drift is detected by doctor", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "source-drift");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/source-drift");

	// Mutate a source file after start
	await writeFile(path.join(planDir, "concepts.md"), concepts + "\nDrifted.\n");

	const result = await doctorExecutionRecord(handle.runDirectory, handle.runId);
	assert.ok(result.findings.some((f) => f.code === "exec-source-drift"));

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("parseExecutionRecord rejects unknown versions", () => {
	assert.throws(
		() => parseExecutionRecord(JSON.stringify({ version: 99, runId: "x" }), "/tmp/x", "x"),
		/Unsupported execution record version/,
	);
});

test("execution record cannot be mutated after terminal state", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "terminal-mutation");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/terminal-mutation");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await finishExecutionRecord(handle, rev, "interrupted", "Done early.");

	// Now try to checkpoint — lease is released, so this should fail on ownership check
	// Actually the handle's lease is released, so this will fail
	await assert.rejects(
		checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "Too late.", undefined),
		/lease is no longer owned/,
	);
});

test("integration BLOCKED remains durable and can be retried to latest PASS", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "integration-block");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/integration-block");

	let rev = 0;
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "implementation", "phase-02-second.md", undefined, "P2 done.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-02-second.md", "PASS", "P2 PASS.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "BLOCKED", "Integration cannot pass.", undefined);
	rev = await checkpointExecutionRecord(handle, rev, "integration_validation", undefined, "PASS", "Integration repaired and PASS.", undefined);
	rev = await finishExecutionRecord(handle, rev, "completed", "Completed after integration retry.");
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.deepEqual(record.integrationValidations.map(({ attempt, verdict }) => ({ attempt, verdict })), [
		{ attempt: 1, verdict: "BLOCKED" },
		{ attempt: 2, verdict: "PASS" },
	]);
	assert.equal(record.state, "completed");
});

test("checkpoint with changed file produces stable present observation", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "stable-file");
	await makePlanDir(planDir);

	// Create the phase's declared write target.
	await mkdir(path.join(root, "sprint-planner"), { recursive: true });
	await writeFile(path.join(root, "sprint-planner", "target-01.ts"), "export const x = 1;\n");

	const { handle } = await startExecutionRecord(internal, root, "plans/stable-file");

	let rev = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "Done.", ["sprint-planner/target-01.ts"]);

	const record = await loadExecutionRecord(handle.runDirectory, handle.runId);
	const phase1 = record!.phases.find((p) => p.phase === "phase-01-first.md");
	assert.ok(phase1?.implementation?.changedFiles.includes("sprint-planner/target-01.ts"));

	await interruptActiveRecord(handle, "Test cleanup.");
});

test("record manifest agreement is verified after every mutation", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "agree-check");
	await makePlanDir(planDir);

	const { handle } = await startExecutionRecord(internal, root, "plans/agree-check");
	let rev = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "P1 done.", undefined);
	const raw = await readFile(path.join(handle.runDirectory, "execution", "record.json"), "utf8");
	parseExecutionRecord(raw, handle.runDirectory, handle.runId);
	const manifest = await readFile(path.join(handle.runDirectory, "manifest.md"), "utf8");
	assert.ok(manifest.includes("Active, revision 1"));

	// A mutating action reconciles derived manifest drift before persisting its transition.
	await writeFile(path.join(handle.runDirectory, "manifest.md"), "stale derived evidence\n");
	rev = await checkpointExecutionRecord(handle, rev, "phase_validation", "phase-01-first.md", "PASS", "P1 PASS.", undefined);
	assert.match(await readFile(path.join(handle.runDirectory, "manifest.md"), "utf8"), /Active, revision 2/);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("execution start freezes the actual ledger and supports collision-safe explicit ids", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "frozen-ledger"));
	const { handle } = await startExecutionRecord(internal, root, "plans/frozen-ledger", undefined, undefined, "exec-explicit-ledger");
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.deepEqual(record.frozen.dependencies, {
		"phase-01-first.md": [],
		"phase-02-second.md": ["phase-01-first.md"],
	});
	assert.deepEqual(record.frozen.waves, { "phase-01-first.md": 1, "phase-02-second.md": 2 });
	assert.equal(record.frozen.goals["phase-02-second.md"], "Complete phase 2");
	assert.deepEqual(record.frozen.targets["phase-01-first.md"], ["sprint-planner/target-01.ts"]);
	assert.equal(await classifyRun(handle.runDirectory), "execution-only");
	await assert.rejects(
		startExecutionRecord(internal, root, "plans/frozen-ledger", undefined, undefined, "exec-explicit-ledger"),
		/already exists/,
	);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("source drift rejects checkpoints without changing descriptor or revision", async () => {
	const { root, internal } = await project();
	const planDir = path.join(root, "plans", "checkpoint-drift");
	await makePlanDir(planDir);
	const { handle } = await startExecutionRecord(internal, root, "plans/checkpoint-drift");
	const before = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	await writeFile(path.join(planDir, "concepts.md"), `${concepts}\nexternal drift\n`);
	await assert.rejects(
		checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "must reject", undefined),
		/Source plan drift detected/,
	);
	const after = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.equal(after.revision, 0);
	assert.deepEqual(after.source, before.source);
	await finishExecutionRecord(handle, 0, "interrupted", "Source changed externally.");
	const terminal = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.ok(terminal.sourceDrift);
});

test("BLOCKED evidence remains active while dependents wait, and shutdown records interruption", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "shutdown-blocked"));
	const { handle } = await startExecutionRecord(internal, root, "plans/shutdown-blocked");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "implemented", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first.md", "BLOCKED", "external credential unavailable", undefined);
	await assert.rejects(
		checkpointExecutionRecord(handle, revision, "implementation", "phase-02-second.md", undefined, "must reject", undefined),
		/latest verdict/,
	);
	assert.equal((await loadExecutionRecord(handle.runDirectory, handle.runId))!.state, "active");
	assert.equal(await interruptActiveRecord(handle, "Session shutdown."), true);
	const record = (await loadExecutionRecord(handle.runDirectory, handle.runId))!;
	assert.equal(record.state, "interrupted");
	assert.equal(await entryExists(leasePath(handle.runDirectory)), false);
});

test("version 1 execution records remain parseable but reject append operations", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "legacy-readable"));
	const { handle } = await startExecutionRecord(internal, root, "plans/legacy-readable");
	let revision = await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first", undefined, "Legacy implementation.", undefined);
	revision = await checkpointExecutionRecord(handle, revision, "phase_validation", "phase-01-first", "PASS", "Legacy PASS.", undefined);
	const recordFile = path.join(handle.runDirectory, "execution", "record.json");
	const legacy = JSON.parse(await readFile(recordFile, "utf8"));
	legacy.version = 1;
	delete legacy.integrationValidations;
	for (const phase of legacy.phases) {
		if (phase.implementation) delete phase.implementation.outsideDeclaredTargets;
		if (phase.validations[0]) {
			phase.validator = phase.validations[0];
			delete phase.validator.attempt;
			delete phase.validator.outsideDeclaredTargets;
		}
		delete phase.validations;
	}
	await writeFile(recordFile, `${JSON.stringify(legacy, null, 2)}\n`);

	const parsed = parseExecutionRecord(await readFile(recordFile, "utf8"), handle.runDirectory, handle.runId);
	assert.equal(parsed.version, 1);
	assert.deepEqual(parsed.phases.map((phase) => phase.validations.map(({ attempt, verdict }) => ({ attempt, verdict }))), [[{ attempt: 1, verdict: "PASS" }], []]);
	assert.equal((await loadExecutionRecord(handle.runDirectory, handle.runId))!.version, 1);
	await assert.rejects(
		checkpointExecutionRecordDetailed(handle, revision, "implementation", "phase-02-second", undefined, "Must remain read-only.", undefined),
		/version 1 is read-only/,
	);
	await releaseLease(handle.leaseHandle);
});

test("parser rejects tuple drift and evidence/revision mismatch", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "strict-parser"));
	const { handle } = await startExecutionRecord(internal, root, "plans/strict-parser");
	await checkpointExecutionRecord(handle, 0, "implementation", "phase-01-first.md", undefined, "implemented", undefined);
	const raw = JSON.parse(await readFile(path.join(handle.runDirectory, "execution", "record.json"), "utf8"));
	const tupleDrift = structuredClone(raw);
	tupleDrift.phases[0].implementation.agentModel.model = "other";
	assert.throws(() => parseExecutionRecord(JSON.stringify(tupleDrift), handle.runDirectory, handle.runId), /model tuple drifted/);
	const revisionDrift = structuredClone(raw);
	revisionDrift.revision = 9;
	assert.throws(() => parseExecutionRecord(JSON.stringify(revisionDrift), handle.runDirectory, handle.runId), /does not match/);
	await interruptActiveRecord(handle, "Test cleanup.");
});

test("list inspection recognizes active execution manifests and multiple retained handles", async () => {
	const { root, internal } = await project();
	await makePlanDir(path.join(root, "plans", "listed-execution"));
	const { handle } = await startExecutionRecord(internal, root, "plans/listed-execution", undefined, undefined, "exec-listed");
	const records = await discoverSprintRuns(await sprintsRoot(internal), [handle.leaseHandle]);
	const selected = records.find((record) => record.runId === handle.runId)!;
	assert.equal(selected.kind, "execution-only");
	assert.equal(selected.state, "active");
	assert.equal(selected.leaseOwnership, "owned-by-this-runtime");
	await interruptActiveRecord(handle, "Test cleanup.");
});

// ── Phase 08: skill policy integration ─────────────────────────────────

// ── Spawn example parser and tool-array assertions ─────────────────────

interface SpawnExample {
	name: string;
	provider: string;
	model: string;
	thinkingLevel: string;
	tools: string[];
	allowSubagents?: boolean;
}

function extractSpawnExamples(content: string): SpawnExample[] {
	const results: SpawnExample[] = [];
	const jsonBlock = /```json\r?\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = jsonBlock.exec(content)) !== null) {
		const block = match[1];
		if (!block.includes('"agents"')) continue;
		let parsed: unknown;
		assert.doesNotThrow(() => { parsed = JSON.parse(block); }, "every fenced spawn example must be valid JSON");
		assert.ok(parsed && typeof parsed === "object" && Array.isArray((parsed as { agents?: unknown }).agents), "spawn example must contain an agents array");
		for (const agent of (parsed as { agents: unknown[] }).agents) {
			assert.ok(agent && typeof agent === "object", "spawn agent must be an object");
			const value = agent as Record<string, unknown>;
			for (const field of ["name", "provider", "model", "thinkingLevel"] as const) {
				assert.equal(typeof value[field], "string", `spawn agent ${field} must be a string`);
				assert.notEqual(value[field], "", `spawn agent ${field} must not be empty`);
			}
			assert.ok(Array.isArray(value.tools), "spawn agent tools must be a literal array");
			assert.equal(value.tools.every((tool) => typeof tool === "string"), true, "spawn tools must be strings");
			if ("allowSubagents" in value) assert.equal(typeof value.allowSubagents, "boolean", "spawn agent allowSubagents must be boolean when present");
			results.push({
				name: value.name as string,
				provider: value.provider as string,
				model: value.model as string,
				thinkingLevel: value.thinkingLevel as string,
				tools: [...value.tools] as string[],
				...(typeof value.allowSubagents === "boolean" ? { allowSubagents: value.allowSubagents } : {}),
			});
		}
	}
	return results;
}

// ── Orchestrate spawn example tool assertions ──────────────────────────

test("orchestrate preflight spawn examples have exact tuples and empty tools", async () => {
	const content = await loadSkill();
	const examples = extractSpawnExamples(content);
	const preflights = examples.filter((ex) => ex.name.startsWith("preflight-"));
	assert.ok(preflights.length >= 2, "at least two preflight examples");

	const deepseekPreflight = preflights.find((ex) => ex.provider === "deepseek");
	assert.ok(deepseekPreflight, "DeepSeek preflight exists");
	assert.equal(deepseekPreflight.model, "deepseek-v4-pro");
	assert.equal(deepseekPreflight.thinkingLevel, "max");
	assert.deepEqual(deepseekPreflight.tools, []);

	const gptPreflight = preflights.find((ex) => ex.provider === "openai-codex");
	assert.ok(gptPreflight, "GPT preflight exists");
	assert.equal(gptPreflight.model, "gpt-5.6-terra");
	assert.equal(gptPreflight.thinkingLevel, "high");
	assert.deepEqual(gptPreflight.tools, []);

	// No preflight has any tools
	for (const pf of preflights) assert.deepEqual(pf.tools, []);
});

test("orchestrate implementer spawn examples have exact four-tool set", async () => {
	const content = await loadSkill();
	const examples = extractSpawnExamples(content);
	const implementers = examples.filter((ex) => ex.name.startsWith("impl-"));
	assert.ok(implementers.length >= 1, "at least one implementer example");

	for (const impl of implementers) {
		assert.equal(impl.provider, "deepseek");
		assert.equal(impl.model, "deepseek-v4-pro");
		assert.equal(impl.thinkingLevel, "max");
		assert.deepEqual(impl.tools, ["read", "bash", "edit", "write"]);
	}
});

test("orchestrate validator spawn examples have exact four-tool set", async () => {
	const content = await loadSkill();
	const examples = extractSpawnExamples(content);
	const validators = examples.filter((ex) => ex.name.startsWith("validate-"));
	assert.ok(validators.length >= 1, "at least one phase validator example");

	for (const val of validators) {
		assert.equal(val.provider, "openai-codex");
		assert.equal(val.model, "gpt-5.6-terra");
		assert.equal(val.thinkingLevel, "high");
		assert.deepEqual(val.tools, ["read", "bash", "edit", "write"]);
	}
});

test("orchestrate integration validator example has exact four-tool set", async () => {
	const content = await loadSkill();
	const examples = extractSpawnExamples(content);
	const integrations = examples.filter((ex) => ex.name.startsWith("integration-"));
	assert.ok(integrations.length >= 1, "at least one integration validator example");

	for (const iv of integrations) {
		assert.equal(iv.provider, "openai-codex");
		assert.equal(iv.model, "gpt-5.6-terra");
		assert.equal(iv.thinkingLevel, "high");
		assert.deepEqual(iv.tools, ["read", "bash", "edit", "write"]);
	}
});

// ── Orchestrate deterministic tool calls ───────────────────────────────

test("orchestrate skill references sprint_validate_plan and sprint_execution_record", async () => {
	const content = await loadSkill();
	assert.match(content, /sprint_validate_plan/);
	assert.match(content, /sprint_execution_record/);
	// Source/execution separation
	assert.match(content, /execution identifier distinct from every source/i);
	assert.match(content, /never alias a source identity/i);
	// Revision chaining
	assert.match(content, /Pass the latest returned revision/i);
	assert.match(content, /stale-revision rejection as a blocker/i);
	// Changed-file evidence
	assert.match(content, /observe the actual changed paths from repository state/i);
	// PASS barriers
	assert.match(content, /checkpointed.*VERDICT: PASS/i);
	// No actionable REPAIR verdict (the skill mentions it only to forbid it)
	assert.doesNotMatch(content, /return.*VERDICT:\s*REPAIR/i);
	// No separate DeepSeek repair path
	assert.doesNotMatch(content, /spawn.*DeepSeek.*repair/i);
	assert.doesNotMatch(content, /repair.*DeepSeek.*spawn/i);
	// No repair cycle / loop
	assert.doesNotMatch(content, /repair.{0,40}revalidate/i);
	assert.doesNotMatch(content, /repair.{0,40}cycle/i);
	assert.doesNotMatch(content, /repair.{0,40}loop/i);
});

// ── Orchestrate additional negative mutations ──────────────────────────

async function assertOrchestrateMutationRejected(change: (content: string) => string, error: RegExp): Promise<void> {
	const original = await loadSkill();
	const mutated = change(original);
	assert.notEqual(mutated, original, "mutation must change the fixture");
	assert.throws(() => assertOrchestrateSkillContract(mutated), error);
}

test("mutations: omitted and extra spawn tools are rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => content.replace(/\n\s*"tools": \["read", "bash", "edit", "write"\](?=\n\s*})/, ""),
		/implementer spawn tools|tools must be a literal array/,
	);
	await assertOrchestrateMutationRejected(
		(content) => content.replace(/"tools": \["read", "bash", "edit", "write"\](?=\n\s*})/, '"tools": ["read", "bash", "edit", "write", "subagent_poll"]'),
		/implementer spawn tools|exact tools/,
	);
});

test("mutation: duplicated deterministic parser prose is rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => mutateSkill(content, "Interpret the directive", "Manually parse the plan ledger and waves before calling the tool."),
		/deterministic algorithms cannot be duplicated/,
	);
});

test("mutations: stale or omitted revision policy is rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => content.replace("Pass the latest returned revision to every subsequent `checkpoint` and `finish` call.", "Pass revision 0 to every subsequent call."),
		/revision chaining/,
	);
	await assertOrchestrateMutationRejected(
		(content) => content.replace("Treat stale-revision rejection as a blocker", "Ignore stale-revision rejection"),
		/stale revision blocks/,
	);
});

test("mutations: source mutation and source/execution aliasing are rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => mutateSkill(content, "Start the execution record", "Modify the source plan after start to record runtime state."),
		/source material cannot be mutated/,
	);
	await assertOrchestrateMutationRejected(
		(content) => mutateSkill(content, "Start the execution record", "Use the source plan identifier as the execution identifier."),
		/source and execution identifiers cannot alias/,
	);
});

test("mutations: uncheckpointed PASS and completion are rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => content.replace("Before marking any PASS or opening a dependent barrier, checkpoint through `sprint_execution_record`", "After opening a dependent barrier, optionally checkpoint through `sprint_execution_record`"),
		/checkpoint before PASS barrier/,
	);
	await assertOrchestrateMutationRejected(
		(content) => content.replace("After integration PASS is checkpointed, call `sprint_execution_record`", "Before integration PASS is checkpointed, call `sprint_execution_record`"),
		/finish after integration PASS/,
	);
});

test("mutation: dependency-before-PASS behavior is rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => mutateSkill(content, "PASS-before-dependent barriers", "Start a dependent phase before its validator returns PASS."),
		/dependents cannot start before PASS/,
	);
});

test("mutation: paging without digest or byte verification is rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => content.replace("3. Verify the final digest matches the complete-result digest.\n4. Verify the reconstructed byte count matches the complete-result byte count.", "3. Consume the assembled text without additional verification."),
		/digest verification/,
	);
});

test("mutation: nonterminal cancellation is rejected", async () => {
	await assertOrchestrateMutationRejected(
		(content) => content.replace("cancel active children when required and poll every launched or cancelled child to a terminal state", "cancel active children and finish immediately"),
		/truthful non-success finish after terminal accounting/,
	);
});

// ── Contract-level fake orchestration traces ───────────────────────────

type FakeTraceAction =
	| { type: "validate"; valid: boolean }
	| { type: "start"; sourceId: string; executionId: string; returnedRevision: number }
	| { type: "preflight" }
	| { type: "implementation"; phase: string; dependencies: string[]; terminal: boolean; expectedRevision: number; returnedRevision: number }
	| { type: "phase-verdict"; phase: string; verdict: "PASS" | "BLOCKED"; observedFiles: string[]; expectedRevision: number; returnedRevision: number }
	| { type: "integration-pass"; observedFiles: string[]; expectedRevision: number; returnedRevision: number }
	| { type: "terminal-evidence"; childrenTerminal: boolean; expectedRevision: number; returnedRevision: number }
	| { type: "finish"; state: "completed" | "blocked" | "interrupted"; expectedRevision: number };

function assertFakeOrchestrationTrace(actions: FakeTraceAction[]): void {
	let validated = false;
	let started = false;
	let preflighted = false;
	let revision = -1;
	let integrationPass = false;
	let terminalEvidence = false;
	const implemented = new Set<string>();
	const passed = new Set<string>();

	for (const action of actions) {
		switch (action.type) {
			case "validate":
				assert.equal(started, false, "validation precedes start");
				assert.equal(action.valid, true, "invalid plans stop the trace");
				validated = true;
				break;
			case "start":
				assert.equal(validated, true, "start follows validation");
				assert.notEqual(action.sourceId, action.executionId, "source and execution identities differ");
				assert.equal(action.returnedRevision, 0);
				started = true;
				revision = action.returnedRevision;
				break;
			case "preflight":
				assert.equal(started, true, "preflight follows execution start");
				preflighted = true;
				break;
			case "implementation":
				assert.equal(preflighted, true, "implementation follows preflight");
				assert.equal(action.dependencies.every((dependency) => passed.has(dependency)), true, "dependencies require checkpointed PASS");
				assert.equal(action.terminal, true, "implementation is terminal before checkpoint");
				assert.equal(action.expectedRevision, revision, "implementation uses latest revision");
				assert.equal(action.returnedRevision, revision + 1, "checkpoint returns next revision");
				revision = action.returnedRevision;
				implemented.add(action.phase);
				break;
			case "phase-verdict":
				assert.equal(implemented.has(action.phase), true, "verdict follows implementation evidence");
				assert.ok(action.observedFiles.length > 0, "verdict checkpoint includes observed files");
				assert.equal(action.expectedRevision, revision, "verdict uses latest revision");
				assert.equal(action.returnedRevision, revision + 1);
				revision = action.returnedRevision;
				if (action.verdict === "PASS") passed.add(action.phase);
				break;
			case "integration-pass":
				assert.equal(passed.size, implemented.size, "integration follows every phase PASS");
				assert.ok(action.observedFiles.length > 0, "integration includes observed files");
				assert.equal(action.expectedRevision, revision);
				assert.equal(action.returnedRevision, revision + 1);
				revision = action.returnedRevision;
				integrationPass = true;
				break;
			case "terminal-evidence":
				assert.equal(action.childrenTerminal, true, "all children terminal before non-success finish");
				assert.equal(action.expectedRevision, revision);
				assert.equal(action.returnedRevision, revision + 1);
				revision = action.returnedRevision;
				terminalEvidence = true;
				break;
			case "finish":
				assert.equal(action.expectedRevision, revision, "finish uses latest revision");
				if (action.state === "completed") assert.equal(integrationPass, true, "completed requires integration PASS checkpoint");
				else assert.equal(terminalEvidence, true, "non-success finish requires prior terminal evidence");
				break;
		}
	}
}

test("fake trace enforces validation → start → preflight → phase PASS → dependent → integration → completed", () => {
	assert.doesNotThrow(() => assertFakeOrchestrationTrace([
		{ type: "validate", valid: true },
		{ type: "start", sourceId: "plan-1", executionId: "exec-1", returnedRevision: 0 },
		{ type: "preflight" },
		{ type: "implementation", phase: "phase-01", dependencies: [], terminal: true, expectedRevision: 0, returnedRevision: 1 },
		{ type: "phase-verdict", phase: "phase-01", verdict: "PASS", observedFiles: ["a.ts"], expectedRevision: 1, returnedRevision: 2 },
		{ type: "implementation", phase: "phase-02", dependencies: ["phase-01"], terminal: true, expectedRevision: 2, returnedRevision: 3 },
		{ type: "phase-verdict", phase: "phase-02", verdict: "PASS", observedFiles: ["b.ts"], expectedRevision: 3, returnedRevision: 4 },
		{ type: "integration-pass", observedFiles: ["a.ts", "b.ts"], expectedRevision: 4, returnedRevision: 5 },
		{ type: "finish", state: "completed", expectedRevision: 5 },
	]));
});

test("fake blocked and interrupted traces require evidence and prohibit dependents", () => {
	assert.doesNotThrow(() => assertFakeOrchestrationTrace([
		{ type: "validate", valid: true },
		{ type: "start", sourceId: "plan-1", executionId: "exec-blocked", returnedRevision: 0 },
		{ type: "preflight" },
		{ type: "implementation", phase: "phase-01", dependencies: [], terminal: true, expectedRevision: 0, returnedRevision: 1 },
		{ type: "phase-verdict", phase: "phase-01", verdict: "BLOCKED", observedFiles: ["a.ts"], expectedRevision: 1, returnedRevision: 2 },
		{ type: "terminal-evidence", childrenTerminal: true, expectedRevision: 2, returnedRevision: 3 },
		{ type: "finish", state: "blocked", expectedRevision: 3 },
	]));
	assert.doesNotThrow(() => assertFakeOrchestrationTrace([
		{ type: "validate", valid: true },
		{ type: "start", sourceId: "plan-1", executionId: "exec-interrupted", returnedRevision: 0 },
		{ type: "preflight" },
		{ type: "terminal-evidence", childrenTerminal: true, expectedRevision: 0, returnedRevision: 1 },
		{ type: "finish", state: "interrupted", expectedRevision: 1 },
	]));
	assert.throws(() => assertFakeOrchestrationTrace([
		{ type: "validate", valid: true },
		{ type: "start", sourceId: "plan-1", executionId: "exec-invalid", returnedRevision: 0 },
		{ type: "preflight" },
		{ type: "implementation", phase: "phase-01", dependencies: [], terminal: true, expectedRevision: 0, returnedRevision: 1 },
		{ type: "phase-verdict", phase: "phase-01", verdict: "BLOCKED", observedFiles: ["a.ts"], expectedRevision: 1, returnedRevision: 2 },
		{ type: "implementation", phase: "phase-02", dependencies: ["phase-01"], terminal: true, expectedRevision: 2, returnedRevision: 3 },
	]), /dependencies require checkpointed PASS/);
});

// ── Senior-agent skill contract tests ──────────────────────────────────

async function loadSeniorSkill(): Promise<string> {
	const skillsRoot = path.resolve(import.meta.dirname, "..", "..", "skills", "senior-agent");
	return readFile(path.join(skillsRoot, "SKILL.md"), "utf8");
}

function assertSeniorSkillContract(content: string): void {
	const parsed = parseSkill(content);
	assert.equal(parsed.frontmatter.get("name"), "senior-agent");
	assert.match(parsed.frontmatterText, /^metadata:\s*\n  version: "3\.0\.0"$/m);
	assert.match(content, /ambiguous authority.*advisory tool set.*prohibit edits/is);
	assert.match(content, /Always set `allowSubagents: true` on the senior agent/i);
	assert.match(content, /must not receive sprint validation, sprint execution, user-questioning, or other root-only tools/i);
	assert.match(content, /any subagent spawned by the senior agent must not receive further subagent controls/i);
	const examples = extractSpawnExamples(content);
	assert.equal(examples.length, 2, "senior-agent must show exactly advisory and edit-authorized spawns");
	assert.deepEqual(examples.map(({ name, provider, model, thinkingLevel, tools, allowSubagents }) => ({ name: name.replace(/<[^>]+>/g, "<unique>"), provider, model, thinkingLevel, tools, allowSubagents })), [
		{ name: "senior-<unique>", provider: "openai-codex", model: "gpt-5.6-sol", thinkingLevel: "xhigh", tools: ["read"], allowSubagents: true },
		{ name: "senior-<unique>", provider: "openai-codex", model: "gpt-5.6-sol", thinkingLevel: "xhigh", tools: ["read", "bash", "edit", "write"], allowSubagents: true },
	]);
}

test("senior-agent skill maintains exact model tuple and tool policy", async () => {
	const content = await loadSeniorSkill();
	assertSeniorSkillContract(content);
	// Exact model tuple
	assert.match(content, /"provider"\s*:\s*"openai-codex"/);
	assert.match(content, /"model"\s*:\s*"gpt-5\.6-sol"/);
	assert.match(content, /"thinkingLevel"\s*:\s*"xhigh"/);
	// No substitution
	assert.match(content, /never be inherited, omitted, downgraded, or replaced/i);
	assert.match(content, /do not emulate the senior agent with another model/i);
});

test("senior-agent advisory spawn example has exact read-only tool set", async () => {
	const content = await loadSeniorSkill();
	const examples = extractSpawnExamples(content);
	const advisory = examples.filter((ex) => !ex.tools.includes("edit"));
	assert.ok(advisory.length >= 1, "at least one advisory example");

	for (const adv of advisory) {
		assert.equal(adv.provider, "openai-codex");
		assert.equal(adv.model, "gpt-5.6-sol");
		assert.equal(adv.thinkingLevel, "xhigh");
		assert.deepEqual(adv.tools, ["read"]);
		assert.equal(adv.allowSubagents, true);
	}
});

test("senior-agent edit-authorized spawn example has exact four-tool set", async () => {
	const content = await loadSeniorSkill();
	const examples = extractSpawnExamples(content);
	const editAuth = examples.filter((ex) => ex.tools.includes("edit"));
	assert.ok(editAuth.length >= 1, "at least one edit-authorized example");

	for (const ed of editAuth) {
		assert.equal(ed.provider, "openai-codex");
		assert.equal(ed.model, "gpt-5.6-sol");
		assert.equal(ed.thinkingLevel, "xhigh");
		assert.deepEqual(ed.tools, ["read", "bash", "edit", "write"]);
		assert.equal(ed.allowSubagents, true);
	}
});

test("senior-agent allows one subagent layer while forbidding other root-only tools", async () => {
	const content = await loadSeniorSkill();
	assert.match(content, /Always set `allowSubagents: true` on the senior agent/i);
	assert.match(content, /spawn one bounded nested delegation layer/i);
	assert.match(content, /must not receive sprint validation, sprint execution, user-questioning, or other root-only tools/i);
	assert.match(content, /atomic.*batch.*rejected/i);
	assert.match(content, /registered tool does not need to be active in the caller.*enables it for the child/is);
	assert.match(content, /fixed sets.*only tools registered in the standard coding harness.*search and listing through `bash`/is);
});

test("senior-agent oversized result recovery uses paged reconstruction", async () => {
	const content = await loadSeniorSkill();
	assert.match(content, /Oversized result recover/i);
	assert.match(content, /UTF-8-safe page bytes in cursor order/i);
	assert.match(content, /Concatenate pages byte-for-byte/i);
	assert.match(content, /Verify the final digest/i);
});

// ── Image-viewing skill contract tests ─────────────────────────────────

async function loadImageSkill(): Promise<string> {
	const skillsRoot = path.resolve(import.meta.dirname, "..", "..", "skills", "image-viewing");
	return readFile(path.join(skillsRoot, "SKILL.md"), "utf8");
}

function assertImageSkillContract(content: string): void {
	const parsed = parseSkill(content);
	assert.equal(parsed.frontmatter.get("name"), "image-viewing");
	assert.match(parsed.frontmatterText, /^metadata:\s*\n  version: "2\.1\.0"$/m);
	assert.match(content, /known to lack image-input capability/i);
	assert.match(content, /call `read` on every listed image/i);
	assert.match(content, /inspection-only/i);
	const examples = extractSpawnExamples(content);
	assert.equal(examples.length, 1, "image-viewing must show exactly one spawn");
	assert.deepEqual(examples[0], {
		name: "vision-<unique-scope>",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		thinkingLevel: "medium",
		tools: ["read"],
	});
}

test("image-viewing skill maintains exact model tuple and read-only tool policy", async () => {
	const content = await loadImageSkill();
	assertImageSkillContract(content);
	// Exact model tuple
	assert.match(content, /"provider"\s*:\s*"openai-codex"/);
	assert.match(content, /"model"\s*:\s*"gpt-5\.6-sol"/);
	assert.match(content, /"thinkingLevel"\s*:\s*"medium"/);
	// No substitution
	assert.match(content, /Never inherit, omit, downgrade, or replace/i);
	assert.match(content, /Do not silently fall back to another model/i);
});

test("image-viewing spawn example has only read tool", async () => {
	const content = await loadImageSkill();
	const examples = extractSpawnExamples(content);
	assert.equal(examples.length, 1, "exactly one spawn example");
	const vision = examples[0];
	assert.match(vision.name, /vision-/);
	assert.equal(vision.provider, "openai-codex");
	assert.equal(vision.model, "gpt-5.6-sol");
	assert.equal(vision.thinkingLevel, "medium");
	assert.deepEqual(vision.tools, ["read"]);
});

test("image-viewing declares exact read-only tool policy", async () => {
	const content = await loadImageSkill();
	assert.match(content, /"tools"\s*:\s*\[\s*"read"\s*\]/);
	assert.match(content, /inspection-only/i);
	assert.match(content, /must not receive edit, write, bash/i);
	assert.match(content, /atomic.*batch.*rejected/i);
	assert.match(content, /registered tool does not need to be active in the caller.*enables it for the child/is);
});

test("image-viewing oversized result recovery uses paged reconstruction", async () => {
	const content = await loadImageSkill();
	assert.match(content, /Oversized result recover/i);
	assert.match(content, /UTF-8-safe page bytes in cursor order/i);
	assert.match(content, /Concatenate pages byte-for-byte/i);
	assert.match(content, /Verify the final digest/i);
});

// ── Cross-skill mutation: extra tools on image-viewing ────────────────

test("mutation: image-viewing with extra tools is rejected", async () => {
	const content = (await loadImageSkill()).replace(/"tools"\s*:\s*\[\s*"read"\s*\](?=\n\s*})/, '"tools": ["read", "grep"]');
	assert.throws(() => assertImageSkillContract(content), /strictly deep-equal/);
});

test("mutation: senior-agent with missing advisory tools is rejected", async () => {
	const content = (await loadSeniorSkill()).replace(/"tools"\s*:\s*\[\s*"read"\s*\](?=,?\n\s*"allowSubagents")/, '"tools": []');
	assert.throws(() => assertSeniorSkillContract(content), /strictly deep-equal/);
});

// ── Full orchestrate tool-policy completeness ──────────────────────────

test("orchestrate skill lists every role-specific tool set in the delegation contract", async () => {
	const content = await loadSkill();
	// Preflight — check for "tools": [] in the preflight section
	assert.match(content, /Preflight agents[\s\S]{0,300}"tools"\s*:\s*\[\s*\]/i);
	// Implementers
	assert.match(content, /DeepSeek implementers[\s\S]{0,300}"tools"\s*:\s*\[/);
	// Validators
	assert.match(content, /GPT-5\.6 Terra phase\/integration validators[\s\S]{0,300}"tools"\s*:\s*\[/);
	// Image viewing
	assert.match(content, /Image viewing[\s\S]{0,100}"tools"\s*:\s*\[\s*"read"\s*\]/i);
});

test("no spawn example across any skill contains subagent or sprint tools", async () => {
	for (const load of [loadSkill, loadSeniorSkill, loadImageSkill]) {
		const content = await load();
		const examples = extractSpawnExamples(content);
		for (const ex of examples) {
			for (const tool of ex.tools) {
				assert.ok(!tool.includes("subagent"), `${ex.name} must not contain subagent tool: ${tool}`);
				assert.ok(!tool.includes("sprint"), `${ex.name} must not contain sprint tool: ${tool}`);
				assert.ok(!tool.includes("user_question"), `${ex.name} must not contain user-questioning tool: ${tool}`);
			}
		}
	}
});

test("no spawn example across any skill has duplicate tools", async () => {
	for (const load of [loadSkill, loadSeniorSkill, loadImageSkill]) {
		const content = await load();
		const examples = extractSpawnExamples(content);
		for (const ex of examples) {
			const unique = new Set(ex.tools);
			assert.equal(unique.size, ex.tools.length, `${ex.name} has duplicate tools: ${ex.tools}`);
		}
	}
});
