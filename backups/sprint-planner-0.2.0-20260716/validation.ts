import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSafeRelativePath } from "./artifacts.ts";
import type { BrainstormRole, SubmissionExpectation, WorkerSubmission } from "./types.ts";

export const BRAINSTORM_HEADINGS = ["Prompt", "Source", "Findings", "Options", "Trade-offs", "Open Questions", "Recommended Next Step"];
export const HANDOFF_HEADINGS = ["Context", "Objective", "Targets", "Features", "Settled Decisions", "Constraints", "Scope", "Assumptions", "Recommended Direction", "Validation", "Open Questions", "Sign-off"];
export const CONCEPT_HEADINGS = ["Architecture", "Conceptual Approach", "Features", "Constraints", "Assumptions", "Cross-phase Guidance", "Final Validation Criteria"];
export const PHASE_HEADINGS = ["Context", "Goal", "In Scope", "Out of Scope", "Dependencies", "Constraints", "Implementation Steps", "Required Guides", "Technical Guidance", "Validation", "Exit Criteria"];
export const REVIEW_HEADINGS = ["Scope", "Findings", "Risk Assessment", "Recommendations", "Follow-ups"];

export function requiredHeadings(content: string, headings: readonly string[], label = "artifact"): void {
	for (const heading of headings) {
		const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (!new RegExp(`^##\\s+${escaped}\\s*$`, "mi").test(content)) throw new Error(`Missing required heading in ${label}: ${heading}`);
	}
}

function markdownSection(content: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return content.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mi"))?.[1]?.trim() ?? "";
}

export function validateBrainstormFindings(reports: readonly { path: string; content: string }[], expectedPaths: readonly string[]): void {
	const byPath = new Map(reports.map((report) => [report.path, report.content]));
	for (const path of expectedPaths) {
		const content = byPath.get(path);
		if (content === undefined) throw new Error(`Brainstorm contract violation: missing ${path}.`);
		requiredHeadings(content, BRAINSTORM_HEADINGS, path);
	}
}

export function validateSynthesisCoverage(content: string, findingPaths: readonly string[]): void {
	requiredHeadings(content, BRAINSTORM_HEADINGS, "synthesis.md");
	const source = markdownSection(content, "Source");
	for (const path of findingPaths) {
		if (!source.includes(path)) throw new Error(`Synthesis contract violation: Source is missing findings report ${path}.`);
	}
}

export function validateHandoff(content: string): void {
	requiredHeadings(content, HANDOFF_HEADINGS, "handoff.md");
}

export function parseJson<T>(content: string | undefined, label: string): T {
	if (!content?.trim()) throw new Error(`${label} submission is empty.`);
	try {
		return JSON.parse(content) as T;
	} catch (error) {
		throw new Error(`${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function validateSubmission(submission: WorkerSubmission | undefined, expectation: SubmissionExpectation): WorkerSubmission {
	if (!submission) throw new Error("Worker completed without a typed artifact submission.");
	if (submission.kind !== expectation.kind) throw new Error(`Expected ${expectation.kind} submission, received ${submission.kind}.`);
	if (expectation.kind !== "files") {
		if (!submission.content?.trim()) throw new Error(`${expectation.kind} submission content is empty.`);
		if (expectation.headings?.artifact) requiredHeadings(submission.content, expectation.headings.artifact, "submitted artifact");
		return submission;
	}
	const files = submission.files;
	if (!Array.isArray(files)) throw new Error("Files submission is missing files.");
	if (expectation.minFiles !== undefined && files.length < expectation.minFiles) throw new Error(`Expected at least ${expectation.minFiles} files.`);
	if (expectation.maxFiles !== undefined && files.length > expectation.maxFiles) throw new Error(`Expected at most ${expectation.maxFiles} files.`);
	const seen = new Set<string>();
	for (const file of files) {
		const path = assertSafeRelativePath(file.path);
		if (seen.has(path)) throw new Error(`Duplicate submitted path: ${path}`);
		seen.add(path);
		if (!file.content?.trim()) throw new Error(`Submitted file is empty: ${path}`);
		if (expectation.allowedPaths && !expectation.allowedPaths.includes(path)) throw new Error(`Submitted path is not allowed: ${path}`);
		const headings = expectation.headings?.[path];
		if (headings) requiredHeadings(file.content, headings, path);
	}
	for (const required of expectation.requiredPaths ?? []) {
		if (!seen.has(required)) throw new Error(`Required submitted file is absent: ${required}`);
	}
	return submission;
}

export function validateRoles(content: string | undefined, expectedCount: number): BrainstormRole[] {
	const parsed = parseJson<{ roles?: BrainstormRole[] }>(content, "Role routing");
	if (!Array.isArray(parsed.roles) || parsed.roles.length !== expectedCount) throw new Error(`Role routing must contain exactly ${expectedCount} roles.`);
	const ids = new Set<string>();
	for (const role of parsed.roles) {
		if (!role || typeof role.id !== "string" || typeof role.name !== "string" || typeof role.lens !== "string") throw new Error("Every brainstorm role requires id, name, and lens strings.");
		if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(role.id)) throw new Error(`Unsafe role id: ${role.id}`);
		if (!role.name.trim() || !role.lens.trim() || ids.has(role.id)) throw new Error(`Invalid or duplicate role: ${role.id}`);
		ids.add(role.id);
	}
	return parsed.roles;
}

export function validatePlanFiles(files: readonly { path: string; content: string }[]): void {
	const names = files.map((file) => assertSafeRelativePath(file.path));
	if (names.some((name) => name.includes("/"))) throw new Error("Advanced-plan files must be flat.");
	if (names.filter((name) => name === "concepts.md").length !== 1) throw new Error("Advanced plan requires exactly one concepts.md.");
	const phases = names.filter((name) => /^phase-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(name));
	if (phases.length < 1 || phases.length !== names.length - 1) throw new Error("Advanced plan may contain only concepts.md and phase-NN-*.md files.");
	const expectedNumbers = phases.sort().map((name) => Number(name.slice(6, 8)));
	for (let index = 0; index < expectedNumbers.length; index++) {
		if (expectedNumbers[index] !== index + 1) throw new Error("Advanced plan phase numbers must be contiguous from 01.");
	}
	for (const file of files) requiredHeadings(file.content, file.path === "concepts.md" ? CONCEPT_HEADINGS : PHASE_HEADINGS, file.path);
}

export async function validatePlanDirectory(directory: string): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) throw new Error(`Plan directory structural violation: ${entry.name} is not a regular flat file.`);
		if (entry.name !== "concepts.md" && !/^phase-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(entry.name)) {
			throw new Error(`Plan directory structural violation: unexpected entry ${entry.name}.`);
		}
	}
	const files = await Promise.all(entries.map(async (entry) => ({ path: entry.name, content: await readFile(resolve(directory, entry.name), "utf8") })));
	validatePlanFiles(files);
}
