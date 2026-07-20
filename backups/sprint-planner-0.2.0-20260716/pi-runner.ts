import type { AssistantMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	type EventBus,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { safeSessionId } from "./commands.ts";
import { validateSubmission } from "./validation.ts";
import type {
	ModelTuple,
	PreparedWorker,
	WorkerFailureKind,
	WorkerRequest,
	WorkerResult,
	WorkerSubmission,
	WorkflowRunner,
} from "./types.ts";

const QUESTION_REQUEST_CHANNEL = "user-questioning:request:v1";
const QUESTION_RESPONSE_PREFIX = "user-questioning:response:v1:";
const QUESTION_DISCOVERY_CHANNEL = "user-questioning:discover:v1";
const QUESTION_AVAILABLE_PREFIX = "user-questioning:available:v1:";
const TOOL_NAMES = ["roles", "markdown", "files"] as const;

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

function failureKind(error: unknown): WorkerFailureKind {
	const text = error instanceof Error ? error.message : String(error);
	return /overload|rate.?limit|timeout|timed out|temporar|unavailable|ECONN|socket|429|5\d\d/i.test(text) ? "transient" : "fatal";
}

interface ActiveChild {
	session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"];
	unsubscribe?: () => void;
}

export interface PiWorkflowRunnerOptions {
	events: EventBus;
	agentDir?: string;
}

export class PiWorkflowRunner implements WorkflowRunner {
	readonly events: EventBus;
	readonly agentDir: string;
	readonly #active = new Set<ActiveChild>();
	readonly #memory = new Map<string, SessionManager>();

	constructor(options: PiWorkflowRunnerOptions) {
		this.events = options.events;
		this.agentDir = options.agentDir ?? getAgentDir();
	}

	async prepare(request: WorkerRequest): Promise<PreparedWorker> {
		if (!request.persistent) return { sessionPath: request.sessionPath };
		if (request.sessionPath) return { sessionPath: request.sessionPath };
		if (!request.sessionDirectory) throw new Error("Persistent worker is missing a session directory.");
		await mkdir(request.sessionDirectory, { recursive: true });
		const manager = SessionManager.create(request.cwd, request.sessionDirectory, { id: safeSessionId(request.id) });
		manager.appendCustomEntry("sprint-planner-checkpoint", {
			workerId: request.id,
			role: request.role,
			model: request.model,
			createdAt: new Date().toISOString(),
		});
		const sessionPath = manager.getSessionFile();
		if (!sessionPath) throw new Error("Pi did not create a persistent child-session checkpoint.");
		return { sessionPath };
	}

	async run(request: WorkerRequest, signal: AbortSignal): Promise<WorkerResult> {
		let child: ActiveChild | undefined;
		try {
			let submission: WorkerSubmission | undefined;
			let questionRounds = 0;
			let questionFailure: string | undefined;
			let seniorCalls = 0;
			const tools: any[] = [];

			tools.push({
				name: "sprint_submit",
				label: "Submit sprint artifact",
				description: `Submit the complete typed ${request.expectation.kind} artifact to the deterministic workflow engine.`,
				parameters: Type.Object(
					{
						kind: StringEnum(TOOL_NAMES),
						content: Type.Optional(Type.String({ maxLength: 2_000_000 })),
						files: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 512 }), content: Type.String({ minLength: 1, maxLength: 2_000_000 }) }, { additionalProperties: false }), { maxItems: 200 })),
					},
					{ additionalProperties: false },
				),
				executionMode: "sequential",
				async execute(_toolCallId: string, params: WorkerSubmission) {
					if (submission) throw new Error("This worker already submitted its artifact.");
					const validated = validateSubmission(params, request.expectation);
					submission = { kind: validated.kind, ...(validated.content !== undefined ? { content: validated.content } : {}), ...(validated.files ? { files: validated.files.map((file) => ({ ...file })) } : {}) };
					return { content: [{ type: "text" as const, text: "Artifact accepted by the deterministic workflow engine. Finish this turn without resubmitting." }], details: { accepted: true } };
				},
			});

			if (request.allowQuestions) {
				tools.push({
					name: "sprint_ask_questions",
					label: "Ask root user",
					description: "Ask one round of up to three root-context choice questions through the user-questioning event-bus service.",
					parameters: Type.Object({ questions: Type.Array(Type.Object({ id: Type.String(), header: Type.String(), question: Type.String(), options: Type.Array(Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }, { additionalProperties: false }), { minItems: 2, maxItems: 5 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 3 }) }, { additionalProperties: false }),
					executionMode: "sequential",
					execute: async (_toolCallId: string, params: { questions: unknown[] }, toolSignal: AbortSignal) => {
						questionRounds++;
						if (questionRounds > (request.maxQuestionRounds ?? 3)) throw new Error("The maximum interactive question rounds has been reached.");
						const response = await this.#requestQuestion(params.questions, toolSignal);
						if (!response.ok) {
							questionFailure = response.error;
							throw new Error(response.error);
						}
						if (response.result?.cancelled) {
							questionFailure = "The user cancelled the interactive ironout questionnaire.";
							throw new Error(questionFailure);
						}
						return { content: [{ type: "text" as const, text: JSON.stringify(response.result) }], details: response.result };
					},
				});
			}

			if ((request.maxSeniorCalls ?? 0) > 0 && request.seniorModel) {
				tools.push({
					name: "sprint_consult_senior",
					label: "Consult senior",
					description: "Request a bounded senior advisory call for a genuinely advanced or blocked area.",
					parameters: Type.Object({ task: Type.String({ minLength: 1, maxLength: 100_000 }) }, { additionalProperties: false }),
					executionMode: "sequential",
					execute: async (_toolCallId: string, params: { task: string }, toolSignal: AbortSignal) => {
						seniorCalls++;
						if (seniorCalls > (request.maxSeniorCalls ?? 0)) throw new Error("The maximum senior-advisor calls has been reached.");
						const text = await this.#runAdvisor(request, params.task, request.seniorModel!, toolSignal);
						return { content: [{ type: "text" as const, text }], details: { call: seniorCalls } };
					},
				});
			}

			if (request.persistent && !request.sessionPath) throw new Error("Persistent worker has no prepared child-session checkpoint.");
			const memoryKey = request.sessionPath?.startsWith("memory:") ? request.sessionPath : undefined;
			const manager = request.persistent
				? SessionManager.open(request.sessionPath!, dirname(request.sessionPath!), request.cwd)
				: memoryKey
					? this.#memory.get(memoryKey) ?? SessionManager.inMemory(request.cwd, { id: safeSessionId(request.id) })
					: SessionManager.inMemory(request.cwd, { id: safeSessionId(request.id) });
			if (memoryKey) this.#memory.set(memoryKey, manager);
			child = await this.#createChild(request.cwd, manager, request.model, request.mode, request.role.includes("red team"), tools);
			this.#active.add(child);

			const abort = () => void child!.session.abort().catch(() => undefined);
			signal.addEventListener("abort", abort, { once: true });
			let thrown: unknown;
			try {
				const prompt = request.retryPrompt ? `${request.retryPrompt}\n\n${request.prompt}` : request.prompt;
				await child.session.prompt(prompt, { expandPromptTemplates: false, source: "extension" });
			} catch (error) {
				thrown = error;
			} finally {
				signal.removeEventListener("abort", abort);
			}
			const assistant = finalAssistant(child.session.messages);
			const stopReason = assistant?.stopReason;
			if (signal.aborted || stopReason === "aborted") return { ok: false, sessionPath: request.sessionPath ?? child.session.sessionFile, error: "Worker was cancelled.", failureKind: "cancelled" };
			if (questionFailure) return { ok: false, sessionPath: request.sessionPath ?? child.session.sessionFile, finalText: assistantText(assistant), error: questionFailure, failureKind: "cancelled" };
			if (thrown || assistant?.errorMessage || stopReason === "error") {
				const error = thrown ?? assistant?.errorMessage ?? "Provider returned an error stop reason.";
				return { ok: false, sessionPath: request.sessionPath ?? child.session.sessionFile, finalText: assistantText(assistant), error: error instanceof Error ? error.message : String(error), failureKind: failureKind(error) };
			}
			if (!submission) return { ok: false, sessionPath: request.sessionPath ?? child.session.sessionFile, finalText: assistantText(assistant), error: "Worker completed without calling sprint_submit.", failureKind: "malformed" };
			return { ok: true, submission, sessionPath: request.sessionPath ?? child.session.sessionFile, finalText: assistantText(assistant) };
		} catch (error) {
			return { ok: false, sessionPath: request.sessionPath, error: error instanceof Error ? error.message : String(error), failureKind: failureKind(error) };
		} finally {
			if (child) this.#dispose(child);
			if (request.sessionPath?.startsWith("memory:") && signal.aborted) this.#memory.delete(request.sessionPath);
		}
	}

	async abortAll(): Promise<void> {
		await Promise.all([...this.#active].map((child) => child.session.abort().catch(() => undefined)));
		for (const child of [...this.#active]) this.#dispose(child);
		this.#memory.clear();
	}

	async #createChild(cwd: string, manager: SessionManager, modelTuple: ModelTuple, mode: WorkerRequest["mode"], isolated: boolean, customTools: any[]): Promise<ActiveChild> {
		const services = await createAgentSessionServices({ cwd, agentDir: this.agentDir });
		const diagnostics = services.diagnostics.filter((item) => item.type === "error");
		if (diagnostics.length) throw new Error(diagnostics.map((item) => item.message).join("; "));
		const model = services.modelRegistry.find(modelTuple.provider, modelTuple.model);
		if (!model) throw new Error(`Required model is unavailable: ${modelTuple.provider}/${modelTuple.model}`);
		if (!services.modelRegistry.hasConfiguredAuth(model)) throw new Error(`Required model has no configured authentication: ${modelTuple.provider}/${modelTuple.model}`);
		const supported = getSupportedThinkingLevels(model);
		if (!supported.includes(modelTuple.thinking as any)) throw new Error(`${modelTuple.provider}/${modelTuple.model} does not support required thinking level ${modelTuple.thinking}.`);
		const builtins = isolated ? [] : ["read", "grep", "find", "ls"];
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: manager,
			model,
			thinkingLevel: modelTuple.thinking,
			tools: [...builtins, ...customTools.map((tool) => tool.name)],
			customTools,
			sessionStartEvent: { type: "session_start", reason: manager.getEntries().length ? "resume" : "startup" },
		});
		const extensionErrors: string[] = [];
		await created.session.bindExtensions({ mode: "print", onError: (error) => extensionErrors.push(`${error.extensionPath}: ${error.error}`) });
		if (extensionErrors.length) {
			created.session.dispose();
			throw new Error(extensionErrors.join("; "));
		}
		if (created.session.model?.provider !== modelTuple.provider || created.session.model?.id !== modelTuple.model || created.session.thinkingLevel !== modelTuple.thinking) {
			created.session.dispose();
			throw new Error(`Child model tuple drifted from ${modelTuple.provider}/${modelTuple.model}:${modelTuple.thinking}.`);
		}
		return { session: created.session };
	}

	async #runAdvisor(parent: WorkerRequest, task: string, model: ModelTuple, signal: AbortSignal): Promise<string> {
		const manager = SessionManager.inMemory(parent.cwd, { id: safeSessionId(`${parent.id}-advisor`) });
		const child = await this.#createChild(parent.cwd, manager, model, parent.mode, false, []);
		this.#active.add(child);
		const abort = () => void child.session.abort().catch(() => undefined);
		signal.addEventListener("abort", abort, { once: true });
		try {
			await child.session.prompt(`Provide bounded senior advice for this exact task. Do not implement and do not add scope.\n\n${task}`, { expandPromptTemplates: false, source: "extension" });
			const assistant = finalAssistant(child.session.messages);
			if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted") throw new Error(assistant?.errorMessage ?? "Senior adviser failed.");
			return assistantText(assistant);
		} finally {
			signal.removeEventListener("abort", abort);
			this.#dispose(child);
		}
	}

	#requestQuestion(questions: unknown[], signal: AbortSignal): Promise<any> {
		return this.#questionServiceAvailable(signal).then((available) => {
			if (!available) return { ok: false, error: "The root user-questioning event-bus service is not installed or active." };
			return this.#sendQuestion(questions, signal);
		});
	}

	#sendQuestion(questions: unknown[], signal: AbortSignal): Promise<any> {
		const requestId = `sprint-question-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const channel = `${QUESTION_RESPONSE_PREFIX}${requestId}`;
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				signal.removeEventListener("abort", abort);
				resolve(value);
			};
			const unsubscribe = this.events.on(channel, finish);
			const timer = setTimeout(() => finish({ ok: false, error: "The root question service timed out." }), 15 * 60_000);
			const abort = () => finish({ ok: false, error: "Question request was cancelled." });
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) return abort();
			this.events.emit(QUESTION_REQUEST_CHANNEL, { requestId, kind: "choices", questions, signal });
		});
	}

	#questionServiceAvailable(signal: AbortSignal): Promise<boolean> {
		const requestId = `sprint-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const channel = `${QUESTION_AVAILABLE_PREFIX}${requestId}`;
		return new Promise((resolve) => {
			let settled = false;
			const finish = (available: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				signal.removeEventListener("abort", abort);
				resolve(available);
			};
			const unsubscribe = this.events.on(channel, () => finish(true));
			const timer = setTimeout(() => finish(false), 250);
			const abort = () => finish(false);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) return abort();
			this.events.emit(QUESTION_DISCOVERY_CHANNEL, { requestId });
		});
	}

	#dispose(child: ActiveChild): void {
		child.unsubscribe?.();
		child.session.dispose();
		this.#active.delete(child);
	}
}
