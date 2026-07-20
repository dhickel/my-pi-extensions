import {
	DEFAULT_BRAINSTORM_AGENTS,
	MAX_BRAINSTORM_AGENTS,
	MIN_BRAINSTORM_AGENTS,
	type WorkflowName,
} from "./types.ts";

export interface ParsedCommand {
	workflow: WorkflowName;
	action: "start" | "status" | "cancel" | "pause" | "resume" | "reset";
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

function tokenize(input: string): CommandToken[] {
	const tokens: CommandToken[] = [];
	let value = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	let start: number | undefined;
	for (let index = 0; index < input.length; index++) {
		const character = input[index];
		if (escaping) {
			value += character;
			escaping = false;
			continue;
		}
		if (character === "\\") {
			start ??= index;
			escaping = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else value += character;
			continue;
		}
		if (character === "'" || character === '"') {
			start ??= index;
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (start !== undefined) {
				tokens.push({ value, start, end: index });
				value = "";
				start = undefined;
			}
			continue;
		}
		start ??= index;
		value += character;
	}
	if (escaping || quote) throw new Error("Unterminated quote or escape in command arguments.");
	if (start !== undefined) tokens.push({ value, start, end: input.length });
	return tokens;
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

/** OpenAI-compatible providers cap prompt cache/session affinity keys at 64 characters. */
export function safeSessionId(value: string): string {
	return safeSlug(value, "sprint-worker").slice(0, 64);
}

/** Accept workflow input as a prompt. Agents, not the command layer, interpret any path references it contains. */
export function acceptWorkflowInput(input: string): string {
	if (!input.trim()) throw new Error("A workflow prompt is required.");
	return input;
}

export function parseCommand(workflow: WorkflowName, raw: string): ParsedCommand {
	const tokens = tokenize(raw);
	const management = tokens[0]?.value;
	if (["status", "cancel", "pause", "resume", "reset"].includes(management)) {
		const action = management as ParsedCommand["action"];
		if (workflow === "sprint" && action === "cancel") throw new Error("/sprint uses pause for resumable interruption; cancel is not supported.");
		if (workflow !== "sprint" && !["status", "cancel"].includes(action)) {
			throw new Error(`/${workflow} supports status and cancel, but not ${action}.`);
		}
		if (workflow !== "sprint" && tokens.length > 1) throw new Error(`/${workflow} ${action} does not accept a run id.`);
		if (tokens.length > 2) throw new Error(`/${workflow} ${action} accepts at most one run id.`);
		return { workflow, action, runId: tokens[1]?.value, agents: DEFAULT_BRAINSTORM_AGENTS };
	}

	let name: string | undefined;
	let agents = DEFAULT_BRAINSTORM_AGENTS;
	let interactive: boolean | undefined;
	let inputStart: number | undefined;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index].value;
		if (token === "--name") {
			const value = tokens[++index]?.value;
			if (!value) throw new Error("--name requires a slug.");
			name = safeSlug(value);
		} else if (token === "--agents") {
			agents = integer(tokens[++index]?.value, "--agents", MIN_BRAINSTORM_AGENTS, MAX_BRAINSTORM_AGENTS);
		} else if (token === "--interactive") {
			interactive = true;
		} else if (token === "--auto") {
			interactive = false;
		} else if (token.startsWith("--")) {
			throw new Error(`Unknown option: ${token}`);
		} else {
			inputStart = tokens[index].start;
			break;
		}
	}
	if (workflow !== "sprint" && name) throw new Error("--name is only supported by /sprint.");
	if (workflow !== "brainstorm" && workflow !== "sprint" && agents !== DEFAULT_BRAINSTORM_AGENTS) {
		throw new Error(`--agents is not supported by /${workflow}.`);
	}
	if (workflow !== "ironout" && interactive !== undefined) {
		throw new Error("--interactive and --auto are only supported by /ironout.");
	}
	const input = inputStart === undefined ? undefined : raw.slice(inputStart).trim();
	return { workflow, action: "start", input: input || undefined, name, agents, interactive };
}

export function commandUsage(workflow: WorkflowName): string {
	switch (workflow) {
		case "sprint":
			return "/sprint [--name <slug>] [--agents 2..8] <prompt> | status|pause|resume|reset [run-id]";
		case "brainstorm":
			return "/brainstorm [--agents 2..8] <prompt> | status|cancel";
		case "ironout":
			return "/ironout [--interactive|--auto] <prompt> | status|cancel";
		case "advanceplan":
			return "/advanceplan <prompt> | status|cancel";
	}
}
