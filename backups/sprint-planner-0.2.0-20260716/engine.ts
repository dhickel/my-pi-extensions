import { resolve } from "node:path";
import {
	atomicCreateFile,
	createSprintRun,
	publishDirectoryAtomically,
	RunArtifactStore,
	SprintStateStore,
} from "./artifacts.ts";
import {
	advancedConceptReviewPrompt,
	advancedPhaseReviewPrompt,
	advancedPlanPrompt,
	brainstormPrompt,
	crossReviewPrompt,
	ironoutPrompt,
	ironoutReviewPrompt,
	redTeamPrompt,
	routeRolesPrompt,
	synthesisPrompt,
} from "./prompts.ts";
import {
	BRAINSTORM_HEADINGS,
	CONCEPT_HEADINGS,
	HANDOFF_HEADINGS,
	PHASE_HEADINGS,
	REVIEW_HEADINGS,
	validateBrainstormFindings,
	validateHandoff,
	validatePlanDirectory,
	validatePlanFiles,
	validateRoles,
	validateSubmission,
	validateSynthesisCoverage,
} from "./validation.ts";
import {
	DEFAULT_BRAINSTORM_AGENTS,
	MAX_STEP_ATTEMPTS,
	MODEL_ROUTES,
	SPRINT_STATE_VERSION,
	type ArtifactRecord,
	type BrainstormRole,
	type EngineCallbacks,
	type EngineProgress,
	type ModelTuple,
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
	return files.map((file) => file.path).sort((a, b) => (a === "concepts.md" ? -1 : b === "concepts.md" ? 1 : a.localeCompare(b)));
}

export class SprintPlannerEngine {
	readonly runner: WorkflowRunner;
	readonly callbacks: EngineCallbacks;
	#controller?: AbortController;
	#state?: SprintState;
	#stateStore?: SprintStateStore;
	#artifactStore?: RunArtifactStore;
	#workflow: WorkflowName = "sprint";
	#runId = "";
	#lastStep?: string;
	#requestedStop?: "paused" | "interrupted" | "cancelled";

	constructor(runner: WorkflowRunner, callbacks: EngineCallbacks = {}) {
		this.runner = runner;
		this.callbacks = callbacks;
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
		return { workflow: this.#workflow, runId: this.#runId, status: this.#controller?.signal.aborted ? "cancelled" : "running", stage: "running", step: this.#lastStep, completed: 0, total: 0 };
	}

	async pause(interrupted = false): Promise<void> {
		this.#requestedStop = interrupted ? "interrupted" : "paused";
		this.#controller?.abort(interrupted ? "Session interrupted." : "Paused by user.");
		await this.runner.abortAll(interrupted ? "Session interrupted." : "Paused by user.");
		if (this.#state && this.#stateStore && this.#state.status === "running") {
			this.#state.status = interrupted ? "interrupted" : "paused";
			this.#state.error = interrupted ? "Running work was interrupted by session shutdown or reload." : undefined;
			this.#state.updatedAt = now();
			for (const step of Object.values(this.#state.steps)) {
				if (step.status === "running") step.status = "interrupted", (step.updatedAt = now());
			}
			await this.#saveState();
		}
	}

	async cancel(): Promise<void> {
		this.#requestedStop = "cancelled";
		this.#controller?.abort("Cancelled by user.");
		await this.runner.abortAll("Cancelled by user.");
	}

	async runSprint(options: SprintRunOptions): Promise<SprintState> {
		const directive = options.directive;
		if (!directive.trim()) throw new Error("Sprint directive is blank.");
		const runDirectory = await createSprintRun(options.internalDevPath, options.runId);
		const store = new RunArtifactStore(runDirectory);
		const inputArtifact = await store.write("input.md", `# Sprint Input\n\n${directive}`);
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
		await this.#saveState();
		return this.#driveSprint(state, directive);
	}

	async resumeSprint(runDirectory: string): Promise<SprintState> {
		const stateStore = new SprintStateStore(runDirectory);
		const state = await stateStore.load();
		if (state.status === "completed") throw new Error("Sprint is already complete.");
		const store = new RunArtifactStore(runDirectory);
		this.#attachSprint(state, store, stateStore);
		await this.#revalidateCompletedSteps();
		state.status = "running";
		state.error = undefined;
		state.updatedAt = now();
		for (const step of Object.values(state.steps)) if (step.status === "running" || step.status === "interrupted") step.status = "pending";
		await this.#saveState();
		return this.#driveSprint(state, await store.read(state.directivePath));
	}

	#attachSprint(state: SprintState, store: RunArtifactStore, stateStore = new SprintStateStore(state.runDirectory)): void {
		this.#workflow = "sprint";
		this.#runId = state.runId;
		this.#state = state;
		this.#artifactStore = store;
		this.#stateStore = stateStore;
		this.#controller = new AbortController();
		this.#requestedStop = undefined;
		this.#lastStep = undefined;
	}

	async #driveSprint(state: SprintState, directiveInput: string): Promise<SprintState> {
		const directive = directiveInput.replace(/^# Sprint Input\s*/i, "").trim();
		try {
			const brainstorm = await this.#sprintBrainstorm(directive, state.agents);
			const handoff = await this.#sprintIronout(brainstorm);
			const plan = await this.#sprintPlan(handoff);
			await this.#writeManifest(directive, brainstorm, plan);
			state.stage = "complete";
			state.status = "completed";
			state.error = undefined;
			state.completedAt = now();
			state.updatedAt = state.completedAt;
			await this.#saveState();
			await this.#artifactStore!.removeRuntimeFiles();
			this.#emitProgress();
			return state;
		} catch (error) {
			if (error instanceof PausedError || this.#controller?.signal.aborted) {
				state.status = this.#requestedStop ?? "paused";
				state.error = this.#requestedStop === "cancelled" ? "Cancelled by user." : state.error;
			} else {
				state.status = "paused";
				state.error = errorText(error);
			}
			state.updatedAt = now();
			await this.#saveState();
			this.#emitProgress();
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
		const steps = Object.values(state.steps);
		let invalidateFollowing = false;
		for (const step of steps) {
			if (step.status !== "completed") continue;
			const valid = invalidateFollowing ? [] : await Promise.all(step.artifacts.map((artifact) => this.#artifactStore!.verify(artifact)));
			if (invalidateFollowing || !valid.every(Boolean)) {
				invalidateFollowing = true;
				step.status = "pending";
				step.error = "This step or an earlier checkpointed artifact is missing or changed; downstream work must be revalidated.";
				step.artifacts = [];
				step.updatedAt = now();
			}
		}
	}

	async #step(
		id: string,
		stage: SprintStage,
		model: ModelTuple,
		request: Omit<WorkerRequest, "id" | "model" | "cwd" | "persistent" | "sessionDirectory" | "sessionPath">,
		consume: (submission: WorkerSubmission) => Promise<ArtifactRecord[]>,
	): Promise<WorkerSubmission | undefined> {
		const state = this.#state!;
		const store = this.#artifactStore!;
		let step = state.steps[id];
		if (step?.status === "completed" && (await Promise.all(step.artifacts.map((artifact) => store.verify(artifact)))).every(Boolean)) return undefined;
		if (!step) {
			step = state.steps[id] = { id, stage, status: "pending", attempts: 0, model: { ...model }, artifacts: [], updatedAt: now() };
		}
		state.stage = stage;
		if (this.#controller!.signal.aborted) throw new PausedError("Workflow is not running.");
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
			if (this.#controller!.signal.aborted) throw new PausedError("Workflow paused.");
			step.status = "running";
			step.attempts++;
			step.startedAt ??= now();
			step.updatedAt = now();
			step.error = undefined;
			await this.#saveState();
			let result: WorkerResult;
			try {
				result = await this.runner.run({ ...base, sessionPath: step.sessionPath, retryPrompt: step.attempts > 1 ? `Attempt ${step.attempts}: correct the prior transient failure or malformed typed submission and resubmit the complete artifact.` : undefined }, this.#controller!.signal);
				if (result.sessionPath && result.sessionPath !== step.sessionPath) step.sessionPath = result.sessionPath;
				if (!result.ok) throw Object.assign(new Error(result.error ?? "Worker failed."), { failureKind: result.failureKind ?? "fatal" });
				const submission = validateSubmission(result.submission, request.expectation);
				const artifacts = await consume(submission);
				step.artifacts = artifacts;
				step.status = "completed";
				step.completedAt = now();
				step.updatedAt = step.completedAt;
				await this.#saveState();
				return submission;
			} catch (error) {
				if (this.#controller!.signal.aborted) throw new PausedError("Workflow paused.");
				const failureKind = (error as { failureKind?: string }).failureKind ?? (error instanceof Error && /submission|heading|json|schema|artifact|file/i.test(error.message) ? "malformed" : "fatal");
				step.error = errorText(error);
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
		const rolesSubmission = await this.#step(
			"brainstorm-route",
			"brainstorm",
			MODEL_ROUTES.roleRouter,
			{ role: "brainstorm role router", mode: "planning", prompt: routeRolesPrompt(directive, count), contextPaths: ["input.md"], expectation: { kind: "roles" } },
			async (submission) => {
				validateRoles(submission.content, count);
				return [await this.#artifactStore!.write("brainstorm/roles.json", submission.content!)];
			},
		);
		const roles = rolesSubmission ? validateRoles(rolesSubmission.content, count) : validateRoles(await this.#artifactStore!.read("brainstorm/roles.json"), count);

		await Promise.all(
			roles.map((role) =>
				this.#step(
					`brainstorm-findings-${role.id}`,
					"brainstorm",
					MODEL_ROUTES.brainstormWorker,
					{ role: `brainstorm worker: ${role.name}`, mode: "planning", prompt: brainstormPrompt(directive, role), contextPaths: ["input.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
					async (submission) => [await this.#artifactStore!.write(`brainstorm/${role.id}/findings.md`, submission.content!)],
				),
			),
		);
		const findings = await Promise.all(roles.map(async (role) => ({ path: `brainstorm/${role.id}/findings.md`, content: await this.#artifactStore!.read(`brainstorm/${role.id}/findings.md`) })));
		validateBrainstormFindings(findings, roles.map((role) => `brainstorm/${role.id}/findings.md`));
		await Promise.all(
			roles.map((role) => {
				const stepId = `brainstorm-findings-${role.id}`;
				const others = findings.filter((item) => item.path !== `brainstorm/${role.id}/findings.md`);
				const crossId = `brainstorm-cross-${role.id}`;
				if (!this.#state!.steps[crossId] && this.#state!.steps[stepId]?.sessionPath) {
					this.#state!.steps[crossId] = { id: crossId, stage: "brainstorm", status: "pending", attempts: 0, model: { ...MODEL_ROUTES.brainstormWorker }, artifacts: [], sessionPath: this.#state!.steps[stepId].sessionPath, updatedAt: now() };
				}
				return this.#step(
					crossId,
					"brainstorm",
					MODEL_ROUTES.brainstormWorker,
					{ role: `cross-review worker: ${role.name}`, mode: "planning", prompt: crossReviewPrompt(role, others), contextPaths: others.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
					async (submission) => [await this.#artifactStore!.write(`brainstorm/${role.id}/cross-review.md`, submission.content!)],
				);
			}),
		);
		const reports = await Promise.all(
			roles.flatMap((role) => ["findings.md", "cross-review.md"].map(async (name) => ({ path: `brainstorm/${role.id}/${name}`, content: await this.#artifactStore!.read(`brainstorm/${role.id}/${name}`) }))),
		);
		await this.#step(
			"brainstorm-synthesis",
			"brainstorm",
			MODEL_ROUTES.brainstormSynthesis,
			{ role: "brainstorm synthesizer", mode: "planning", prompt: synthesisPrompt(directive, reports), contextPaths: reports.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
			async (submission) => {
				validateSynthesisCoverage(submission.content!, findings.map((item) => item.path));
				return [await this.#artifactStore!.write("brainstorm/synthesis.md", submission.content!)];
			},
		);
		const synthesis = await this.#artifactStore!.read("brainstorm/synthesis.md");
		validateSynthesisCoverage(synthesis, findings.map((item) => item.path));
		await this.#step(
			"brainstorm-red-team",
			"brainstorm",
			MODEL_ROUTES.brainstormRedTeam,
			{ role: "brainstorm red team", mode: "planning", prompt: redTeamPrompt(synthesis), contextPaths: ["brainstorm/synthesis.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) },
			async (submission) => [await this.#artifactStore!.write("brainstorm/red-team.md", submission.content!)],
		);
		return { roles, reports, synthesis, redTeam: await this.#artifactStore!.read("brainstorm/red-team.md") };
	}

	async #sprintIronout(brainstorm: SprintBrainstormResult) {
		await this.#step(
			"ironout-author",
			"ironout",
			MODEL_ROUTES.ironoutAuthor,
			{ role: "autonomous ironout author", mode: "planning", prompt: ironoutPrompt(`${brainstorm.synthesis}\n\n<red-team>\n${brainstorm.redTeam}\n</red-team>`, brainstorm.reports, false), contextPaths: ["brainstorm/synthesis.md", "brainstorm/red-team.md", ...brainstorm.reports.map((item) => item.path)], expectation: markdownExpectation(HANDOFF_HEADINGS), allowQuestions: false },
			async (submission) => [await this.#artifactStore!.write("ironout/draft.md", submission.content!)],
		);
		const draft = await this.#artifactStore!.read("ironout/draft.md");
		await this.#step(
			"ironout-review",
			"ironout",
			MODEL_ROUTES.ironoutReviewer,
			{ role: "corrective ironout reviewer", mode: "planning", prompt: ironoutReviewPrompt(draft), contextPaths: ["ironout/draft.md"], expectation: { kind: "files", allowedPaths: ["review.md", "handoff.md"], requiredPaths: ["review.md", "handoff.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "handoff.md": HANDOFF_HEADINGS } } },
			async (submission) => {
				const files = filesByPath(submission);
				return [
					await this.#artifactStore!.write("reviews/ironout-review.md", files.get("review.md")!),
					await this.#artifactStore!.write("ironout/handoff.md", files.get("handoff.md")!),
				];
			},
		);
		const handoff = await this.#artifactStore!.read("ironout/handoff.md");
		validateHandoff(handoff);
		return handoff;
	}

	async #sprintPlan(handoff: string): Promise<SubmittedFile[]> {
		const draftSubmission = await this.#step(
			"planning-author",
			"planning",
			MODEL_ROUTES.advancedPlanner,
			{ role: "advanced planner", mode: "planning", prompt: advancedPlanPrompt(handoff), contextPaths: ["ironout/handoff.md"], expectation: { kind: "files", minFiles: 2 }, maxSeniorCalls: 2, seniorModel: MODEL_ROUTES.advancedAdvisor },
			async (submission) => {
				validatePlanFiles(submission.files!);
				return Promise.all(submission.files!.map((file) => this.#artifactStore!.write(`planning-draft/${file.path}`, file.content)));
			},
		);
		const draftFiles = draftSubmission?.files ?? (await Promise.all(this.#state!.steps["planning-author"].artifacts.map(async (artifact) => ({ path: artifact.path.replace(/^planning-draft\//, ""), content: await this.#artifactStore!.read(artifact.path) }))));
		validatePlanFiles(draftFiles);
		const names = planNames(draftFiles);
		const phasePaths = names.filter((path) => path !== "concepts.md");
		const draftConcepts = draftFiles.find((file) => file.path === "concepts.md")!;
		await this.#step(
			"planning-review-concepts",
			"planning",
			MODEL_ROUTES.advancedReviewer,
			{ role: "advanced concepts reviewer", mode: "planning", prompt: advancedConceptReviewPrompt(handoff, draftConcepts, phasePaths), contextPaths: ["ironout/handoff.md", "planning-draft/concepts.md"], expectation: { kind: "files", allowedPaths: ["review.md", "concepts.md"], requiredPaths: ["review.md", "concepts.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "concepts.md": CONCEPT_HEADINGS } } },
			async (submission) => {
				const map = filesByPath(submission);
				return [
					await this.#artifactStore!.write("reviews/advanced-plan-components/concepts.md", map.get("review.md")!),
					await this.#artifactStore!.write("planning-review-draft/concepts.md", map.get("concepts.md")!),
				];
			},
		);
		const correctedConcepts = { path: "concepts.md", content: await this.#artifactStore!.read("planning-review-draft/concepts.md") };
		for (let index = 0; index < phasePaths.length; index++) {
			const phasePath = phasePaths[index];
			const phase = draftFiles.find((file) => file.path === phasePath)!;
			const reviewPath = `reviews/advanced-plan-components/${phasePath.replace(/\.md$/, "")}.md`;
			const isFinalPhase = index === phasePaths.length - 1;
			await this.#step(
				`planning-review-${phasePath.replace(/\.md$/, "")}`,
				"planning",
				MODEL_ROUTES.advancedReviewer,
				{ role: `advanced phase reviewer: ${phasePath}`, mode: "planning", prompt: advancedPhaseReviewPrompt(correctedConcepts, phase, phasePaths), contextPaths: ["planning-review-draft/concepts.md", `planning-draft/${phasePath}`], expectation: { kind: "files", allowedPaths: ["review.md", phasePath], requiredPaths: ["review.md", phasePath], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, [phasePath]: PHASE_HEADINGS } } },
				async (submission) => {
					const map = filesByPath(submission);
					const ownArtifacts = [
						await this.#artifactStore!.write(reviewPath, map.get("review.md")!),
						await this.#artifactStore!.write(`planning-review-draft/${phasePath}`, map.get(phasePath)!),
					];
					if (!isFinalPhase) return ownArtifacts;
					const plan = await Promise.all(names.map(async (path) => ({ path, content: await this.#artifactStore!.read(`planning-review-draft/${path}`) })));
					validatePlanFiles(plan);
					const componentPaths = ["reviews/advanced-plan-components/concepts.md", ...phasePaths.map((path) => `reviews/advanced-plan-components/${path.replace(/\.md$/, "")}.md`)];
					const reviews = await Promise.all(componentPaths.map(async (path) => ({ path: path.split("/").at(-1)!, content: await this.#artifactStore!.read(path) })));
					const summary = summarizePlanReviews(reviews);
					const artifacts = [...ownArtifacts, await this.#artifactStore!.write("reviews/advanced-plan-review.md", summary)];
					artifacts.push(...(await this.#artifactStore!.replaceFlatDirectory("planning", plan)));
					return artifacts;
				},
			);
		}
		const plan = await Promise.all(names.map(async (path) => ({ path, content: await this.#artifactStore!.read(`planning/${path}`) })));
		validatePlanFiles(plan);
		await validatePlanDirectory(resolve(this.#state!.runDirectory, "planning"));
		return plan;
	}

	async #writeManifest(directive: string, brainstorm: { roles: BrainstormRole[] }, plan: SubmittedFile[]): Promise<void> {
		const steps = Object.values(this.#state!.steps);
		const artifacts = [this.#state!.inputArtifact, ...steps.flatMap((step) => step.artifacts)];
		const content = [
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
			`- Planning: ${plan.length - 1} corrected phases plus concepts; this is the terminal extension stage`,
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
		await this.#artifactStore!.write("manifest.md", content);
	}

	async #standaloneCall(request: WorkerRequest): Promise<WorkerSubmission> {
		let lastError = "Worker failed.";
		for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
			if (this.#controller!.signal.aborted) throw new PausedError("Standalone workflow cancelled.");
			this.#lastStep = request.role;
			const current = this.progress;
			if (current) this.callbacks.onProgress?.({ ...current, step: request.role });
			const result = await this.runner.run({ ...request, retryPrompt: attempt > 1 ? `Attempt ${attempt}: resubmit a complete valid typed artifact.` : undefined }, this.#controller!.signal);
			try {
				if (!result.ok) throw Object.assign(new Error(result.error ?? "Worker failed."), { failureKind: result.failureKind });
				return validateSubmission(result.submission, request.expectation);
			} catch (error) {
				lastError = errorText(error);
				const kind = (error as { failureKind?: string }).failureKind ?? "malformed";
				if (kind === "fatal" || kind === "cancelled" || attempt === MAX_STEP_ATTEMPTS) throw new Error(lastError);
			}
		}
		throw new Error(lastError);
	}

	#startStandalone(workflow: WorkflowName, options: StandaloneRunOptions): void {
		this.#workflow = workflow;
		this.#runId = options.id;
		this.#state = undefined;
		this.#stateStore = undefined;
		this.#artifactStore = undefined;
		this.#controller = new AbortController();
		this.#requestedStop = undefined;
		this.#lastStep = undefined;
	}

	#request(options: StandaloneRunOptions, request: Omit<WorkerRequest, "cwd" | "persistent">): WorkerRequest {
		return { ...request, cwd: resolve(options.projectRoot), persistent: false };
	}

	async runStandaloneBrainstorm(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("brainstorm", options);
		const count = normalizeAgents(options.agents);
		const rolesResult = await this.#standaloneCall(this.#request(options, { id: `${options.id}-route`, role: "brainstorm role router", model: MODEL_ROUTES.roleRouter, mode: "planning", prompt: routeRolesPrompt(options.directive, count), contextPaths: [], expectation: { kind: "roles" } }));
		const roles = validateRoles(rolesResult.content, count);
		const findings = await Promise.all(roles.map(async (role) => ({ role, submission: await this.#standaloneCall(this.#request(options, { id: `${options.id}-findings-${role.id}`, role: role.name, model: MODEL_ROUTES.brainstormWorker, mode: "planning", prompt: brainstormPrompt(options.directive, role), contextPaths: [], expectation: markdownExpectation(BRAINSTORM_HEADINGS), sessionPath: `memory:${options.id}:${role.id}` })) })));
		const findingReports = findings.map(({ role, submission }) => ({ path: `${role.id}/findings.md`, content: submission.content! }));
		validateBrainstormFindings(findingReports, roles.map((role) => `${role.id}/findings.md`));
		const crosses = await Promise.all(findings.map(async ({ role }) => ({ role, submission: await this.#standaloneCall(this.#request(options, { id: `${options.id}-cross-${role.id}`, role: `${role.name} cross reviewer`, model: MODEL_ROUTES.brainstormWorker, mode: "planning", prompt: crossReviewPrompt(role, findingReports.filter((item) => item.path !== `${role.id}/findings.md`)), contextPaths: findingReports.filter((item) => item.path !== `${role.id}/findings.md`).map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS), sessionPath: `memory:${options.id}:${role.id}` })) })));
		const allReports = [...findingReports, ...crosses.map(({ role, submission }) => ({ path: `${role.id}/cross-review.md`, content: submission.content! }))];
		const synthesis = await this.#standaloneCall(this.#request(options, { id: `${options.id}-synthesis`, role: "brainstorm synthesizer", model: MODEL_ROUTES.brainstormSynthesis, mode: "planning", prompt: synthesisPrompt(options.directive, allReports), contextPaths: allReports.map((item) => item.path), expectation: markdownExpectation(BRAINSTORM_HEADINGS) }));
		validateSynthesisCoverage(synthesis.content!, findingReports.map((item) => item.path));
		const redTeam = await this.#standaloneCall(this.#request(options, { id: `${options.id}-red-team`, role: "brainstorm red team", model: MODEL_ROUTES.brainstormRedTeam, mode: "planning", prompt: redTeamPrompt(synthesis.content!), contextPaths: ["synthesis.md"], expectation: markdownExpectation(BRAINSTORM_HEADINGS) }));
		const parent = resolve(options.internalDevPath, "brainstorm");
		return publishDirectoryAtomically(parent, options.id, [...allReports, { path: "synthesis.md", content: synthesis.content! }, { path: "red-team.md", content: redTeam.content! }]);
	}

	async runStandaloneIronout(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("ironout", options);
		const draft = await this.#standaloneCall(this.#request(options, { id: `${options.id}-author`, role: "ironout author", model: MODEL_ROUTES.ironoutAuthor, mode: "planning", prompt: ironoutPrompt(options.directive, [], options.interactive !== false), contextPaths: [], expectation: markdownExpectation(HANDOFF_HEADINGS), allowQuestions: options.interactive !== false, maxQuestionRounds: 3 }));
		const reviewed = await this.#standaloneCall(this.#request(options, { id: `${options.id}-review`, role: "corrective ironout reviewer", model: MODEL_ROUTES.ironoutReviewer, mode: "planning", prompt: ironoutReviewPrompt(draft.content!), contextPaths: [], expectation: { kind: "files", allowedPaths: ["review.md", "handoff.md"], requiredPaths: ["review.md", "handoff.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "handoff.md": HANDOFF_HEADINGS } } }));
		const handoff = filesByPath(reviewed).get("handoff.md")!;
		validateHandoff(handoff);
		const target = resolve(options.internalDevPath, "handoffs", `${options.id}.md`);
		await atomicCreateFile(target, handoff.endsWith("\n") ? handoff : `${handoff}\n`);
		return target;
	}

	async runStandaloneAdvancePlan(options: StandaloneRunOptions): Promise<string> {
		this.#startStandalone("advanceplan", options);
		const draft = await this.#standaloneCall(this.#request(options, { id: `${options.id}-plan`, role: "advanced planner", model: MODEL_ROUTES.advancedPlanner, mode: "planning", prompt: advancedPlanPrompt(options.directive), contextPaths: [], expectation: { kind: "files", minFiles: 2 }, maxSeniorCalls: 2, seniorModel: MODEL_ROUTES.advancedAdvisor }));
		validatePlanFiles(draft.files!);
		const names = planNames(draft.files!);
		const phasePaths = names.filter((path) => path !== "concepts.md");
		const draftConcepts = draft.files!.find((file) => file.path === "concepts.md")!;
		const conceptReview = await this.#standaloneCall(this.#request(options, { id: `${options.id}-review-concepts`, role: "advanced concepts reviewer", model: MODEL_ROUTES.advancedReviewer, mode: "planning", prompt: advancedConceptReviewPrompt(options.directive, draftConcepts, phasePaths), contextPaths: ["concepts.md"], expectation: { kind: "files", allowedPaths: ["review.md", "concepts.md"], requiredPaths: ["review.md", "concepts.md"], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, "concepts.md": CONCEPT_HEADINGS } } }));
		const conceptMap = filesByPath(conceptReview);
		const correctedConcepts = { path: "concepts.md", content: conceptMap.get("concepts.md")! };
		const componentReviews = [{ path: "concepts.md", content: conceptMap.get("review.md")! }];
		const correctedPhases: SubmittedFile[] = [];
		for (const phasePath of phasePaths) {
			const phase = draft.files!.find((file) => file.path === phasePath)!;
			const reviewed = await this.#standaloneCall(this.#request(options, { id: `${options.id}-review-${phasePath.replace(/\.md$/, "")}`, role: `advanced phase reviewer: ${phasePath}`, model: MODEL_ROUTES.advancedReviewer, mode: "planning", prompt: advancedPhaseReviewPrompt(correctedConcepts, phase, phasePaths), contextPaths: ["concepts.md", phasePath], expectation: { kind: "files", allowedPaths: ["review.md", phasePath], requiredPaths: ["review.md", phasePath], minFiles: 2, maxFiles: 2, headings: { "review.md": REVIEW_HEADINGS, [phasePath]: PHASE_HEADINGS } } }));
			const map = filesByPath(reviewed);
			componentReviews.push({ path: phasePath, content: map.get("review.md")! });
			correctedPhases.push({ path: phasePath, content: map.get(phasePath)! });
		}
		const plan = [correctedConcepts, ...correctedPhases];
		validatePlanFiles(plan);
		const target = await publishDirectoryAtomically(resolve(options.internalDevPath, "plans"), options.id, plan);
		await validatePlanDirectory(target);
		await atomicCreateFile(resolve(options.internalDevPath, "reviews", `${options.id}-advanced-plan-review.md`), summarizePlanReviews(componentReviews));
		return target;
	}

}
