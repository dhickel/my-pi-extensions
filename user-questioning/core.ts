export const OTHER_LABEL = "Other";
export const MAX_QUESTIONS = 3;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const MAX_HEADER_LENGTH = 32;

export interface QuestionOptionInput {
	label: string;
	description?: string;
}

export interface QuestionInput {
	id: string;
	header: string;
	question: string;
	options: QuestionOptionInput[];
}

export interface QuestionOption {
	label: string;
	description?: string;
}

export interface Question {
	id: string;
	header: string;
	question: string;
	options: QuestionOption[];
}

export interface ChoiceAnswer {
	id: string;
	answer: string;
	source: "option" | "other";
	/** Zero-based index into the supplied options. Present only for a supplied option. */
	optionIndex?: number;
}

export interface ChoiceResult {
	cancelled: boolean;
	answers: ChoiceAnswer[];
}

export interface TextResult {
	cancelled: boolean;
	answer: string | null;
}

function requiredString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${path} must be a nonblank string.`);
	}
	return value.trim();
}

function normalizedKey(value: string): string {
	return value.toLocaleLowerCase();
}

export function validateQuestions(value: unknown): Question[] {
	if (!Array.isArray(value)) throw new Error("questions must be an array.");
	if (value.length < 1 || value.length > MAX_QUESTIONS) {
		throw new Error(`questions must contain between 1 and ${MAX_QUESTIONS} questions.`);
	}

	const ids = new Set<string>();
	return value.map((raw, questionIndex) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error(`questions[${questionIndex}] must be an object.`);
		}
		const candidate = raw as Record<string, unknown>;
		const id = requiredString(candidate.id, `questions[${questionIndex}].id`);
		const idKey = normalizedKey(id);
		if (ids.has(idKey)) {
			throw new Error(`Duplicate question id "${id}" (ids are case-insensitive).`);
		}
		ids.add(idKey);

		const header = requiredString(candidate.header, `questions[${questionIndex}].header`);
		if (header.length > MAX_HEADER_LENGTH) {
			throw new Error(`questions[${questionIndex}].header must be at most ${MAX_HEADER_LENGTH} characters.`);
		}
		const question = requiredString(candidate.question, `questions[${questionIndex}].question`);
		if (!Array.isArray(candidate.options)) {
			throw new Error(`questions[${questionIndex}].options must be an array.`);
		}
		if (candidate.options.length < MIN_OPTIONS || candidate.options.length > MAX_OPTIONS) {
			throw new Error(
				`questions[${questionIndex}].options must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`,
			);
		}

		const labels = new Set<string>();
		const options = candidate.options.map((rawOption, optionIndex) => {
			if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
				throw new Error(`questions[${questionIndex}].options[${optionIndex}] must be an object.`);
			}
			const option = rawOption as Record<string, unknown>;
			const label = requiredString(option.label, `questions[${questionIndex}].options[${optionIndex}].label`);
			const labelKey = normalizedKey(label);
			if (labelKey === normalizedKey(OTHER_LABEL)) {
				throw new Error(
					`questions[${questionIndex}].options[${optionIndex}].label must not be "${OTHER_LABEL}"; it is added automatically.`,
				);
			}
			if (labels.has(labelKey)) {
				throw new Error(
					`Duplicate option label "${label}" in question "${id}" (labels are case-insensitive).`,
				);
			}
			labels.add(labelKey);

			let description: string | undefined;
			if (option.description !== undefined) {
				description = requiredString(
					option.description,
					`questions[${questionIndex}].options[${optionIndex}].description`,
				);
			}
			return description === undefined ? { label } : { label, description };
		});

		return { id, header, question, options };
	});
}

export type SelectionOutcome = "editing" | "answered" | "complete";
export type OtherSubmissionOutcome = "blank" | "answered" | "complete";

/** Shared event-bus protocol used by root-context workflow extensions. */
export const QUESTION_SERVICE_REQUEST_CHANNEL = "user-questioning:request:v1";
export const QUESTION_SERVICE_RESPONSE_PREFIX = "user-questioning:response:v1:";
export const QUESTION_SERVICE_DISCOVERY_CHANNEL = "user-questioning:discover:v1";
export const QUESTION_SERVICE_AVAILABLE_PREFIX = "user-questioning:available:v1:";

export interface QuestionEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export type QuestionServiceRequest =
	| { requestId: string; kind: "choices"; questions: unknown[]; signal?: AbortSignal }
	| { requestId: string; kind: "text"; question: string; signal?: AbortSignal };

export type QuestionServiceResponse =
	| { requestId: string; ok: true; kind: "choices"; result: ChoiceResult }
	| { requestId: string; ok: true; kind: "text"; result: TextResult }
	| { requestId: string; ok: false; error: string };

export type QuestionServiceRequestInput = QuestionServiceRequest extends infer Request
	? Request extends unknown
		? Omit<Request, "requestId"> & { requestId?: string }
		: never
	: never;

export function questionServiceResponseChannel(requestId: string): string {
	const id = requestId.trim();
	if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) throw new Error("requestId is invalid.");
	return `${QUESTION_SERVICE_RESPONSE_PREFIX}${id}`;
}

let nextQuestionRequestId = 1;

/** Request the existing root UI without exposing root-only questioning tools to a child session. */
export async function requestRootQuestion(
	events: QuestionEventBus,
	request: QuestionServiceRequestInput,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<QuestionServiceResponse> {
	const requestId = request.requestId?.trim() || `question-${Date.now()}-${nextQuestionRequestId++}`;
	const channel = questionServiceResponseChannel(requestId);
	const timeoutMs = options.timeoutMs ?? 15 * 60_000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive.");
	if (options.signal?.aborted) return { requestId, ok: false, error: "Question request was cancelled." };

	return new Promise<QuestionServiceResponse>((resolve) => {
		let settled = false;
		const finish = (response: QuestionServiceResponse) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			options.signal?.removeEventListener("abort", abort);
			resolve(response);
		};
		const unsubscribe = events.on(channel, (data) => {
			const response = data as QuestionServiceResponse;
			if (!response || response.requestId !== requestId || typeof response.ok !== "boolean") return;
			finish(response);
		});
		const timer = setTimeout(
			() => finish({ requestId, ok: false, error: "The root question service did not respond before the timeout." }),
			timeoutMs,
		);
		const abort = () => finish({ requestId, ok: false, error: "Question request was cancelled." });
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) return abort();
		events.emit(QUESTION_SERVICE_REQUEST_CHANNEL, { ...request, requestId, signal: options.signal });
	});
}

export class QuestionnaireState {
	readonly questions: readonly Question[];
	currentTab = 0;
	editingOther = false;
	readonly #optionIndices: number[];
	readonly #answers = new Map<string, ChoiceAnswer>();

	constructor(questions: readonly Question[]) {
		if (questions.length < 1) throw new Error("QuestionnaireState requires at least one question.");
		this.questions = questions;
		this.#optionIndices = questions.map(() => 0);
	}

	get isMulti(): boolean {
		return this.questions.length > 1;
	}

	get isReview(): boolean {
		return this.isMulti && this.currentTab === this.questions.length;
	}

	get allAnswered(): boolean {
		return this.questions.every((question) => this.#answers.has(question.id));
	}

	get currentQuestion(): Question | undefined {
		return this.questions[this.currentTab];
	}

	get currentOptionIndex(): number {
		return this.#optionIndices[this.currentTab] ?? 0;
	}

	answerFor(id: string): ChoiceAnswer | undefined {
		return this.#answers.get(id);
	}

	moveTab(delta: number): void {
		if (!this.isMulti || this.editingOther) return;
		const totalTabs = this.questions.length + 1;
		this.currentTab = (this.currentTab + delta + totalTabs) % totalTabs;
	}

	moveOption(delta: number): void {
		const question = this.currentQuestion;
		if (!question || this.editingOther) return;
		const optionCountWithOther = question.options.length + 1;
		const next = Math.max(0, Math.min(optionCountWithOther - 1, this.currentOptionIndex + delta));
		this.#optionIndices[this.currentTab] = next;
	}

	selectCurrent(): SelectionOutcome {
		const question = this.currentQuestion;
		if (!question) throw new Error("Cannot select an option from the review tab.");
		const optionIndex = this.currentOptionIndex;
		if (optionIndex === question.options.length) {
			this.editingOther = true;
			return "editing";
		}

		const option = question.options[optionIndex];
		this.#answers.set(question.id, {
			id: question.id,
			answer: option.label,
			source: "option",
			optionIndex,
		});
		return this.#advanceAfterAnswer();
	}

	submitOther(value: string): OtherSubmissionOutcome {
		if (!this.editingOther) throw new Error("No custom answer is being edited.");
		const trimmed = value.trim();
		if (!trimmed) return "blank";
		const question = this.currentQuestion!;
		this.#answers.set(question.id, { id: question.id, answer: trimmed, source: "other" });
		this.editingOther = false;
		return this.#advanceAfterAnswer();
	}

	escapeOther(): void {
		this.editingOther = false;
	}

	submitReview(): ChoiceResult | undefined {
		if (!this.isReview || !this.allAnswered) return undefined;
		return this.completedResult();
	}

	completedResult(): ChoiceResult {
		if (!this.allAnswered) throw new Error("Cannot complete a questionnaire with unanswered questions.");
		return {
			cancelled: false,
			answers: this.questions.map((question) => ({ ...this.#answers.get(question.id)! })),
		};
	}

	cancelledResult(): ChoiceResult {
		return { cancelled: true, answers: [] };
	}

	#advanceAfterAnswer(): "answered" | "complete" {
		if (!this.isMulti) return "complete";
		if (this.currentTab < this.questions.length - 1) this.currentTab++;
		else this.currentTab = this.questions.length;
		return "answered";
	}
}

export interface SequentialQuestionUI {
	select(title: string, options: string[], options?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>;
}

export async function runSequentialQuestionnaire(
	questions: readonly Question[],
	ui: SequentialQuestionUI,
	signal?: AbortSignal,
): Promise<ChoiceResult> {
	const answers: ChoiceAnswer[] = [];
	for (const question of questions) {
		while (true) {
			if (signal?.aborted) return { cancelled: true, answers: [] };
			const labels = [...question.options.map((option) => option.label), OTHER_LABEL];
			const selection = await ui.select(`${question.header}: ${question.question}`, labels, { signal });
			if (selection === undefined || signal?.aborted) return { cancelled: true, answers: [] };
			if (selection === OTHER_LABEL) {
				const custom = await ui.input(`${question.header}: ${OTHER_LABEL}`, "Type your answer", { signal });
				if (signal?.aborted) return { cancelled: true, answers: [] };
				if (custom === undefined || custom.trim().length === 0) continue;
				answers.push({ id: question.id, answer: custom.trim(), source: "other" });
				break;
			}

			const optionIndex = question.options.findIndex((option) => option.label === selection);
			if (optionIndex < 0) continue;
			answers.push({ id: question.id, answer: question.options[optionIndex].label, source: "option", optionIndex });
			break;
		}
	}
	return { cancelled: false, answers };
}

export function writtenAnswer(value: string | undefined): TextResult {
	if (value === undefined) return { cancelled: true, answer: null };
	const answer = value.trim();
	return answer ? { cancelled: false, answer } : { cancelled: false, answer: null };
}
