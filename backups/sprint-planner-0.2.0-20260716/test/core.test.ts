import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	acceptWorkflowInput,
	BRAINSTORM_HEADINGS,
	BRAINSTORM_LIFECYCLE_REQUIREMENT,
	BRAINSTORM_TOOL_GUIDELINES,
	CONCEPT_HEADINGS,
	createSprintRun,
	deleteSprintRun,
	HANDOFF_HEADINGS,
	MODEL_ROUTES,
	parseCommand,
	PHASE_HEADINGS,
	REVIEW_HEADINGS,
	RunArtifactStore,
	safeSessionId,
	SprintPlannerEngine,
	SprintStateStore,
	validateBrainstormFindings,
	validateHandoff,
	validatePlanDirectory,
	validatePlanFiles,
	validateSynthesisCoverage,
	type WorkerRequest,
	type WorkerResult,
	type WorkflowRunner,
} from "../core.ts";

test("worker session ids respect the provider prompt-cache key limit", () => {
	const id = safeSessionId(`20260715-194048-${"long-directive-".repeat(8)}-ironout-author`);
	assert.equal(id.length, 64);
	assert.match(id, /^[a-z0-9-]+$/);
});

function markdown(title: string, headings: readonly string[]): string {
	return [`# ${title}`, "", ...headings.flatMap((heading) => [`## ${heading}`, "", `${heading} content.`, ""])].join("\n");
}

const concepts = markdown("Concepts", CONCEPT_HEADINGS);
const phase1 = markdown("Phase 1", PHASE_HEADINGS);
const phase2 = markdown("Phase 2", PHASE_HEADINGS);

async function project() {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-sprint-planner-"));
	const internal = path.join(root, ".internal-dev");
	for (const store of ["sprints", "brainstorm", "handoffs", "plans", "reviews"]) await mkdir(path.join(internal, store), { recursive: true });
	return { root, internal };
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
			};
		}
		if (request.role === "brainstorm synthesizer") {
			const sources = request.contextPaths.filter((item) => item.endsWith("/findings.md"));
			return { ok: true, submission: { kind: "markdown", content: markdown("Synthesis", BRAINSTORM_HEADINGS).replace("Source content.", sources.join("\n")) }, sessionPath: request.sessionPath };
		}
		if (request.role.includes("ironout reviewer")) {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Review", REVIEW_HEADINGS) }, { path: "handoff.md", content: markdown("Handoff", HANDOFF_HEADINGS) }] }, sessionPath: request.sessionPath };
		}
		if (request.role === "advanced planner") {
			return { ok: true, submission: { kind: "files", files: [{ path: "concepts.md", content: concepts }, { path: "phase-01-first.md", content: phase1 }, { path: "phase-02-second.md", content: phase2 }] }, sessionPath: request.sessionPath };
		}
		if (request.role === "advanced concepts reviewer") {
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown("Concept Review", REVIEW_HEADINGS) }, { path: "concepts.md", content: concepts }] }, sessionPath: request.sessionPath };
		}
		if (request.role.startsWith("advanced phase reviewer:")) {
			const phasePath = request.expectation.requiredPaths!.find((item) => item !== "review.md")!;
			return { ok: true, submission: { kind: "files", files: [{ path: "review.md", content: markdown(`Review ${phasePath}`, REVIEW_HEADINGS) }, { path: phasePath, content: phasePath.includes("01-") ? phase1 : phase2 }] }, sessionPath: request.sessionPath };
		}
		if (request.expectation.kind === "markdown") {
			const headings = request.expectation.headings?.artifact ?? BRAINSTORM_HEADINGS;
			return { ok: true, submission: { kind: "markdown", content: markdown(request.role, headings) }, sessionPath: request.sessionPath };
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
			return { ok: true, submission: { kind: "roles", content: "not json" }, sessionPath: request.sessionPath };
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
			const abort = () => resolve({ ok: false, error: "cancelled", failureKind: "cancelled", sessionPath: request.sessionPath });
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		});
	}
}

class CrossReviewFailureRunner extends FakeRunner {
	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		if (request.id.includes("-cross-")) {
			this.requests.push(structuredClone(request));
			return { ok: false, error: "cross-review unavailable", failureKind: "fatal", sessionPath: request.sessionPath };
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

test("model routing contains only planning responsibilities with exact tuples", () => {
	assert.deepEqual(Object.keys(MODEL_ROUTES), [
		"roleRouter",
		"brainstormWorker",
		"brainstormSynthesis",
		"brainstormRedTeam",
		"ironoutAuthor",
		"ironoutReviewer",
		"advancedPlanner",
		"advancedAdvisor",
		"advancedReviewer",
	]);
	for (const route of Object.values(MODEL_ROUTES)) {
		if (route.model === "deepseek-v4-pro") assert.deepEqual(route, { provider: "deepseek", model: "deepseek-v4-pro", thinking: "max" });
		else assert.equal(route.provider, "openai-codex"), assert.equal(route.model, "gpt-5.6-sol");
	}
	assert.equal(MODEL_ROUTES.ironoutReviewer.thinking, "xhigh");
	assert.equal(MODEL_ROUTES.advancedAdvisor.thinking, "max");
});

test("plan validation enforces a flat concepts plus contiguous phases publication", () => {
	validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "phase-01-first.md", content: phase1 }]);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "nested/phase-01-first.md", content: phase1 }]), /flat/);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "phase-02-second.md", content: phase2 }]), /contiguous/);
	assert.throws(() => validatePlanFiles([{ path: "concepts.md", content: concepts }, { path: "phase-01-first.md", content: phase1.replace("## Context", "## Background") }]), /phase-01-first\.md: Context/);
});

test("between-stage validators name missing brainstorm, synthesis, handoff, and directory contracts", async () => {
	const finding = markdown("Finding", BRAINSTORM_HEADINGS);
	assert.throws(() => validateBrainstormFindings([{ path: "lens-1/findings.md", content: finding }], ["lens-1/findings.md", "lens-2/findings.md"]), /missing lens-2\/findings\.md/);
	assert.throws(() => validateBrainstormFindings([{ path: "lens-1/findings.md", content: finding.replace("## Trade-offs", "## Costs") }], ["lens-1/findings.md"]), /lens-1\/findings\.md: Trade-offs/);
	assert.throws(() => validateSynthesisCoverage(markdown("Synthesis", BRAINSTORM_HEADINGS).replace("Source content.", "lens-1/findings.md"), ["lens-1/findings.md", "lens-2/findings.md"]), /Source is missing findings report lens-2\/findings\.md/);
	assert.throws(() => validateHandoff(markdown("Handoff", HANDOFF_HEADINGS).replace("## Validation", "## Checks")), /handoff\.md: Validation/);

	const root = await mkdtemp(path.join(os.tmpdir(), "pi-plan-contract-"));
	await writeFile(path.join(root, "concepts.md"), concepts);
	await writeFile(path.join(root, "phase-01-first.md"), phase1);
	await validatePlanDirectory(root);
	await writeFile(path.join(root, ".state.json"), "{}");
	await assert.rejects(validatePlanDirectory(root), /unexpected entry \.state\.json/);
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
	assert.deepEqual((await readdir(path.join(run, "planning"))).sort(), ["concepts.md", "phase-01-first.md", "phase-02-second.md"]);
	const conceptReview = runner.requests.find((request) => request.role === "advanced concepts reviewer")!;
	const phaseReviews = runner.requests.filter((request) => request.role.startsWith("advanced phase reviewer:"));
	assert.equal(conceptReview.model.thinking, "xhigh");
	assert.equal(phaseReviews.length, 2);
	assert.equal(phaseReviews.every((request) => request.model.thinking === "xhigh" && request.contextPaths.length === 2), true);
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

	const resumed = await new SprintPlannerEngine(new FakeRunner()).resumeSprint(path.join(internal, "sprints", "paused"));
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
	await assert.rejects(new SprintPlannerEngine(new FakeRunner()).resumeSprint(directory), /original sprint input is missing or changed/i);
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
	assert.deepEqual((await readdir(plan)).sort(), ["concepts.md", "phase-01-first.md", "phase-02-second.md"]);
	assert.equal(await entryExists(path.join(internal, ".state.json")), false);
});

test("package installs the orchestrate skill while the extension omits the orchestrate command", async () => {
	const packageRoot = path.resolve(import.meta.dirname, "..");
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.skills, ["./skills"]);

	const extension = await readFile(path.join(packageRoot, "index.ts"), "utf8");
	assert.doesNotMatch(extension, /registerCommand\(["']orchestrate["']/);
	assert.match(extension, /\["ironout", "advanceplan"\]/);
	const runner = await readFile(path.join(packageRoot, "pi-runner.ts"), "utf8");
	assert.match(runner, /const builtins = isolated \? \[\] : \["read", "grep", "find", "ls"\]/);
	assert.doesNotMatch(runner, /sprint_report_toolchain_blocker|"bash", "edit", "write"/);

	const skill = await readFile(path.join(packageRoot, "skills", "orchestrate", "SKILL.md"), "utf8");
	assert.match(skill, /^name: orchestrate$/m);
	assert.match(skill, /model`: `deepseek-v4-pro`[\s\S]*thinkingLevel`: `max`/);
	assert.match(skill, /model`: `gpt-5\.6-sol`[\s\S]*thinkingLevel`: `xhigh`/);
	assert.match(skill, /Validation of \*\*every phase\*\*/);
	assert.match(skill, /concepts\.md[\s\S]*phase-NN-\*\.md/);
	assert.match(skill, /Run phases in parallel only/);
	assert.match(skill, /Final integration gate/);
	assert.match(skill, /Do not claim extension-owned background execution/);
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

async function entryExists(selected: string): Promise<boolean> {
	try {
		await stat(selected);
		return true;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") return false;
		throw error;
	}
}
