import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	publishJobPlan,
	renderJobPlan,
	safeSlug,
	validateQuestions,
	type JobPlanInput,
} from "../core.ts";

const plan: JobPlanInput = {
	title: "Configurable Frame Pacing",
	feature: "Add an explicit frame pacing policy.",
	requirements: ["Expose a validated setting", "Apply it to the render loop"],
	targets: [{ target: "src/render.ts", change: "Apply the selected pacing policy." }],
	constraints: ["Preserve the existing default"],
	assumptions: ["The render loop remains single-threaded"],
	decisions: ["Use milliseconds in configuration"],
	implementationSteps: ["Add configuration parsing", "Wire the render loop"],
	validationCriteria: ["Invalid values are rejected", "Existing tests remain green"],
	outOfScope: ["Adaptive refresh support"],
};

test("validateQuestions accepts up to three unique choice questions", () => {
	const result = validateQuestions([
		{ id: "scope", header: "Scope", question: "Which behavior?", options: [{ label: "A" }, { label: "B", description: "Trade-off" }] },
		{ id: "compat", header: "Compatibility", question: "Keep default?", options: [{ label: "Yes" }, { label: "No" }] },
	]);
	assert.equal(result.length, 2);
	assert.equal(result[0].options[1].description, "Trade-off");
});

test("validateQuestions rejects duplicate ids, reserved Other, and invalid option counts", () => {
	assert.throws(() => validateQuestions([
		{ id: "scope", header: "A", question: "A?", options: [{ label: "One" }, { label: "Two" }] },
		{ id: "SCOPE", header: "B", question: "B?", options: [{ label: "One" }, { label: "Two" }] },
	]), /Duplicate question id/);
	assert.throws(() => validateQuestions([{ id: "x", header: "X", question: "X?", options: [{ label: "Other" }, { label: "Two" }] }]), /added automatically/);
	assert.throws(() => validateQuestions([{ id: "x", header: "X", question: "X?", options: [{ label: "Only" }] }]), /between 2 and 5/);
});

test("safeSlug produces bounded stable plan ids", () => {
	assert.equal(safeSlug(" Configurable Frame Pacing! "), "configurable-frame-pacing");
	assert.equal(safeSlug("***"), "job");
	assert.ok(safeSlug("x".repeat(100)).length <= 56);
});

test("renderJobPlan emits the complete simple-plan contract", () => {
	const rendered = renderJobPlan(plan, { rounds: 3, questions: 5 });
	for (const heading of ["Feature", "Required Behavior", "Targets", "Constraints", "Assumptions", "Settled Decisions", "Implementation Approach", "Validation Criteria", "Out of Scope", "Planning Record"]) {
		assert.match(rendered, new RegExp(`## ${heading}`));
	}
	assert.match(rendered, /Interactive rounds completed: 3/);
	assert.match(rendered, /Remaining consequential open questions: none/);
});

test("publishJobPlan uses the nearest ready store and never overwrites", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "job-planner-"));
	await mkdir(path.join(root, ".internal-dev", "plans"), { recursive: true });
	const nested = path.join(root, "src", "nested");
	await mkdir(nested, { recursive: true });
	const first = await publishJobPlan(nested, plan, { rounds: 1, questions: 1 });
	const second = await publishJobPlan(nested, plan, { rounds: 1, questions: 1 });
	assert.notEqual(first.directory, second.directory);
	assert.equal(first.projectRoot, root);
	assert.match(await readFile(first.path, "utf8"), /# Configurable Frame Pacing/);
});

test("package manifest ships the extension and the collaborative jog skill", async () => {
	const packageRoot = path.resolve(import.meta.dirname, "..");
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.deepEqual(manifest.pi.skills, ["./skills"]);

	const extension = await readFile(path.join(packageRoot, "index.ts"), "utf8");
	for (const tool of ["job_ask_choices", "job_ask_text", "job_plan_submit"]) assert.match(extension, new RegExp(`name: "${tool}"`));
	assert.match(extension, /registerCommand\("job"/);
	assert.match(extension, /Start jogging this job\?/);
	assert.match(extension, /sendUserMessage\(`\/skill:jog \$\{relativePath\}`/);
	assert.match(extension, /deliverAs: "followUp"/);
	assert.match(extension, /session_tree/);
	assert.match(extension, /exploration/i);
	assert.match(extension, /deepseek\/deepseek-v4-flash:max/i);

	const skill = await readFile(path.join(packageRoot, "skills", "jog", "SKILL.md"), "utf8");
	assert.match(skill, /^---\nname: jog\n/m);
	assert.match(skill, /main agent thread|root agent|root thread/i);
	assert.match(skill, /subagent_spawn/);
	assert.match(skill, /subagent_poll/);
	assert.match(skill, /deepseek-v4-flash/); // exploration team contract remains fixed
	assert.match(skill, /basicImplementer/);
	assert.match(skill, /advancedImplementer/);
	assert.match(skill, /configs\/index\.ts/);
	assert.match(skill, /DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION/);
	assert.match(skill, /maps directly to `thinkingLevel`/i);
	assert.match(skill, /"provider": "<config-basic-provider>"/);
	assert.match(skill, /exploration skill/i);
	assert.match(skill, /large single-domain edit/i);
	assert.match(skill, /ironed out with the user|settled with the user|approach.*user/i);
	assert.match(skill, /Sprint Planner workflow/i);
});
