import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
	buildToolCatalog,
	capModelOutput,
	CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES,
	CHILD_EXCLUDED_TOOL_NAMES,
	compareToolFingerprints,
	emptyUsage,
	fingerprintActiveToolDefs,
	fingerprintToolDef,
	MAX_ASSISTANT_TURNS,
	MAX_CONCURRENT_AGENTS,
	MAX_SUBAGENT_DEPTH,
	type ResultPageResponse,
	type SubagentResult,
	THINKING_LEVELS,
	type AgentSpec,
	type ChildHandle,
	type ChildRunResult,
	type ModelDescriptor,
	SUBAGENT_CONTROL_TOOL_NAMES,
	SubagentManager,
	type ThinkingLevel,
	type ToolCatalog,
	type ToolDef,
	type ToolFingerprint,
	validateSpawnBatch,
} from "../core.ts";

// ── Test helpers ───────────────────────────────────────────────

const model: ModelDescriptor = {
	provider: "test",
	id: "wide",
	authConfigured: true,
	supportedThinkingLevels: ["off", "low", "medium", "high"],
};

const narrowModel: ModelDescriptor = {
	provider: "test",
	id: "narrow",
	authConfigured: true,
	supportedThinkingLevels: ["off", "low"],
};

function makeTool(
	name: string,
	overrides: Partial<ToolDef> = {},
): ToolDef {
	return {
		name,
		description: `Description of ${name}`,
		parameters: { type: "object", properties: {} },
		promptGuidelines: [`Use ${name} for things.`],
		sourceInfo: { source: "test" },
		...overrides,
	};
}

/** Build a minimal catalog with the given active tool names. */
function catalogWithActive(...names: string[]): ToolCatalog {
	const tools = names.map((n) => makeTool(n));
	return buildToolCatalog(tools, names, [...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES]);
}

const readTool = makeTool("read", { promptGuidelines: ["Use read to inspect files."] });
const bashTool = makeTool("bash", { promptGuidelines: undefined });
const editTool = makeTool("edit", { promptGuidelines: ["Use edit for precise changes."] });
const grepTool = makeTool("grep");
const subagentControlTools = SUBAGENT_CONTROL_TOOL_NAMES.map((name) => makeTool(name));

function defaultCatalog(): ToolCatalog {
	return buildToolCatalog(
		[readTool, bashTool, editTool, grepTool, ...subagentControlTools],
		["read", "bash", "edit", "grep", ...SUBAGENT_CONTROL_TOOL_NAMES],
		[...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES],
	);
}

function validation(overrides: Record<string, unknown> = {}) {
	return {
		activeCount: 0,
		lifetimeNames: new Set<string>(),
		managerDepth: 0,
		maxSubagentDepth: MAX_SUBAGENT_DEPTH,
		currentModel: model,
		currentThinkingLevel: "high" as ThinkingLevel,
		findModel(provider: string, id: string) {
			if (provider !== "test") return undefined;
			if (id === "wide") return model;
			if (id === "narrow") return narrowModel;
			if (id === "no-auth") return { ...model, id, authConfigured: false };
			return undefined;
		},
		clampThinkingLevel(selected: ModelDescriptor, level: ThinkingLevel) {
			return selected.supportedThinkingLevels.includes(level)
				? level
				: selected.supportedThinkingLevels.at(-1)!;
		},
		cwd: "/tmp/project",
		catalog: defaultCatalog(),
		...overrides,
	};
}

function managerValidation(manager: SubagentManager) {
	const {
		activeCount: _active,
		lifetimeNames: _names,
		managerDepth: _depth,
		maxSubagentDepth: _maxDepth,
		...context
	} = validation({
		activeCount: manager.activeCount,
		lifetimeNames: manager.lifetimeNames,
	});
	return context;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function success(text = "done", usage = emptyUsage()): ChildRunResult {
	return { finalText: text, usage, stopReason: "stop" };
}

class ControlledHandle implements ChildHandle {
	provider = "test";
	model = "wide";
	thinkingLevel: ThinkingLevel = "high";
	runStarted = false;
	aborted = false;
	disposed = false;
	readonly completion = deferred<ChildRunResult>();

	run(
		_task: string,
		_hooks: { onTurn(usage?: ReturnType<typeof emptyUsage>): void },
	): Promise<ChildRunResult> {
		this.runStarted = true;
		return this.completion.promise;
	}

	abort(): void {
		if (this.aborted) return;
		this.aborted = true;
		this.completion.resolve({ ...success(""), stopReason: "aborted" });
	}

	dispose(): void {
		this.disposed = true;
	}
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// ── Tool catalog & fingerprint tests ───────────────────────────

test("fingerprintToolDef produces deterministic output", () => {
	const a = fingerprintToolDef(readTool);
	const b = fingerprintToolDef(readTool);
	assert.equal(a.fingerprint, b.fingerprint);
	assert.equal(a.name, "read");
});

test("fingerprintToolDef includes description, parameters, promptGuidelines, sourceInfo", () => {
	const fp = fingerprintToolDef(readTool);
	assert.ok(fp.fingerprint.includes("Use read to inspect files."));
	assert.ok(fp.fingerprint.includes("test"));
});

test("buildToolCatalog rejects duplicate tool definitions", () => {
	assert.throws(
		() =>
			buildToolCatalog(
				[readTool, { ...readTool }],
				["read"],
				[],
			),
		/Duplicate tool definition.*"read"/,
	);
});

test("buildToolCatalog rejects active name without definition or duplicate active identity", () => {
	assert.throws(
		() => buildToolCatalog([readTool], ["read", "missing"], []),
		/Active tool "missing" has no reproducible/,
	);
	assert.throws(
		() => buildToolCatalog([readTool], ["read", "read"], []),
		/Duplicate active tool identity.*"read"/,
	);
});

test("fingerprints reject malformed or non-reproducible active metadata", () => {
	assert.throws(
		() => fingerprintToolDef({ ...readTool, description: undefined }),
		/description must be a string/,
	);
	assert.throws(
		() => fingerprintToolDef({ ...readTool, parameters: { default: Number.NaN } }),
		/non-reproducible fingerprint metadata.*non-finite/,
	);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(
		() => fingerprintToolDef({ ...readTool, sourceInfo: cyclic }),
		/non-reproducible fingerprint metadata.*cyclic/,
	);
});

test("buildToolCatalog marks forbidden names even when inactive", () => {
	const catalog = buildToolCatalog(
		[readTool],
		["read"],
		["ask_user_choices"],
	);
	const entry = catalog.get("ask_user_choices")!;
	assert.equal(entry.active, false);
	assert.equal(entry.forbidden, true);
	assert.equal(entry.fingerprint.name, "ask_user_choices");
});

test("buildToolCatalog includes inactive non-forbidden tools for distinct diagnostics", () => {
	const catalog = buildToolCatalog(
		[readTool, bashTool],
		["read"],
		[],
	);
	const bash = catalog.get("bash")!;
	assert.equal(bash.active, false);
	assert.equal(bash.forbidden, false);
});

test("catalog snapshot is immutable and preserves fingerprints deterministically", () => {
	const a = buildToolCatalog([readTool, bashTool], ["read", "bash"], []);
	const b = buildToolCatalog([readTool, bashTool], ["read", "bash"], []);
	assert.equal(a.get("read")!.fingerprint.fingerprint, b.get("read")!.fingerprint.fingerprint);
	assert.equal(Object.isFrozen(a), true);
	assert.equal(Object.isFrozen(a.get("read")), true);
	assert.equal("set" in a, false);
});

// ── tools field validation ─────────────────────────────────────

test("tools omission grants every registered child-allowed ordinary tool", () => {
	const ordinaryTools = ["read", "bash", "edit", "grep"];
	const [resolved] = validateSpawnBatch([{ name: "a", task: "x" }], validation());
	assert.deepEqual(resolved.expectedTools.map((tool) => tool.name), ordinaryTools);
	assert.equal(resolved.allowSubagents, false);

	const [delegator] = validateSpawnBatch(
		[{ name: "delegator", task: "x", allowSubagents: true }],
		validation(),
	);
	assert.deepEqual(
		delegator.expectedTools.map((tool) => tool.name),
		[...ordinaryTools, ...SUBAGENT_CONTROL_TOOL_NAMES],
	);
});

test("default all-tools mode includes inactive definitions but excludes forbidden and control tools", () => {
	const askTools = CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES.map((name) => makeTool(name));
	const inactiveTool = makeTool("inactive");
	const catalog = buildToolCatalog(
		[readTool, inactiveTool, ...subagentControlTools, ...askTools],
		["read", ...SUBAGENT_CONTROL_TOOL_NAMES, ...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES],
		[...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES],
	);
	const [resolved] = validateSpawnBatch([{ name: "defaulted", task: "x" }], validation({ catalog }));
	assert.deepEqual(resolved.expectedTools.map((tool) => tool.name), ["read", "inactive"]);
});

test("tools non-array rejects", () => {
	const spec = { name: "a", task: "x", tools: "read" } as unknown as AgentSpec;
	assert.throws(
		() => validateSpawnBatch([spec], validation()),
		/tools must be an array/,
	);
});

test("tools non-string entry rejects", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read", 42 as unknown as string] }],
				validation(),
			),
		/tools\[1\] must be a string/,
	);
});

test("duplicate tool name in one agent rejects", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read", "bash", "read"] }],
				validation(),
			),
		/Duplicate tool "read"/,
	);
});

test("unknown tool name rejects with distinct message", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read", "nonexistent"] }],
				validation(),
			),
		/is not registered/,
	);
});

test("explicit allowlists may enable registered tools that are inactive in the caller", () => {
	const catalog = buildToolCatalog(
		[readTool, bashTool],
		["read"], // bash is registered but not active
		[],
	);
	const [resolved] = validateSpawnBatch(
		[{ name: "a", task: "x", tools: ["read", "bash"] }],
		validation({ catalog }),
	);
	assert.deepEqual(resolved.expectedTools.map((tool) => tool.name), ["read", "bash"]);
});

test("forbidden tool request rejects with distinct message", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read", "subagent_spawn"] }],
				validation(),
			),
		/is forbidden/,
	);
});

test("tools: [] is accepted as explicit no-tools and nested spawning defaults off", () => {
	const [resolved] = validateSpawnBatch(
		[{ name: "a", task: "x", tools: [] }],
		validation(),
	);
	assert.deepEqual(resolved.expectedTools, []);
	assert.equal(resolved.allowSubagents, false);
});

test("valid tools subset resolves fingerprints in request order", () => {
	const [resolved] = validateSpawnBatch(
		[{ name: "a", task: "x", tools: ["grep", "read", "bash"] }],
		validation(),
	);
	assert.equal(resolved.expectedTools.length, 3);
	assert.equal(resolved.expectedTools[0].name, "grep");
	assert.equal(resolved.expectedTools[1].name, "read");
	assert.equal(resolved.expectedTools[2].name, "bash");
});

test("allowSubagents appends the complete managed control bundle only when opted in", () => {
	const [resolved] = validateSpawnBatch(
		[{ name: "escalator", task: "x", tools: ["read"], allowSubagents: true }],
		validation(),
	);
	assert.equal(resolved.allowSubagents, true);
	assert.deepEqual(
		resolved.expectedTools.map((tool) => tool.name),
		["read", ...SUBAGENT_CONTROL_TOOL_NAMES],
	);
});

test("allowSubagents may enable registered control tools that are inactive in the caller", () => {
	const catalog = buildToolCatalog(
		[readTool, ...subagentControlTools],
		["read"],
		[...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES],
	);
	const [resolved] = validateSpawnBatch(
		[{ name: "delegator", task: "x", tools: [], allowSubagents: true }],
		validation({ catalog }),
	);
	assert.deepEqual(
		resolved.expectedTools.map((tool) => tool.name),
		[...SUBAGENT_CONTROL_TOOL_NAMES],
	);
});

test("allowSubagents rejects malformed values and missing managed controls atomically", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "bad-flag", task: "x", tools: [], allowSubagents: "yes" as unknown as boolean }],
				validation(),
			),
		/allowSubagents must be a boolean/,
	);

	const incompleteNames = ["read", ...SUBAGENT_CONTROL_TOOL_NAMES.slice(0, -1)];
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "missing-control", task: "x", tools: ["read"], allowSubagents: true }],
				validation({ catalog: catalogWithActive(...incompleteNames) }),
			),
		/Managed subagent tool "subagent_cancel".*not registered/,
	);
});

test("only root children can receive the one-layer nested delegation grant", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "too-deep", task: "x", tools: [], allowSubagents: true }],
				validation({ managerDepth: 1 }),
			),
		/only root children may spawn one nested delegation layer/,
	);
	assert.throws(
		() => validateSpawnBatch([{ name: "impossible", task: "x", tools: [] }], validation({ managerDepth: 2 })),
		/may nest only one layer/,
	);
});

test("requesting all forbidden names is rejected for each", () => {
	for (const name of CHILD_EXCLUDED_TOOL_NAMES) {
		assert.throws(
			() =>
				validateSpawnBatch(
					[{ name: "a", task: "x", tools: [name] }],
					validation(),
				),
			new RegExp(`"${name}".*forbidden`),
		);
	}
});

test("THINKING_LEVELS contains xhigh exactly once", () => {
	assert.equal(
		THINKING_LEVELS.filter((level) => level === "xhigh").length,
		1,
	);
});

// ── Mixed-batch preflight rejection (atomic) ───────────────────

test("one invalid tools set in a two-agent batch rejects all, no initialization", async () => {
	let initialized = 0;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				initialized++;
				return new ControlledHandle();
			},
		},
	});
	await assert.rejects(
		manager.spawn(
			[
				{ name: "ok", task: "x", tools: ["read"] },
				{ name: "bad", task: "y", tools: ["read", "unknown_tool"] },
			],
			managerValidation(manager),
		),
		/is not registered/,
	);
	assert.equal(initialized, 0);
	assert.equal(manager.status().length, 0);
});

test("catalog construction failure (active without definition) throws before any manager work", () => {
	// buildToolCatalog itself throws; the caller must catch and abort before spawning.
	assert.throws(
		() => buildToolCatalog([readTool], ["read", "ghost"], []),
		/Active tool "ghost" has no reproducible/,
	);
});

test("inactive registered tool in a valid catalog is enabled during initialization", async () => {
	let initialized = 0;
	let initializedTools: string[] = [];
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: {
			async initialize(spec) {
				initialized++;
				initializedTools = spec.expectedTools.map((tool) => tool.name);
				return handle;
			},
		},
	});
	// Catalog is valid (bash registered but not active), and the explicit allowlist enables it for the child.
	const catalog = buildToolCatalog([readTool, bashTool], ["read"], []);
	const [spawned] = await manager.spawn(
		[{ name: "a", task: "x", tools: ["bash"] }],
		{
			...managerValidation(manager),
			catalog,
		},
	);
	assert.equal(initialized, 1);
	assert.deepEqual(initializedTools, ["bash"]);
	assert.equal(spawned.status, "running");
	assert.equal(handle.runStarted, true);
	await manager.cancel({ all: true });
});

// ── Compare fingerprints (pure unit) ───────────────────────────

test("compareToolFingerprints detects missing, unexpected, changed", () => {
	const expected: ToolFingerprint[] = [
		{ name: "a", fingerprint: "a-v1" },
		{ name: "b", fingerprint: "b-v1" },
	];
	assert.equal(compareToolFingerprints(expected, [...expected]), undefined);
	assert.match(compareToolFingerprints(expected, expected.slice(0, 1))!, /missing: b/);
	assert.match(
		compareToolFingerprints(expected, [...expected, { name: "c", fingerprint: "cv" }])!,
		/unexpected: c/,
	);
	assert.match(
		compareToolFingerprints(expected, [
			expected[0],
			{ name: "b", fingerprint: "b-v2" },
		])!,
		/different definitions: b/,
	);
});

test("compareToolFingerprints treats identical fingerprints as no drift and rejects reordered identities", () => {
	const read = fingerprintToolDef(readTool);
	const bash = fingerprintToolDef(bashTool);
	assert.equal(compareToolFingerprints([read], [read]), undefined);
	assert.match(compareToolFingerprints([read, bash], [bash, read])!, /order differs/);
	assert.match(compareToolFingerprints([read], [read, read])!, /duplicate active identities/);
});

// ── Existing lifecycle / behavior tests (adapted for tools) ────

test("active metadata resolution includes only the exact requested definitions and guidance", () => {
	const questioning = makeTool("ask_user_choices", {
		description: "QUESTION_SENTINEL",
		promptGuidelines: ["QUESTION_GUIDELINE_SENTINEL"],
	});
	const spawning = makeTool("subagent_spawn", {
		description: "SPAWN_SENTINEL",
		promptGuidelines: ["SPAWN_GUIDELINE_SENTINEL"],
	});
	const active = fingerprintActiveToolDefs(
		[readTool, bashTool, editTool, questioning, spawning],
		["edit", "read"],
	);
	assert.deepEqual(active.map((tool) => tool.name), ["edit", "read"]);
	const serialized = JSON.stringify(active);
	assert.doesNotMatch(serialized, /QUESTION_SENTINEL|SPAWN_SENTINEL/);
	assert.ok(CHILD_EXCLUDED_TOOL_NAMES.includes("ask_user_choices"));
	assert.ok(CHILD_EXCLUDED_TOOL_NAMES.includes("subagent_spawn"));
});

test("batch validation requires tasks/names and enforces lifetime case-insensitive uniqueness", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "", task: "x", tools: ["read"] }],
				validation(),
			),
		/name is required/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "x", task: "", tools: ["read"] }],
				validation(),
			),
		/task is required/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[
					{ name: "Scout", task: "a", tools: ["read"] },
					{ name: "scout", task: "b", tools: ["read"] },
				],
				validation(),
			),
		/Duplicate subagent name/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "SCOUT", task: "x", tools: ["read"] }],
				validation({ lifetimeNames: new Set(["scout"]) }),
			),
		/already been used/,
	);
});

test("batch validation is atomic for model pairs, authentication, and thinking", () => {
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read"], provider: "test" }],
				validation(),
			),
		/must be provided together/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read"], provider: "test", model: "missing" }],
				validation(),
			),
		/not available/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read"], provider: "test", model: "no-auth" }],
				validation(),
			),
		/configured authentication/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read"], thinkingLevel: "max" }],
				validation(),
			),
		/not supported/,
	);
	assert.throws(
		() =>
			validateSpawnBatch(
				[{ name: "a", task: "x", tools: ["read"], thinkingLevel: "invalid" }],
				validation(),
			),
		/Invalid thinking level/,
	);

	const [resolved] = validateSpawnBatch(
		[{ name: "a", task: "x", tools: ["read"], provider: "test", model: "narrow" }],
		validation(),
	);
	assert.equal(resolved.thinkingLevel, "low");
	const [independent] = validateSpawnBatch(
		[{ name: "b", task: "x", tools: ["read"], thinkingLevel: "low" }],
		validation(),
	);
	assert.equal(independent.model, "wide");
	assert.equal(independent.thinkingLevel, "low");
});

test("the eight-agent limit accounts for both batch size and active capacity", () => {
	const nine = Array.from({ length: MAX_CONCURRENT_AGENTS + 1 }, (_, index) => ({
		name: `a${index}`,
		task: "x",
		tools: ["read"],
	}));
	assert.throws(() => validateSpawnBatch(nine, validation()), /at most 8/);
	assert.throws(
		() =>
			validateSpawnBatch(
				[
					{ name: "a", task: "x", tools: ["read"] },
					{ name: "b", task: "x", tools: ["read"] },
				],
				validation({ activeCount: 7 }),
			),
		/exceed the 8-agent/,
	);
});

test("the concurrency cap is shared across the complete root and nested tree", async () => {
	const rootHandles = new Map<string, ControlledHandle>();
	const root = new SubagentManager({
		maxConcurrent: 2,
		adapter: {
			async initialize(spec) {
				const handle = new ControlledHandle();
				rootHandles.set(spec.name, handle);
				return handle;
			},
		},
	});
	const nestedHandle = new ControlledHandle();
	const nested = new SubagentManager({
		scope: root.createChildScope(),
		adapter: { initialize: async () => nestedHandle },
	});

	await root.spawn(
		[{ name: "delegator", task: "x", tools: [], allowSubagents: true }],
		managerValidation(root),
	);
	await nested.spawn([{ name: "senior", task: "y", tools: [] }], managerValidation(nested));
	assert.equal(root.activeCount, 2);
	assert.equal(nested.activeCount, 2);
	await assert.rejects(
		root.spawn([{ name: "overflow", task: "z", tools: [] }], managerValidation(root)),
		/tree concurrency limit/,
	);

	await Promise.all([root.cancel({ all: true }), nested.cancel({ all: true })]);
	assert.equal(root.activeCount, 0);
	assert.equal(nested.activeCount, 0);
	assert.equal(rootHandles.get("delegator")!.aborted, true);
	assert.equal(nestedHandle.aborted, true);
});

test("a nested manager may spawn one agent but cannot grant another layer", async () => {
	let initialized = 0;
	const root = new SubagentManager({
		adapter: { initialize: async () => new ControlledHandle() },
	});
	const nested = new SubagentManager({
		scope: root.createChildScope(),
		adapter: {
			async initialize() {
				initialized++;
				return new ControlledHandle();
			},
		},
	});

	await assert.rejects(
		nested.spawn(
			[{ name: "recursive", task: "x", tools: [], allowSubagents: true }],
			managerValidation(nested),
		),
		/only root children may spawn one nested delegation layer/,
	);
	assert.equal(initialized, 0);

	await nested.spawn([{ name: "nested-task", task: "x", tools: [] }], managerValidation(nested));
	assert.equal(initialized, 1);
	await nested.cancel({ all: true });
});

test("invalid batches do not initialize or reserve any member", async () => {
	let initialized = 0;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				initialized++;
				return new ControlledHandle();
			},
		},
	});
	await assert.rejects(
		manager.spawn(
			[
				{ name: "same", task: "x", tools: ["read"] },
				{ name: "SAME", task: "y", tools: ["read"] },
			],
			managerValidation(manager),
		),
		/Duplicate/,
	);
	assert.equal(initialized, 0);
	assert.equal(manager.status().length, 0);
});

test("model or thinking drift fails the whole initialization barrier before tasks run", async () => {
	for (const drift of ["model", "thinking"] as const) {
		const first = new ControlledHandle();
		if (drift === "model") first.model = "different";
		else first.thinkingLevel = "low";
		const sibling = new ControlledHandle();
		const manager = new SubagentManager({
			adapter: { initialize: async (spec) => (spec.name === "drift" ? first : sibling) },
		});
		const launched = await manager.spawn(
			[
				{ name: "drift", task: "x", tools: ["read"] },
				{ name: "sibling", task: "y", tools: ["bash"] },
			],
			managerValidation(manager),
		);
		assert.deepEqual(launched.map((agent) => agent.status), ["failed", "failed"]);
		assert.equal(first.runStarted, false);
		assert.equal(sibling.runStarted, false);
		assert.equal(first.disposed, true);
		assert.equal(sibling.disposed, true);
		assert.match(launched[0].error!, drift === "model" ? /model mismatch/ : /thinking-level mismatch/);
	}
});

test("initialization failure fails the whole batch before tasks run and disposes successful runtimes", async () => {
	const first = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: {
			async initialize(spec) {
				if (spec.name === "bad") throw new Error("tool mismatch");
				return first;
			},
		},
	});
	const launched = await manager.spawn(
		[
			{ name: "good", task: "x", tools: ["read"] },
			{ name: "bad", task: "y", tools: ["bash"] },
		],
		managerValidation(manager),
	);
	assert.deepEqual(launched.map((agent) => agent.status), ["failed", "failed"]);
	assert.equal(first.runStarted, false);
	assert.equal(first.disposed, true);
	assert.match(launched[0].error!, /before any task started: tool mismatch/);
});

test("initialization failure aborts a still-initializing sibling and fails the batch promptly", async () => {
	let siblingAborted = false;
	const manager = new SubagentManager({
		adapter: {
			async initialize(spec, _scope, signal) {
				if (spec.name === "bad") throw new Error("broken initializer");
				return new Promise<ChildHandle>((_resolve, reject) => {
					const abort = () => {
						siblingAborted = true;
						reject(new Error("sibling initialization aborted"));
					};
					if (signal.aborted) abort();
					else signal.addEventListener("abort", abort, { once: true });
				});
			},
		},
	});

	const launched = await manager.spawn(
		[
			{ name: "bad", task: "x", tools: [] },
			{ name: "stuck", task: "y", tools: [] },
		],
		managerValidation(manager),
	);
	assert.deepEqual(launched.map((agent) => agent.status), ["failed", "failed"]);
	assert.match(launched[0].error!, /broken initializer/);
	assert.equal(siblingAborted, true);
	assert.equal(manager.activeCount, 0);
});

test("starting and running agents contribute to footer counts", async () => {
	const init = deferred<ChildHandle>();
	const counts: number[] = [];
	const manager = new SubagentManager({
		adapter: { initialize: async () => init.promise },
		onChange: (count) => counts.push(count),
	});
	const spawning = manager.spawn(
		[{ name: "a", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	await tick();
	assert.equal(manager.activeCount, 1);
	assert.ok(counts.includes(1));
	const handle = new ControlledHandle();
	init.resolve(handle);
	await spawning;
	assert.equal(manager.activeCount, 1);
	handle.completion.resolve(success());
	await manager.poll({ timeoutSeconds: 1 });
	assert.equal(manager.activeCount, 0);
	assert.equal(counts.at(-1), 0);
});

test("concurrent completions are delivered once while status remains non-consuming", async () => {
	const handles = new Map<string, ControlledHandle>();
	const manager = new SubagentManager({
		adapter: {
			async initialize(spec) {
				const handle = new ControlledHandle();
				handles.set(spec.name, handle);
				return handle;
			},
		},
	});
	await manager.spawn(
		[
			{ name: "a", task: "one", tools: ["read"] },
			{ name: "b", task: "two", tools: ["read"] },
		],
		managerValidation(manager),
	);
	handles.get("b")!.completion.resolve(success("B"));
	handles.get("a")!.completion.resolve(success("A"));
	await tick();

	const inspected = manager.status({ includeResults: true });
	assert.deepEqual(
		inspected.map((agent) => agent.finalText).sort(),
		["A", "B"],
	);
	const firstPoll = await manager.poll({ timeoutSeconds: 0 });
	assert.deepEqual(
		firstPoll.results.map((agent) => agent.name).sort(),
		["a", "b"],
	);
	const secondPoll = await manager.poll({ timeoutSeconds: 0 });
	assert.equal(secondPoll.results.length, 0);
	assert.deepEqual(
		manager
			.status({ includeResults: true })
			.map((agent) => agent.finalText)
			.sort(),
		["A", "B"],
	);
});

test("poll honors timeout, queued-message wake-up, root abort, and rejects concurrent blocking polls", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn(
		[{ name: "a", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);

	const started = Date.now();
	const timed = await manager.poll({ timeoutSeconds: 0.02 });
	assert.equal(timed.wakeReason, "timeout");
	assert.ok(Date.now() - started >= 10);

	let queued = false;
	setTimeout(() => {
		queued = true;
	}, 15);
	const queuedPoll = await manager.poll({
		timeoutSeconds: 1,
		shouldWake: () => queued,
	});
	assert.equal(queuedPoll.wakeReason, "queued_message");

	const controller = new AbortController();
	setTimeout(() => controller.abort(), 15);
	const aborted = await manager.poll({
		timeoutSeconds: 1,
		signal: controller.signal,
	});
	assert.equal(aborted.wakeReason, "aborted");

	const controller2 = new AbortController();
	const blocking = manager.poll({
		timeoutSeconds: 1,
		signal: controller2.signal,
	});
	await tick();
	await assert.rejects(
		manager.poll({ timeoutSeconds: 1 }),
		/already active/,
	);
	controller2.abort();
	await blocking;
	await manager.cancel({ all: true });
});

test("success and provider failure preserve usage metrics", async () => {
	const usage = {
		input: 10,
		output: 4,
		cacheRead: 3,
		cacheWrite: 2,
		total: 19,
		cost: 0.25,
	};
	let count = 0;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				const index = count++;
				return {
					provider: "test",
					model: "wide",
					thinkingLevel: "high",
					async run() {
						return index === 0
							? success("ok", usage)
							: {
									finalText: "",
									usage,
									stopReason: "error" as const,
									error: "provider unavailable",
								};
					},
					abort() {},
					dispose() {},
				};
			},
		},
	});
	await manager.spawn(
		[
			{ name: "ok", task: "x", tools: ["read"] },
			{ name: "bad", task: "y", tools: ["read"] },
		],
		managerValidation(manager),
	);
	const poll = await manager.poll({ timeoutSeconds: 1 });
	assert.equal(
		poll.results.find((agent) => agent.name === "ok")!.status,
		"completed",
	);
	assert.equal(
		poll.results.find((agent) => agent.name === "bad")!.status,
		"failed",
	);
	assert.deepEqual(poll.results[0].usage, usage);
	assert.match(
		poll.results.find((agent) => agent.name === "bad")!.error!,
		/provider unavailable/,
	);
});

test("explicit cancellation and root shutdown abort and dispose active runtimes", async () => {
	const first = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => first },
	});
	await manager.spawn(
		[{ name: "cancel-me", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	const cancelled = await manager.cancel({ names: ["CANCEL-ME"] });
	assert.equal(cancelled[0].status, "cancelled");
	assert.equal(first.aborted, true);
	await tick();
	assert.equal(first.disposed, true);
	assert.equal(manager.claimReminder(), false);

	const second = new ControlledHandle();
	const shutdownManager = new SubagentManager({
		adapter: { initialize: async () => second },
	});
	await shutdownManager.spawn(
		[{ name: "shutdown", task: "x", tools: ["read"] }],
		managerValidation(shutdownManager),
	);
	await shutdownManager.shutdown("reload");
	assert.equal(shutdownManager.status()[0].status, "cancelled");
	assert.equal(second.aborted, true);
	assert.equal(second.disposed, true);
	await assert.rejects(
		shutdownManager.spawn(
			[{ name: "later", task: "x", tools: ["read"] }],
			managerValidation(shutdownManager),
		),
		/shutting down/,
	);
});

test("cancellation during cascading disposal cannot publish a stale completed result", async () => {
	const disposalStarted = deferred<void>();
	const releaseDisposal = deferred<void>();
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test",
					model: "wide",
					thinkingLevel: "high",
					async run() { return success("finished before cancellation"); },
					abort() {},
					async dispose() {
						disposalStarted.resolve();
						await releaseDisposal.promise;
					},
				};
			},
		},
	});

	await manager.spawn([{ name: "dispose-race", task: "x", tools: [] }], managerValidation(manager));
	await disposalStarted.promise;
	const cancelling = manager.cancel({ all: true });
	await tick();
	releaseDisposal.resolve();
	const [result] = await cancelling;
	assert.equal(result.status, "cancelled");
	assert.match(result.error!, /Cancelled/);
});

test("parent cancellation cascades to its nested manager before root cancellation settles", async () => {
	const parentCompletion = deferred<ChildRunResult>();
	const escalationHandle = new ControlledHandle();
	let nested!: SubagentManager;
	let parentDisposeCalls = 0;

	const parentHandle: ChildHandle = {
		provider: "test",
		model: "wide",
		thinkingLevel: "high",
		run: () => parentCompletion.promise,
		async abort() {
			parentCompletion.resolve({ ...success(""), stopReason: "aborted" });
			await nested.shutdown("Parent subagent was aborted.");
		},
		async dispose() {
			parentDisposeCalls++;
			await nested.shutdown("Parent subagent ended.");
		},
	};
	const root = new SubagentManager({
		adapter: {
			async initialize(_spec, childScope) {
				nested = new SubagentManager({
					scope: childScope,
					adapter: { initialize: async () => escalationHandle },
				});
				return parentHandle;
			},
		},
	});

	await root.spawn(
		[{ name: "delegator", task: "x", tools: [], allowSubagents: true }],
		managerValidation(root),
	);
	await nested.spawn([{ name: "senior", task: "y", tools: [] }], managerValidation(nested));
	assert.equal(root.activeCount, 2);

	const cancelled = await root.cancel({ all: true });
	assert.equal(cancelled[0].status, "cancelled");
	assert.equal(root.activeCount, 0);
	assert.equal(nested.status()[0].status, "cancelled");
	assert.equal(escalationHandle.aborted, true);
	assert.equal(escalationHandle.disposed, true);
	assert.equal(parentDisposeCalls, 1);
});

test("ordinary parent completion disposes its nested subtree before publishing the result", async () => {
	const parentCompletion = deferred<ChildRunResult>();
	const escalationHandle = new ControlledHandle();
	let nested!: SubagentManager;
	const root = new SubagentManager({
		adapter: {
			async initialize(_spec, childScope) {
				nested = new SubagentManager({
					scope: childScope,
					adapter: { initialize: async () => escalationHandle },
				});
				return {
					provider: "test",
					model: "wide",
					thinkingLevel: "high",
					run: () => parentCompletion.promise,
					abort() { parentCompletion.resolve({ ...success(""), stopReason: "aborted" }); },
					async dispose() { await nested.shutdown("Parent subagent ended."); },
				};
			},
		},
	});

	await root.spawn(
		[{ name: "delegator-natural", task: "x", tools: [], allowSubagents: true }],
		managerValidation(root),
	);
	await nested.spawn([{ name: "left-behind", task: "y", tools: [] }], managerValidation(nested));
	parentCompletion.resolve(success("parent done"));
	const result = (await root.poll({ timeoutSeconds: 1 })).results[0];
	assert.equal(result.status, "completed");
	assert.equal(root.activeCount, 0);
	assert.equal(nested.status()[0].status, "cancelled");
	assert.equal(escalationHandle.aborted, true);
});

test("the assistant turn cutoff aborts before turn 301", async () => {
	let aborted = false;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test",
					model: "wide",
					thinkingLevel: "high",
					async run(_task, hooks) {
						for (
							let index = 0;
							index < MAX_ASSISTANT_TURNS + 1 && !aborted;
							index++
						)
							hooks.onTurn();
						return {
							...success("partial"),
							stopReason: aborted ? "aborted" : "stop",
						};
					},
					abort() {
						aborted = true;
					},
					dispose() {},
				};
			},
		},
	});
	await manager.spawn(
		[{ name: "loop", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	const result = (await manager.poll({ timeoutSeconds: 1 })).results[0];
	assert.equal(result.status, "turn_limit");
	assert.equal(result.turns, MAX_ASSISTANT_TURNS);
	assert.equal(aborted, true);
});

test("model-visible truncation observes byte/line caps while full result is recoverable via paging", async () => {
	const huge = `${"😀".repeat(20_000)}\n${Array.from({ length: 3_000 }, (_, index) => `line-${index}`).join("\n")}`;
	const capped = capModelOutput(huge);
	assert.equal(capped.truncated, true);
	assert.ok(Buffer.byteLength(capped.text, "utf8") <= 50 * 1024);
	assert.ok(capped.text.split("\n").length <= 2_000);
	assert.match(capped.text, /resultPage mode/);

	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test",
					model: "wide",
					thinkingLevel: "high",
					async run() {
						return success(huge);
					},
					abort() {},
					dispose() {},
				};
			},
		},
	});
	await manager.spawn(
		[{ name: "verbose", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	await manager.poll({ timeoutSeconds: 1 });

	// Oversized results return a preview + paging metadata, not the full text.
	const status = manager.status({ includeResults: true }) as SubagentResult[];
	const agent = status[0];
	assert.equal(agent.resultTruncated, true);
	assert.ok(typeof agent.resultPreview === "string");
	assert.ok(typeof agent.resultId === "string");
	assert.ok(typeof agent.resultSha256 === "string");
	assert.equal(agent.resultBytes, Buffer.byteLength(huge, "utf8"));

	// Reconstruct via paging.
	let page = manager.status({
		resultPage: { name: "verbose", maxBytes: 8192 },
	}) as ResultPageResponse;
	assert.equal(page.schema, 1);
	assert.equal(page.resultId, agent.resultId);
	assert.equal(page.sha256, agent.resultSha256);
	assert.equal(page.totalBytes, agent.resultBytes);
	assert.equal(page.startByte, 0);
	assert.equal(page.complete, false);
	assert.ok(typeof page.nextCursor === "string");

	// Collect all pages.
	const parts: string[] = [page.text];
	let cursor = page.nextCursor;
	while (cursor) {
		page = manager.status({ resultPage: { name: "verbose", cursor, maxBytes: 8192 } }) as ResultPageResponse;
		parts.push(page.text);
		cursor = page.nextCursor;
	}
	const reconstructed = parts.join("");
	assert.equal(reconstructed, huge);
	assert.equal(Buffer.byteLength(reconstructed, "utf8"), agent.resultBytes);
});

test("automatic reminder claims are deduplicated and poll/cancel acknowledge them", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn(
		[{ name: "a", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	assert.equal(manager.claimReminder(), true);
	assert.equal(manager.claimReminder(), false);
	await manager.poll({ timeoutSeconds: 0 });
	assert.equal(
		manager.claimReminder(),
		true,
		"poll acknowledges the previous reminder while work remains",
	);
	await manager.cancel({ all: true });
	assert.equal(
		manager.claimReminder(),
		false,
		"explicit cancellation stops reminder polling",
	);
});

// ── Result page reconstruction & cursor authentication ─────────

test("result page reconstructs multibyte text including 1-4 byte characters exactly", async () => {
	// Mix of 1-byte (ASCII), 2-byte (ñ), 3-byte (€), 4-byte (😀) characters
	const parts: string[] = [];
	for (let i = 0; i < 100; i++) parts.push("abc");
	for (let i = 0; i < 50; i++) parts.push("ñññ");
	for (let i = 0; i < 50; i++) parts.push("€€€");
	for (let i = 0; i < 50; i++) parts.push("😀😀😀");
	const text = parts.join("\n");

	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(text); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "mix", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const pages: ResultPageResponse[] = [];
	let cursor: string | undefined;
	do {
		const page = manager.status({
			resultPage: { name: "mix", cursor, maxBytes: 64 },
		}) as ResultPageResponse;
		pages.push(page);
		cursor = page.nextCursor;
	} while (cursor);

	const reconstructed = pages.map((p) => p.text).join("");
	assert.equal(reconstructed, text);

	// Verify ranges, digest, identity, and terminal metadata.
	const totalBytes = Buffer.byteLength(text, "utf8");
	assert.equal(pages[0].sha256, crypto.createHash("sha256").update(Buffer.from(text)).digest("hex"));
	assert.ok(pages.every((page) => page.resultId === pages[0].resultId));
	assert.ok(pages.every((page) => page.status === "completed"));
	assert.ok(pages.every((page) => page.endedAt >= page.createdAt));
	assert.equal(pages[0].totalBytes, totalBytes);
	assert.equal(pages[0].startByte, 0);
	for (let i = 0; i < pages.length; i++) {
		assert.equal(pages[i].complete, i === pages.length - 1);
		if (i > 0) assert.equal(pages[i].startByte, pages[i - 1].endByte);
		// Every page starts and ends on code-point boundaries
		assert.ok(pages[i].text.length > 0 || pages[i].totalBytes === 0);
	}
	assert.equal(pages[pages.length - 1].endByte, totalBytes);
});

test("zero-byte result returns one complete empty page with no next cursor", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(""); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "empty", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const page = manager.status({ resultPage: { name: "empty" } }) as ResultPageResponse;
	assert.equal(page.text, "");
	assert.equal(page.totalBytes, 0);
	assert.equal(page.startByte, 0);
	assert.equal(page.endByte, 0);
	assert.equal(page.complete, true);
	assert.equal(page.nextCursor, undefined);
});

test("result page identity and digest are stable across repeated requests", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("hello world"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "stable", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const a = manager.status({ resultPage: { name: "stable", maxBytes: 5 } }) as ResultPageResponse;
	const b = manager.status({ resultPage: { name: "stable", maxBytes: 5 } }) as ResultPageResponse;
	assert.equal(a.resultId, b.resultId);
	assert.equal(a.sha256, b.sha256);
	assert.equal(a.totalBytes, b.totalBytes);
	assert.equal(a.text, b.text);
	// Cursor should be deterministic: same page request → same nextCursor
	assert.equal(a.nextCursor, b.nextCursor);
});

test("result page respects maxBytes lower bound and rejects out-of-range", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("hello"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "small", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	assert.throws(
		() => manager.status({ resultPage: { name: "small", maxBytes: 3 } }),
		/maxBytes must be an integer between 4 and/,
	);
	assert.throws(
		() => manager.status({ resultPage: { name: "small", maxBytes: 2_000_000 } }),
		/maxBytes must be an integer/,
	);
	assert.throws(
		() => manager.status({ resultPage: { name: "small", maxBytes: 3.5 } }),
		/maxBytes must be an integer/,
	);
});

test("a four-byte character fits minimum page and is never split", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("😀😀😀"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "emoji", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	// maxBytes=4 fits exactly one 4-byte emoji
	const page = manager.status({ resultPage: { name: "emoji", maxBytes: 4 } }) as ResultPageResponse;
	assert.equal(page.text, "😀");
	assert.equal(page.endByte, 4);
	assert.equal(page.complete, false);
	assert.ok(page.nextCursor);
});

test("page boundaries never split a code point", async () => {
	// The byte sequence for "😀" is F0 9F 98 80
	// Ensure pages end between characters, not mid-character
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("😀😀😀😀😀"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "emojis", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	// maxBytes=6: should fit one emoji (4 bytes) but not two (8 bytes > 6)
	const page = manager.status({ resultPage: { name: "emojis", maxBytes: 6 } }) as ResultPageResponse;
	assert.equal(page.text, "😀");
	assert.equal(page.endByte, 4);
});

test("invalid or tampered cursors are rejected deterministically", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("hello world"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "cur", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const page = manager.status({ resultPage: { name: "cur", maxBytes: 5 } }) as ResultPageResponse;
	const validCursor = page.nextCursor!;

	// Tampered HMAC
	assert.throws(
		() => manager.status({ resultPage: { name: "cur", cursor: validCursor + "x" } }),
		/Invalid or stale/,
	);
	// Garbage cursor
	assert.throws(
		() => manager.status({ resultPage: { name: "cur", cursor: "not-a-valid-cursor" } }),
		/Invalid or stale/,
	);
	// Empty cursor
	assert.throws(
		() => manager.status({ resultPage: { name: "cur", cursor: "" } }),
		/Invalid or stale/,
	);
});

test("cross-result cursor (different child) is rejected", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize(spec) {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(`result-from-${spec.name}`); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn(
		[
			{ name: "alpha", task: "a", tools: ["read"] },
			{ name: "beta", task: "b", tools: ["read"] },
		],
		managerValidation(manager),
	);
	await manager.poll({ timeoutSeconds: 1 });

	const alphaPage = manager.status({ resultPage: { name: "alpha", maxBytes: 4 } }) as ResultPageResponse;
	// The cursor is valid for alpha but not for beta.
	assert.ok(alphaPage.nextCursor);
	assert.throws(
		() => manager.status({ resultPage: { name: "beta", cursor: alphaPage.nextCursor } }),
		/Cursor does not match/,
	);
});

test("stale cursor from a prior manager instance is rejected", async () => {
	const text = "long enough result for paging";
	let manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(text); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "stale", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const page = manager.status({ resultPage: { name: "stale", maxBytes: 5 } }) as ResultPageResponse;
	const cursor = page.nextCursor!;

	// A new manager can have a result with the same child name, but its secret and
	// immutable result identity differ, so the old cursor must still fail auth.
	manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(text); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "stale", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });
	assert.throws(
		() => manager.status({ resultPage: { name: "stale", cursor } }),
		/Invalid or stale/,
	);
});

test("resultPage rejects non-terminal agents", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn([{ name: "running", task: "x", tools: ["read"] }], managerValidation(manager));

	assert.throws(
		() => manager.status({ resultPage: { name: "running" } }),
		/has no completed result to page/,
	);
	handle.completion.resolve(success());
	await manager.poll({ timeoutSeconds: 1 });
});

test("resultPage is exclusive and rejects combination with names or includeResults", () => {
	const manager = new SubagentManager({
		adapter: { initialize: async () => new ControlledHandle() },
	});
	assert.throws(
		() => manager.status({ resultPage: { name: "x" }, names: ["x"] }),
		/resultPage is exclusive/,
	);
	assert.throws(
		() => manager.status({ resultPage: { name: "x" }, includeResults: true }),
		/resultPage is exclusive/,
	);
});

test("status paging never consumes poll delivery", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("paged result"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "p", task: "x", tools: ["read"] }], managerValidation(manager));

	// Poll delivers once
	const poll1 = await manager.poll({ timeoutSeconds: 1 });
	assert.equal(poll1.results.length, 1);
	assert.equal(poll1.results[0].name, "p");

	// Status reads (including resultPage) do not consume
	const statusPage = manager.status({ resultPage: { name: "p", maxBytes: 5 } }) as ResultPageResponse;
	assert.ok(statusPage.text.length > 0);

	const poll2 = await manager.poll({ timeoutSeconds: 0 });
	assert.equal(poll2.results.length, 0, "poll should not re-deliver after status/page reads");
});

test("non-oversized result still returns finalText in status for backward compatibility", async () => {
	const small = "small result";
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success(small); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "tiny", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });

	const agent = (manager.status({ includeResults: true }) as SubagentResult[])[0];
	assert.equal(agent.finalText, small);
	assert.equal(agent.resultTruncated, undefined);
});

// ── Bounded cancellation & shutdown ────────────────────────────

test("cancel bounded: non-cooperative run that never settles is force-terminalized", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 50,
	});
	await manager.spawn([{ name: "stuck", task: "x", tools: ["read"] }], managerValidation(manager));

	// run started but completion never resolved → cancel with short grace
	const start = Date.now();
	const results = await manager.cancel({ names: ["stuck"] });
	const elapsed = Date.now() - start;

	assert.equal(results[0].status, "cancelled");
	assert.equal(manager.activeCount, 0);
	// Bounded return: should not block forever
	assert.ok(elapsed < 2_000, `cancel took ${elapsed}ms, expected < 2000ms`);
});

test("cancel bounded: cooperative abort that settles quickly", async () => {
	const handle = new ControlledHandle();
	// Override abort to resolve immediately
	handle.abort = () => {
		handle.completion.resolve({ ...success(""), stopReason: "aborted" });
	};
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 5000,
	});
	await manager.spawn([{ name: "coop", task: "x", tools: ["read"] }], managerValidation(manager));

	const results = await manager.cancel({ all: true });
	assert.equal(results[0].status, "cancelled");
	assert.equal(manager.activeCount, 0);
});

test("shutdown bounded: never-settling run is force-terminalized within grace period", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 50,
	});
	await manager.spawn([{ name: "never", task: "x", tools: ["read"] }], managerValidation(manager));

	const start = Date.now();
	await manager.shutdown("reload");
	const elapsed = Date.now() - start;

	assert.equal(manager.activeCount, 0);
	assert.ok(elapsed < 2_000, `shutdown took ${elapsed}ms, expected < 2000ms`);

	// After shutdown, spawn is rejected
	await assert.rejects(
		manager.spawn([{ name: "later", task: "x", tools: ["read"] }], managerValidation(manager)),
		/shutting down/,
	);
});

test("turn-limit escalation terminalizes with turn_limit cause", async () => {
	let aborted = false;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run(_task, hooks) {
						for (let i = 0; i < MAX_ASSISTANT_TURNS + 1 && !aborted; i++) hooks.onTurn();
						return { ...success("partial"), stopReason: aborted ? "aborted" : "stop" };
					},
					abort() { aborted = true; },
					dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "loop", task: "x", tools: ["read"] }], managerValidation(manager));
	const result = (await manager.poll({ timeoutSeconds: 1 })).results[0];
	assert.equal(result.status, "turn_limit");
	assert.equal(result.turns, MAX_ASSISTANT_TURNS);
});

test("explicit cancel sets status to cancelled (not turn_limit or failed)", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn([{ name: "c", task: "x", tools: ["read"] }], managerValidation(manager));

	const results = await manager.cancel({ names: ["c"] });
	assert.equal(results[0].status, "cancelled");
});

test("double cancel is idempotent", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn([{ name: "dup", task: "x", tools: ["read"] }], managerValidation(manager));

	await manager.cancel({ names: ["dup"] });
	// Second cancel should not throw
	await manager.cancel({ names: ["dup"] });
	assert.equal(manager.activeCount, 0);
});

test("double shutdown is idempotent", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn([{ name: "s", task: "x", tools: ["read"] }], managerValidation(manager));

	await manager.shutdown("reload");
	await manager.shutdown("reload");
	assert.equal(manager.activeCount, 0);
});

test("synchronous throw in handle.run is caught and terminalizes as failed", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					run() { throw new Error("sync boom"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "syncfail", task: "x", tools: ["read"] }], managerValidation(manager));
	const result = (await manager.poll({ timeoutSeconds: 1 })).results[0];
	assert.equal(result.status, "failed");
	assert.match(result.error!, /sync boom/);
});

test("synchronous throw in handle.abort does not prevent terminalization", async () => {
	const handle = new ControlledHandle();
	handle.abort = () => { throw new Error("abort boom"); };
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 100,
	});
	await manager.spawn([{ name: "abortThrow", task: "x", tools: ["read"] }], managerValidation(manager));

	const results = await manager.cancel({ names: ["abortThrow"] });
	assert.equal(results[0].status, "cancelled");
	assert.equal(manager.activeCount, 0);
});

test("synchronous throw in handle.dispose does not prevent terminalization", async () => {
	const handle = new ControlledHandle();
	const origDispose = handle.dispose.bind(handle);
	handle.dispose = () => { origDispose(); throw new Error("dispose boom"); };
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
	});
	await manager.spawn([{ name: "dispThrow", task: "x", tools: ["read"] }], managerValidation(manager));

	handle.completion.resolve(success());
	const result = (await manager.poll({ timeoutSeconds: 1 })).results[0];
	assert.equal(result.status, "completed");
});

test("late onTurn callback after detachment does not mutate record", async () => {
	const handle = new ControlledHandle();
	let savedHook: ((usage?: ReturnType<typeof emptyUsage>) => void) | undefined;
	handle.run = (_task: string, hooks: { onTurn(u?: ReturnType<typeof emptyUsage>): void }) => {
		savedHook = hooks.onTurn;
		return handle.completion.promise;
	};

	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 50,
	});
	await manager.spawn([{ name: "late", task: "x", tools: ["read"] }], managerValidation(manager));

	// Force cancel — this will force-terminalize after grace
	await manager.cancel({ names: ["late"] });

	const statusAfter = (manager.status({ includeResults: true }) as SubagentResult[])[0];
	const turnsAfter = statusAfter.turns;

	// Late onTurn should be a no-op after detachment
	if (savedHook) {
		savedHook(emptyUsage());
		savedHook(emptyUsage());
	}

	const statusFinal = (manager.status({ includeResults: true }) as SubagentResult[])[0];
	assert.equal(statusFinal.turns, turnsAfter, "late onTurn should not mutate turns after detachment");
});

test("late run completion after detachment does not alter terminal state", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 50,
	});
	await manager.spawn([{ name: "lateRun", task: "x", tools: ["read"] }], managerValidation(manager));

	// Force cancel first
	const cancelResults = await manager.cancel({ names: ["lateRun"] });
	assert.equal(cancelResults[0].status, "cancelled");

	// Now resolve run late — should not change status
	const statusBefore = (manager.status() as SubagentResult[])[0];
	handle.completion.resolve(success("late result"));
	await tick();
	await tick();

	const statusAfter = (manager.status() as SubagentResult[])[0];
	assert.equal(statusAfter.status, "cancelled", "status should remain cancelled after late completion");
	assert.equal(statusAfter.resultTruncated ?? false, statusBefore.resultTruncated ?? false);
});

test("reminder state is consistent after bounded shutdown", async () => {
	const handle = new ControlledHandle();
	const manager = new SubagentManager({
		adapter: { initialize: async () => handle },
		shutdownGraceMs: 50,
	});
	await manager.spawn([{ name: "rem", task: "x", tools: ["read"] }], managerValidation(manager));

	await manager.shutdown("reload");
	// After shutdown with delivered=true, claimReminder should return false
	// (active count is 0 and all are delivered)
	assert.equal(manager.claimReminder(), false);
});

test("after detachment, status does not change and snapshot remains immutable", async () => {
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					async run() { return success("stable result"); },
					abort() {}, dispose() {},
				};
			},
		},
	});
	await manager.spawn([{ name: "immutable", task: "x", tools: ["read"] }], managerValidation(manager));
	await manager.poll({ timeoutSeconds: 1 });
	const status1 = (manager.status({ includeResults: true }) as SubagentResult[])[0];
	const status2 = (manager.status({ includeResults: true }) as SubagentResult[])[0];

	assert.equal(status1.status, "completed");
	assert.equal(status1.status, status2.status);
});

test("cancel interrupts never-settling initialization and disposes a late handle without starting it", async () => {
	const initialization = deferred<ChildHandle>();
	const lateHandle = new ControlledHandle();
	let initializationSignal: AbortSignal | undefined;
	const manager = new SubagentManager({
		adapter: {
			initialize(_spec, _scope, signal) {
				initializationSignal = signal;
				return initialization.promise;
			},
		},
		boundScheduler: async () => undefined,
	});
	const spawning = manager.spawn(
		[{ name: "initializing", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	await tick();

	const cancelled = await manager.cancel({ all: true });
	assert.equal(initializationSignal?.aborted, true);
	assert.equal(cancelled[0].status, "cancelled");
	assert.equal(manager.activeCount, 0);
	assert.equal((await spawning)[0].status, "cancelled");

	initialization.resolve(lateHandle);
	await tick();
	await tick();
	assert.equal(lateHandle.runStarted, false);
	assert.equal(lateHandle.disposed, true);
});

test("shutdown interrupts never-settling initialization with cancelled root accounting", async () => {
	const initialization = deferred<ChildHandle>();
	let initializationSignal: AbortSignal | undefined;
	const manager = new SubagentManager({
		adapter: {
			initialize(_spec, _scope, signal) {
				initializationSignal = signal;
				return initialization.promise;
			},
		},
		boundScheduler: async () => undefined,
	});
	const spawning = manager.spawn(
		[{ name: "reload-init", task: "x", tools: ["read"] }],
		managerValidation(manager),
	);
	await tick();

	await manager.shutdown("Root session reload.");
	assert.equal(initializationSignal?.aborted, true);
	assert.equal(manager.activeCount, 0);
	const result = (await spawning)[0];
	assert.equal(result.status, "cancelled");
	assert.match(result.error!, /reload/);
});

test("turn limit force-detaches never-settling run, abort, and disposal through injected bounds", async () => {
	const never = new Promise<void>(() => undefined);
	let abortCalls = 0;
	let disposeCalls = 0;
	let boundCalls = 0;
	const activeCounts: number[] = [];
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					run(_task, hooks) {
						hooks.onTurn(emptyUsage());
						return new Promise<ChildRunResult>(() => undefined);
					},
					abort() { abortCalls++; return never; },
					dispose() { disposeCalls++; return never; },
				};
			},
		},
		turnLimit: 1,
		boundScheduler: async () => { boundCalls++; },
		onChange: (count) => activeCounts.push(count),
	});
	await manager.spawn([{ name: "limit-stuck", task: "x", tools: ["read"] }], managerValidation(manager));
	const result = (await manager.poll({ timeoutSeconds: 1 })).results[0];

	assert.equal(result.status, "turn_limit");
	assert.equal(result.turns, 1);
	assert.equal(manager.activeCount, 0);
	assert.equal(abortCalls, 1);
	assert.equal(disposeCalls, 1);
	assert.ok(boundCalls >= 2);
	assert.equal(activeCounts.filter((count) => count === 0).length, 1);
	assert.match(result.error!, /provider execution may not have stopped/);
});

test("forced cancellation is single-settlement and ignores late run rejection", async () => {
	const completion = deferred<ChildRunResult>();
	let disposeCalls = 0;
	const manager = new SubagentManager({
		adapter: {
			async initialize() {
				return {
					provider: "test", model: "wide", thinkingLevel: "high",
					run: () => completion.promise,
					abort: () => new Promise<void>(() => undefined),
					dispose() { disposeCalls++; return new Promise<void>(() => undefined); },
				};
			},
		},
		boundScheduler: async () => undefined,
	});
	await manager.spawn([{ name: "late-reject", task: "x", tools: ["read"] }], managerValidation(manager));
	const cancelled = (await manager.cancel({ all: true }))[0];
	const pageBefore = manager.status({ resultPage: { name: "late-reject" } }) as ResultPageResponse;

	completion.reject(new Error("late provider rejection"));
	await tick();
	await tick();
	const after = (manager.status({ includeResults: true }) as SubagentResult[])[0];
	const pageAfter = manager.status({ resultPage: { name: "late-reject" } }) as ResultPageResponse;
	assert.equal(cancelled.status, "cancelled");
	assert.equal(after.status, "cancelled");
	assert.equal(pageAfter.resultId, pageBefore.resultId);
	assert.equal(pageAfter.sha256, pageBefore.sha256);
	assert.equal(disposeCalls, 1);
});
