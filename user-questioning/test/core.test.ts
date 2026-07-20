import assert from "node:assert/strict";
import test from "node:test";
import {
	MAX_HEADER_LENGTH,
	OTHER_LABEL,
	type Question,
	QuestionnaireState,
	runSequentialQuestionnaire,
	validateQuestions,
	writtenAnswer,
} from "../core.ts";

function inputs(count = 1) {
	return Array.from({ length: count }, (_, index) => ({
		id: `q${index + 1}`,
		header: `Q${index + 1}`,
		question: `Decision ${index + 1}?`,
		options: [
			{ label: "Alpha", description: "First choice" },
			{ label: "Beta", description: "Second choice" },
		],
	}));
}

function questions(count = 1): Question[] {
	return validateQuestions(inputs(count));
}

test("validation normalizes fields and enforces the question count", () => {
	const [question] = validateQuestions([
		{
			id: " scope ",
			header: " Scope ",
			question: " Which scope? ",
			options: [
				{ label: " Small ", description: " Focused " },
				{ label: " Large " },
			],
		},
	]);
	assert.deepEqual(question, {
		id: "scope",
		header: "Scope",
		question: "Which scope?",
		options: [
			{ label: "Small", description: "Focused" },
			{ label: "Large" },
		],
	});
	assert.throws(() => validateQuestions([]), /between 1 and 3/);
	assert.throws(() => validateQuestions(inputs(4)), /between 1 and 3/);
});

test("validation rejects blank fields and overlong headers", () => {
	for (const field of ["id", "header", "question"] as const) {
		const candidate = inputs();
		candidate[0][field] = "   ";
		assert.throws(() => validateQuestions(candidate), new RegExp(`${field} must be a nonblank string`));
	}
	const candidate = inputs();
	candidate[0].header = "x".repeat(MAX_HEADER_LENGTH + 1);
	assert.throws(() => validateQuestions(candidate), /at most 32 characters/);

	const blankLabel = inputs();
	blankLabel[0].options[0].label = " ";
	assert.throws(() => validateQuestions(blankLabel), /label must be a nonblank string/);
	const blankDescription = inputs();
	blankDescription[0].options[0].description = " ";
	assert.throws(() => validateQuestions(blankDescription), /description must be a nonblank string/);
});

test("validation enforces option counts plus case-insensitive ids and labels", () => {
	const oneOption = inputs();
	oneOption[0].options.pop();
	assert.throws(() => validateQuestions(oneOption), /between 2 and 5 options/);

	const sixOptions = inputs();
	sixOptions[0].options = Array.from({ length: 6 }, (_, index) => ({ label: `O${index}` }));
	assert.throws(() => validateQuestions(sixOptions), /between 2 and 5 options/);

	const duplicateIds = inputs(2);
	duplicateIds[1].id = "Q1";
	assert.throws(() => validateQuestions(duplicateIds), /Duplicate question id/);

	const duplicateLabels = inputs();
	duplicateLabels[0].options[1].label = "ALPHA";
	assert.throws(() => validateQuestions(duplicateLabels), /Duplicate option label/);

	const suppliedOther = inputs();
	suppliedOther[0].options[1].label = OTHER_LABEL.toUpperCase();
	assert.throws(() => validateQuestions(suppliedOther), /added automatically/);
});

test("a supplied option completes a single question with a zero-based index", () => {
	const state = new QuestionnaireState(questions());
	state.moveOption(1);
	assert.equal(state.selectCurrent(), "complete");
	assert.deepEqual(state.completedResult(), {
		cancelled: false,
		answers: [{ id: "q1", answer: "Beta", source: "option", optionIndex: 1 }],
	});
});

test("Other rejects blank input, Escape returns to options, and a custom answer is trimmed", () => {
	const state = new QuestionnaireState(questions());
	state.moveOption(10);
	assert.equal(state.selectCurrent(), "editing");
	assert.equal(state.submitOther("  \n "), "blank");
	assert.equal(state.editingOther, true);
	state.escapeOther();
	assert.equal(state.editingOther, false);
	assert.equal(state.selectCurrent(), "editing");
	assert.equal(state.submitOther("  a nuanced answer  "), "complete");
	assert.deepEqual(state.completedResult(), {
		cancelled: false,
		answers: [{ id: "q1", answer: "a nuanced answer", source: "other" }],
	});
});

test("multiple questions require complete review submission and preserve question order", () => {
	const state = new QuestionnaireState(questions(3));
	assert.equal(state.selectCurrent(), "answered");
	assert.equal(state.currentTab, 1);
	state.moveTab(2);
	assert.equal(state.isReview, true);
	assert.equal(state.submitReview(), undefined, "incomplete review cannot submit");
	state.moveTab(-2);
	state.moveOption(1);
	assert.equal(state.selectCurrent(), "answered");
	assert.equal(state.currentTab, 2);
	state.moveOption(10);
	assert.equal(state.selectCurrent(), "editing");
	assert.equal(state.submitOther("third"), "answered");
	assert.equal(state.isReview, true);
	assert.deepEqual(state.submitReview(), {
		cancelled: false,
		answers: [
			{ id: "q1", answer: "Alpha", source: "option", optionIndex: 0 },
			{ id: "q2", answer: "Beta", source: "option", optionIndex: 1 },
			{ id: "q3", answer: "third", source: "other" },
		],
	});
});

test("cancellation always discards partial answers", () => {
	const state = new QuestionnaireState(questions(2));
	state.selectCurrent();
	assert.deepEqual(state.cancelledResult(), { cancelled: true, answers: [] });
});

test("RPC fallback is sequential, adds Other, and returns blank custom input to options", async () => {
	const calls: string[] = [];
	const selections = [OTHER_LABEL, OTHER_LABEL, "Beta"];
	const inputs = [" ", " custom "];
	const result = await runSequentialQuestionnaire(questions(2), {
		async select(title, options) {
			calls.push(`select:${title}:${options.join("|")}`);
			return selections.shift();
		},
		async input(title) {
			calls.push(`input:${title}`);
			return inputs.shift();
		},
	});
	assert.deepEqual(result, {
		cancelled: false,
		answers: [
			{ id: "q1", answer: "custom", source: "other" },
			{ id: "q2", answer: "Beta", source: "option", optionIndex: 1 },
		],
	});
	assert.equal(calls.filter((call) => call.startsWith("select:")).length, 3);
	assert.match(calls[0], /Alpha\|Beta\|Other/);
});

test("RPC cancellation discards answers already collected", async () => {
	const selections: Array<string | undefined> = ["Alpha", undefined];
	const result = await runSequentialQuestionnaire(questions(2), {
		async select() {
			return selections.shift();
		},
		async input() {
			throw new Error("not used");
		},
	});
	assert.deepEqual(result, { cancelled: true, answers: [] });
});

test("written answers distinguish cancellation, blank submission, and trimmed text", () => {
	assert.deepEqual(writtenAnswer(undefined), { cancelled: true, answer: null });
	assert.deepEqual(writtenAnswer(" \n "), { cancelled: false, answer: null });
	assert.deepEqual(writtenAnswer("  line one\nline two  "), {
		cancelled: false,
		answer: "line one\nline two",
	});
});
