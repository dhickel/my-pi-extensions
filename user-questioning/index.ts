import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	type ChoiceResult,
	MAX_HEADER_LENGTH,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	OTHER_LABEL,
	QUESTION_SERVICE_REQUEST_CHANNEL,
	QUESTION_SERVICE_DISCOVERY_CHANNEL,
	QUESTION_SERVICE_AVAILABLE_PREFIX,
	questionServiceResponseChannel,
	type QuestionServiceRequest,
	type QuestionServiceResponse,
	type Question,
	QuestionnaireState,
	runSequentialQuestionnaire,
	type TextResult,
	validateQuestions,
	writtenAnswer,
} from "./core.ts";

const QUESTIONING_GUIDELINES = [
	"Ask the user questions only while planning, ironing out requirements, or when the user explicitly requests an interactive decision discussion.",
	"Explore the repository and relevant environment before asking the user; do not ask for facts that can be discovered safely from available context or tools.",
	"Prefer ask_user_choices. Use ask_user_text only when meaningful choices cannot capture the intent, authority, or nuance required to proceed safely.",
	"For a genuine technical or project-context impasse, first delegate a self-contained senior-advisor task through subagent_spawn; do not use either user-questioning tool as the first escalation.",
	"After senior-advisor delegation fails or is unavailable, question the user only when missing intent, authority, or nuance still prevents safe progress.",
	"A cancelled or no-answer result is final for that request. Do not automatically retry a user-questioning tool unless the user explicitly asks to revisit it.",
];

const OptionSchema = Type.Object(
	{
		label: Type.String({ minLength: 1, description: `Option label. Do not supply ${OTHER_LABEL}; it is added internally.` }),
		description: Type.Optional(Type.String({ minLength: 1, description: "Optional explanation of the tradeoff." })),
	},
	{ additionalProperties: false },
);

const QuestionSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, description: "Case-insensitively unique identifier returned with the answer." }),
		header: Type.String({
			minLength: 1,
			maxLength: MAX_HEADER_LENGTH,
			description: "Short tab/header label, such as Scope or Runtime.",
		}),
		question: Type.String({ minLength: 1, description: "Full decision question shown to the user." }),
		options: Type.Array(OptionSchema, {
			minItems: MIN_OPTIONS,
			maxItems: MAX_OPTIONS,
			description: `Two to five meaningful choices. ${OTHER_LABEL} is always added by the UI.`,
		}),
	},
	{ additionalProperties: false },
);

const ChoicesParameters = Type.Object(
	{
		questions: Type.Array(QuestionSchema, {
			minItems: 1,
			maxItems: MAX_QUESTIONS,
			description: "One to three decisions to collect together.",
		}),
	},
	{ additionalProperties: false },
);

const TextParameters = Type.Object(
	{ question: Type.String({ minLength: 1, description: "The nuanced question shown above Pi's multiline editor." }) },
	{ additionalProperties: false },
);

function choiceToolResult(result: ChoiceResult, message?: string) {
	const text = message ?? (result.cancelled ? "User cancelled the questionnaire; partial answers were discarded." : JSON.stringify(result));
	return { content: [{ type: "text" as const, text }], details: result };
}

function textToolResult(result: TextResult, message?: string) {
	let text = message;
	if (!text) {
		if (result.cancelled) text = "User cancelled without answering.";
		else if (result.answer === null) text = "User submitted no written answer.";
		else text = `User wrote:\n${result.answer}`;
	}
	return { content: [{ type: "text" as const, text }], details: result };
}

function editorTheme(theme: any): EditorTheme {
	return {
		borderColor: (value) => theme.fg("accent", value),
		selectList: {
			selectedPrefix: (value) => theme.fg("accent", value),
			selectedText: (value) => theme.fg("accent", value),
			description: (value) => theme.fg("muted", value),
			scrollInfo: (value) => theme.fg("dim", value),
			noMatch: (value) => theme.fg("warning", value),
		},
	};
}

async function runTerminalQuestionnaire(
	questions: readonly Question[],
	ctx: any,
	signal?: AbortSignal,
): Promise<ChoiceResult> {
	return ctx.ui.custom<ChoiceResult>((tui: any, theme: any, _keybindings: any, done: (result: ChoiceResult) => void) => {
		const state = new QuestionnaireState(questions);
		const editor = new Editor(tui, editorTheme(theme));
		let cachedLines: string[] | undefined;
		let validationMessage = "";
		let finished = false;

		function refresh() {
			cachedLines = undefined;
			tui.requestRender();
		}

		function finish(result: ChoiceResult) {
			if (finished) return;
			finished = true;
			done(result);
		}

		function cancel() {
			finish(state.cancelledResult());
		}

		const abort = () => cancel();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) queueMicrotask(abort);

		editor.onSubmit = (value) => {
			const outcome = state.submitOther(value);
			if (outcome === "blank") {
				validationMessage = "Answer cannot be blank.";
				refresh();
				return;
			}
			validationMessage = "";
			editor.setText("");
			if (outcome === "complete") finish(state.completedResult());
			else refresh();
		};

		function handleInput(data: string) {
			if (finished) return;
			if (state.editingOther) {
				if (matchesKey(data, Key.escape)) {
					state.escapeOther();
					editor.setText("");
					validationMessage = "";
					refresh();
					return;
				}
				editor.handleInput(data);
				validationMessage = "";
				refresh();
				return;
			}

			if (state.isMulti && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) {
				state.moveTab(1);
				validationMessage = "";
				refresh();
				return;
			}
			if (state.isMulti && (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left))) {
				state.moveTab(-1);
				validationMessage = "";
				refresh();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				cancel();
				return;
			}
			if (state.isReview) {
				if (matchesKey(data, Key.enter)) {
					const result = state.submitReview();
					if (result) finish(result);
					else {
						validationMessage = "Answer every question before submitting.";
						refresh();
					}
				}
				return;
			}
			if (matchesKey(data, Key.up)) {
				state.moveOption(-1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				state.moveOption(1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				const outcome = state.selectCurrent();
				validationMessage = "";
				if (outcome === "complete") finish(state.completedResult());
				else refresh();
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const renderWidth = Math.max(1, width);
			const question = state.currentQuestion;

			function addWrapped(text: string) {
				lines.push(...wrapTextWithAnsi(text, renderWidth));
			}

			function addPrefixed(prefix: string, text: string) {
				const prefixWidth = visibleWidth(prefix);
				if (prefixWidth >= renderWidth) {
					addWrapped(prefix + text);
					return;
				}
				const wrapped = wrapTextWithAnsi(text, Math.max(1, renderWidth - prefixWidth));
				for (let index = 0; index < wrapped.length; index++) {
					lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[index]}`);
				}
			}

			lines.push(theme.fg("accent", "─".repeat(renderWidth)));
			if (state.isMulti) {
				const tabs = questions.map((item, index) => {
					const answered = state.answerFor(item.id) !== undefined;
					const label = ` ${answered ? "■" : "□"} ${item.header} `;
					return state.currentTab === index
						? theme.bg("selectedBg", theme.fg("text", label))
						: theme.fg(answered ? "success" : "muted", label);
				});
				const reviewLabel = " ✓ Review ";
				tabs.push(
					state.isReview
						? theme.bg("selectedBg", theme.fg("text", reviewLabel))
						: theme.fg(state.allAnswered ? "success" : "dim", reviewLabel),
				);
				addPrefixed(" ", tabs.join(" "));
				lines.push("");
			}

			if (state.isReview) {
				addPrefixed(" ", theme.fg("accent", theme.bold("Review answers")));
				lines.push("");
				for (const item of questions) {
					const answer = state.answerFor(item.id);
					const displayed = answer ? `${answer.source === "other" ? "(wrote) " : ""}${answer.answer}` : "Unanswered";
					addPrefixed(" ", `${theme.fg("muted", `${item.header}: `)}${theme.fg(answer ? "text" : "warning", displayed)}`);
				}
				lines.push("");
				addPrefixed(
					" ",
					theme.fg(state.allAnswered ? "success" : "warning", state.allAnswered ? "Press Enter to submit." : "All questions must be answered."),
				);
			} else if (question) {
				addPrefixed(" ", theme.fg("text", question.question));
				lines.push("");
				const answer = state.answerFor(question.id);
				const options = [...question.options, { label: OTHER_LABEL }];
				for (let index = 0; index < options.length; index++) {
					const option = options[index];
					const selected = index === state.currentOptionIndex;
					const isOther = index === question.options.length;
					const isAnswer = answer?.source === "option" ? answer.optionIndex === index : isOther && answer?.source === "other";
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					const suffix = isAnswer ? theme.fg("success", " ✓") : "";
					addPrefixed(prefix, `${theme.fg(selected ? "accent" : "text", `${index + 1}. ${option.label}`)}${suffix}`);
					if ("description" in option && option.description) {
						addPrefixed("     ", theme.fg("muted", option.description));
					}
				}
				if (state.editingOther) {
					lines.push("");
					addPrefixed(" ", theme.fg("muted", "Your answer:"));
					for (const editorLine of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${editorLine}`);
				}
			}

			if (validationMessage) {
				lines.push("");
				addPrefixed(" ", theme.fg("warning", validationMessage));
			}
			lines.push("");
			const help = state.editingOther
				? "Enter submit • Esc return to options"
				: state.isMulti
					? "Tab/←→ tabs • ↑↓ options • Enter select/submit • Esc cancel"
					: "↑↓ options • Enter select • Esc cancel";
			addPrefixed(" ", theme.fg("dim", help));
			lines.push(theme.fg("accent", "─".repeat(renderWidth)));
			cachedLines = lines;
			return lines;
		}

		return {
			render,
			handleInput,
			invalidate: () => {
				cachedLines = undefined;
			},
			dispose: () => signal?.removeEventListener("abort", abort),
		};
	});
}

export default function userQuestioningExtension(pi: ExtensionAPI) {
	let rootContext: ExtensionContext | undefined;
	let serviceQueue = Promise.resolve();

	pi.events.on(QUESTION_SERVICE_DISCOVERY_CHANNEL, (data) => {
		const requestId = (data as { requestId?: unknown })?.requestId;
		if (typeof requestId === "string" && requestId) pi.events.emit(`${QUESTION_SERVICE_AVAILABLE_PREFIX}${requestId}`, { requestId, available: true });
	});

	async function answerServiceRequest(request: QuestionServiceRequest): Promise<QuestionServiceResponse> {
		const requestId = typeof request?.requestId === "string" ? request.requestId : "invalid";
		const ctx = rootContext;
		if (!ctx) return { requestId, ok: false, error: "The root question service is not attached to a session." };
		if (ctx.mode === "json" || ctx.mode === "print") {
			return { requestId, ok: false, error: `The root question service requires a TUI or RPC client (current mode: ${ctx.mode}).` };
		}
		if (request.signal?.aborted) return { requestId, ok: false, error: "Question request was cancelled." };
		if (request.kind === "choices") {
			const questions = validateQuestions(request.questions);
			const result =
				ctx.mode === "rpc"
					? await runSequentialQuestionnaire(questions, ctx.ui, request.signal)
					: await runTerminalQuestionnaire(questions, ctx, request.signal);
			return { requestId, ok: true, kind: "choices", result };
		}
		if (request.kind === "text") {
			const question = typeof request.question === "string" ? request.question.trim() : "";
			if (!question) return { requestId, ok: false, error: "question must be nonblank." };
			const value = await ctx.ui.editor(question, "");
			return { requestId, ok: true, kind: "text", result: writtenAnswer(value) };
		}
		return { requestId, ok: false, error: "Unknown question request kind." };
	}

	pi.events.on(QUESTION_SERVICE_REQUEST_CHANNEL, (data) => {
		const request = data as QuestionServiceRequest;
		let channel: string;
		try {
			channel = questionServiceResponseChannel(request?.requestId);
		} catch {
			return;
		}
		serviceQueue = serviceQueue.then(async () => {
			let response: QuestionServiceResponse;
			try {
				response = await answerServiceRequest(request);
			} catch (error) {
				response = { requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			pi.events.emit(channel, response);
		});
	});

	pi.on("session_start", (_event, ctx) => {
		rootContext = ctx;
	});
	pi.on("session_shutdown", () => {
		rootContext = undefined;
	});

	pi.registerTool({
		name: "ask_user_choices",
		label: "Ask user choices",
		description:
			"Root-only interactive questionnaire for one to three decisions, each with two to five meaningful options. The UI adds Other. Use only under the questioning restrictions in the prompt guidance.",
		promptSnippet: "Ask the root user one to three constrained interactive decisions",
		promptGuidelines: QUESTIONING_GUIDELINES,
		parameters: ChoicesParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			let questions: Question[];
			try {
				questions = validateQuestions(params.questions);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return choiceToolResult({ cancelled: true, answers: [] }, `Invalid questionnaire: ${message}`);
			}

			if (ctx.mode === "json" || ctx.mode === "print") {
				return choiceToolResult(
					{ cancelled: true, answers: [] },
					`Error: ask_user_choices requires an interactive TUI or RPC client (current mode: ${ctx.mode}).`,
				);
			}
			const result =
				ctx.mode === "rpc"
					? await runSequentialQuestionnaire(questions, ctx.ui, signal)
					: await runTerminalQuestionnaire(questions, ctx, signal);
			return choiceToolResult(result);
		},
		renderCall(args, theme) {
			const headers = args.questions.map((question) => question.header).join(", ");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask user "))}${theme.fg("muted", headers || "choices")}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as ChoiceResult;
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled; no answers retained"), 0, 0);
			return new Text(
				details.answers
					.map((answer) => `${theme.fg("success", "✓ ")}${theme.fg("muted", `${answer.id}: `)}${theme.fg("accent", answer.answer)}`)
					.join("\n"),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "ask_user_text",
		label: "Ask user text",
		description:
			"Root-only multiline written-answer dialog for exceptional cases where meaningful choices cannot capture required nuance.",
		promptSnippet: "Ask the root user for an exceptional nuanced written answer",
		promptGuidelines: QUESTIONING_GUIDELINES,
		parameters: TextParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const question = typeof params.question === "string" ? params.question.trim() : "";
			if (!question) return textToolResult({ cancelled: true, answer: null }, "Invalid question: question must be nonblank.");
			if (ctx.mode === "json" || ctx.mode === "print") {
				return textToolResult(
					{ cancelled: true, answer: null },
					`Error: ask_user_text requires an interactive TUI or RPC client (current mode: ${ctx.mode}).`,
				);
			}
			if (signal?.aborted) return textToolResult({ cancelled: true, answer: null });
			const value = await ctx.ui.editor(question, "");
			if (signal?.aborted) return textToolResult({ cancelled: true, answer: null });
			return textToolResult(writtenAnswer(value));
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask user text "))}${theme.fg("muted", args.question)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TextResult;
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled; no answer"), 0, 0);
			if (details.answer === null) return new Text(theme.fg("warning", "No written answer"), 0, 0);
			return new Text(`${theme.fg("success", "✓ ")}${theme.fg("accent", details.answer)}`, 0, 0);
		},
	});
}
