import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import {
	acceptWorkflowInput,
	assertSafeRelativePath,
	BRAINSTORM_LIFECYCLE_REQUIREMENT,
	BRAINSTORM_TOOL_DESCRIPTION,
	BRAINSTORM_TOOL_GUIDELINES,
	checkpointExecutionRecord,
	deleteSprintRunRecord,
	discoverSprintRuns,
	doctorExecutionRecord,
	finishExecutionRecord,
	inspectLease,
	inspectPlanDirectory,
	interruptActiveRecord,
	parseCommand,
	commandUsage,
	resolveRunDirectory,
	runDoctor,
	safeSlug,
	sprintsRoot,
	SprintPlannerEngine,
	SprintStateStore,
	startExecutionRecord,
	type DoctorReport,
	type EngineProgress,
	type ExecutionRecordHandle,
	type PlanValidationResult,
	type RunRecordSummary,
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

async function inputArtifactPath(rawPath: string, cwd: string, fileOnly: boolean): Promise<string> {
	const input = rawPath.trim().replace(/^@/, "").trim();
	if (!input) throw new Error("An input artifact path is required.");
	const path = resolve(cwd, input);
	const found = await entry(path);
	if (!found) throw new Error(`Input artifact does not exist: ${path}`);
	if (found.isSymbolicLink() || (fileOnly ? !found.isFile() : !found.isFile() && !found.isDirectory())) {
		throw new Error(`Input artifact is not a regular ${fileOnly ? "file" : "file or directory"}: ${path}`);
	}
	return path;
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
	const statusSuffix = progress.status === "running" || progress.status === "starting" ? "" : ` (${progress.status})`;
	return `${progress.workflow}: ${progress.stage}${count}${step}${statusSuffix}`;
}

export default function sprintPlannerExtension(pi: ExtensionAPI) {
	let rootUi: ExtensionUIContext | undefined;
	let activeSprint: ActiveJob | undefined;
	const standalone = new Map<WorkflowName, ActiveJob>();
	const executionRecords = new Map<string, ExecutionRecordHandle>();
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
			if (job.workflow === "sprint" && activeSprint === job && !job.engine.retainedLeaseHandle) activeSprint = undefined;
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
		const root = await sprintsRoot(location.internalDevPath);
		const directory = resolveRunDirectory(root, selected);
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
				const root = await sprintsRoot(location.internalDevPath);
				const engine = makeEngine("sprint", runId);
				const promise = engine.resumeSprint(resolveRunDirectory(root, runId), runId);
				const job: ActiveJob = { workflow: "sprint", runId, engine, promise, internalDevPath: location.internalDevPath };
				activeSprint = job;
				if (engine.progress) updateFooter(engine.progress);
				void notifyCompletion(job, promise);
				await engine.initialized;
				appendBinding({ kind: "current", runId, internalDevPath: location.internalDevPath, timestamp: new Date().toISOString() });
				ctx.ui.notify(`Resuming sprint ${runId} from its first incomplete or invalid checkpoint.`, "info");
				return;
			}
			if (parsed.action === "list") {
				if (!ctx.isProjectTrusted()) throw new Error("Trust this project before listing sprints.");
				const location = await locateStore(ctx.cwd);
				const root = await sprintsRoot(location.internalDevPath);
				const retained = [
					...(activeSprint?.engine?.retainedLeaseHandle ? [activeSprint.engine.retainedLeaseHandle] : []),
					...[...executionRecords.values()].map((handle) => handle.leaseHandle),
				];
				const runs: RunRecordSummary[] = await discoverSprintRuns(root, retained);
				if (runs.length === 0) {
					ctx.ui.notify("No sprint runs found in .internal-dev/sprints/.", "info");
					return;
				}
				const lines = runs.map((r) => {
					const leaseIcon = r.leaseOwnership === "owned-by-this-runtime" ? "🔒"
						: r.leaseOwnership === "held-by-other" ? "🔐"
						: r.leaseOwnership === "uncertain" ? "❓" : "";
					const kindLabel = r.kind === "planning" ? "planning"
						: r.kind === "execution-only" ? "execution"
						: r.kind === "ambiguous" ? "ambiguous"
						: r.kind === "malformed" ? "malformed" : "unknown";
					const markers = [r.markers.state ? "state" : "", r.markers.manifest ? "manifest" : "", r.markers.execution ? "execution" : ""].filter(Boolean).join(",") || "none";
					return `${r.runId}  ${kindLabel}  ${r.state}  markers=${markers}  lease=${r.leaseOwnership}${leaseIcon ? ` ${leaseIcon}` : ""}`;
				});
				ctx.ui.notify(`Sprint runs:\n${lines.join("\n")}`, "info");
				return;
			}
			if (parsed.action === "doctor") {
				if (!ctx.isProjectTrusted()) throw new Error("Trust this project before inspecting sprints.");
				const location = await locateStore(ctx.cwd);
				const root = await sprintsRoot(location.internalDevPath);
				const selectedId = parsed.runId ?? activeSprint?.runId ?? (bound?.kind === "current" ? bound.runId : undefined);
				if (!selectedId) return ctx.ui.notify("No sprint run was selected for doctor. Provide a run id or bind a sprint first.", "warning");
				const runDirectory = resolveRunDirectory(root, selectedId);
				const retained = executionRecords.get(selectedId)?.leaseHandle ?? (activeSprint?.runId === selectedId ? activeSprint.engine.retainedLeaseHandle : undefined);
				const report: DoctorReport = await runDoctor(root, runDirectory, selectedId, retained);
				if (report.findings.length === 0) {
					ctx.ui.notify(`Sprint ${selectedId}: no issues found (${report.runKind}).`, "info");
				} else {
					const bySeverity = (s: string) => report.findings.filter((f) => f.severity === s);
					const crits = bySeverity("critical");
					const errs = bySeverity("error");
					const warns = bySeverity("warning");
					const infos = bySeverity("info");
					const allLines = [
						`Sprint ${selectedId} (${report.runKind}, lease: ${report.leaseOwnership}):`,
						...crits.map((f) => `  ❌ ${f.message}${f.action ? ` — ${f.action}` : ""}`),
						...errs.map((f) => `  ❌ ${f.message}${f.action ? ` — ${f.action}` : ""}`),
						...warns.map((f) => `  ⚠️ ${f.message}${f.action ? ` — ${f.action}` : ""}`),
						...infos.map((f) => `  ℹ️ ${f.message}`),
					];
					const worst = crits.length + errs.length > 0 ? "error" : warns.length > 0 ? "warning" : "info";
					ctx.ui.notify(allLines.join("\n"), worst);
				}
				return;
			}
			if (parsed.action === "reset") {
				if (!ctx.isProjectTrusted()) throw new Error("Trust this project before deleting sprint records.");
				const location = await locateStore(ctx.cwd);
				const runId = parsed.runId ?? activeSprint?.runId ?? (bound?.kind === "current" ? bound.runId : undefined);
				if (!runId) return ctx.ui.notify("No sprint run was selected for reset.", "warning");
				const root = await sprintsRoot(location.internalDevPath);
				const runDirectory = resolveRunDirectory(root, runId);
				const lease = await inspectLease(runDirectory, activeSprint?.runId === runId ? activeSprint.engine.retainedLeaseHandle : undefined);
				const evidence = lease.record ? `${lease.ownership}; ${lease.record.runKind}, pid=${lease.record.pid}, host=${lease.record.hostname}, acquired=${lease.record.acquiredAt}` : `${lease.ownership}${lease.error ? `; ${lease.error}` : ""}`;
				const approved = await ctx.ui.confirm("Permanently reset sprint?", `Delete .internal-dev/sprints/${runId}/ permanently? Lease: ${evidence}. This aborts its workers and removes sprint records, including malformed state. Repository edits will not be reverted.`);
				if (!approved) return ctx.ui.notify("Sprint reset cancelled; nothing was deleted.", "info");
				if (activeSprint?.runId === runId) {
					const job = activeSprint;
					await job.engine.cancel();
					await job.promise.catch(() => undefined);
				}
				await deleteSprintRunRecord(root, runId);
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
			if (engine.progress) updateFooter(engine.progress);
			void notifyCompletion(job, promise);
			await engine.initialized;
			appendBinding({ kind: "current", runId, internalDevPath: location.internalDevPath, timestamp: new Date().toISOString() });
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

	pi.registerTool({
		name: "sprint_ironout",
		label: "Run sprint ironout",
		description: "Run the engine-owned autonomous ironout author and corrective reviewer for an input artifact. The engine selects MODEL_ROUTES.ironoutAuthor and MODEL_ROUTES.ironoutReviewer; callers cannot supply models.",
		promptSnippet: "Turn a brainstorm artifact into a corrected handoff using engine-owned model routes",
		promptGuidelines: ["Use sprint_ironout after sprint_brainstorm instead of manually selecting ironout author or reviewer models."],
		parameters: Type.Object(
			{
				path: Type.String({ minLength: 1, maxLength: 4096, description: "Path to a brainstorm output directory or other handoff input artifact. Relative paths resolve from the current Pi working directory." }),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootUi = ctx.ui;
			if (standalone.has("ironout")) throw new Error("A /ironout or sprint_ironout workflow is already running.");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting a workflow.");
			const location = await locateStore(ctx.cwd);
			const directive = acceptWorkflowInput(await inputArtifactPath(params.path, ctx.cwd, false));
			const id = await uniqueId(location.internalDevPath, timeId(undefined, directive), "handoffs");
			const engine = makeEngine("ironout", id);
			const promise = engine.runStandaloneIronout({ projectRoot: location.projectRoot, internalDevPath: location.internalDevPath, id, directive, interactive: false });
			const job: ActiveJob = { workflow: "ironout", runId: id, engine, promise, internalDevPath: location.internalDevPath };
			standalone.set("ironout", job);
			if (engine.progress) updateFooter(engine.progress);
			const abort = () => void engine.cancel().catch(() => undefined);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			try {
				const target = await promise;
				return {
					content: [{ type: "text" as const, text: `Ironout ${id} completed with engine-routed author and corrective review: ${target}` }],
					details: { id, target },
				};
			} finally {
				signal.removeEventListener("abort", abort);
				if (standalone.get("ironout") === job) standalone.delete("ironout");
				if (!activeSprint && standalone.size === 0) updateFooter();
			}
		},
	});

	pi.registerTool({
		name: "sprint_advanceplan",
		label: "Run sprint advance plan",
		description: "Run the engine-owned advanced plan author, concept review, orchestration review, and phase reviews for a handoff artifact. The engine selects MODEL_ROUTES.advancedPlanner, MODEL_ROUTES.advancedAdvisor, and MODEL_ROUTES.advancedReviewer; callers cannot supply models.",
		promptSnippet: "Turn a corrected handoff into a fully reviewed phased plan using engine-owned model routes",
		promptGuidelines: ["Use sprint_advanceplan after sprint_ironout instead of manually selecting advanced planning or review models."],
		parameters: Type.Object(
			{
				path: Type.String({ minLength: 1, maxLength: 4096, description: "Path to the corrected handoff Markdown artifact. Relative paths resolve from the current Pi working directory." }),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rootUi = ctx.ui;
			if (standalone.has("advanceplan")) throw new Error("An /advanceplan or sprint_advanceplan workflow is already running.");
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before starting a workflow.");
			const location = await locateStore(ctx.cwd);
			const directive = acceptWorkflowInput(await inputArtifactPath(params.path, ctx.cwd, true));
			const id = await uniqueId(location.internalDevPath, timeId(undefined, directive), "plans");
			const engine = makeEngine("advanceplan", id);
			const promise = engine.runStandaloneAdvancePlan({ projectRoot: location.projectRoot, internalDevPath: location.internalDevPath, id, directive });
			const job: ActiveJob = { workflow: "advanceplan", runId: id, engine, promise, internalDevPath: location.internalDevPath };
			standalone.set("advanceplan", job);
			if (engine.progress) updateFooter(engine.progress);
			const abort = () => void engine.cancel().catch(() => undefined);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			try {
				const target = await promise;
				return {
					content: [{ type: "text" as const, text: `Advanced plan ${id} completed with concept, orchestration, and phase reviews: ${target}` }],
					details: { id, target },
				};
			} finally {
				signal.removeEventListener("abort", abort);
				if (standalone.get("advanceplan") === job) standalone.delete("advanceplan");
				if (!activeSprint && standalone.size === 0) updateFooter();
			}
		},
	});

	pi.registerTool({
		name: "sprint_validate_plan",
		label: "Validate sprint plan",
		description: "Read-only structured validation of a sprint-planner generated plan directory. Returns a versioned diagnostic result with categorized findings. Does not create, normalize, touch, or rewrite any file.",
		promptSnippet: "Validate a sprint-planner generated plan directory for structural and cross-consistency issues",
		promptGuidelines: ["Use sprint_validate_plan to validate a plan directory before implementation. The tool is read-only and does not mutate plan files."],
		parameters: Type.Object(
			{
				path: Type.String({ minLength: 1, maxLength: 4096, description: "Project-relative path to the plan directory. Leading @ is normalized. Must be a regular directory beneath the project root with no symlinks in any path component." }),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before validating a plan.");
			const rawPath = params.path.replace(/^@/, "");
			if (!rawPath.trim()) throw new Error("A plan directory path is required.");
			const normalized = assertSafeRelativePath(rawPath);
			if (normalized !== rawPath) throw new Error("Plan path must be canonical project-relative text.");
			const projectRoot = resolve(ctx.cwd);
			const resolved = resolve(projectRoot, normalized);
			let cumulative = projectRoot;
			const currentUid = process.getuid?.();
			for (const segment of normalized.split("/")) {
				cumulative = resolve(cumulative, segment);
				let selected;
				try {
					selected = await lstat(cumulative);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Plan directory does not exist: ${normalized}`);
					throw error;
				}
				if (selected.isSymbolicLink()) throw new Error(`Refusing to traverse symbolic link in plan path: ${normalized}`);
				if (currentUid !== undefined && selected.uid !== currentUid) throw new Error(`Plan path contains a foreign-owned component: ${normalized}`);
			}
			const rootEntry = await lstat(resolved);
			if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error(`Plan path is not a regular directory: ${normalized}`);
			const details: PlanValidationResult = await inspectPlanDirectory(resolved, projectRoot);
			return {
				content: [{ type: "text" as const, text: details.valid ? `Plan at ${normalized} is valid (${details.metadata.phaseCount} phases, ${details.metadata.waveCount} waves).` : `Plan at ${normalized} has ${details.findings.length} issue(s):\n${details.findings.map((f) => `- [${f.category}] ${f.message}${f.path ? ` (${f.path})` : ""}`).join("\n")}` }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "sprint_execution_record",
		label: "Manage execution record",
		description: "Persist versioned execution-only orchestration evidence for a sprint plan. Accepts start, checkpoint, and finish actions. Never coordinates workers; pure persistence.",
		promptSnippet: "Start, checkpoint, or finish a durable execution record for a sprint plan",
		promptGuidelines: [
			"Use sprint_execution_record start to create an immutable snapshot of a source plan and begin tracking orchestration evidence.",
			"Use sprint_execution_record checkpoint to record implementation, phase validation, or integration validation evidence.",
			"Use sprint_execution_record finish to transition the record to a terminal completed, blocked, or interrupted state.",
			"Each checkpoint requires the caller's expectedRevision; revision increments once per accepted transition.",
			"This tool persists evidence only. Worker coordination is owned by the orchestrate skill.",
		],
		parameters: Type.Union([
			Type.Object({
				action: Type.Literal("start"),
				sourcePlanPath: Type.String({ minLength: 1, maxLength: 1024 }),
				sourcePlanningRunId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
				name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
				runId: Type.Optional(Type.String({ pattern: "^exec-[A-Za-z0-9][A-Za-z0-9_-]*$", maxLength: 128 })),
			}, { additionalProperties: false }),
			Type.Object({
				action: Type.Literal("checkpoint"), type: Type.Literal("implementation"),
				runId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }),
				phase: Type.String({ minLength: 1, maxLength: 256 }), report: Type.String({ minLength: 1, maxLength: 100_000 }),
				changedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 500, uniqueItems: true })),
			}, { additionalProperties: false }),
			Type.Object({
				action: Type.Literal("checkpoint"), type: Type.Literal("phase_validation"),
				runId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }),
				phase: Type.String({ minLength: 1, maxLength: 256 }), verdict: Type.Union([Type.Literal("PASS"), Type.Literal("BLOCKED")]),
				report: Type.String({ minLength: 1, maxLength: 100_000 }),
				changedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 500, uniqueItems: true })),
			}, { additionalProperties: false }),
			Type.Object({
				action: Type.Literal("checkpoint"), type: Type.Literal("integration_validation"),
				runId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }),
				verdict: Type.Union([Type.Literal("PASS"), Type.Literal("BLOCKED")]), report: Type.String({ minLength: 1, maxLength: 100_000 }),
				changedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 500, uniqueItems: true })),
			}, { additionalProperties: false }),
			...(["completed", "blocked", "interrupted"] as const).map((type) => Type.Object({
				action: Type.Literal("finish"), type: Type.Literal(type),
				runId: Type.String({ minLength: 1, maxLength: 128 }), expectedRevision: Type.Integer({ minimum: 0 }),
				report: Type.String({ minLength: 1, maxLength: 100_000 }),
				changedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 500, uniqueItems: true })),
			}, { additionalProperties: false })),
		]),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			rootUi = ctx.ui;
			if (!ctx.isProjectTrusted()) throw new Error("Trust this project before managing execution records.");
			const location = await locateStore(ctx.cwd);

			if (params.action === "start") {
				if (!params.sourcePlanPath) throw new Error("sourcePlanPath is required for start.");
				const normalized = params.sourcePlanPath.replace(/^@/, "");
				if (!normalized.trim()) throw new Error("A source plan path is required.");
				const { handle, revision } = await startExecutionRecord(
					location.internalDevPath,
					location.projectRoot,
					normalized,
					params.sourcePlanningRunId,
					params.name,
					params.runId,
				);
				executionRecords.set(handle.runId, handle);
				return {
					content: [{ type: "text" as const, text: `Execution record ${handle.runId} started at revision ${revision}. Source plan frozen.` }],
					details: { runId: handle.runId, revision },
				};
			}

			if (params.action === "checkpoint") {
				if (!params.runId) throw new Error("runId is required for checkpoint.");
				if (params.expectedRevision === undefined) throw new Error("expectedRevision is required for checkpoint.");
				if (!params.type || !["implementation", "phase_validation", "integration_validation"].includes(params.type)) throw new Error("type must be implementation, phase_validation, or integration_validation.");
				if (!params.report) throw new Error("report is required for checkpoint.");

				const handle = executionRecords.get(params.runId);
				if (!handle) throw new Error(`Execution record ${params.runId} is not owned by this runtime. Start it first.`);

				if (params.type === "implementation" || params.type === "phase_validation") {
					if (!params.phase) throw new Error("phase is required for implementation and phase_validation checkpoints.");
				}
				if ((params.type === "phase_validation" || params.type === "integration_validation") && !params.verdict) {
					throw new Error("verdict (PASS or BLOCKED) is required for validation checkpoints.");
				}

				const newRevision = await checkpointExecutionRecord(
					handle,
					params.expectedRevision,
					params.type,
					params.phase,
					params.verdict,
					params.report,
					params.changedPaths,
				);
				return {
					content: [{ type: "text" as const, text: `Execution record ${params.runId} checkpoint accepted; new revision ${newRevision}.` }],
					details: { runId: params.runId, revision: newRevision },
				};
			}

			if (params.action === "finish") {
				if (!params.runId) throw new Error("runId is required for finish.");
				if (params.expectedRevision === undefined) throw new Error("expectedRevision is required for finish.");
				if (!params.type || !["completed", "blocked", "interrupted"].includes(params.type)) throw new Error("type must be completed, blocked, or interrupted.");
				if (!params.report) throw new Error("report (reason) is required for finish.");

				const handle = executionRecords.get(params.runId);
				if (!handle) throw new Error(`Execution record ${params.runId} is not owned by this runtime. Start it first.`);

				const newRevision = await finishExecutionRecord(
					handle,
					params.expectedRevision,
					params.type,
					params.report,
					params.changedPaths,
				);
				executionRecords.delete(params.runId);
				return {
					content: [{ type: "text" as const, text: `Execution record ${params.runId} finished as ${params.type} at revision ${newRevision}.` }],
					details: { runId: params.runId, revision: newRevision, state: params.type },
				};
			}

			throw new Error(`Unknown action: ${params.action}. Use start, checkpoint, or finish.`);
		},
	});

	pi.registerCommand("sprint", { description: `Run or manage the resilient sprint planning pipeline through corrected plan publication. ${BRAINSTORM_LIFECYCLE_REQUIREMENT}`, handler: handleSprint, getArgumentCompletions: (prefix) => ["status", "pause", "resume", "reset", "list", "doctor"].filter((item) => item.startsWith(prefix.trim())).map((value) => ({ value, label: value })) });
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
			const root = await sprintsRoot(bound.internalDevPath);
			const runDirectory = resolveRunDirectory(root, bound.runId);
			const lease = await inspectLease(runDirectory);
			const evidence = lease.record ? `${lease.ownership}, ${lease.record.runKind}, pid=${lease.record.pid}, host=${lease.record.hostname}` : `${lease.ownership}${lease.error ? `, ${lease.error}` : ""}`;
			ctx.ui.notify(`Sprint ${bound.runId} was inspected read-only (${evidence}) and will not auto-resume or be rewritten. Use /sprint doctor ${bound.runId} and /sprint resume explicitly.`, "warning");
		} catch (error) {
			ctx.ui.notify(`Sprint ${bound.runId} could not be inspected safely and was not changed: ${error instanceof Error ? error.message : String(error)}.`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		if (activeSprint) {
			try {
				await activeSprint.engine.pause(true);
			} catch (error) {
				rootUi?.notify(`Sprint ${activeSprint.runId} could not finalize or release its lease safely: ${error instanceof Error ? error.message : String(error)}. Use /sprint doctor ${activeSprint.runId}.`, "error");
			}
		}
		await Promise.all([...standalone.values()].map((job) => job.engine.cancel().catch(() => undefined)));
		// Interrupt owned unfinished execution records
		for (const [runId, handle] of executionRecords) {
			try {
				const interrupted = await interruptActiveRecord(handle, "Extension session shutdown.");
				if (interrupted) rootUi?.notify(`Execution record ${runId} was interrupted on shutdown.`, "info");
			} catch (error) {
				rootUi?.notify(`Execution record ${runId} could not be interrupted on shutdown: ${error instanceof Error ? error.message : String(error)}.`, "error");
			}
		}
		executionRecords.clear();
		try {
			rootUi?.setStatus(FOOTER_KEY, undefined);
		} catch {}
		rootUi = undefined;
	});
}
