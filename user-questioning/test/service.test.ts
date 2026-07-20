import assert from "node:assert/strict";
import test from "node:test";
import {
	QUESTION_SERVICE_REQUEST_CHANNEL,
	questionServiceResponseChannel,
	requestRootQuestion,
	type QuestionEventBus,
} from "../core.ts";

class Bus implements QuestionEventBus {
	#listeners = new Map<string, Set<(data: unknown) => void>>();
	emit(channel: string, data: unknown): void {
		for (const listener of this.#listeners.get(channel) ?? []) listener(data);
	}
	on(channel: string, handler: (data: unknown) => void): () => void {
		const listeners = this.#listeners.get(channel) ?? new Set();
		listeners.add(handler);
		this.#listeners.set(channel, listeners);
		return () => listeners.delete(handler);
	}
}

test("root question event-bus requests correlate responses and clean up listeners", async () => {
	const bus = new Bus();
	let requestId = "";
	bus.on(QUESTION_SERVICE_REQUEST_CHANNEL, (data) => {
		requestId = (data as { requestId: string }).requestId;
		bus.emit(questionServiceResponseChannel(requestId), { requestId, ok: true, kind: "text", result: { cancelled: false, answer: "yes" } });
	});
	const response = await requestRootQuestion(bus, { kind: "text", question: "Proceed?" }, { timeoutMs: 100 });
	assert.equal(response.ok, true);
	assert.ok(requestId.startsWith("question-"));
});

test("root question request respects cancellation", async () => {
	const bus = new Bus();
	const controller = new AbortController();
	controller.abort();
	const response = await requestRootQuestion(bus, { kind: "text", question: "Proceed?" }, { signal: controller.signal });
	assert.deepEqual(response.ok, false);
});
