import { createHash } from "node:crypto";
import {
	DEFAULT_BRAINSTORM_AGENTS,
	MAX_BRAINSTORM_AGENTS,
	MIN_BRAINSTORM_AGENTS,
	type WorkflowName,
} from "./types.ts";

export interface ParsedCommand {
	workflow: WorkflowName;
	action: "start" | "status" | "cancel" | "pause" | "resume" | "reset" | "list" | "doctor";
	input?: string;
	runId?: string;
	name?: string;
	agents: number;
	interactive?: boolean;
}

interface CommandToken {
	value: string;
	start: number;
	end: number;
}

/** Read one option/management token. Callers stop scanning as soon as prompt text begins,
 * so prompt bytes are never parsed as command syntax. */
function nextToken(input: string, offset: number): CommandToken | undefined {
	let index = offset;
	while (index < input.length && /\s/.test(input[index])) index++;
	if (index === input.length) return undefined;
	const start = index;
	let value = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	for (; index < input.length; index++) {
		const character = input[index];
		if (escaping) {
			value += character;
			escaping = false;
			continue;
		}
		if (character === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else value += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) break;
		value += character;
	}
	if (escaping || quote) throw new Error("Unterminated quote or escape in command arguments.");
	return { value, start, end: index };
}

function integer(value: string | undefined, option: string, min: number, max: number): number {
	if (!value || !/^\d+$/.test(value)) throw new Error(`${option} requires an integer from ${min} to ${max}.`);
	const parsed = Number(value);
	if (parsed < min || parsed > max) throw new Error(`${option} must be from ${min} to ${max}.`);
	return parsed;
}

export function safeSlug(value: string, fallback = "sprint"): string {
	const slug = value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || fallback;
}

/** OpenAI-compatible providers cap prompt cache/session affinity keys at 64 characters.
 *  Every distinct complete worker identifier produces a distinct session id by appending
 *  a SHA-256-derived hex suffix to a truncated readable slug prefix. */
export function safeSessionId(value: string): string {
	const hash = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
	const maxPrefix = 64 - 1 - 16; // reserve separator + 16-char hex suffix
	const prefix = safeSlug(value, "sprint-worker").slice(0, maxPrefix).replace(/-+$/g, "");
	return `${prefix}-${hash}`;
}

/** Accept workflow input as a prompt. Agents, not the command layer, interpret any path references it contains. */
export function acceptWorkflowInput(input: string): string {
	if (!input.trim()) throw new Error("A workflow prompt is required.");
	return input;
}

function assertManagementRunId(value: string): string {
	if (!value || value.includes("/") || value.includes("\\") || value === "." || value === ".." || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error("A sprint run id must be one safe path segment.");
	}
	return value;
}

export function parseCommand(workflow: WorkflowName, raw: string): ParsedCommand {
	const firstStart = raw.search(/\S/);
	const bareFirst = firstStart < 0 ? "" : raw.slice(firstStart).match(/^\S+/)?.[0] ?? "";
	const management = ["status", "cancel", "pause", "resume", "reset", "list", "doctor"].includes(bareFirst) ? bareFirst : undefined;
	if (management) {
		const first = nextToken(raw, 0)!;
		const action = management as ParsedCommand["action"];
		const run = nextToken(raw, first.end);
		const extra = run ? nextToken(raw, run.end) : undefined;
		if (workflow === "sprint" && action === "cancel") throw new Error("/sprint uses pause for resumable interruption; cancel is not supported.");
		if (workflow === "sprint" && action === "list" && run) throw new Error("/sprint list does not accept arguments.");
		if (workflow === "sprint" && run) {
			const runId = assertManagementRunId(run.value);
			if (extra) throw new Error(`/${workflow} ${action} accepts at most one run id.`);
			return { workflow, action, runId, agents: DEFAULT_BRAINSTORM_AGENTS };
		}
		if (workflow !== "sprint" && !["status", "cancel"].includes(action)) throw new Error(`/${workflow} supports status and cancel, but not ${action}.`);
		if (workflow !== "sprint" && run) throw new Error(`/${workflow} ${action} does not accept a run id.`);
		if (extra) throw new Error(`/${workflow} ${action} accepts at most one run id.`);
		return { workflow, action, agents: DEFAULT_BRAINSTORM_AGENTS };
	}

	let name: string | undefined;
	let agents = DEFAULT_BRAINSTORM_AGENTS;
	let interactive: boolean | undefined;
	let offset = 0;
	let input: string | undefined;
	for (;;) {
		let promptStart = offset;
		while (promptStart < raw.length && /\s/.test(raw[promptStart])) promptStart++;
		if (promptStart < raw.length && raw[promptStart] !== "-") {
			input = raw.slice(promptStart);
			break;
		}
		const selected = nextToken(raw, offset);
		if (!selected) break;
		offset = selected.end;
		if (selected.value === "--") {
			while (offset < raw.length && /\s/.test(raw[offset])) offset++;
			input = offset < raw.length ? raw.slice(offset) : undefined;
			break;
		}
		if (selected.value === "--name" || selected.value === "--agents") {
			const value = nextToken(raw, offset);
			if (!value) throw new Error(`${selected.value} requires ${selected.value === "--name" ? "a slug" : `an integer from ${MIN_BRAINSTORM_AGENTS} to ${MAX_BRAINSTORM_AGENTS}`}.`);
			offset = value.end;
			if (selected.value === "--name") name = safeSlug(value.value);
			else agents = integer(value.value, "--agents", MIN_BRAINSTORM_AGENTS, MAX_BRAINSTORM_AGENTS);
			continue;
		}
		if (selected.value === "--interactive") interactive = true;
		else if (selected.value === "--auto") interactive = false;
		else if (selected.value.startsWith("--")) throw new Error(`Unknown option: ${selected.value}`);
		else {
			input = raw.slice(selected.start);
			break;
		}
	}
	if (workflow !== "sprint" && name) throw new Error("--name is only supported by /sprint.");
	if (workflow !== "brainstorm" && workflow !== "sprint" && agents !== DEFAULT_BRAINSTORM_AGENTS) throw new Error(`--agents is not supported by /${workflow}.`);
	if (workflow !== "ironout" && interactive !== undefined) throw new Error("--interactive and --auto are only supported by /ironout.");
	return { workflow, action: "start", input: input || undefined, name, agents, interactive };
}

export function commandUsage(workflow: WorkflowName): string {
	switch (workflow) {
		case "sprint":
			return "/sprint [--name <slug>] [--agents 2..8] <prompt> | status|pause|resume|reset|list|doctor [run-id]";
		case "brainstorm":
			return "/brainstorm [--agents 2..8] <prompt> | status|cancel";
		case "ironout":
			return "/ironout [--interactive|--auto] <prompt> | status|cancel";
		case "advanceplan":
			return "/advanceplan <prompt> | status|cancel";
	}
}
