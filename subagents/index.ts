import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	createEventBus,
	type ExtensionAPI,
	type ExtensionUIContext,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	buildToolCatalog,
	capModelOutput,
	CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES,
	compareToolFingerprints,
	fingerprintActiveToolDefs,
	type AgentSpec,
	type ChildHandle,
	type ChildRunResult,
	type ModelDescriptor,
	type ResolvedAgentSpec,
	type ResultPageResponse,
	SUBAGENT_CHILD_CONFIG_EVENT,
	type SubagentManagerScope,
	type SubagentResult,
	SubagentManager,
	THINKING_LEVELS,
	type ThinkingLevel,
	type ToolDef,
	type ToolFingerprint,
} from "./core.ts";

const FOOTER_KEY = "subagents";

interface ChildManagerConfiguration {
	schema: 1;
	scope: SubagentManagerScope;
	attach(manager: SubagentManager): void;
}

function isChildManagerConfiguration(value: unknown): value is ChildManagerConfiguration {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ChildManagerConfiguration>;
	return candidate.schema === 1 && typeof candidate.attach === "function" && candidate.scope !== undefined;
}

const agentParameters = Type.Object(
	{
		name: Type.String({ description: "A case-insensitively unique name for this subagent scope." }),
		task: Type.String({ description: "The complete delegated task. The child receives no caller transcript." }),
		tools: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Optional exact allowlist of non-subagent, case-sensitive tool API names. Omit to grant all registered child-allowed ordinary tools; use [] to grant none. Explicitly named registered tools are enabled for the child even when inactive in the caller. allowSubagents manages the control bundle separately.",
				uniqueItems: true,
			}),
		),
		allowSubagents: Type.Optional(
			Type.Boolean({
				description:
					"Opt in to the complete subagent control bundle so this root child can spawn one nested delegation layer. Default false.",
				default: false,
			}),
		),
		provider: Type.Optional(Type.String({ description: "Provider override; model is required with it." })),
		model: Type.Optional(Type.String({ description: "Model override; provider is required with it." })),
		thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS)),
	},
	{ additionalProperties: false },
);

const namesParameter = Type.Optional(
	Type.Array(Type.String(), { minItems: 1, description: "Case-insensitive subagent names. Omit to select all." }),
);

function describeModel(model: Model<any>, authConfigured: boolean): ModelDescriptor {
	return {
		provider: model.provider,
		id: model.id,
		authConfigured,
		supportedThinkingLevels: getSupportedThinkingLevels(model) as ThinkingLevel[],
	};
}

function finalAssistant(messages: readonly unknown[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as { role?: string };
		if (message?.role === "assistant") return message as AssistantMessage;
	}
	return undefined;
}

function assistantText(message: AssistantMessage | undefined): string {
	if (!message) return "";
	return message.content
		.filter((content): content is Extract<AssistantMessage["content"][number], { type: "text" }> => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

function initializationAbortError(signal: AbortSignal): Error {
	const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "cancelled");
	return new Error(`Child initialization aborted: ${reason}`);
}

function throwIfInitializationAborted(signal: AbortSignal): void {
	if (signal.aborted) throw initializationAbortError(signal);
}

function awaitAbortable<T>(
	promise: Promise<T>,
	signal: AbortSignal,
	onLateValue?: (value: T) => void | Promise<void>,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const consumeLateValue = (value: T) => {
			if (!onLateValue) return;
			void Promise.resolve(onLateValue(value)).catch(() => undefined);
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			reject(initializationAbortError(signal));
		};

		if (signal.aborted) {
			settled = true;
			void promise.then(consumeLateValue, () => undefined);
			reject(initializationAbortError(signal));
			return;
		}

		signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(
			(value) => {
				if (settled) {
					consumeLateValue(value);
					return;
				}
				settled = true;
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

async function createChild(
	spec: ResolvedAgentSpec,
	childScope: SubagentManagerScope,
	signal: AbortSignal,
): Promise<ChildHandle> {
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
	const eventBus = createEventBus();
	const attachedManagers: SubagentManager[] = [];
	const stopAttachedManagers = async (reason: string) => {
		await Promise.allSettled(attachedManagers.map((manager) => manager.shutdown(reason)));
	};

	try {
		throwIfInitializationAborted(signal);
		const services = await awaitAbortable(
			createAgentSessionServices({
				cwd: spec.cwd,
				agentDir: getAgentDir(),
				resourceLoaderOptions: { eventBus },
			}),
			signal,
			() => eventBus.clear(),
		);
		throwIfInitializationAborted(signal);
		eventBus.emit(SUBAGENT_CHILD_CONFIG_EVENT, {
			schema: 1,
			scope: childScope,
			attach(manager: SubagentManager) {
				attachedManagers.push(manager);
			},
		} satisfies ChildManagerConfiguration);
		if (attachedManagers.length > 1) {
			throw new Error("Child loaded multiple subagent managers; refusing ambiguous nested ownership.");
		}
		const nestedManager = attachedManagers[0];
		if (spec.allowSubagents && !nestedManager) {
			throw new Error("Nested subagent controls were requested, but no child subagent manager was loaded.");
		}

		const diagnosticErrors = services.diagnostics.filter((diagnostic) => diagnostic.type === "error");
		if (diagnosticErrors.length > 0) {
			throw new Error(diagnosticErrors.map((diagnostic) => diagnostic.message).join("; "));
		}

		const model = services.modelRuntime.getModel(spec.provider, spec.model);
		if (!model) throw new Error(`Child could not reproduce model ${spec.provider}/${spec.model}.`);
		if (!services.modelRuntime.hasConfiguredAuth(model.provider)) {
			throw new Error(`Child model ${spec.provider}/${spec.model} does not have configured authentication.`);
		}

		throwIfInitializationAborted(signal);
		const requestedNames = spec.expectedTools.map((tool) => tool.name);
		const created = await awaitAbortable(
			createAgentSessionFromServices({
				services,
				sessionManager: SessionManager.inMemory(spec.cwd),
				model,
				thinkingLevel: spec.thinkingLevel,
				tools: requestedNames,
				noTools: requestedNames.length === 0 ? "all" : undefined,
				sessionStartEvent: { type: "session_start", reason: "startup" },
			}),
			signal,
			async (lateCreated) => {
				const stopping = stopAttachedManagers(
					`Child subagent "${spec.name}" was cancelled during session creation.`,
				);
				lateCreated.session.dispose();
				eventBus.clear();
				await stopping;
			},
		);
		session = created.session;
		throwIfInitializationAborted(signal);
		const extensionErrors: string[] = [];
		await awaitAbortable(
			session.bindExtensions({
				mode: "print",
				onError: (error) => extensionErrors.push(`${error.extensionPath}: ${error.error}`),
			}),
			signal,
			async () => {
				const stopping = stopAttachedManagers(
					`Child subagent "${spec.name}" was cancelled while binding extensions.`,
				);
				session?.dispose();
				eventBus.clear();
				await stopping;
			},
		);
		throwIfInitializationAborted(signal);
		if (extensionErrors.length > 0) throw new Error(extensionErrors.join("; "));

		const actualModel = session.model;
		if (actualModel?.provider !== spec.provider || actualModel.id !== spec.model) {
			throw new Error(
				`Child model mismatch: expected ${spec.provider}/${spec.model}, received ${actualModel ? `${actualModel.provider}/${actualModel.id}` : "none"}.`,
			);
		}
		if (session.thinkingLevel !== spec.thinkingLevel) {
			throw new Error(
				`Child thinking-level mismatch: expected ${spec.thinkingLevel}, received ${session.thinkingLevel}.`,
			);
		}

		// Resolve metadata only for definitions active in the child. Requested registered
		// definitions were activated during child session creation, even if inactive in the caller.
		const actualTools = fingerprintActiveToolDefs(
			session.getAllTools() as ToolDef[],
			session.getActiveToolNames(),
		);
		const mismatch = compareToolFingerprints(spec.expectedTools, actualTools);
		if (mismatch) throw new Error(mismatch);

		const childSession = session;
		let disposePromise: Promise<void> | undefined;
		let unsubscribe: (() => void) | undefined;
		const shutdownNested = (reason: string) => nestedManager?.shutdown(reason) ?? Promise.resolve();

		return {
			provider: childSession.model?.provider ?? spec.provider,
			model: childSession.model?.id ?? spec.model,
			thinkingLevel: childSession.thinkingLevel as ThinkingLevel,
			async run(task, hooks): Promise<ChildRunResult> {
				unsubscribe = childSession.subscribe((event) => {
					if (event.type === "turn_end") {
						const stats = childSession.getSessionStats();
						hooks.onTurn({
							input: stats.tokens.input,
							output: stats.tokens.output,
							cacheRead: stats.tokens.cacheRead,
							cacheWrite: stats.tokens.cacheWrite,
							total: stats.tokens.total,
							cost: stats.cost,
						});
					}
				});
				let thrown: string | undefined;
				try {
					await childSession.prompt(task, { expandPromptTemplates: false, source: "extension" });
				} catch (error) {
					thrown = error instanceof Error ? error.message : String(error);
				}
				const stats = childSession.getSessionStats();
				const assistant = finalAssistant(childSession.messages);
				return {
					finalText: assistantText(assistant),
					usage: {
						input: stats.tokens.input,
						output: stats.tokens.output,
						cacheRead: stats.tokens.cacheRead,
						cacheWrite: stats.tokens.cacheWrite,
						total: stats.tokens.total,
						cost: stats.cost,
					},
					stopReason: assistant?.stopReason,
					error: thrown ?? assistant?.errorMessage,
				};
			},
			async abort() {
				await Promise.allSettled([
					childSession.abort(),
					shutdownNested(`Parent subagent "${spec.name}" was aborted.`),
				]);
			},
			dispose() {
				if (disposePromise) return disposePromise;
				disposePromise = (async () => {
					unsubscribe?.();
					const stopping = shutdownNested(`Parent subagent "${spec.name}" ended.`);
					childSession.dispose();
					eventBus.clear();
					await stopping;
				})();
				return disposePromise;
			},
		};
	} catch (error) {
		const stopping = stopAttachedManagers(`Child subagent "${spec.name}" failed during initialization.`);
		session?.dispose();
		eventBus.clear();
		await stopping;
		throw error;
	}
}

function modelVisibleResult(payload: unknown) {
	const capped = capModelOutput(payload);
	return {
		content: [{ type: "text" as const, text: capped.text }],
		details: { payload, modelOutputTruncated: capped.truncated },
	};
}

/** Render a page response without re-wrapping the bounded page text. */
function modelVisiblePage(page: ResultPageResponse) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
		details: { payload: page },
	};
}

function renderCallText(label: string, detail: string, theme: any) {
	return new Text(`${theme.fg("toolTitle", theme.bold(label))}${theme.fg("dim", detail)}`, 0, 0);
}

export default function subagentsExtension(pi: ExtensionAPI) {
	let rootUi: ExtensionUIContext | undefined;
	let manager!: SubagentManager;

	const updateFooter = (count = manager?.activeCount ?? 0) => {
		try {
			rootUi?.setStatus(FOOTER_KEY, `subagents: ${count}`);
		} catch {
			// A stale TUI context can race a session replacement; its footer is already being torn down.
		}
	};

	manager = new SubagentManager({
		adapter: { initialize: createChild },
		onChange: updateFooter,
	});

	let childScopeAttached = false;
	const detachChildConfiguration = pi.events.on(SUBAGENT_CHILD_CONFIG_EVENT, (payload) => {
		if (!isChildManagerConfiguration(payload)) return;
		if (childScopeAttached) throw new Error("Child subagent manager was configured more than once.");
		manager.attachScope(payload.scope);
		childScopeAttached = true;
		payload.attach(manager);
	});

	function rememberContext(ctx: { ui: ExtensionUIContext }) {
		rootUi = ctx.ui;
		updateFooter();
	}

	function validationContext(ctx: {
		cwd: string;
		model: Model<any> | undefined;
		modelRegistry: {
			find(provider: string, id: string): Model<any> | undefined;
			hasConfiguredAuth(model: Model<any>): boolean;
		};
	}) {
		// Build one immutable catalog snapshot from root tool state.
		const catalog = buildToolCatalog(
			pi.getAllTools() as ToolDef[],
			pi.getActiveTools(),
			[...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES],
		);

		const currentModel = ctx.model
			? describeModel(ctx.model, ctx.modelRegistry.hasConfiguredAuth(ctx.model))
			: undefined;
		return {
			currentModel,
			currentThinkingLevel: pi.getThinkingLevel() as ThinkingLevel,
			findModel(provider: string, id: string) {
				const model = ctx.modelRegistry.find(provider, id);
				return model ? describeModel(model, ctx.modelRegistry.hasConfiguredAuth(model)) : undefined;
			},
			clampThinkingLevel(descriptor: ModelDescriptor, level: ThinkingLevel) {
				const model = ctx.modelRegistry.find(descriptor.provider, descriptor.id);
				if (!model) return "off" as ThinkingLevel;
				return clampThinkingLevel(model, level) as ThinkingLevel;
			},
			cwd: ctx.cwd,
			catalog,
		};
	}

	pi.registerTool({
		name: "subagent_spawn",
		label: "Spawn subagents",
		description:
			"Launch one or more isolated in-memory Pi subagents. Omit agents[].tools to enable every registered child-allowed ordinary tool by default; provide an exact allowlist to restrict tools, or [] for none. Explicitly listed registered tools are enabled for the child even when inactive in the caller. allowSubagents is off by default and separately grants the complete control bundle to a root child for exactly one nested delegation layer. Names are unique within their parent session. A batch is validated and initialized atomically before any delegated task starts. Children inherit the caller model, thinking level, and cwd unless model/thinking overrides are supplied. Maximum 8 active agents across the complete tree.",
		promptSnippet: "Launch isolated subagents with optional one-layer delegation",
		promptGuidelines: [
			"After spawning subagents, call subagent_poll until every launched agent reaches a terminal state.",
			"Give each child a self-contained task because it does not receive the caller transcript.",
			"All registered child-allowed ordinary tools are enabled by default when tools is omitted. To restrict a child, provide the complete exact allowlist; use tools: [] for no ordinary tools. A caller-inactive tool is valid when registered, but an unregistered tool name is not; in the standard coding harness use bash for grep/find/ls commands rather than requesting separate grep, find, or ls APIs.",
			"Keep allowSubagents off unless that specific root child must delegate; nested agents cannot spawn again.",
		],
		parameters: Type.Object(
			{ agents: Type.Array(agentParameters, { minItems: 1, maxItems: 8 }) },
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			rememberContext(ctx);
			const agents = await manager.spawn(params.agents as AgentSpec[], validationContext(ctx));
			return modelVisibleResult({ agents });
		},
		renderCall(args, theme) {
			const detail = args.agents
				.map((agent) => {
					const model = agent.provider && agent.model ? `${agent.provider}/${agent.model}` : "inherited model";
					const nesting = agent.allowSubagents ? ", one nested layer" : "";
					return `${agent.name} (${model}, ${agent.thinkingLevel ?? "inherited thinking"}${nesting})`;
				})
				.join(", ");
			return renderCallText("subagents ", detail, theme);
		},
		renderResult(result, _options, theme) {
			const agents = (result.details as any)?.payload?.agents as Array<any> | undefined;
			const detail = agents?.map((agent) => `${agent.name}: ${agent.provider}/${agent.model}:${agent.thinkingLevel}`).join(", ") ?? "";
			return new Text(theme.fg("success", detail || "launch complete"), 0, 0);
		},
	});

	pi.registerTool({
		name: "subagent_poll",
		label: "Poll subagents",
		description:
			"Return every previously undelivered terminal subagent result exactly once. If none is ready, wait up to timeoutSeconds (default 60) and return early for a result, queued user input, cancellation, or root abort. Also returns a snapshot of remaining agents. Only one blocking poll may run at once.",
		promptSnippet: "Wait for and consume newly completed subagent results",
		parameters: Type.Object(
			{
				names: namesParameter,
				timeoutSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 3_600, default: 60 })),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			rememberContext(ctx);
			const response = await manager.poll({
				names: params.names,
				timeoutSeconds: params.timeoutSeconds,
				shouldWake: () => ctx.hasPendingMessages(),
				signal,
			});
			return modelVisibleResult(response);
		},
		renderCall(args, theme) {
			return renderCallText("poll subagents ", `${args.timeoutSeconds ?? 60}s`, theme);
		},
		renderResult(result, _options, theme) {
			const payload = (result.details as any)?.payload;
			return new Text(
				theme.fg("success", `${payload?.results?.length ?? 0} result(s)`) +
					theme.fg("dim", `, ${payload?.remaining?.length ?? 0} remaining (${payload?.wakeReason ?? "done"})`),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "subagent_status",
		label: "Subagent status",
		description:
			"Inspect subagent states, turns, usage, duration, and errors without consuming poll results. Use includeResults to retrieve completed final text, or resultPage to page through oversized results one segment at a time. resultPage is exclusive: do not combine it with names or includeResults. Oversized results are never placed in model-visible content or tool details — retrieve them with resultPage.",
		promptSnippet: "Inspect subagent state without consuming results",
		parameters: Type.Object(
			{
				names: namesParameter,
				includeResults: Type.Optional(Type.Boolean({ default: false })),
				resultPage: Type.Optional(
					Type.Object(
						{
							name: Type.String({ description: "Case-insensitive subagent name." }),
							cursor: Type.Optional(
								Type.String({ description: "Opaque cursor from a previous page response." }),
							),
							maxBytes: Type.Optional(
								Type.Number({
									minimum: 4,
									maximum: 1_048_576,
									default: 4_096,
									description:
										"Maximum page size in UTF-8 bytes (4–1048576). Pages end on code-point boundaries.",
								}),
							),
						},
						{ additionalProperties: false },
					),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			rememberContext(ctx);
			const result = manager.status({
				names: params.names as string[] | undefined,
				includeResults: params.includeResults as boolean | undefined,
				resultPage: params.resultPage as { name: string; cursor?: string; maxBytes?: number } | undefined,
			});
			if (params.resultPage) {
				return modelVisiblePage(result as ResultPageResponse);
			}
			return modelVisibleResult({ agents: result as SubagentResult[] });
		},
		renderCall(_args, theme) {
			return renderCallText("subagent status", "", theme);
		},
	});

	pi.registerTool({
		name: "subagent_cancel",
		label: "Cancel subagents",
		description:
			"Cancel selected subagents by names, or every subagent with all: true. Active child sessions and their owned descendants are aborted and disposed with bounded cascading cleanup; non-cooperative children are force-terminalized so root accounting always settles. Selected terminal results are marked delivered so they no longer trigger polling reminders.",
		promptSnippet: "Abort and dispose selected subagents",
		parameters: Type.Object(
			{ names: namesParameter, all: Type.Optional(Type.Boolean()) },
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			rememberContext(ctx);
			const agents = await manager.cancel({ names: params.names, all: params.all });
			return modelVisibleResult({ agents });
		},
		renderCall(args, theme) {
			return renderCallText("cancel subagents ", args.all ? "all" : (args.names?.join(", ") ?? ""), theme);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		rememberContext(ctx);
	});

	pi.on("agent_settled", async () => {
		if (!manager.claimReminder()) return;
		pi.sendMessage(
			{
				customType: "subagent-poll-reminder",
				content:
					"Subagent work or undelivered results remain. Call subagent_poll now and continue polling until no agents remain. Handle any queued user message first if appropriate, then return to polling.",
				display: false,
				details: { active: manager.activeCount },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	});

	pi.on("session_shutdown", async (event) => {
		detachChildConfiguration();
		await manager.shutdown(`Root session ${event.reason}.`);
		try {
			rootUi?.setStatus(FOOTER_KEY, undefined);
		} catch {
			// The UI can already be detached during shutdown.
		}
		rootUi = undefined;
	});
}
