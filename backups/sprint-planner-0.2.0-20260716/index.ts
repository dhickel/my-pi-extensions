import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import {
	acceptWorkflowInput,
	BRAINSTORM_LIFECYCLE_REQUIREMENT,
	BRAINSTORM_TOOL_DESCRIPTION,
	BRAINSTORM_TOOL_GUIDELINES,
	deleteSprintRun,
	parseCommand,
	commandUsage,
	safeSlug,
	sprintRunDirectory,
	SprintPlannerEngine,
	SprintStateStore,
	type EngineProgress,
	type SprintState,
	type WorkflowName,
} from "./core.ts";
import { PiWorkflowRunner } from "./pi-runner.ts";

const BINDING_ENTRY = "sprint-planner-binding-v1";
const FOOTER_KEY = "sprint-planner";

type Binding =
	| { kind: "current"; runId: string; internalDevPath: string; timestamp: string }
	| { kind: "completed" | "reset"; runId: string; timestamp: string };

interface ActiveJob {
	workflow: WorkflowName;
	runId: string;
	engine: SprintPlannerEngine;
	promise: Promise<unknown>;
	internalDevPath: string;
}

async function entry(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") return undefined;
		throw error;
	}
}

async function locateStore(cwd: string): Promise<{ projectRoot: string; internalDevPath: string }> {
	let current = resolve(cwd);
	while (true) {
		const internalDevPath = resolve(current, ".internal-dev");
		const found = await entry(internalDevPath);
		if (found) {
			if (found.isSymbolicLink() || !found.isDirectory()) throw new Error("The nearest .internal-dev path is not a regular directory.");
			for (const store of ["brainstorm", "handoffs", "plans", "reviews", "sprints"]) {
				const selected = await entry(resolve(internalDevPath, store));
				if (!selected?.isDirectory() || selected.isSymbolicLink()) throw new Error(`The .internal-dev store is incomplete: ${store}/ is not ready. Run /internal-dev init.`);
			}
			return { projectRoot: current, internalDevPath };
		}
		const parent = dirname(current);
		if (parent === current) throw new Error("No ready .internal-dev store was found. Initialize it before using sprint-planner.");
		current = parent;
	}
}

function latestBinding(ctx: ExtensionContext): Binding | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const selected = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (selected.type === "custom" && selected.customType === BINDING_ENTRY) {
			const binding = selected.data as Partial<Binding> | undefined;
			if (!binding || !["current", "completed", "reset"].includes(String(binding.kind)) || typeof binding.runId !== "string" || typeof binding.timestamp !== "string") return undefined;
			if (binding.kind === "current" && typeof binding.internalDevPath !== "string") return undefined;
			return binding as Binding;
		}
	}
	return undefined;
}

function timeId(name: string | undefined, directive: string): string {
	if (name) return safeSlug(name);
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	return `${stamp}-${safeSlug(directive.slice(0, 48), "run")}`;
}

async function uniqueId(internalDevPath: string, desired: string, store: "sprints" | "brainstorm" | "plans" | "handoffs" | "reviews"): Promise<string> {
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const id = `${desired}${suffix === 1 ? "" : `-${suffix}`}`;
		const path = store === "handoffs" || store === "reviews" ? resolve(internalDevPath, store, `${id}.md`) : resolve(internalDevPath, store, id);
		if (!(await entry(path))) return id;
	}
	throw new Error("Could not allocate a unique workflow id.");
}

function formatProgress(progress: EngineProgress): string {
	const count = progress.total ? ` ${progress.completed}/${progress.total}` : "";
	const step = progress.step ? ` — ${progress.step}` : "";
	return `${progress.workflow}: ${progress.stage}${count}${step}${progress.status === "running" ? "" : ` (${progress.status})`}`;
}

export default function sprintPlannerExtension(pi: ExtensionAPI) {
	let rootUi: ExtensionUIContext | undefined;
	let activeSprint: ActiveJob | undefined;
	const standalone = new Map<WorkflowName, ActiveJob>();
	let bound: Binding | undefined;

	function updateFooter(progress?: EngineProgress) {
		try {
			rootUi?.setStatus(FOOTER_KEY, progress ? formatProgress(progress) : undefined);
		} catch {
			// The root UI may already be detached during reload.
		}
	}

	function callbacks(workflow: WorkflowName, runId: string) {
		return {
			onProgress(progress: EngineProgress) {
				if ((workflow === "sprint" && activeSprint?.runId === runId) || standalone.get(workflow)?.runId === runId) updateFooter(progress);
			},
		};
	}

	function makeEngine(workflow: WorkflowName, runId: string) {
		return new SprintPlannerEngine(new PiWorkflowRunner({ events: pi.events }), callbacks(workflow, runId));
	}

	function appendBinding(binding: Binding) {
		try {
			pi.appendEntry(BINDING_ENTRY, binding);
			bound = binding;
		} catch {
			// A stale extension runtime after reload cannot mutate the replacement session.
		}
	}

	async function notifyCompletion(job: ActiveJob, promise: Promise<unknown>) {
		try {
			const result = await promise;
			if (job.workflow === "sprint") {
				const state = result as SprintState;
				if (state.status === "completed") {
					appendBinding({ kind: "completed", runId: job.runId, timestamp: new Date().toISOString() });
					rootUi?.notify(`Sprint ${job.runId} completed. Manifest: .internal-dev/sprints/${job.runId}/manifest.md`, "info");
				} else if (state.status !== "interrupted") rootUi?.notify(`Sprint ${job.runId} ${state.status}: ${state.error ?? "checkpointed"}`, "warning");
			} else {
				rootUi?.notify(`/${job.workflow} ${job.runId} completed: ${String(result)}`, "info");
			}
		} catch (error) {
			rootUi?.notify(`/${job.workflow} ${job.runId} stopped: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			if (job.workflow === "sprint" && activeSprint === job) activeSprint = undefined;
			if (standalone.get(job.workflow) === job) standalone.delete(job.workflow);
			if (!activeSprint && standalone.size === 0) updateFooter();
		}
	}

	async function inputFrom(parsedInput: string | undefined, workflow: WorkflowName, ctx: ExtensionCommandContext): Promise<string | undefined> {
		if (parsedInput) return parsedInput;
		if (!ctx.hasUI) {
			ctx.ui.notify(commandUsage(workflow), "warning");
			return undefined;
		}
		return ctx.ui.editor(`/${workflow} input`, "");
	}

	async function sprintStatus(runId: string | undefined, ctx: ExtensionCommandContext) {
		if (activeSprint && (!runId || activeSprint.runId === runId)) {
			ctx.ui.notify(formatProgress(activeSprint.engine.progress!), "info");
			return;
		}
		if (!ctx.isProjectTrusted()) throw new Error("Trust this project before reading sprint state.");
		const location = await locateStore(ctx.cwd);
		const selected = runId ?? (bound?.kind === "current" ? bound.runId : undefined);
		if (!selected) {
			ctx.ui.notify("No sprint is bound to this Pi session.", "info");
			return;
		}
		const directory = sprintRunDirectory(location.internalDevPath, selected);
		if (!(await entry(directory))) {
			ctx.ui.notify(`Sprint ${selected} does not exist.`, "warning");
			return;
		}
		try {
			const state = await new SprintStateStore(directory).load();
			const steps = Object.values(state.steps);
			ctx.ui.notify(`${selected}: ${state.status}, ${state.stage}, ${steps.filter((step) => step.status === "completed").length}/${steps.length} checkpointed${state.error ? ` — ${state.error}` : ""}`, state.error ? "warning" : "info");
		} catch (error) {
			if (await entry(resolve(directory, "manifest.md"))) ctx.ui.notify(`${selected}: completed (runtime state cleaned up).`, "info");
			else ctx.ui.notify(`${selected}: state is malformed or missing — ${error instanceof Error ? error.message : String(error)}. /sprint reset still works.`, "error");
		}
	}

	async function handleSprint(raw: string, ctx: ExtensionCommandContext) {
		rootUi = ctx.ui;
		let parsed;
		try {
			parsed = parseCommand("sprint", raw);
		} catch (error) {
			ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}\n${commandUsage("sprint")}`, "warning");
			return;
		}
		try {
			if (parsed.action === "status") return await sprintStatus(parsed.runId, ctx);
			if (parsed.action === "pause") {
				if (!activeSprint || (parsed.runId && parsed.runId !== activeSprint.runId)) return ctx.ui.notify("The selected sprint is not running in this process.", "warning");
				const job = activeSprint;
				await job.engine.pause();
				return ctx.ui.notify(`Sprint ${job.runId} paused at a durable checkpoint.`, "info");
			}
			if (parsed.action === "resume") {
				if (activeSprint) return ctx.ui.notify(`Sprint ${activeSprint.runId} is already running.`, "warning");
				if (!ctx.isProjectTrusted()) throw new Error("Trust this project before resuming a sprint.");
				const location = await locateStore(ctx.cwd);
				const runId = parsed.runId ?? (bound?.kind === "current" ? bound.runId : undefined);
				if (!runId) return ctx.ui.notify("No sprint run was selected for resume.", "warning");
				const engine = makeEngine("sprint", runId);
				const promise = engine.resumeSprint(sprintRunDirectory(location.internalDevPath, runId));
				const job: ActiveJob = { workflow: "sprint", runId, engine, promise, internalDevPath: location.internalDevPath };
				activeSprint = job;
				appendBinding({ kind: "current", runId, internalDevPath: location.internalDevPath, timestamp: new Date().toISOString() });
				void notifyCompletion(job, promise);
				ctx.ui.notify(`Resuming sprint ${runId} from its first incomplete or invalid checkpoint.`, "info");
				return;
			}
			if (parsed.action === "reset") {
				if (!ctx.isProjectTrusted()) throw new Error("Trust this project before deleting sprint records.");
				const location = await locateStore(ctx.cwd);
				const runId = parsed.runId ?? activeSprint?.runId ?? (bound?.kind === "current" ? bound.runId : undefined);
				if (!runId) return ctx.ui.notify("No sprint run was selected for reset.", "warning");
				const approved = await ctx.ui.confirm("Permanently reset sprint?", `Delete .internal-dev/sprints/${runId}/ permanently? This aborts its workers and removes sprint records, including malformed state. Repository edits will not be reverted.`);
				if (!approved) return ctx.ui.notify("Sprint reset cancelled; nothing was deleted.", "info");
				if (activeSprint?.runId === runId) {
					const job = activeSprint;
					await job.engine.cancel();
					await job.promise.catch(() => undefined);
				}
				await deleteSprintRun(location.internalDevPath, runId);
				appendBinding({ kind: "reset", runId, timestamp: new Date().toISOString() });
				if (activeSprint?.runId === runId) activeSprint = undefined;
				updateFooter();
				ctx.ui.notify(`Sprint ${runId} was permanently deleted. Repository edits were left unchanged.`, "info");
				return;
			}
			if (activeSprint) return ctx.ui.notify(`Sprint ${activeSprint.runId} is already running in this process.`, "warning");
			const rawInput = await inputFrom(parsed.input, "sprint", ctx);
			if (!rawInput?.trim()) return ctx.ui.notify("Sprint cancelled; no directive was supplied.", "info");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting a sprint.");
			const location = await locateStore(ctx.cwd);
			const directive = acceptWorkflowInput(rawInput);
			const desired = timeId(parsed.name, directive);
			const runId = await uniqueId(location.internalDevPath, desired, "sprints");
			const engine = makeEngine("sprint", runId);
			const promise = engine.runSprint({ projectRoot: location.projectRoot, internalDevPath: location.internalDevPath, runId, directive, agents: parsed.agents });
			const job: ActiveJob = { workflow: "sprint", runId, engine, promise, internalDevPath: location.internalDevPath };
			activeSprint = job;
			appendBinding({ kind: "current", runId, internalDevPath: location.internalDevPath, timestamp: new Date().toISOString() });
			void notifyCompletion(job, promise);
			ctx.ui.notify(`Started sprint ${runId} in the background. Use /sprint status or /sprint pause while continuing this root session.`, "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function handleStandalone(workflow: Exclude<WorkflowName, "sprint">, raw: string, ctx: ExtensionCommandContext) {
		rootUi = ctx.ui;
		let parsed;
		try {
			parsed = parseCommand(workflow, raw);
		} catch (error) {
			ctx.ui.notify(`${error instanceof Error ? error.message : String(error)}\n${commandUsage(workflow)}`, "warning");
			return;
		}
		const active = standalone.get(workflow);
		if (parsed.action === "status") {
			ctx.ui.notify(active?.engine.progress ? formatProgress(active.engine.progress) : `No /${workflow} workflow is running.`, "info");
			return;
		}
		if (parsed.action === "cancel") {
			if (!active) return ctx.ui.notify(`No /${workflow} workflow is running.`, "info");
			await active.engine.cancel();
			ctx.ui.notify(`/${workflow} ${active.runId} cancelled. No incomplete output will be published.`, "info");
			return;
		}
		if (active) return ctx.ui.notify(`/${workflow} ${active.runId} is already running.`, "warning");
		try {
			const rawInput = await inputFrom(parsed.input, workflow, ctx);
			if (!rawInput?.trim()) return ctx.ui.notify(`/${workflow} cancelled; no input was supplied.`, "info");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting a workflow.");
			const location = await locateStore(ctx.cwd);
			const directive = acceptWorkflowInput(rawInput);
			const id = await uniqueId(location.internalDevPath, timeId(undefined, directive), workflow === "brainstorm" ? "brainstorm" : workflow === "advanceplan" ? "plans" : "handoffs");
			const engine = makeEngine(workflow, id);
			const options = { projectRoot: location.projectRoot, internalDevPath: location.internalDevPath, id, directive, agents: parsed.agents, interactive: parsed.interactive };
			const promise = workflow === "brainstorm" ? engine.runStandaloneBrainstorm(options) : workflow === "ironout" ? engine.runStandaloneIronout(options) : engine.runStandaloneAdvancePlan(options);
			const job: ActiveJob = { workflow, runId: id, engine, promise, internalDevPath: location.internalDevPath };
			standalone.set(workflow, job);
			if (engine.progress) updateFooter(engine.progress);
			void notifyCompletion(job, promise);
			ctx.ui.notify(`Started /${workflow} ${id} in the background. Use /${workflow} status or /${workflow} cancel.`, "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	pi.registerTool({
		name: "sprint_brainstorm",
		label: "Run sprint brainstorm",
		description: BRAINSTORM_TOOL_DESCRIPTION,
		promptSnippet: "Run the engine-owned brainstorm with mandatory all-to-all cross-review before synthesis",
		promptGuidelines: [...BRAINSTORM_TOOL_GUIDELINES],
		parameters: Type.Object(
			{
				prompt: Type.String({ minLength: 1, maxLength: 2_000_000, description: "The authoritative brainstorming prompt." }),
				agents: Type.Optional(Type.Integer({ minimum: 2, maximum: 8, description: "Number of complementary brainstorm workers. Default: 4." })),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootUi = ctx.ui;
			if (standalone.has("brainstorm")) throw new Error("A /brainstorm or sprint_brainstorm workflow is already running.");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting a workflow.");
			const location = await locateStore(ctx.cwd);
			const directive = acceptWorkflowInput(params.prompt);
			const id = await uniqueId(location.internalDevPath, timeId(undefined, directive), "brainstorm");
			const engine = makeEngine("brainstorm", id);
			const promise = engine.runStandaloneBrainstorm({ projectRoot: location.projectRoot, internalDevPath: location.internalDevPath, id, directive, agents: params.agents });
			const job: ActiveJob = { workflow: "brainstorm", runId: id, engine, promise, internalDevPath: location.internalDevPath };
			standalone.set("brainstorm", job);
			if (engine.progress) updateFooter(engine.progress);
			const abort = () => void engine.cancel().catch(() => undefined);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			try {
				const target = await promise;
				return {
					content: [{ type: "text" as const, text: `Brainstorm ${id} completed after mandatory findings and cross-review rounds: ${target}` }],
					details: { id, target, crossReviewRequired: true },
				};
			} finally {
				signal.removeEventListener("abort", abort);
				if (standalone.get("brainstorm") === job) standalone.delete("brainstorm");
				if (!activeSprint && standalone.size === 0) updateFooter();
			}
		},
	});

	pi.registerCommand("sprint", { description: `Run or manage the resilient sprint planning pipeline through corrected plan publication. ${BRAINSTORM_LIFECYCLE_REQUIREMENT}`, handler: handleSprint, getArgumentCompletions: (prefix) => ["status", "pause", "resume", "reset"].filter((item) => item.startsWith(prefix.trim())).map((value) => ({ value, label: value })) });
	pi.registerCommand("brainstorm", { description: `Run the engine-owned standalone brainstorm. ${BRAINSTORM_LIFECYCLE_REQUIREMENT}`, handler: (args, ctx) => handleStandalone("brainstorm", args, ctx), getArgumentCompletions: (prefix) => ["status", "cancel"].filter((item) => item.startsWith(prefix.trim())).map((value) => ({ value, label: value })) });
	for (const workflow of ["ironout", "advanceplan"] as const) {
		pi.registerCommand(workflow, { description: `Run the standalone ${workflow} workflow`, handler: (args, ctx) => handleStandalone(workflow, args, ctx), getArgumentCompletions: (prefix) => ["status", "cancel"].filter((item) => item.startsWith(prefix.trim())).map((value) => ({ value, label: value })) });
	}

	pi.on("session_start", async (_event, ctx) => {
		rootUi = ctx.ui;
		bound = latestBinding(ctx);
		if (bound?.kind !== "current" || !ctx.isProjectTrusted()) return;
		try {
			const location = await locateStore(ctx.cwd);
			if (resolve(bound.internalDevPath) !== resolve(location.internalDevPath)) {
				ctx.ui.notify("The bound sprint belongs to a different project store and will not be opened automatically.", "warning");
				return;
			}
			const runDirectory = sprintRunDirectory(bound.internalDevPath, bound.runId);
			const stateStore = new SprintStateStore(runDirectory);
			const state = await stateStore.load();
			if (state.status !== "running") return;
			state.status = "interrupted";
			state.error = "Running work was interrupted by session shutdown, reload, or process exit. Use /sprint resume explicitly.";
			state.updatedAt = new Date().toISOString();
			for (const step of Object.values(state.steps)) if (step.status === "running") step.status = "interrupted", (step.updatedAt = state.updatedAt);
			await stateStore.save(state);
			ctx.ui.notify(`Sprint ${bound.runId} was interrupted and will not auto-resume. Use /sprint resume when ready.`, "warning");
		} catch {
			// Malformed state is intentionally left untouched so /sprint reset can remove it.
		}
	});

	pi.on("session_shutdown", async () => {
		await activeSprint?.engine.pause(true).catch(() => undefined);
		await Promise.all([...standalone.values()].map((job) => job.engine.cancel().catch(() => undefined)));
		try {
			rootUi?.setStatus(FOOTER_KEY, undefined);
		} catch {}
		rootUi = undefined;
	});
}
