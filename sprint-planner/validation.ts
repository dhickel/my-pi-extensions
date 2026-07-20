import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertSafeRelativePath } from "./artifacts.ts";
import {
	ORCHESTRATION_HEADINGS,
	PHASE_BUDGETS,
	PLAN_VALIDATION_RESULT_VERSION,
	type BrainstormRole,
	type PlanValidationCategory,
	type PlanValidationFinding,
	type PlanValidationMetadata,
	type PlanValidationResult,
	type ScopeSize,
	type SubmissionExpectation,
	type WorkerSubmission,
} from "./types.ts";

export const BRAINSTORM_HEADINGS = ["Prompt", "Source", "Findings", "Options", "Trade-offs", "Open Questions", "Recommended Next Step"];
export const HANDOFF_HEADINGS = ["Context", "Objective", "Targets", "Features", "Settled Decisions", "Constraints", "Scope", "Assumptions", "Recommended Direction", "Validation", "Open Questions", "Sign-off"];
export const CONCEPT_HEADINGS = ["Architecture", "Conceptual Approach", "Features", "Constraints", "Assumptions", "Cross-phase Guidance", "Final Validation Criteria"];
export const PHASE_HEADINGS = ["Context", "Goal", "In Scope", "Out of Scope", "Dependencies", "Constraints", "Implementation Steps", "Required Guides", "Technical Guidance", "Validation", "Exit Criteria"];
export const REVIEW_HEADINGS = ["Scope", "Findings", "Risk Assessment", "Recommendations", "Follow-ups"];

const PHASE_PATH_PATTERN = /^phase-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

interface MarkdownLine {
	text: string;
	code: boolean;
}

function markdownLines(content: string): MarkdownLine[] {
	let fence: { marker: "`" | "~"; length: number } | undefined;
	return content.split(/\r?\n/).map((text) => {
		if (fence) {
			const closing = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}[ \\t]*$`).test(text);
			if (closing) fence = undefined;
			return { text, code: true };
		}
		const opening = text.match(/^ {0,3}(`{3,}|~{3,})(?:[^`~].*)?$/);
		if (opening) {
			const run = opening[1];
			fence = { marker: run[0] as "`" | "~", length: run.length };
			return { text, code: true };
		}
		return { text, code: /^( {4,}|\t)/.test(text) };
	});
}

function headingPattern(heading: string): RegExp {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^##\\s+${escaped}\\s*$`);
}

export function requiredHeadings(content: string, headings: readonly string[], label = "artifact"): void {
	const lines = markdownLines(content);
	for (const heading of headings) {
		const pattern = headingPattern(heading);
		if (!lines.some((line) => !line.code && pattern.test(line.text))) throw new Error(`Missing required heading in ${label}: ${heading}`);
	}
}

// ── Markdown section helpers ──────────────────────────────────────────────

function markdownSection(content: string, heading: string): string {
	const lines = markdownLines(content);
	const pattern = headingPattern(heading);
	const start = lines.findIndex((line) => !line.code && pattern.test(line.text));
	if (start < 0) return "";
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index++) {
		if (!lines[index].code && /^##(?:\s|$)/.test(lines[index].text)) {
			end = index;
			break;
		}
	}
	return lines.slice(start + 1, end).map((line) => line.text).join("\n").trim();
}

function exactSectionLines(content: string, heading: string): MarkdownLine[] {
	const lines = markdownLines(content);
	const literal = `## ${heading}`;
	const starts = lines.flatMap((line, index) => (!line.code && line.text === literal ? [index] : []));
	if (starts.length !== 1) throw new Error(`Orchestration must contain exactly one literal ${literal} heading.`);
	const start = starts[0];
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index++) {
		if (!lines[index].code && /^##(?:\s|$)/.test(lines[index].text)) {
			end = index;
			break;
		}
	}
	return lines.slice(start + 1, end);
}

function meaningfulSectionLines(content: string, heading: string): string[] {
	return exactSectionLines(content, heading).filter((line) => !line.code && line.text.trim()).map((line) => line.text);
}

function structuredSectionLines(content: string, heading: string): string[] {
	return exactSectionLines(content, heading).filter((line) => line.text.trim()).map((line) => line.text);
}

// ── Structured inspection helpers ─────────────────────────────────────────

function finding(code: string, category: PlanValidationCategory, message: string, path?: string): PlanValidationFinding {
	return { code, category, message, ...(path !== undefined ? { path } : {}) };
}

function findingsSortKey(f: PlanValidationFinding): string {
	return `${f.path ?? ""}\x00${f.code}`;
}

function result(): PlanValidationResult {
	return {
		version: PLAN_VALIDATION_RESULT_VERSION,
		valid: true,
		metadata: { phaseCount: 0, phasePaths: [], waveCount: 0 },
		findings: [],
	};
}

function push(result: PlanValidationResult, f: PlanValidationFinding): void {
	(result as { findings: PlanValidationFinding[] }).findings.push(f);
	if (result.valid) (result as { valid: boolean }).valid = false;
}

function finalize(result: PlanValidationResult): PlanValidationResult {
	(result as { findings: readonly PlanValidationFinding[] }).findings = [...result.findings].sort((a, b) => {
		const ak = findingsSortKey(a);
		const bk = findingsSortKey(b);
		return ak < bk ? -1 : ak > bk ? 1 : 0;
	});
	return result;
}

// ── Existing throwing validators (unchanged signatures) ──────────────────

export function validateBrainstormFindings(reports: readonly { path: string; content: string }[], expectedPaths: readonly string[]): void {
	const byPath = new Map(reports.map((report) => [report.path, report.content]));
	for (const path of expectedPaths) {
		const content = byPath.get(path);
		if (content === undefined) throw new Error(`Brainstorm contract violation: missing ${path}.`);
		requiredHeadings(content, BRAINSTORM_HEADINGS, path);
	}
}

export function validateSynthesisCoverage(content: string, expectedPaths: readonly string[]): void {
	requiredHeadings(content, BRAINSTORM_HEADINGS, "synthesis.md");
	if (new Set(expectedPaths).size !== expectedPaths.length) throw new Error("Synthesis contract received duplicate expected report paths.");
	const entries = exactSectionLines(content, "Source")
		.filter((line) => !line.code && line.text.trim())
		.map((line) => line.text);
	const reported = new Set<string>();
	for (const line of entries) {
		const match = line.match(/^- ([^\s].*)$/);
		if (!match) throw new Error(`Synthesis Source contains a non-literal report-path list item: ${line}`);
		const path = match[1];
		if (line !== `- ${path}`) throw new Error(`Synthesis Source path must be listed verbatim: ${line}`);
		if (reported.has(path)) throw new Error(`Synthesis Source lists the same path more than once: ${path}`);
		reported.add(path);
	}
	const expected = new Set(expectedPaths);
	for (const path of expectedPaths) if (!reported.has(path)) throw new Error(`Synthesis contract violation: Source is missing report path ${path}.`);
	for (const path of reported) if (!expected.has(path)) throw new Error(`Synthesis contract violation: Source contains unknown report path ${path}.`);
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
		return { ...submission };
	}
	if (!Array.isArray(submission.files)) throw new Error("Files submission is missing files.");
	const files = submission.files.map((file) => ({ ...file, path: assertSafeRelativePath(file.path) }));
	if (expectation.minFiles !== undefined && files.length < expectation.minFiles) throw new Error(`Expected at least ${expectation.minFiles} files.`);
	if (expectation.maxFiles !== undefined && files.length > expectation.maxFiles) throw new Error(`Expected at most ${expectation.maxFiles} files.`);
	const allowedPaths = expectation.allowedPaths?.map((path) => assertSafeRelativePath(path));
	const requiredPaths = expectation.requiredPaths?.map((path) => assertSafeRelativePath(path));
	const headings = expectation.headings
		? Object.fromEntries(Object.entries(expectation.headings).map(([path, value]) => [assertSafeRelativePath(path), value]))
		: undefined;
	const seen = new Set<string>();
	for (const file of files) {
		if (seen.has(file.path)) throw new Error(`Duplicate submitted path: ${file.path}`);
		seen.add(file.path);
		if (!file.content?.trim()) throw new Error(`Submitted file is empty: ${file.path}`);
		if (allowedPaths && !allowedPaths.includes(file.path)) throw new Error(`Submitted path is not allowed: ${file.path}`);
		if (headings?.[file.path]) requiredHeadings(file.content, headings[file.path], file.path);
	}
	for (const required of requiredPaths ?? []) {
		if (!seen.has(required)) throw new Error(`Required submitted file is absent: ${required}`);
	}
	return { ...submission, files };
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

export function parseScopeSize(content: string): ScopeSize {
	const markers = meaningfulSectionLines(content, "Scope Size").filter((line) => /^\*\*Size\*\*: (?:small|medium|large)$/.test(line));
	if (markers.length === 0) throw new Error("Orchestration Scope Size section must declare one literal `**Size**: small`, `**Size**: medium`, or `**Size**: large` marker on its own line outside Markdown code.");
	if (markers.length > 1) throw new Error("Orchestration Scope Size section must contain exactly one size marker; found duplicates.");
	return markers[0].slice("**Size**: ".length) as ScopeSize;
}

export function validateConcept(content: string): void {
	requiredHeadings(content, CONCEPT_HEADINGS, "concepts.md");
}

export function validatePhase(path: string, content: string, orchestration?: string): void {
	const selected = assertSafeRelativePath(path);
	if (!PHASE_PATH_PATTERN.test(selected)) throw new Error(`Invalid advanced-plan phase path: ${selected}`);
	requiredHeadings(content, PHASE_HEADINGS, selected);
	if (!orchestration) return;
	const phasePaths = inspectionSectionLines(orchestration, "Phase Ledger")
		.map((line) => line.match(/^- (phase-\d{2}-[a-z0-9][a-z0-9-]*\.md) \|/)?.[1])
		.filter((value): value is string => Boolean(value));
	const inspected = result();
	const ledger = parseLedger(orchestration, phasePaths, inspected);
	const waves = ledger ? parseWaves(orchestration, ledger, phasePaths, inspected) : undefined;
	if (ledger) checkPhaseMetadataCrossConsistency([{ path: selected, content }], ledger, waves, inspected);
	const finalized = finalize(inspected);
	if (!finalized.valid) throw new Error(`Phase metadata validation failed:\n${finalized.findings.map((item) => `- [${item.category}] ${item.message}`).join("\n")}`);
}

/** Throwing wrapper: validate orchestration content + phase paths. Used inside retry boundaries. */
export function validateOrchestration(content: string, phasePaths: readonly string[]): ScopeSize {
	// Build a minimal plan for the inspector with proper cross-consistency metadata.
	// Parse the ledger from the orchestration to build matching stub phases.
	const ledger = new Map<string, { deps: string; goal: string; targets: string }>();
	const ledgerPattern = /^- (phase-\d{2}-[a-z0-9][a-z0-9-]*\.md) \| depends: (none|phase-\d{2}-[a-z0-9][a-z0-9-]*\.md(?:, phase-\d{2}-[a-z0-9][a-z0-9-]*\.md)*) \| targets: ([^|]+) \| goal: (\S.*)$/;
	for (const line of structuredSectionLines(content, "Phase Ledger")) {
		const match = line.match(ledgerPattern);
		if (match) ledger.set(match[1], { deps: match[2], targets: match[3].split(", ").map((t) => t.trim()).join(", "), goal: match[4] });
	}
	const stubConcept = CONCEPT_HEADINGS.map((h) => `## ${h}\n\nstub.\n`).join("\n");
	const files = [
		{ path: "concepts.md", content: `# Concepts\n\n${stubConcept}` },
		{ path: "orchestration.md", content },
		...phasePaths.map((p) => {
			const entry = ledger.get(p);
			const deps = entry?.deps ?? "none";
			const goal = entry?.goal ?? "stub";
			const targets = entry?.targets ?? "stub";
			const phaseContent = PHASE_HEADINGS.map((h) => {
				if (h === "Goal") return `## Goal\n\n${goal}\n`;
				if (h === "Dependencies") return `## Dependencies\n\n${deps}\n`;
				if (h === "In Scope") return `## In Scope\n\n**Write Targets**: ${targets}\n`;
				return `## ${h}\n\nstub.\n`;
			}).join("\n");
			return { path: p, content: `# Phase\n\n${phaseContent}` };
		}),
	];
	const res = inspectPlan(files);
	if (!res.valid) {
		const summary = res.findings.map((f) => `- [${f.category}] ${f.message}${f.path ? ` (${f.path})` : ""}`).join("\n");
		throw new Error(`Orchestration validation failed:\n${summary}`);
	}
	return res.metadata.scopeSize!;
}

// ── Structured plan inspector ────────────────────────────────────────────

function exactLines(content: string, heading: string, expected: readonly string[]): boolean {
	try {
		const actual = structuredSectionLines(content, heading);
		return actual.length === expected.length && actual.every((line, index) => line === expected[index]);
	} catch {
		return false;
	}
}

function inspectionSectionLines(content: string, heading: string): string[] {
	try {
		return structuredSectionLines(content, heading);
	} catch {
		return [];
	}
}

function safePath(value: string, r: PlanValidationResult, code: string, category: PlanValidationCategory, message: string, path?: string): string | undefined {
	try {
		return assertSafeRelativePath(value);
	} catch (error) {
		push(r, finding(code, category, `${message}: ${error instanceof Error ? error.message : String(error)}`, path));
		return undefined;
	}
}

function targetsOverlap(left: string, right: string): boolean {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

interface LedgerEntry {
	dependencies: string[];
	targets: string[];
	goal: string;
}

function parseLedger(content: string, phases: readonly string[], r: PlanValidationResult): Map<string, LedgerEntry> | undefined {
	const ledger = new Map<string, LedgerEntry>();
	const ledgerLines = inspectionSectionLines(content, "Phase Ledger");
	const ledgerPattern = /^- (phase-\d{2}-[a-z0-9][a-z0-9-]*\.md) \| depends: (none|phase-\d{2}-[a-z0-9][a-z0-9-]*\.md(?:, phase-\d{2}-[a-z0-9][a-z0-9-]*\.md)*) \| targets: ([^|]+) \| goal: (\S.*)$/;
	for (const [index, line] of ledgerLines.entries()) {
		const match = line.match(ledgerPattern);
		if (!match) {
			push(r, finding("ledger-entry-malformed", "shape", `Orchestration Phase Ledger entry is malformed: ${line}`));
			continue;
		}
		if (ledger.has(match[1])) {
			push(r, finding(`ledger-duplicate`, "shape", `Orchestration Phase Ledger duplicates ${match[1]}.`));
			continue;
		}
		const dependencies = match[2] === "none" ? [] : match[2].split(", ");
		const targets: string[] = [];
		for (const target of match[3].split(", ")) {
			if (target.includes(",")) {
				push(r, finding("ledger-target-delimiter", "target", `Orchestration write targets must use an exact comma-space delimiter: ${match[3]}`, "orchestration.md"));
				continue;
			}
			const canonical = safePath(target, r, "ledger-target-unsafe", "target", `Orchestration write target is unsafe: ${target}`, "orchestration.md");
			if (!canonical) continue;
			if (target !== canonical || target.includes("`")) push(r, finding("ledger-target-canonical", "target", `Orchestration write target must be a canonical project-relative path without Markdown quoting: ${target}`, "orchestration.md"));
			targets.push(canonical);
		}
		if (new Set(dependencies).size !== dependencies.length) push(r, finding(`ledger-dep-duplicate`, "dependency", `Orchestration Phase Ledger duplicates a dependency for ${match[1]}.`));
		if (new Set(targets).size !== targets.length) push(r, finding(`ledger-target-duplicate`, "target", `Orchestration Phase Ledger duplicates a write target for ${match[1]}.`));
		ledger.set(match[1], { dependencies, targets, goal: match[4] });
	}
	if (ledgerLines.length !== phases.length || [...ledger.keys()].some((phase, index) => phase !== phases[index])) {
		push(r, finding("ledger-phase-coverage", "shape", `Orchestration Phase Ledger must cover every phase exactly once in phase order: ${phases.join(", ")}.`));
	}
	for (const [phase, entry] of ledger) {
		for (const dependency of entry.dependencies) {
			if (!ledger.has(dependency)) push(r, finding("ledger-dependency-unknown", "dependency", `Orchestration dependency ${dependency} for ${phase} is not a plan phase.`));
			if (dependency === phase) push(r, finding("ledger-self-dependency", "dependency", `Orchestration phase ${phase} cannot depend on itself.`));
		}
	}
	return ledger.size > 0 ? ledger : undefined;
}

function parseWaves(content: string, ledger: Map<string, LedgerEntry>, phases: readonly string[], r: PlanValidationResult): Map<string, number> | undefined {
	const waveLines = inspectionSectionLines(content, "Execution Waves");
	const phaseWave = new Map<string, number>();
	for (let index = 0; index < waveLines.length; index++) {
		const match = waveLines[index].match(/^- wave-(\d{2}): (phase-\d{2}-[a-z0-9][a-z0-9-]*\.md(?:, phase-\d{2}-[a-z0-9][a-z0-9-]*\.md)*)$/);
		if (!match || Number(match[1]) !== index + 1) {
			push(r, finding("wave-entry-format", "wave", "Orchestration Execution Waves must be contiguous exact `- wave-NN: phase-NN-slug.md` entries."));
			continue;
		}
		const members = match[2].split(", ");
		for (const phase of members) {
			if (!ledger.has(phase)) push(r, finding("wave-phase-unknown", "wave", `Orchestration wave references unknown phase ${phase}.`));
			if (phaseWave.has(phase)) push(r, finding("wave-phase-duplicate", "wave", `Orchestration waves schedule ${phase} more than once.`));
			phaseWave.set(phase, index + 1);
		}
		for (let left = 0; left < members.length; left++) {
			for (let right = left + 1; right < members.length; right++) {
				const leftTargets = ledger.get(members[left])?.targets ?? [];
				const rightTargets = ledger.get(members[right])?.targets ?? [];
				for (const leftTarget of leftTargets) {
					if (rightTargets.some((rightTarget) => targetsOverlap(leftTarget, rightTarget))) {
						push(r, finding("wave-target-overlap", "target", `Parallel phases ${members[left]} and ${members[right]} have overlapping write targets.`));
					}
				}
			}
		}
	}
	(r.metadata as PlanValidationMetadata).waveCount = waveLines.length;
	if (phaseWave.size !== phases.length) push(r, finding("wave-coverage", "wave", "Orchestration Execution Waves must schedule every phase exactly once."));
	for (const [phase, entry] of ledger) {
		for (const dependency of entry.dependencies) {
			const depWave = phaseWave.get(dependency);
			const phaseW = phaseWave.get(phase);
			if (depWave !== undefined && phaseW !== undefined && depWave >= phaseW) {
				push(r, finding("wave-dependency-order", "wave", `Orchestration dependency ${dependency} must run in an earlier wave than ${phase}.`));
			}
		}
	}
	return phaseWave.size > 0 ? phaseWave : undefined;
}

/**
 * Compare phase metadata with the orchestration ledger to enforce cross-consistency.
 * Compares Goal, Dependencies, and In Scope Write Targets from each phase file against the ledger.
 */
function checkPhaseMetadataCrossConsistency(
	phases: readonly { path: string; content: string }[],
	ledger: Map<string, LedgerEntry>,
	phaseWave: Map<string, number> | undefined,
	r: PlanValidationResult,
): void {
	for (const phase of phases) {
		const entry = ledger.get(phase.path);
		if (!entry) continue; // already reported as ledger coverage issue

		// Goal: first nonblank line under ## Goal must match ledger goal exactly
		const goalSection = markdownSection(phase.content, "Goal");
		const goalFirstLine = goalSection.split(/\r?\n/)[0]?.trim() ?? "";
		if (goalFirstLine !== entry.goal) {
			push(r, finding("cross-goal-drift", "phase-metadata", `Phase ${phase.path} Goal "${goalFirstLine}" does not match ledger goal "${entry.goal}".`, phase.path));
		}

		// Dependencies: exactly one non-code, nonblank line in ledger order.
		const dependencyLines = markdownLines(markdownSection(phase.content, "Dependencies"))
			.filter((line) => !line.code && line.text.trim())
			.map((line) => line.text.trim());
		const expectedDeps = entry.dependencies.length === 0 ? "none" : entry.dependencies.join(", ");
		if (dependencyLines.length !== 1 || dependencyLines[0] !== expectedDeps) {
			push(r, finding("phase-dependencies-drift", "dependency", `Phase ${phase.path} Dependencies must contain exactly "${expectedDeps}" on one line.`, phase.path));
		}

		// In Scope must contain exactly one literal Write Targets marker.
		const scopeLines = markdownLines(markdownSection(phase.content, "In Scope"));
		const targetMarkers = scopeLines.filter((line) => !line.code && /^\*\*Write Targets\*\*:/.test(line.text));
		if (targetMarkers.length !== 1) {
			push(r, finding("phase-write-target-marker-count", "phase-metadata", `Phase ${phase.path} In Scope must contain exactly one **Write Targets**: line.`, phase.path));
		} else {
			const match = targetMarkers[0].text.match(/^\*\*Write Targets\*\*: ([^\s].*)$/);
			const declared: string[] = [];
			if (!match) push(r, finding("phase-write-target-marker-format", "phase-metadata", `Phase ${phase.path} Write Targets marker is malformed.`, phase.path));
			else for (const target of match[1].split(", ")) {
				const canonical = safePath(target, r, "phase-write-target-unsafe", "target", `Phase ${phase.path} declares an unsafe write target`, phase.path);
				if (canonical) declared.push(canonical);
			}
			if (new Set(declared).size !== declared.length) push(r, finding("phase-write-target-duplicate", "target", `Phase ${phase.path} duplicates a write target.`, phase.path));
			if (declared.length !== entry.targets.length || declared.some((target, index) => target !== entry.targets[index])) push(r, finding("phase-write-target-drift", "target", `Phase ${phase.path} Write Targets do not match ledger targets in canonical order.`, phase.path));
		}

		if (phaseWave && !phaseWave.has(phase.path)) push(r, finding("phase-wave-drift", "wave", `Phase ${phase.path} is in the ledger but not scheduled in any wave.`, phase.path));
	}
}

export function inspectPlan(files: readonly { path: string; content: string }[]): PlanValidationResult {
	const r = result();
	const canonical: { path: string; content: string }[] = [];
	for (const file of files) {
		const path = safePath(file.path, r, "shape-unsafe-path", "shape", `Advanced-plan file path is unsafe: ${file.path}`);
		if (path) canonical.push({ path, content: file.content });
	}
	const names = canonical.map((file) => file.path);

	// ── Shape checks ────────────────────────────────────────────────────
	if (new Set(names).size !== names.length) {
		push(r, finding("shape-duplicate-paths", "shape", "Advanced-plan file paths must be unique after canonicalization."));
	}
	if (names.some((name) => name.includes("/"))) {
		push(r, finding("shape-nested", "shape", "Advanced-plan files must be flat."));
	}
	const conceptsCount = names.filter((name) => name === "concepts.md").length;
	if (conceptsCount !== 1) push(r, finding("shape-concepts-count", "shape", `Advanced plan requires exactly one concepts.md; found ${conceptsCount}.`));
	const orchCount = names.filter((name) => name === "orchestration.md").length;
	if (orchCount !== 1) push(r, finding("shape-orchestration-count", "shape", `Advanced plan requires exactly one orchestration.md; found ${orchCount}.`));
	const phases = names.filter((name) => PHASE_PATH_PATTERN.test(name)).sort();
	const unexpected = names.filter((name) => name !== "concepts.md" && name !== "orchestration.md" && !PHASE_PATH_PATTERN.test(name));
	if (unexpected.length > 0) push(r, finding("shape-unexpected", "shape", `Advanced plan may contain only concepts.md, orchestration.md, and phase-NN-*.md files; unexpected: ${unexpected.join(", ")}.`));
	const phaseCount = phases.length;
	(r.metadata as PlanValidationMetadata).phaseCount = phaseCount;
	(r.metadata as PlanValidationMetadata).phasePaths = phases;
	if (phaseCount < 2 || phaseCount > 10) push(r, finding("shape-phase-count-global", "shape", `Advanced plan requires 2–10 contiguous phase files; found ${phaseCount}.`));
	for (let index = 0; index < phases.length; index++) {
		if (Number(phases[index].slice(6, 8)) !== index + 1) {
			push(r, finding("shape-phase-contiguous", "shape", "Advanced plan phase numbers must be contiguous from 01."));
			break;
		}
	}

	// ── Heading checks ──────────────────────────────────────────────────
	if (conceptsCount === 1) {
		const concepts = canonical.find((file) => file.path === "concepts.md")!;
		for (const heading of CONCEPT_HEADINGS) {
			const count = headingCount(concepts.content, heading);
			if (count !== 1) push(r, finding(`heading-concepts:${heading}`, "shape", count === 0 ? `Missing required heading in concepts.md: ${heading}` : `Duplicate required heading in concepts.md: ${heading}`, "concepts.md"));
		}
	}
	for (const phase of phases) {
		const file = canonical.find((f) => f.path === phase);
		if (file) {
			for (const heading of PHASE_HEADINGS) {
				const count = headingCount(file.content, heading);
				if (count !== 1) push(r, finding(`heading-phase:${heading}`, "shape", count === 0 ? `Missing required heading in ${phase}: ${heading}` : `Duplicate required heading in ${phase}: ${heading}`, phase));
			}
		}
	}

	// ── Orchestration semantics ─────────────────────────────────────────
	if (orchCount === 1) {
		const orch = canonical.find((file) => file.path === "orchestration.md")!;

		// Section structure
		const lines = markdownLines(orch.content);
		for (const heading of ORCHESTRATION_HEADINGS) {
			const literal = `## ${heading}`;
			if (lines.filter((l) => !l.code && l.text === literal).length !== 1) {
				push(r, finding(`orch-section:${heading}`, "shape", `Orchestration must contain exactly one literal ${literal} heading.`, "orchestration.md"));
			}
		}
		const h2s = lines.filter((line) => !line.code && /^##(?:\s|$)/.test(line.text)).map((line) => line.text);
		const expectedH2s = ORCHESTRATION_HEADINGS.map((h) => `## ${h}`);
		if (h2s.length !== expectedH2s.length || h2s.some((h, i) => h !== expectedH2s[i])) {
			push(r, finding("orch-sections-order", "shape", "Orchestration may contain only the six required level-two sections in their required order.", "orchestration.md"));
		}

		// Scope Size
		let scopeSize: ScopeSize | undefined;
		try {
			scopeSize = parseScopeSize(orch.content);
		} catch (err) {
			push(r, finding("orch-scope-size", "phase-budget", (err as Error).message, "orchestration.md"));
		}
		if (scopeSize && !exactLines(orch.content, "Scope Size", [`**Size**: ${scopeSize}`])) {
			push(r, finding("orch-scope-exact", "shape", "Orchestration Scope Size section must use the exact structured contract.", "orchestration.md"));
		}
		if (scopeSize) (r.metadata as PlanValidationMetadata).scopeSize = scopeSize;

		// Phase budget
		if (scopeSize) {
			const budget = PHASE_BUDGETS[scopeSize];
			if (phaseCount < budget.min || phaseCount > budget.max) {
				push(r, finding("budget-scope-mismatch", "phase-budget", `Scope ${scopeSize} requires ${budget.min}–${budget.max} phases, but found ${phaseCount}.`, "orchestration.md"));
			}
		}

		// Phase Ledger
		const ledger = parseLedger(orch.content, phases, r);

		// Execution Waves
		let phaseWave: Map<string, number> | undefined;
		if (ledger) phaseWave = parseWaves(orch.content, ledger, phases, r);

		// Model assignments, validation gate, integration
		if (!exactLines(orch.content, "Model Assignments", [
			"- Implementation: deepseek/deepseek-v4-pro:max",
			"- Validation: openai-codex/gpt-5.6-sol:medium",
			"- Implementers: exactly one implementation agent per phase",
		])) {
			push(r, finding("orch-model-assignments", "model-route", "Orchestration Model Assignments section must use the exact structured contract.", "orchestration.md"));
		}
		if (!exactLines(orch.content, "Validation Gate", [
			"- Gate: post-phase validator review-and-repair must PASS before a phase is complete.",
			"- Dependencies: no dependent phase starts before every dependency has PASS.",
		])) {
			push(r, finding("orch-validation-gate", "gate", "Orchestration Validation Gate section must use the exact structured contract.", "orchestration.md"));
		}
		if (!exactLines(orch.content, "Final Integration", [
			"- Integration: after all phases PASS, run final integration validation with openai-codex/gpt-5.6-sol:medium.",
		])) {
			push(r, finding("orch-integration", "integration", "Orchestration Final Integration section must use the exact structured contract.", "orchestration.md"));
		}

		// ── Cross-consistency: phase metadata vs ledger ──────────────────
		if (ledger && phaseWave) {
			checkPhaseMetadataCrossConsistency(
				phases.map((p) => canonical.find((f) => f.path === p)!).filter(Boolean) as { path: string; content: string }[],
				ledger,
				phaseWave,
				r,
			);
		}
	}

	return finalize(r);
}

/** Lightweight draft-submission shape check for the pre-freeze decomposition gate.
 *  Validates safe unique flat names, required top-level files, contiguous phase numbering,
 *  file count, and required headings without treating the uncorrected draft as accepted. */
export function validateDraftPlanShape(files: readonly { path: string; content: string }[]): void {
	const canonical = files.map((file) => ({ ...file, path: assertSafeRelativePath(file.path) }));
	const names = canonical.map((file) => file.path);
	if (new Set(names).size !== names.length) throw new Error("Draft plan files must have unique canonical names.");
	if (names.some((name) => name.includes("/"))) throw new Error("Draft plan files must be flat.");
	if (names.filter((n) => n === "concepts.md").length !== 1) throw new Error("Draft plan requires exactly one concepts.md.");
	if (names.filter((n) => n === "orchestration.md").length !== 1) throw new Error("Draft plan requires exactly one orchestration.md.");
	const phases = names.filter((n) => PHASE_PATH_PATTERN.test(n)).sort();
	const unexpected = names.filter((n) => n !== "concepts.md" && n !== "orchestration.md" && !PHASE_PATH_PATTERN.test(n));
	if (unexpected.length > 0) throw new Error(`Draft plan contains unexpected entries: ${unexpected.join(", ")}.`);
	if (phases.length < 2 || phases.length > 10) throw new Error(`Draft plan requires 2–10 phase files; found ${phases.length}.`);
	for (let i = 0; i < phases.length; i++) {
		if (Number(phases[i].slice(6, 8)) !== i + 1) throw new Error("Draft plan phase numbers must be contiguous from 01.");
	}
	const concepts = canonical.find((file) => file.path === "concepts.md")!;
	const orchestration = canonical.find((file) => file.path === "orchestration.md")!;
	requiredHeadings(concepts.content, CONCEPT_HEADINGS, "concepts.md");
	requiredHeadings(orchestration.content, ORCHESTRATION_HEADINGS, "orchestration.md");
	for (const phase of phases) requiredHeadings(canonical.find((file) => file.path === phase)!.content, PHASE_HEADINGS, phase);
}

function headingCount(content: string, heading: string): number {
	const pattern = headingPattern(heading);
	return markdownLines(content).filter((line) => !line.code && pattern.test(line.text)).length;
}

function headingPresent(content: string, heading: string): boolean {
	return headingCount(content, heading) > 0;
}

// ── Throwing wrappers (preserve existing signatures) ──────────────────────

export function validatePlanFiles(files: readonly { path: string; content: string }[]): void {
	const res = inspectPlan(files);
	if (!res.valid) {
		const summary = res.findings.map((f) => `- [${f.category}] ${f.message}${f.path ? ` (${f.path})` : ""}`).join("\n");
		throw new Error(`Plan validation failed:\n${summary}`);
	}
}

/** Read a plan without following links or mutating its entries. When trustedRoot is
 * supplied, every traversed component beneath that root is checked before any read. */
export async function inspectPlanDirectory(directory: string, trustedRoot?: string): Promise<PlanValidationResult> {
	const r = result();
	const resolved = resolve(directory);
	const trust = resolve(trustedRoot ?? resolved);
	const rel = relative(trust, resolved);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		push(r, finding("root-escape", "root", "Plan directory must remain beneath the trusted project root."));
		return finalize(r);
	}
	const displayRoot = rel || ".";
	const displayChild = (name: string) => displayRoot === "." ? name : `${displayRoot.split(sep).join("/")}/${name}`;
	const components = rel ? rel.split(sep) : [];
	const currentUid = process.getuid?.();
	let current = trust;
	let root;
	for (let index = -1; index < components.length; index++) {
		if (index >= 0) current = resolve(current, components[index]);
		try {
			root = await lstat(current);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") {
				push(r, finding("root-missing", "root", `Plan directory component does not exist: ${index < 0 ? "." : components.slice(0, index + 1).join("/")}`, displayRoot));
				return finalize(r);
			}
			if (code === "EACCES" || code === "EPERM") {
				push(r, finding("root-unreadable", "root", "Plan directory component is not readable.", displayRoot));
				return finalize(r);
			}
			throw error;
		}
		if (root.isSymbolicLink()) {
			push(r, finding("root-symlink", "symbolic-link", "Refusing to traverse symbolic link in the plan directory path.", displayRoot));
			return finalize(r);
		}
		if (currentUid !== undefined && root.uid !== currentUid) {
			push(r, finding("root-foreign-owner", "root", "Plan path contains a component owned by a different user.", displayRoot));
			return finalize(r);
		}
		if (index < components.length - 1 && !root.isDirectory()) {
			push(r, finding("root-component-not-directory", "root", "A plan path component is not a directory.", displayRoot));
			return finalize(r);
		}
	}
	if (!root?.isDirectory()) {
		push(r, finding("root-not-dir", "root", "Plan directory root is not a regular directory.", displayRoot));
		return finalize(r);
	}
	let names: string[];
	try {
		names = (await readdir(resolved)).sort();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM" || code === "ENOENT") {
			push(r, finding("root-unreadable", "root", "Plan directory cannot be read.", displayRoot));
			return finalize(r);
		}
		throw error;
	}

	const accepted: { name: string; entry: Awaited<ReturnType<typeof lstat>> }[] = [];
	for (const name of names) {
		const childPath = resolve(resolved, name);
		let child;
		try {
			child = await lstat(childPath);
		} catch (error) {
			if (["ENOENT", "EACCES", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) {
				push(r, finding("entry-unreadable", "root", `Plan entry cannot be inspected: ${name}`, displayChild(name)));
				continue;
			}
			throw error;
		}
		if (child.isSymbolicLink()) push(r, finding("entry-symlink", "symbolic-link", `Plan directory contains a symbolic link: ${name}`, displayChild(name)));
		else if (!child.isFile()) push(r, finding("entry-not-file", "shape", `Plan directory contains a non-file entry: ${name}`, displayChild(name)));
		else if (currentUid !== undefined && child.uid !== currentUid) push(r, finding("entry-foreign-owner", "root", `Plan entry is owned by a different user: ${name}`, displayChild(name)));
		else {
			if (name !== "concepts.md" && name !== "orchestration.md" && !PHASE_PATH_PATTERN.test(name)) push(r, finding("entry-unexpected", "shape", `Unexpected entry in plan directory: ${name}`, displayChild(name)));
			accepted.push({ name, entry: child });
		}
	}
	if (!r.valid) return finalize(r);

	const files: { path: string; content: string }[] = [];
	for (const { name, entry } of accepted) {
		let handle;
		try {
			handle = await open(resolve(resolved, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			const opened = await handle.stat();
			if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
				push(r, finding("entry-changed", "root", `Plan entry changed during inspection: ${name}`, displayChild(name)));
				continue;
			}
			const content = await handle.readFile();
			const after = await handle.stat();
			if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== content.byteLength) {
				push(r, finding("entry-changed", "root", `Plan entry changed while being read: ${name}`, displayChild(name)));
				continue;
			}
			files.push({ path: name, content: content.toString("utf8") });
		} catch (error) {
			if (["ELOOP", "ENOENT", "EACCES", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) push(r, finding("entry-read-refused", "symbolic-link", `Plan entry could not be safely read: ${name}`, displayChild(name)));
			else throw error;
		} finally {
			await handle?.close();
		}
	}
	if (!r.valid) return finalize(r);
	const inspected = inspectPlan(files);
	for (const item of inspected.findings) push(r, item.path && displayRoot !== "." ? { ...item, path: displayChild(item.path) } : item);
	Object.assign(r.metadata, inspected.metadata);
	return finalize(r);
}

export async function validatePlanDirectory(directory: string): Promise<void> {
	const res = await inspectPlanDirectory(directory);
	if (!res.valid) {
		const summary = res.findings.map((f) => `- [${f.category}] ${f.message}${f.path ? ` (${f.path})` : ""}`).join("\n");
		throw new Error(`Plan directory validation failed:\n${summary}`);
	}
}
