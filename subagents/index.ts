import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
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
	CHILD_EXCLUDED_TOOL_NAMES,
	compareToolFingerprints,
	fingerprintActiveToolDefs,
	type AgentSpec,
	type ChildHandle,
	type ChildRunResult,
	type ModelDescriptor,
	type ResolvedAgentSpec,
	type ResultPageResponse,
	type SubagentResult,
	SubagentManager,
	THINKING_LEVELS,
	type ThinkingLevel,
	type ToolDef,
	type ToolFingerprint,
} from "./core.ts";

const FOOTER_KEY = "subagents";

const agentParameters = Type.Object(
	{
		name: Type.String({ description: "A case-insensitively unique name for this root session." }),
		task: Type.String({ description: "The complete delegated task. The child receives no caller transcript." }),
		tools: Type.Array(Type.String(), {
			description: "Complete exact set of case-sensitive tool API names. Use [] for no project tools.",
			uniqueItems: true,
		}),
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

async function createChild(spec: ResolvedAgentSpec): Promise<ChildHandle> {
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
	try {
		const services = await createAgentSessionServices({ cwd: spec.cwd, agentDir: getAgentDir() });
		const diagnosticErrors = services.diagnostics.filter((diagnostic) => diagnostic.type === "error");
		if (diagnosticErrors.length > 0) {
			throw new Error(diagnosticErrors.map((diagnostic) => diagnostic.message).join("; "));
		}

		const model = services.modelRegistry.find(spec.provider, spec.model);
		if (!model) throw new Error(`Child could not reproduce model ${spec.provider}/${spec.model}.`);
		if (!services.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`Child model ${spec.provider}/${spec.model} does not have configured authentication.`);
		}

		const requestedNames = spec.expectedTools.map((tool) => tool.name);
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(spec.cwd),
			model,
			thinkingLevel: spec.thinkingLevel,
			tools: requestedNames,
			noTools: requestedNames.length === 0 ? "all" : undefined,
			sessionStartEvent: { type: "session_start", reason: "startup" },
		});
		session = created.session;
		const extensionErrors: string[] = [];
		await session.bindExtensions({
			mode: "print",
			onError: (error) => extensionErrors.push(`${error.extensionPath}: ${error.error}`),
		});
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

		// Resolve metadata only for active definitions; configured inactive tools never participate.
		const actualTools = fingerprintActiveToolDefs(
			session.getAllTools() as ToolDef[],
			session.getActiveToolNames(),
		);
		const mismatch = compareToolFingerprints(spec.expectedTools, actualTools);
		if (mismatch) throw new Error(mismatch);

		const childSession = session;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;

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
				await childSession.abort();
			},
			dispose() {
				if (disposed) return;
				disposed = true;
				unsubscribe?.();
				childSession.dispose();
			},
		};
	} catch (error) {
		session?.dispose();
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
			[...CHILD_EXCLUDED_TOOL_NAMES],
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
			"Launch one or more isolated in-memory Pi subagents. Every agent supplies a complete exact tools array (use [] for no project tools). Names are unique for the root session. A batch is validated and initialized atomically before any delegated task starts. Children inherit the caller model, thinking level, and cwd unless model/thinking overrides are supplied. Maximum 8 active agents.",
		promptSnippet: "Launch isolated subagents as a flat concurrent pool",
		promptGuidelines: [
			"After spawning subagents, call subagent_poll until every launched agent reaches a terminal state.",
			"Give each child a self-contained task because it does not receive the caller transcript.",
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
					return `${agent.name} (${model}, ${agent.thinkingLevel ?? "inherited thinking"})`;
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
			"Cancel selected subagents by names, or every subagent with all: true. Active child sessions are aborted and disposed, with a bounded grace period; non-cooperative children are force-terminalized so root accounting always settles. Selected terminal results are marked delivered so they no longer trigger polling reminders.",
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
		await manager.shutdown(`Root session ${event.reason}.`);
		try {
			rootUi?.setStatus(FOOTER_KEY, undefined);
		} catch {
			// The UI can already be detached during shutdown.
		}
		rootUi = undefined;
	});
}
