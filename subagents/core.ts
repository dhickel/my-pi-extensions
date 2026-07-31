import crypto from "node:crypto";

export const MAX_CONCURRENT_AGENTS = 8;
/** Root children are depth 1; one opt-in delegation layer may create depth-2 children. */
export const MAX_SUBAGENT_DEPTH = 2;
export const MAX_ASSISTANT_TURNS = 300;
export const MODEL_OUTPUT_MAX_BYTES = 50 * 1024;
export const MODEL_OUTPUT_MAX_LINES = 2_000;
export const RESULT_PREVIEW_MAX_BYTES = 4_096;
export const RESULT_PAGE_MAX_BYTES = 1_048_576;
export const RESULT_PAGE_MIN_BYTES = 4;
export const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
const CURSOR_VERSION = 1;
const TERMINAL_STATES = new Set<SubagentState>(["completed", "failed", "cancelled", "turn_limit"]);
export type TerminalState = Extract<SubagentState, "completed" | "failed" | "cancelled" | "turn_limit">;

export const SUBAGENT_CONTROL_TOOL_NAMES = [
	"subagent_spawn",
	"subagent_poll",
	"subagent_status",
	"subagent_cancel",
] as const;

export const CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES = ["ask_user_choices", "ask_user_text"] as const;

/** Default-denied child tools. The control bundle is granted only through allowSubagents. */
export const CHILD_EXCLUDED_TOOL_NAMES = [
	...SUBAGENT_CONTROL_TOOL_NAMES,
	...CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES,
] as const;

export const SUBAGENT_CHILD_CONFIG_EVENT = "pi-subagents:configure-child-manager:v1";

const SUBAGENT_CONTROL_TOOLS = new Set<string>(SUBAGENT_CONTROL_TOOL_NAMES);
const CHILD_ALWAYS_FORBIDDEN_TOOLS = new Set<string>(CHILD_ALWAYS_FORBIDDEN_TOOL_NAMES);

export function isChildToolAllowed(name: string, allowSubagents = false): boolean {
	if (CHILD_ALWAYS_FORBIDDEN_TOOLS.has(name)) return false;
	return allowSubagents || !SUBAGENT_CONTROL_TOOLS.has(name);
}

// ── Tool catalog & fingerprint helpers (pure, testable without Pi sessions) ──

export interface ToolDef {
	name: string;
	description?: string;
	parameters?: unknown;
	promptGuidelines?: string[];
	sourceInfo?: unknown;
}

export interface ToolCatalogEntry {
	readonly active: boolean;
	readonly forbidden: boolean;
	readonly fingerprint: ToolFingerprint;
}

/** Immutable snapshot built once per spawn from root Pi tool state. */
export type ToolCatalog = ReadonlyMap<string, ToolCatalogEntry>;

class ImmutableToolCatalog implements ReadonlyMap<string, ToolCatalogEntry> {
	readonly #entries: ReadonlyMap<string, ToolCatalogEntry>;

	constructor(entries: Map<string, ToolCatalogEntry>) {
		this.#entries = entries;
		Object.freeze(this);
	}

	get size(): number {
		return this.#entries.size;
	}

	get(name: string): ToolCatalogEntry | undefined {
		return this.#entries.get(name);
	}

	has(name: string): boolean {
		return this.#entries.has(name);
	}

	entries(): MapIterator<[string, ToolCatalogEntry]> {
		return this.#entries.entries();
	}

	keys(): MapIterator<string> {
		return this.#entries.keys();
	}

	values(): MapIterator<ToolCatalogEntry> {
		return this.#entries.values();
	}

	forEach(callback: (value: ToolCatalogEntry, key: string, map: ReadonlyMap<string, ToolCatalogEntry>) => void): void {
		for (const [key, value] of this.#entries) callback(value, key, this);
	}

	[Symbol.iterator](): MapIterator<[string, ToolCatalogEntry]> {
		return this.entries();
	}
}

function stableStringify(value: unknown, ancestors = new Set<object>()): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("non-finite numbers are not reproducible");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		if (ancestors.has(value)) throw new Error("cyclic values are not reproducible");
		ancestors.add(value);
		try {
			const items: string[] = [];
			for (let index = 0; index < value.length; index++) {
				if (!(index in value) || value[index] === undefined) {
					throw new Error("undefined or sparse array entries are not reproducible");
				}
				items.push(stableStringify(value[index], ancestors));
			}
			return `[${items.join(",")}]`;
		} finally {
			ancestors.delete(value);
		}
	}
	if (value && typeof value === "object") {
		if (ancestors.has(value)) throw new Error("cyclic values are not reproducible");
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error("non-plain objects are not reproducible");
		}
		ancestors.add(value);
		try {
			const record = value as Record<string, unknown>;
			return `{${Object.keys(record)
				.sort()
				.filter((key) => record[key] !== undefined)
				.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], ancestors)}`)
				.join(",")}}`;
		} finally {
			ancestors.delete(value);
		}
	}
	throw new Error(`unsupported ${typeof value} value is not reproducible`);
}

/** Build a reproducible fingerprint from exactly the registered metadata fields. */
export function fingerprintToolDef(tool: ToolDef): ToolFingerprint {
	if (typeof tool?.name !== "string" || tool.name.length === 0) throw new Error("tool name must be a non-empty string");
	if (typeof tool.description !== "string") throw new Error(`tool "${tool.name}" description must be a string`);
	if (tool.parameters === undefined) throw new Error(`tool "${tool.name}" parameters are required`);
	if (tool.sourceInfo === undefined) throw new Error(`tool "${tool.name}" sourceInfo is required`);
	if (
		tool.promptGuidelines !== undefined &&
		(!Array.isArray(tool.promptGuidelines) || tool.promptGuidelines.some((guideline) => typeof guideline !== "string"))
	) {
		throw new Error(`tool "${tool.name}" promptGuidelines must be an array of strings`);
	}
	try {
		return Object.freeze({
			name: tool.name,
			fingerprint: stableStringify({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				promptGuidelines: tool.promptGuidelines,
				sourceInfo: tool.sourceInfo,
			}),
		});
	} catch (error) {
		throw new Error(`Tool "${tool.name}" has non-reproducible fingerprint metadata: ${errorText(error)}`);
	}
}

function indexToolDefinitions(allTools: readonly ToolDef[]): Map<string, ToolDef> {
	const byName = new Map<string, ToolDef>();
	for (const tool of allTools) {
		if (typeof tool?.name !== "string" || tool.name.length === 0) {
			throw new Error("Tool catalog contains a definition without a non-empty string name.");
		}
		if (byName.has(tool.name)) throw new Error(`Duplicate tool definition in catalog: "${tool.name}".`);
		byName.set(tool.name, tool);
	}
	return byName;
}

/** Resolve only active definitions, preserving active-name order and rejecting malformed identities. */
export function fingerprintActiveToolDefs(
	allTools: readonly ToolDef[],
	activeNames: readonly string[],
): readonly ToolFingerprint[] {
	const byName = indexToolDefinitions(allTools);
	const seen = new Set<string>();
	const fingerprints: ToolFingerprint[] = [];
	for (const name of activeNames) {
		if (seen.has(name)) throw new Error(`Duplicate active tool identity in catalog: "${name}".`);
		seen.add(name);
		const definition = byName.get(name);
		if (!definition) throw new Error(`Active tool "${name}" has no reproducible tool definition.`);
		fingerprints.push(fingerprintToolDef(definition));
	}
	return Object.freeze(fingerprints);
}

/**
 * Build one immutable catalog snapshot from configured metadata and root-level
 * active names. Rejects the catalog itself when an active name has no registered
 * definition or a definition appears with a duplicate name — the caller must
 * abort the spawn batch before the manager sees any mutation.
 */
export function buildToolCatalog(
	allTools: readonly ToolDef[],
	activeNames: readonly string[],
	forbiddenNames: readonly string[],
): ToolCatalog {
	const byName = indexToolDefinitions(allTools);
	const activeFingerprints = fingerprintActiveToolDefs(allTools, activeNames);
	const forbiddenSet = new Set(forbiddenNames);
	const activeSet = new Set(activeNames);
	const map = new Map<string, ToolCatalogEntry>();

	for (const fingerprint of activeFingerprints) {
		map.set(
			fingerprint.name,
			Object.freeze({
				active: true,
				forbidden: forbiddenSet.has(fingerprint.name),
				fingerprint,
			}),
		);
	}

	// Ensure every forbidden name is represented (even if it isn't active).
	for (const name of forbiddenNames) {
		if (map.has(name)) continue;
		const def = byName.get(name);
		map.set(
			name,
			Object.freeze({
				active: activeSet.has(name),
				forbidden: true,
				fingerprint: def
					? fingerprintToolDef(def)
					: Object.freeze({ name, fingerprint: "unavailable" }),
			}),
		);
	}

	// Register remaining definitions so "unknown" vs "inactive" is distinct.
	for (const [name, def] of byName) {
		if (map.has(name)) continue;
		map.set(
			name,
			Object.freeze({
				active: false,
				forbidden: forbiddenSet.has(name),
				fingerprint: fingerprintToolDef(def),
			}),
		);
	}

	return new ImmutableToolCatalog(map);
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type SubagentState =
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "turn_limit";

export interface AgentSpec {
	name: string;
	task: string;
	/** Optional exact allowlist. Omission grants every registered child-allowed ordinary tool. */
	tools?: string[];
	/** Opt-in grant allowing this child to create and supervise one nested delegation layer. */
	allowSubagents?: boolean;
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel | string;
}

export interface ModelDescriptor {
	provider: string;
	id: string;
	authConfigured: boolean;
	supportedThinkingLevels: readonly ThinkingLevel[];
}

export interface ToolFingerprint {
	readonly name: string;
	readonly fingerprint: string;
}

export interface ResultSnapshot {
	readonly id: string;
	readonly bytes: Buffer;
	readonly sha256: string;
	readonly totalBytes: number;
	readonly status: TerminalState;
	readonly provider: string;
	readonly model: string;
	readonly thinkingLevel: ThinkingLevel;
	readonly turns: number;
	readonly usage: Readonly<UsageMetrics>;
	readonly stopReason?: string;
	readonly error?: string;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly endedAt: number;
}

export interface ResultPageRequest {
	name: string;
	cursor?: string;
	maxBytes?: number;
}

export interface ResultPageResponse {
	schema: 1;
	name: string;
	resultId: string;
	status: SubagentState;
	sha256: string;
	totalBytes: number;
	startByte: number;
	endByte: number;
	text: string;
	complete: boolean;
	nextCursor?: string;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	turns: number;
	usage: UsageMetrics;
	durationMs: number;
	createdAt: number;
	startedAt?: number;
	endedAt: number;
	stopReason?: string;
	error?: string;
}

export interface ValidationContext {
	activeCount: number;
	lifetimeNames: ReadonlySet<string>;
	managerDepth: number;
	maxSubagentDepth: number;
	currentModel?: ModelDescriptor;
	currentThinkingLevel: ThinkingLevel;
	findModel(provider: string, model: string): ModelDescriptor | undefined;
	clampThinkingLevel(model: ModelDescriptor, level: ThinkingLevel): ThinkingLevel;
	cwd: string;
	catalog: ToolCatalog;
}

export interface ResolvedAgentSpec {
	name: string;
	task: string;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	cwd: string;
	allowSubagents: boolean;
	expectedTools: readonly ToolFingerprint[];
}

export interface UsageMetrics {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
}

export interface ChildRunResult {
	finalText: string;
	usage: UsageMetrics;
	stopReason?: string;
	error?: string;
}

export interface ChildHandle {
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	run(task: string, hooks: { onTurn(usage?: UsageMetrics): void }): Promise<ChildRunResult>;
	abort(): Promise<void> | void;
	dispose(): Promise<void> | void;
}

export interface SubagentManagerScope {
	readonly coordinator: SubagentCoordinator;
	readonly depth: number;
}

export interface SubagentAdapter {
	initialize(spec: ResolvedAgentSpec, childScope: SubagentManagerScope, signal: AbortSignal): Promise<ChildHandle>;
}

export interface SubagentResult {
	id: string;
	name: string;
	status: SubagentState;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	turns: number;
	usage: UsageMetrics;
	durationMs: number;
	finalText?: string;
	resultTruncated?: boolean;
	resultPreview?: string;
	resultId?: string;
	resultSha256?: string;
	resultBytes?: number;
	error?: string;
	stopReason?: string;
}

export interface PollResponse {
	wakeReason: "result" | "timeout" | "queued_message" | "aborted" | "immediate";
	results: SubagentResult[];
	remaining: SubagentResult[];
}

export interface PollOptions {
	names?: string[];
	timeoutSeconds?: number;
	shouldWake?: () => boolean;
	signal?: AbortSignal;
}

export interface StatusOptions {
	names?: string[];
	includeResults?: boolean;
	resultPage?: ResultPageRequest;
}

export interface CancelOptions {
	names?: string[];
	all?: boolean;
}

/** Shared accounting for one root-owned subagent tree. */
export class SubagentCoordinator {
	readonly maxConcurrent: number;
	readonly maxSubagentDepth: number;
	readonly #activeIds = new Set<string>();
	readonly #listeners = new Set<(activeCount: number) => void>();

	constructor(maxConcurrent = MAX_CONCURRENT_AGENTS) {
		if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT_AGENTS) {
			throw new Error(`maxConcurrent must be an integer between 1 and ${MAX_CONCURRENT_AGENTS}.`);
		}
		this.maxConcurrent = maxConcurrent;
		this.maxSubagentDepth = MAX_SUBAGENT_DEPTH;
	}

	get activeCount(): number {
		return this.#activeIds.size;
	}

	reserve(ids: readonly string[]): void {
		if (this.activeCount + ids.length > this.maxConcurrent) {
			throw new Error(
				`Spawning ${ids.length} agents would exceed the ${this.maxConcurrent}-agent tree concurrency limit (${this.activeCount} active).`,
			);
		}
		const unique = new Set(ids);
		if (unique.size !== ids.length || ids.some((id) => this.#activeIds.has(id))) {
			throw new Error("Subagent coordinator received duplicate record identities.");
		}
		for (const id of ids) this.#activeIds.add(id);
		this.#emit();
	}

	release(id: string): void {
		if (!this.#activeIds.delete(id)) return;
		this.#emit();
	}

	subscribe(listener: (activeCount: number) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emit(): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(this.activeCount);
			} catch {
				// Accounting must not depend on a footer/status callback.
			}
		}
	}
}

export interface SubagentManagerOptions {
	adapter: SubagentAdapter;
	maxConcurrent?: number;
	scope?: SubagentManagerScope;
	turnLimit?: number;
	onChange?: (activeCount: number) => void;
	now?: () => number;
	shutdownGraceMs?: number;
	/** Injectable lifecycle-bound scheduler for deterministic tests. */
	boundScheduler?: (milliseconds: number) => Promise<void>;
}

interface InternalRecord {
	id: string;
	name: string;
	key: string;
	task: string;
	status: SubagentState;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	turns: number;
	usage: UsageMetrics;
	createdAt: number;
	startedAt?: number;
	endedAt?: number;
	finalText?: string;
	error?: string;
	stopReason?: string;
	delivered: boolean;
	cancelRequested: boolean;
	turnLimitReached: boolean;
	handle?: ChildHandle;
	initializationController?: AbortController;
	done: Promise<void>;
	resolveDone: () => void;
	detached: boolean;
	generation: number;
	resultSnapshot?: ResultSnapshot;
}

export function emptyUsage(): UsageMetrics {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

// (moved above — isTerminalState is now defined alongside the cursor/terminal helpers)

function normalizedName(name: string): string {
	return name.trim().toLocaleLowerCase();
}

function assertThinkingLevel(value: string): asserts value is ThinkingLevel {
	if (!(THINKING_LEVELS as readonly string[]).includes(value)) {
		throw new Error(`Invalid thinking level "${value}". Expected one of: ${THINKING_LEVELS.join(", ")}.`);
	}
}

export function validateSpawnBatch(specs: readonly AgentSpec[], context: ValidationContext): ResolvedAgentSpec[] {
	if (
		!Number.isInteger(context.managerDepth) ||
		context.managerDepth < 0 ||
		context.maxSubagentDepth !== MAX_SUBAGENT_DEPTH
	) {
		throw new Error("Invalid subagent hierarchy context.");
	}
	if (context.managerDepth >= context.maxSubagentDepth) {
		throw new Error(`Subagents may nest only one layer (maximum agent depth ${context.maxSubagentDepth}).`);
	}
	if (!Array.isArray(specs) || specs.length === 0) {
		throw new Error("agents must contain at least one subagent.");
	}
	if (specs.length > MAX_CONCURRENT_AGENTS) {
		throw new Error(`A spawn batch may contain at most ${MAX_CONCURRENT_AGENTS} agents.`);
	}
	if (context.activeCount + specs.length > MAX_CONCURRENT_AGENTS) {
		throw new Error(
			`Spawning ${specs.length} agents would exceed the ${MAX_CONCURRENT_AGENTS}-agent concurrency limit (${context.activeCount} active).`,
		);
	}

	const batchNames = new Set<string>();
	const resolved: ResolvedAgentSpec[] = [];

	for (let index = 0; index < specs.length; index++) {
		const spec = specs[index];
		const name = typeof spec?.name === "string" ? spec.name.trim() : "";
		const task = typeof spec?.task === "string" ? spec.task.trim() : "";
		if (!name) throw new Error(`agents[${index}].name is required.`);
		if (!task) throw new Error(`agents[${index}].task is required.`);

		const key = normalizedName(name);
		if (batchNames.has(key)) throw new Error(`Duplicate subagent name in batch: "${name}" (names are case-insensitive).`);
		if (context.lifetimeNames.has(key)) {
			throw new Error(`Subagent name "${name}" has already been used in this subagent scope.`);
		}
		batchNames.add(key);

		if (spec.allowSubagents !== undefined && typeof spec.allowSubagents !== "boolean") {
			throw new Error(`agents[${index}].allowSubagents must be a boolean.`);
		}
		const allowSubagents = spec.allowSubagents === true;
		if (allowSubagents && context.managerDepth + 1 >= context.maxSubagentDepth) {
			throw new Error(
				`Agent "${name}" cannot receive subagent controls: only root children may spawn one nested delegation layer.`,
			);
		}

		// ── Tool policy validation (exact, per-agent, ordered) ──
		if (spec.tools !== undefined && !Array.isArray(spec.tools)) {
			throw new Error(`agents[${index}].tools must be an array when provided (received ${typeof spec.tools}).`);
		}
		const requestedTools = spec.tools ?? [...context.catalog]
			.filter(([name, entry]) => !entry.forbidden && !SUBAGENT_CONTROL_TOOLS.has(name))
			.map(([name]) => name);
		const toolSet = new Set<string>();
		const expectedTools: ToolFingerprint[] = [];
		for (let ti = 0; ti < requestedTools.length; ti++) {
			const toolName = requestedTools[ti];
			if (typeof toolName !== "string") {
				throw new Error(`agents[${index}].tools[${ti}] must be a string.`);
			}
			if (toolSet.has(toolName)) {
				throw new Error(`Duplicate tool "${toolName}" in agents[${index}].tools.`);
			}
			toolSet.add(toolName);
			if (SUBAGENT_CONTROL_TOOLS.has(toolName)) {
				throw new Error(
					`Tool "${toolName}" requested by agent "${name}" is forbidden in tools; use allowSubagents for the complete managed control bundle.`,
				);
			}

			const entry = context.catalog.get(toolName);
			if (!entry) {
				throw new Error(`Tool "${toolName}" requested by agent "${name}" is not registered.`);
			}
			if (entry.forbidden) {
				throw new Error(`Tool "${toolName}" requested by agent "${name}" is forbidden.`);
			}
			expectedTools.push(entry.fingerprint);
		}

		if (allowSubagents) {
			for (const toolName of SUBAGENT_CONTROL_TOOL_NAMES) {
				const entry = context.catalog.get(toolName);
				if (!entry) {
					throw new Error(`Managed subagent tool "${toolName}" required by agent "${name}" is not registered.`);
				}
				if (entry.forbidden) {
					throw new Error(`Managed subagent tool "${toolName}" required by agent "${name}" is forbidden.`);
				}
				expectedTools.push(entry.fingerprint);
			}
		}

		const hasProvider = typeof spec.provider === "string" && spec.provider.trim().length > 0;
		const hasModel = typeof spec.model === "string" && spec.model.trim().length > 0;
		if (hasProvider !== hasModel) {
			throw new Error(`agents[${index}].provider and agents[${index}].model must be provided together.`);
		}

		const model = hasProvider
			? context.findModel(spec.provider!.trim(), spec.model!.trim())
			: context.currentModel;
		if (!model) {
			const label = hasProvider ? `${spec.provider!.trim()}/${spec.model!.trim()}` : "the caller's current model";
			throw new Error(`Model ${label} is not available.`);
		}
		if (!model.authConfigured) {
			throw new Error(`Model ${model.provider}/${model.id} does not have configured authentication.`);
		}

		let thinkingLevel: ThinkingLevel;
		if (spec.thinkingLevel !== undefined) {
			assertThinkingLevel(spec.thinkingLevel);
			if (!model.supportedThinkingLevels.includes(spec.thinkingLevel)) {
				throw new Error(
					`Thinking level "${spec.thinkingLevel}" is not supported by ${model.provider}/${model.id}. Supported: ${model.supportedThinkingLevels.join(", ")}.`,
				);
			}
			thinkingLevel = spec.thinkingLevel;
		} else {
			thinkingLevel = context.clampThinkingLevel(model, context.currentThinkingLevel);
		}

		resolved.push({
			name,
			task,
			provider: model.provider,
			model: model.id,
			thinkingLevel,
			cwd: context.cwd,
			allowSubagents,
			expectedTools: Object.freeze(expectedTools.map((tool) => Object.freeze({ ...tool }))),
		});
	}

	return resolved;
}

export function compareToolFingerprints(
	expected: readonly ToolFingerprint[],
	actual: readonly ToolFingerprint[],
): string | undefined {
	const expectedMap = new Map(expected.map((tool) => [tool.name, tool.fingerprint]));
	const actualMap = new Map(actual.map((tool) => [tool.name, tool.fingerprint]));
	const missing = [...expectedMap.keys()].filter((name) => !actualMap.has(name)).sort();
	const extra = [...actualMap.keys()].filter((name) => !expectedMap.has(name)).sort();
	const changed = [...expectedMap.keys()]
		.filter((name) => actualMap.has(name) && actualMap.get(name) !== expectedMap.get(name))
		.sort();
	const actualNames = actual.map((tool) => tool.name);
	const duplicateActual = actualNames
		.filter((name, index) => actualNames.indexOf(name) !== index)
		.filter((name, index, names) => names.indexOf(name) === index)
		.sort();
	const orderChanged =
		missing.length === 0 &&
		extra.length === 0 &&
		duplicateActual.length === 0 &&
		expected.some((tool, index) => actual[index]?.name !== tool.name);
	if (missing.length === 0 && extra.length === 0 && changed.length === 0 && duplicateActual.length === 0 && !orderChanged) {
		return undefined;
	}
	const parts: string[] = [];
	if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
	if (extra.length) parts.push(`unexpected: ${extra.join(", ")}`);
	if (duplicateActual.length) parts.push(`duplicate active identities: ${duplicateActual.join(", ")}`);
	if (orderChanged) {
		parts.push(`order differs: expected ${expected.map((tool) => tool.name).join(", ")}; actual ${actualNames.join(", ")}`);
	}
	if (changed.length) parts.push(`different definitions: ${changed.join(", ")}`);
	return `Child tool inheritance mismatch (${parts.join("; ")}).`;
}

function utf8Prefix(value: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	let bytes = 0;
	let result = "";
	for (const character of value) {
		const size = Buffer.byteLength(character, "utf8");
		if (bytes + size > maxBytes) break;
		result += character;
		bytes += size;
	}
	return result;
}

export function capModelOutput(
	value: unknown,
	maxBytes = MODEL_OUTPUT_MAX_BYTES,
	maxLines = MODEL_OUTPUT_MAX_LINES,
): { text: string; truncated: boolean } {
	const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	const rawLines = raw.split("\n");
	const lineLimited = rawLines.length > maxLines ? rawLines.slice(0, Math.max(0, maxLines - 1)).join("\n") : raw;
	const needsTruncation = rawLines.length > maxLines || Buffer.byteLength(lineLimited, "utf8") > maxBytes;
	if (!needsTruncation) return { text: lineLimited, truncated: false };

	const notice = "\n[Model-visible output truncated. Retrieve the full result with subagent_status using resultPage mode.]";
	const bodyBudget = Math.max(0, maxBytes - Buffer.byteLength(notice, "utf8"));
	let body = utf8Prefix(lineLimited, bodyBudget);
	const allowedBodyLines = Math.max(0, maxLines - 1);
	if (body.split("\n").length > allowedBodyLines) {
		body = body.split("\n").slice(0, allowedBodyLines).join("\n");
	}
	return { text: `${body}${notice}`, truncated: true };
}

export function isTerminalState(state: SubagentState): state is TerminalState {
	return TERMINAL_STATES.has(state);
}

// ── Cursor auth helpers ───────────────────────────────────────

interface CursorPayload {
	v: number;
	rid: string;
	off: number;
}

function encodeCursor(payload: CursorPayload, secret: Buffer): string {
	const json = JSON.stringify(payload);
	const encoded = Buffer.from(json).toString("base64url");
	const hmac = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
	return `${encoded}.${hmac}`;
}

function decodeCursor(cursor: string, secret: Buffer): CursorPayload | undefined {
	const dot = cursor.lastIndexOf(".");
	if (dot < 0) return undefined;
	const encoded = cursor.slice(0, dot);
	const hmac = cursor.slice(dot + 1);
	const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
	let supplied: Buffer;
	try {
		supplied = Buffer.from(hmac, "base64url");
	} catch {
		return undefined;
	}
	if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return undefined;
	try {
		const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
		if (
			payload?.v !== CURSOR_VERSION ||
			typeof payload.rid !== "string" ||
			typeof payload.off !== "number" ||
			!Number.isInteger(payload.off) ||
			payload.off < 0
		) {
			return undefined;
		}
		return payload as CursorPayload;
	} catch {
		return undefined;
	}
}

/** Check whether a UTF-8 byte offset falls on a code-point start boundary. */
function isCodePointStart(bytes: Buffer, offset: number): boolean {
	if (offset === 0) return true;
	if (offset >= bytes.length) return false;
	const byte = bytes[offset];
	// Continuation bytes are 10xxxxxx (0x80–0xBF).
	return (byte & 0xC0) !== 0x80;
}

/** Walk forward from offset to the largest code-point boundary within maxBytes. */
function advanceToBoundary(bytes: Buffer, offset: number, maxBytes: number): number {
	let pos = offset;
	let consumed = 0;
	while (pos < bytes.length) {
		const b = bytes[pos];
		let charBytes: number;
		if ((b & 0x80) === 0) charBytes = 1;
		else if ((b & 0xE0) === 0xC0) charBytes = 2;
		else if ((b & 0xF0) === 0xE0) charBytes = 3;
		else charBytes = 4;
		if (pos + charBytes > bytes.length) break;
		if (consumed + charBytes > maxBytes) break;
		pos += charBytes;
		consumed += charBytes;
	}
	return pos;
}

function countLines(text: string): number {
	let count = 1;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") count++;
	}
	return count;
}

let nextId = 1;

export class SubagentManager {
	readonly #adapter: SubagentAdapter;
	readonly #turnLimit: number;
	readonly #shutdownGraceMs: number;
	readonly #boundScheduler: (milliseconds: number) => Promise<void>;
	readonly #onChange?: (activeCount: number) => void;
	readonly #now: () => number;
	readonly #cursorSecret: Buffer;
	readonly #abortedHandles = new WeakSet<object>();
	readonly #disposePromises = new WeakMap<object, Promise<void>>();
	readonly #records = new Map<string, InternalRecord>();
	readonly #lifetimeNames = new Set<string>();
	readonly #waiters = new Set<() => void>();
	#coordinator: SubagentCoordinator;
	#depth: number;
	#unsubscribeCoordinator?: () => void;
	#blockingPoll = false;
	#reminderOutstanding = false;
	#shutdown = false;
	#shutdownPromise?: Promise<void>;
	#lastNotifiedActiveCount = 0;

	constructor(options: SubagentManagerOptions) {
		if (options.scope && options.maxConcurrent !== undefined) {
			throw new Error("A shared subagent scope cannot be combined with an independent concurrency limit.");
		}
		this.#adapter = options.adapter;
		this.#coordinator = options.scope?.coordinator ?? new SubagentCoordinator(options.maxConcurrent);
		this.#depth = options.scope?.depth ?? 0;
		this.#assertDepth(this.#depth, this.#coordinator);
		this.#turnLimit = options.turnLimit ?? MAX_ASSISTANT_TURNS;
		this.#shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
		this.#boundScheduler = options.boundScheduler ?? ((milliseconds) => new Promise((resolve) => {
			const timer = setTimeout(resolve, milliseconds);
			timer.unref?.();
		}));
		this.#onChange = options.onChange;
		this.#now = options.now ?? Date.now;
		this.#cursorSecret = crypto.randomBytes(32);
		this.#subscribeCoordinator();
	}

	get activeCount(): number {
		return this.#coordinator.activeCount;
	}

	get depth(): number {
		return this.#depth;
	}

	get lifetimeNames(): ReadonlySet<string> {
		return this.#lifetimeNames;
	}

	createChildScope(): SubagentManagerScope {
		return Object.freeze({ coordinator: this.#coordinator, depth: this.#depth + 1 });
	}

	attachScope(scope: SubagentManagerScope): void {
		if (this.#shutdown || this.#records.size > 0 || this.#lifetimeNames.size > 0) {
			throw new Error("A subagent manager scope can be attached only before the manager is used.");
		}
		this.#assertDepth(scope.depth, scope.coordinator);
		this.#unsubscribeCoordinator?.();
		this.#coordinator = scope.coordinator;
		this.#depth = scope.depth;
		this.#lastNotifiedActiveCount = -1;
		this.#subscribeCoordinator();
		this.#notifyActiveCount(this.activeCount);
	}

	async spawn(
		specs: readonly AgentSpec[],
		context: Omit<ValidationContext, "activeCount" | "lifetimeNames" | "managerDepth" | "maxSubagentDepth">,
	): Promise<SubagentResult[]> {
		if (this.#shutdown) throw new Error("The subagent manager is shutting down.");
		const resolved = validateSpawnBatch(specs, {
			...context,
			activeCount: this.activeCount,
			lifetimeNames: this.#lifetimeNames,
			managerDepth: this.#depth,
			maxSubagentDepth: this.#coordinator.maxSubagentDepth,
		});

		const records = resolved.map((spec) => this.#createRecord(spec));
		this.#coordinator.reserve(records.map((record) => record.id));
		try {
			for (const record of records) {
				this.#records.set(record.key, record);
				this.#lifetimeNames.add(record.key);
			}
		} catch (error) {
			for (const record of records) this.#coordinator.release(record.id);
			throw error;
		}
		this.#changed();

		const childScope = this.createChildScope();
		let initializationAbandoned = false;
		let firstInitializationError: string | undefined;
		let signalInitializationFailure = () => undefined;
		const initializationFailure = new Promise<void>((resolve) => {
			signalInitializationFailure = resolve;
		});
		const initializedHandles: Array<ChildHandle | undefined> = Array(records.length);
		const abortInitializers = (reason: string) => {
			for (const record of records) {
				if (!record.initializationController?.signal.aborted) {
					record.initializationController?.abort(new Error(reason));
				}
			}
		};
		const abandonForFailure = (reason: unknown) => {
			if (firstInitializationError !== undefined) return;
			firstInitializationError = errorText(reason);
			initializationAbandoned = true;
			abortInitializers(`Batch initialization failed: ${firstInitializationError}`);
			signalInitializationFailure();
		};
		const initialization = Promise.all(
			resolved.map(async (spec, index) => {
				try {
					const signal = records[index].initializationController!.signal;
					const handle = await this.#adapter.initialize(spec, childScope, signal);
					if (initializationAbandoned || isTerminalState(records[index].status)) {
						void this.#boundedDispose(handle, this.#shutdownGraceMs);
					} else {
						initializedHandles[index] = handle;
					}
					return { status: "fulfilled" as const, value: handle };
				} catch (reason) {
					if (
						!records[index].initializationController?.signal.aborted &&
						!isTerminalState(records[index].status)
					) {
						abandonForFailure(reason);
					}
					return { status: "rejected" as const, reason };
				}
			}),
		);
		const outcome = await Promise.race([
			initialization.then((results) => ({ kind: "initialized" as const, results })),
			Promise.race(records.map((record) => record.done)).then(() => ({ kind: "interrupted" as const })),
			initializationFailure.then(() => ({ kind: "failed" as const })),
		]);

		if (outcome.kind === "failed") {
			await Promise.allSettled(
				initializedHandles.filter((handle): handle is ChildHandle => handle !== undefined)
					.map((handle) => this.#boundedDispose(handle, this.#shutdownGraceMs)),
			);
			const message = `Batch initialization failed before any task started: ${firstInitializationError}`;
			for (const record of records) this.#terminalize(record, "failed", { error: message });
			return records.map((record) => this.#snapshot(record, true));
		}

		if (outcome.kind === "interrupted" || records.some((record) => isTerminalState(record.status))) {
			initializationAbandoned = true;
			abortInitializers("Batch initialization was interrupted before any task started.");
			await Promise.allSettled(
				initializedHandles.filter((handle): handle is ChildHandle => handle !== undefined)
					.map((handle) => this.#boundedDispose(handle, this.#shutdownGraceMs)),
			);
			for (const record of records) {
				if (isTerminalState(record.status)) continue;
				const cancelled = this.#shutdown || record.cancelRequested;
				this.#terminalize(record, cancelled ? "cancelled" : "failed", {
					error: cancelled
						? "Cancelled before the delegated task started."
						: "Batch initialization was interrupted before any task started.",
				});
			}
			return records.map((record) => this.#snapshot(record, true));
		}

		const initialized = outcome.results;
		const failure = initialized.find((result) => result.status === "rejected");
		let initializationError = failure?.status === "rejected" ? errorText(failure.reason) : undefined;
		if (!initializationError) {
			for (let index = 0; index < initialized.length; index++) {
				const handle = initialized[index].status === "fulfilled" ? initialized[index].value : undefined;
				if (!handle) continue;
				const spec = resolved[index];
				if (handle.provider !== spec.provider || handle.model !== spec.model) {
					initializationError =
						`Child model mismatch for "${spec.name}": expected ${spec.provider}/${spec.model}, ` +
						`received ${handle.provider}/${handle.model}.`;
					break;
				}
				if (handle.thinkingLevel !== spec.thinkingLevel) {
					initializationError =
						`Child thinking-level mismatch for "${spec.name}": expected ${spec.thinkingLevel}, ` +
						`received ${handle.thinkingLevel}.`;
					break;
				}
			}
		}
		if (initializationError) {
			initializationAbandoned = true;
			abortInitializers(`Batch initialization failed: ${initializationError}`);
			await Promise.allSettled(
				initializedHandles.filter((handle): handle is ChildHandle => handle !== undefined)
					.map((handle) => this.#boundedDispose(handle, this.#shutdownGraceMs)),
			);
			const message = `Batch initialization failed before any task started: ${initializationError}`;
			for (const record of records) this.#terminalize(record, "failed", { error: message });
			return records.map((record) => this.#snapshot(record, true));
		}

		for (let index = 0; index < records.length; index++) {
			const record = records[index];
			const handle = initializedHandles[index]!;
			record.handle = handle;
			record.initializationController = undefined;
			record.provider = handle.provider;
			record.model = handle.model;
			record.thinkingLevel = handle.thinkingLevel;
			record.status = "running";
			record.startedAt = this.#now();
			void this.#run(record, record.generation);
		}
		return records.map((record) => this.#snapshot(record, true));
	}

	async poll(options: PollOptions = {}): Promise<PollResponse> {
		const timeoutSeconds = options.timeoutSeconds ?? 60;
		if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 3_600) {
			throw new Error("timeoutSeconds must be between 0 and 3600.");
		}
		const selected = this.#select(options.names);
		this.ackReminder();
		let results = this.#consumeCompleted(selected);
		if (results.length > 0) {
			return { wakeReason: "result", results, remaining: this.#remaining(selected) };
		}
		if (timeoutSeconds === 0) {
			return { wakeReason: "immediate", results: [], remaining: this.#remaining(selected) };
		}
		if (this.#blockingPoll) throw new Error("A blocking subagent_poll is already active.");

		this.#blockingPoll = true;
		const deadline = this.#now() + timeoutSeconds * 1_000;
		let wakeReason: PollResponse["wakeReason"] = "timeout";
		try {
			while (this.#now() < deadline) {
				if (options.signal?.aborted) {
					wakeReason = "aborted";
					break;
				}
				if (options.shouldWake?.()) {
					wakeReason = "queued_message";
					break;
				}
				results = this.#consumeCompleted(selected);
				if (results.length > 0) {
					wakeReason = "result";
					break;
				}
				await this.#waitForChange(Math.min(100, Math.max(0, deadline - this.#now())));
			}
			if (wakeReason === "timeout") {
				results = this.#consumeCompleted(selected);
				if (results.length > 0) wakeReason = "result";
			}
			return { wakeReason, results, remaining: this.#remaining(selected) };
		} finally {
			this.#blockingPoll = false;
		}
	}

	status(options: StatusOptions = {}): SubagentResult[] | ResultPageResponse {
		if (options.resultPage) {
			if (options.names !== undefined || options.includeResults !== undefined) {
				throw new Error("resultPage is exclusive; do not combine with names or includeResults.");
			}
			return this.#resultPage(options.resultPage);
		}
		const selected = this.#select(options.names);
		return selected.map((record) => this.#snapshot(record, options.includeResults === true));
	}

	async cancel(options: CancelOptions): Promise<SubagentResult[]> {
		const hasNames = Array.isArray(options.names);
		if ((options.all === true) === hasNames) {
			throw new Error("Specify either names or all: true, but not both.");
		}
		const selected = options.all === true ? [...this.#records.values()] : this.#select(options.names);
		for (const record of selected) record.delivered = true;
		this.#reminderOutstanding = false;
		await Promise.all(selected.map((record) => this.#stopRecord(record, "cancelled", "Cancelled.")));
		return selected.map((record) => this.#snapshot(record, true));
	}

	shutdown(reason = "Root session shutdown"): Promise<void> {
		if (this.#shutdownPromise) return this.#shutdownPromise;
		this.#shutdown = true;
		this.#shutdownPromise = (async () => {
			try {
				const active = [...this.#records.values()].filter(
					(record) => record.status === "starting" || record.status === "running",
				);
				for (const record of this.#records.values()) record.delivered = true;
				this.#reminderOutstanding = false;
				await Promise.all(active.map((record) => this.#stopRecord(record, "cancelled", reason)));
			} finally {
				this.#unsubscribeCoordinator?.();
				this.#unsubscribeCoordinator = undefined;
			}
		})();
		return this.#shutdownPromise;
	}

	claimReminder(): boolean {
		if (this.#shutdown || this.#reminderOutstanding || !this.#needsReminder()) return false;
		this.#reminderOutstanding = true;
		return true;
	}

	ackReminder(): void {
		this.#reminderOutstanding = false;
	}

	#createRecord(spec: ResolvedAgentSpec): InternalRecord {
		let resolveDone = () => undefined;
		const done = new Promise<void>((resolve) => {
			resolveDone = resolve;
		});
		return {
			id: `subagent-${nextId++}`,
			name: spec.name,
			key: normalizedName(spec.name),
			task: spec.task,
			status: "starting",
			provider: spec.provider,
			model: spec.model,
			thinkingLevel: spec.thinkingLevel,
			turns: 0,
			usage: emptyUsage(),
			createdAt: this.#now(),
			delivered: false,
			cancelRequested: false,
			turnLimitReached: false,
			initializationController: new AbortController(),
			done,
			resolveDone,
			detached: false,
			generation: 0,
		};
	}

	async #run(record: InternalRecord, generation: number): Promise<void> {
		const handle = record.handle!;
		let finalStatus: TerminalState = "failed";
		let finalFields: { finalText?: string; usage?: UsageMetrics; error?: string; stopReason?: string } = {};
		try {
			const result = await handle.run(record.task, {
				onTurn: (usage) => {
					if (!this.#isCurrent(record, generation) || record.turnLimitReached) return;
					record.turns++;
					if (usage) record.usage = { ...usage };
					if (record.turns >= this.#turnLimit) {
						record.turnLimitReached = true;
						void this.#stopRecord(
							record,
							"turn_limit",
							`Assistant turn limit reached (${this.#turnLimit}).`,
							generation,
						);
					}
					this.#changed();
				},
			});
			if (!this.#isCurrent(record, generation)) return;
			finalFields = { finalText: result.finalText, usage: result.usage, stopReason: result.stopReason };
			if (record.turnLimitReached) {
				finalStatus = "turn_limit";
				finalFields.error = `Assistant turn limit reached (${this.#turnLimit}).`;
			} else if (record.cancelRequested || this.#shutdown) {
				finalStatus = "cancelled";
				finalFields.error = record.error ?? "Cancelled.";
			} else if (result.error || result.stopReason === "error" || result.stopReason === "aborted") {
				finalStatus = "failed";
				finalFields.error = result.error ?? `Child stopped with ${result.stopReason}.`;
			} else {
				finalStatus = "completed";
			}
		} catch (error) {
			if (!this.#isCurrent(record, generation)) return;
			if (record.turnLimitReached) {
				finalStatus = "turn_limit";
				finalFields = { error: `Assistant turn limit reached (${this.#turnLimit}).` };
			} else if (record.cancelRequested || this.#shutdown) {
				finalStatus = "cancelled";
				finalFields = { error: record.error ?? "Cancelled." };
			} else {
				finalStatus = "failed";
				finalFields = { error: errorText(error) };
			}
		} finally {
			// Child disposal cascades into its nested manager. Do not publish an ordinary
			// terminal result until that owned subtree has settled or hit its bound.
			await this.#boundedDispose(handle, this.#shutdownGraceMs);
			if (this.#isCurrent(record, generation)) {
				// Cancellation or turn-limit state can change while cascading disposal waits.
				if (record.turnLimitReached) {
					finalStatus = "turn_limit";
					finalFields.error = `Assistant turn limit reached (${this.#turnLimit}).`;
				} else if (record.cancelRequested || this.#shutdown) {
					finalStatus = "cancelled";
					finalFields.error = record.error ?? "Cancelled.";
				}
				this.#terminalize(record, finalStatus, finalFields, generation);
			}
			if (record.handle === handle) record.handle = undefined;
		}
	}

	#isCurrent(record: InternalRecord, generation: number): boolean {
		return !record.detached && record.generation === generation && !isTerminalState(record.status);
	}

	/** Idempotent terminalization: wins the generation, freezes fields, creates snapshot, resolves done. */
	#terminalize(
		record: InternalRecord,
		status: TerminalState,
		fields: { finalText?: string; usage?: UsageMetrics; error?: string; stopReason?: string },
		expectedGeneration = record.generation,
	): boolean {
		if (!this.#isCurrent(record, expectedGeneration)) return false;
		record.detached = true;
		record.generation++;
		record.status = status;
		record.initializationController = undefined;
		record.endedAt = this.#now();
		if (fields.finalText !== undefined) record.finalText = fields.finalText;
		if (fields.usage !== undefined) record.usage = { ...fields.usage };
		if (fields.error !== undefined) record.error = fields.error;
		if (fields.stopReason !== undefined) record.stopReason = fields.stopReason;

		const bytes = Buffer.from(record.finalText ?? "", "utf8");
		const usage = Object.freeze({ ...record.usage });
		record.resultSnapshot = Object.freeze({
			id: crypto.randomUUID(),
			bytes,
			sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
			totalBytes: bytes.length,
			status,
			provider: record.provider,
			model: record.model,
			thinkingLevel: record.thinkingLevel,
			turns: record.turns,
			usage,
			stopReason: record.stopReason,
			error: record.error,
			createdAt: record.createdAt,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
		});
		// The snapshot buffer is the sole retained canonical terminal payload.
		record.finalText = undefined;

		this.#coordinator.release(record.id);
		record.resolveDone();
		this.#changed();
		return true;
	}

	#snapshot(record: InternalRecord, includeResult: boolean): SubagentResult {
		const end = record.endedAt ?? this.#now();
		const start = record.startedAt ?? record.createdAt;
		const snapshot = record.resultSnapshot;
		const base: SubagentResult = {
			id: record.id,
			name: record.name,
			status: record.status,
			provider: record.provider,
			model: record.model,
			thinkingLevel: record.thinkingLevel,
			turns: record.turns,
			usage: { ...record.usage },
			durationMs: Math.max(0, end - start),
			...(record.error !== undefined ? { error: record.error } : {}),
			...(record.stopReason !== undefined ? { stopReason: record.stopReason } : {}),
		};

		if (!includeResult) return base;

		if (snapshot && snapshot.totalBytes > MODEL_OUTPUT_MAX_BYTES) {
			// Oversized — deliver bounded preview + paging metadata, never the full text.
			const previewBytes = advanceToBoundary(snapshot.bytes, 0, RESULT_PREVIEW_MAX_BYTES);
			const previewText = snapshot.bytes.subarray(0, previewBytes).toString("utf8");
			return {
				...base,
				resultTruncated: true,
				resultPreview: previewText,
				resultId: snapshot.id,
				resultSha256: snapshot.sha256,
				resultBytes: snapshot.totalBytes,
			};
		}

		if (snapshot) {
			// Non-oversized — include the full text.
			return { ...base, finalText: snapshot.bytes.toString("utf8") };
		}

		// No snapshot yet (still starting/running); include whatever text we have.
		if (record.finalText !== undefined) return { ...base, finalText: record.finalText };
		return base;
	}

	#select(names?: string[]): InternalRecord[] {
		if (names === undefined) return [...this.#records.values()];
		if (!Array.isArray(names) || names.length === 0) throw new Error("names must contain at least one subagent name.");
		const selected: InternalRecord[] = [];
		const seen = new Set<string>();
		for (const name of names) {
			const key = normalizedName(String(name));
			if (seen.has(key)) continue;
			const record = this.#records.get(key);
			if (!record) throw new Error(`Unknown subagent name: "${name}".`);
			seen.add(key);
			selected.push(record);
		}
		return selected;
	}

	#consumeCompleted(selected: readonly InternalRecord[]): SubagentResult[] {
		const results: SubagentResult[] = [];
		for (const record of selected) {
			if (isTerminalState(record.status) && !record.delivered) {
				record.delivered = true;
				results.push(this.#snapshot(record, true));
			}
		}
		if (results.length) this.#changed();
		return results;
	}

	#remaining(selected: readonly InternalRecord[]): SubagentResult[] {
		return selected
			.filter((record) => !isTerminalState(record.status) || !record.delivered)
			.map((record) => this.#snapshot(record, false));
	}

	#needsReminder(): boolean {
		for (const record of this.#records.values()) {
			if (record.status === "starting" || record.status === "running") return true;
			if (isTerminalState(record.status) && !record.delivered) return true;
		}
		return false;
	}

	// ── Result page ────────────────────────────────────────────

	#resultPage(request: ResultPageRequest): ResultPageResponse {
		const [record] = this.#select([request.name]);
		const snapshot = record.resultSnapshot;
		if (!snapshot) {
			throw new Error(`Subagent "${request.name}" has no completed result to page.`);
		}

		const maxBytes = request.maxBytes ?? RESULT_PREVIEW_MAX_BYTES;
		if (!Number.isInteger(maxBytes) || maxBytes < RESULT_PAGE_MIN_BYTES || maxBytes > RESULT_PAGE_MAX_BYTES) {
			throw new Error(
				`maxBytes must be an integer between ${RESULT_PAGE_MIN_BYTES} and ${RESULT_PAGE_MAX_BYTES}.`,
			);
		}

		let offset = 0;
		if (request.cursor !== undefined) {
			const payload = decodeCursor(request.cursor, this.#cursorSecret);
			if (!payload) throw new Error("Invalid or stale result page cursor.");
			if (payload.rid !== snapshot.id) throw new Error("Cursor does not match the current result.");
			if (payload.off > snapshot.totalBytes) throw new Error("Cursor offset is out of range.");
			if (payload.off > 0 && !isCodePointStart(snapshot.bytes, payload.off)) {
				throw new Error("Cursor does not start at a UTF-8 code point boundary.");
			}
			offset = payload.off;
		}

		const endOffset = advanceToBoundary(snapshot.bytes, offset, maxBytes);
		const pageBytes = snapshot.bytes.subarray(offset, endOffset);
		const text = pageBytes.toString("utf8");
		const complete = endOffset >= snapshot.totalBytes;

		let nextCursor: string | undefined;
		if (!complete) {
			nextCursor = encodeCursor({ v: CURSOR_VERSION, rid: snapshot.id, off: endOffset }, this.#cursorSecret);
		}

		const start = record.startedAt ?? record.createdAt;
		return {
			schema: 1,
			name: record.name,
			resultId: snapshot.id,
			status: snapshot.status,
			sha256: snapshot.sha256,
			totalBytes: snapshot.totalBytes,
			startByte: offset,
			endByte: endOffset,
			text,
			complete,
			...(nextCursor ? { nextCursor } : {}),
			provider: snapshot.provider,
			model: snapshot.model,
			thinkingLevel: snapshot.thinkingLevel,
			turns: snapshot.turns,
			usage: { ...snapshot.usage },
			durationMs: Math.max(0, snapshot.endedAt - start),
			createdAt: snapshot.createdAt,
			...(snapshot.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
			endedAt: snapshot.endedAt,
			...(snapshot.stopReason ? { stopReason: snapshot.stopReason } : {}),
			...(snapshot.error ? { error: snapshot.error } : {}),
		};
	}

	// ── Bounded lifecycle helpers ──────────────────────────────

	async #stopRecord(
		record: InternalRecord,
		cause: Extract<TerminalState, "cancelled" | "turn_limit">,
		error: string,
		expectedGeneration = record.generation,
	): Promise<void> {
		if (!this.#isCurrent(record, expectedGeneration)) return;
		if (cause === "cancelled") record.cancelRequested = true;
		record.error = error;

		// Abort starting initialization cooperatively. The observed initialization
		// promise disposes any handle that still arrives after terminalization.
		const handle = record.handle;
		if (!handle) {
			record.initializationController?.abort(new Error(error));
			this.#terminalize(record, cause, { error }, expectedGeneration);
			return;
		}

		this.#requestAbort(handle);
		await Promise.race([record.done, this.#boundScheduler(this.#shutdownGraceMs)]);
		if (this.#isCurrent(record, expectedGeneration)) {
			this.#terminalize(record, cause, {
				error: `${error} Root accounting ended after the child failed to cooperate; provider execution may not have stopped.`,
			}, expectedGeneration);
		}
		await this.#boundedDispose(handle, this.#shutdownGraceMs);
		if (record.handle === handle) record.handle = undefined;
	}

	#requestAbort(handle: ChildHandle): void {
		if (this.#abortedHandles.has(handle)) return;
		this.#abortedHandles.add(handle);
		try {
			void Promise.resolve(handle.abort()).catch(() => undefined);
		} catch {
			// Synchronous throw in abort is observed and cannot block root accounting.
		}
	}

	#boundedDispose(handle: ChildHandle, graceMs: number): Promise<void> {
		const existing = this.#disposePromises.get(handle);
		if (existing) return existing;

		let settle = () => undefined;
		const bounded = new Promise<void>((resolve) => {
			settle = resolve;
		});
		this.#disposePromises.set(handle, bounded);
		void (async () => {
			try {
				const disposal = Promise.resolve(handle.dispose()).catch(() => undefined);
				await Promise.race([disposal, this.#boundScheduler(graceMs)]);
			} catch {
				// Synchronous throw in dispose is observed and cannot block root accounting.
			} finally {
				settle();
			}
		})();
		return bounded;
	}

	// ── Cursor helpers (tested indirectly via #resultPage) ─────

	#encodeCursor(payload: CursorPayload): string {
		return encodeCursor(payload, this.#cursorSecret);
	}

	#decodeCursor(cursor: string): CursorPayload | undefined {
		return decodeCursor(cursor, this.#cursorSecret);
	}

	#assertDepth(depth: number, coordinator: SubagentCoordinator): void {
		if (!Number.isInteger(depth) || depth < 0 || depth > coordinator.maxSubagentDepth) {
			throw new Error(`Subagent manager depth must be between 0 and ${coordinator.maxSubagentDepth}.`);
		}
	}

	#subscribeCoordinator(): void {
		this.#unsubscribeCoordinator = this.#coordinator.subscribe((activeCount) => {
			this.#notifyActiveCount(activeCount);
		});
	}

	#notifyActiveCount(activeCount: number): void {
		if (activeCount === this.#lastNotifiedActiveCount) return;
		this.#lastNotifiedActiveCount = activeCount;
		this.#onChange?.(activeCount);
	}

	#changed(): void {
		this.#notifyActiveCount(this.activeCount);
		for (const waiter of [...this.#waiters]) waiter();
	}

	#waitForChange(milliseconds: number): Promise<void> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.#waiters.delete(finish);
				resolve();
			};
			const timer = setTimeout(finish, milliseconds);
			this.#waiters.add(finish);
		});
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
