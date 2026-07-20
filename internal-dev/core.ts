import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ROOT_AGENTS_CONTENT, SPECIFICATION_AGENTS_CONTENT } from "./contract.ts";

export const INTERNAL_DEV_DIRECTORY = ".internal-dev";

export const ARTIFACT_KINDS = [
	"specification",
	"bug",
	"plan",
	"review",
	"knowledge",
	"changelog",
	"debug_report",
	"skill",
	"handoff",
	"brainstorm",
	"sprint",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Canonical ordered required H2 headings for every artifact kind. */
export const REQUIRED_HEADINGS = {
	specification: ["Purpose", "Intended Contract", "Constraints", "Decisions", "Validation", "Open Questions"],
	bug: ["Summary", "Scope", "Reproduction", "Expected", "Actual", "Evidence", "Impact", "Status", "Next Action"],
	plan: ["Context", "Goal", "In Scope", "Out of Scope", "Implementation Steps", "Validation", "Exit Criteria"],
	review: ["Scope", "Findings", "Risk Assessment", "Recommendations", "Follow-ups"],
	knowledge: ["Topic", "Source References", "Key Takeaways", "Project Relevance", "Open Questions"],
	changelog: ["Date", "Git Commit", "Change Summary", "Files", "Behavioral Impact", "Specification Impact", "Risks", "Follow-up Items"],
	debug_report: ["Symptom", "Scope", "Time Bound", "Environment", "Investigation", "Evidence", "Conclusion", "Next Action"],
	skill: ["Purpose", "When to Use", "Procedure", "Validation", "Constraints"],
	handoff: ["Context", "Objective", "Settled Decisions", "Constraints", "Scope", "Recommended Direction", "Validation", "Open Questions"],
	brainstorm: ["Prompt", "Source", "Findings", "Options", "Trade-offs", "Open Questions", "Recommended Next Step"],
	sprint: ["Directive", "Stages", "Artifacts", "Implementation Evidence", "Final Validation", "Outcome"],
} as const satisfies Readonly<Record<ArtifactKind, readonly string[]>>;

export const ARTIFACT_STORES: Record<ArtifactKind, string> = {
	specification: "specifications",
	bug: "bugs",
	plan: "plans",
	review: "reviews",
	knowledge: "knowledge",
	changelog: "changelogs",
	debug_report: "debug_reports",
	skill: "skills",
	handoff: "handoffs",
	brainstorm: "brainstorm",
	sprint: "sprints",
};

export const STORE_DIRECTORIES = [...new Set(Object.values(ARTIFACT_STORES))];

export interface GitState {
	isRepository: boolean;
	commit?: string;
}

export interface ScaffoldOptions {
	now?: Date;
	git?: GitState;
}

export interface InternalDevInspection {
	state: "missing" | "partial" | "ready" | "conflict";
	internalDevPath: string;
	missingDirectories: string[];
	missingFiles: string[];
	conflicts: string[];
}

export interface ScaffoldResult {
	internalDevPath: string;
	createdDirectories: string[];
	createdFiles: string[];
	existingFiles: string[];
	warnings: string[];
}

export interface CreateArtifactOptions {
	kind: ArtifactKind;
	requestedPath?: string;
	title?: string;
	content?: string;
	now?: Date;
	git?: GitState;
}

export interface CreatedArtifact {
	kind: ArtifactKind;
	path: string;
	relativePath: string;
}

/** A validated heading occurrence from the line-oriented Markdown parser. */
export interface HeadingOccurrence {
	/** 1-indexed source line. */
	line: number;
	/** ATX level (2 for H2, etc.). */
	level: number;
	/** Trimmed heading text. */
	name: string;
}

/** A kind-specific content validation error. */
export interface ValidationError {
	kind: ArtifactKind;
	heading?: string;
	line?: number;
	category: "missing" | "duplicate" | "out_of_order" | "wrong_level" | "malformed";
	message: string;
}

function formatValidationErrors(errors: readonly ValidationError[]): string {
	return errors.map((error) => `- [${error.kind}/${error.category}] ${error.message}`).join("\n");
}

/**
 * Line-oriented Markdown section parser.
 * Tracks backtick and tilde fenced-code state (openers indented ≤ 3 spaces),
 * skips indented-code lines (≥ 4 spaces or tab), and records every ATX heading
 * whose trimmed text matches a name in `requiredNames`.
 */
function parseMarkdownAtxHeadings(content: string): HeadingOccurrence[] {
	const lines = content.split("\n");
	const results: HeadingOccurrence[] = [];
	let fenceChar: "`" | "~" | undefined;
	let fenceCount = 0;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (fenceChar) {
			const close = /^( {0,3})(`+|~+)[ \t]*$/.exec(raw);
			if (close && close[2][0] === fenceChar && close[2].length >= fenceCount) {
				fenceChar = undefined;
				fenceCount = 0;
			}
			continue;
		}

		// Fences indented as code do not open fenced-code state.
		const open = /^( {0,3})(`{3,}|~{3,})/.exec(raw);
		if (open) {
			fenceChar = open[2][0] as "`" | "~";
			fenceCount = open[2].length;
			continue;
		}

		// Tabs and four-space indentation are code, not headings.
		if (/^(?: {4}|\t)/.test(raw)) continue;

		// Required sections are literal ATX lines; closing hashes or extra text
		// are not normalized into a required heading name.
		const heading = /^( {0,3})(#{1,6})[ \t]+([^#\r\n]*?)[ \t]*$/.exec(raw);
		if (!heading) continue;
		results.push({ line: i + 1, level: heading[2].length, name: heading[3].trim() });
	}
	return results;
}

export function parseMarkdownHeadings(content: string, requiredNames: ReadonlySet<string>): HeadingOccurrence[] {
	return parseMarkdownAtxHeadings(content).filter((heading) => requiredNames.has(heading.name));
}

function sectionBody(content: string, occurrence: HeadingOccurrence): string {
	const lines = content.split("\n");
	const next = parseMarkdownAtxHeadings(content).find(
		(heading) => heading.level === 2 && heading.line > occurrence.line,
	);
	return lines.slice(occurrence.line, next ? next.line - 1 : lines.length).join("\n");
}

/**
 * Validate that `content` contains every required heading for `kind` exactly once
 * at H2 level in canonical relative order.  Returns every violation.
 */
export function validateContent(
	kind: ArtifactKind,
	content: string,
	relativePath?: string,
): ValidationError[] {
	const required = REQUIRED_HEADINGS[kind];
	const requiredSet = new Set(required);
	const occs = parseMarkdownHeadings(content, requiredSet);
	const errors: ValidationError[] = [];
	const ctx = relativePath ? ` in "${relativePath}"` : "";

	// Wrong-level detections.
	for (const occ of occs) {
		if (occ.level !== 2) {
			errors.push({
				kind,
				heading: occ.name,
				line: occ.line,
				category: "wrong_level",
				message: `H${occ.level} heading "## ${occ.name}"${ctx} must be H2.`,
			});
		}
	}

	// Only consider H2 occurrences for duplicate / order / missing.
	const h2Occs = occs.filter((o) => o.level === 2);

	// Duplicates.
	const byName = new Map<string, number[]>();
	for (const occ of h2Occs) {
		const lines = byName.get(occ.name) ?? [];
		lines.push(occ.line);
		byName.set(occ.name, lines);
	}
	for (const [name, lines] of byName) {
		if (lines.length > 1) {
			errors.push({
				kind,
				heading: name,
				category: "duplicate",
				message: `Heading "## ${name}"${ctx} appears ${lines.length} times (lines ${lines.join(", ")}).`,
			});
		}
	}

	// Canonical-order check.
	let reqIdx = 0;
	for (const occ of h2Occs) {
		const expectedIdx = required.indexOf(occ.name);
		if (expectedIdx < reqIdx) {
			errors.push({
				kind,
				heading: occ.name,
				line: occ.line,
				category: "out_of_order",
				message: `Heading "## ${occ.name}"${ctx} is out of canonical order (line ${occ.line}).`,
			});
		}
		reqIdx = Math.max(reqIdx, expectedIdx + 1);
	}

	// Missing.
	const h2Names = new Set(h2Occs.map((o) => o.name));
	for (const name of required) {
		if (!h2Names.has(name)) {
			errors.push({
				kind,
				heading: name,
				category: "missing",
				message: `Required heading "## ${name}"${ctx} is missing.`,
			});
		}
	}

	return errors;
}

/**
 * Pre-normalization changelog validation: every user-owned heading must be present,
 * unique, at H2, and in order.  `Git Commit` is optional but, if present, must be
 * unique, at H2, and between `Date` and `Change Summary`.
 */
export function validateChangelogPreNormalization(content: string, relativePath?: string): ValidationError[] {
	const required = REQUIRED_HEADINGS["changelog"];
	const userRequired = required.filter((h) => h !== "Git Commit");
	const allRequiredSet = new Set(required);
	const occs = parseMarkdownHeadings(content, allRequiredSet);
	const errors: ValidationError[] = [];
	const ctx = relativePath ? ` in "${relativePath}"` : "";

	// Wrong-level detections for all required headings.
	for (const occ of occs) {
		if (occ.level !== 2) {
			errors.push({
				kind: "changelog",
				heading: occ.name,
				line: occ.line,
				category: "wrong_level",
				message: `H${occ.level} heading "## ${occ.name}"${ctx} must be H2.`,
			});
		}
	}

	const h2Occs = occs.filter((o) => o.level === 2);

	// Duplicates for all required headings.
	const byName = new Map<string, number[]>();
	for (const occ of h2Occs) {
		const lines = byName.get(occ.name) ?? [];
		lines.push(occ.line);
		byName.set(occ.name, lines);
	}
	for (const [name, lines] of byName) {
		if (lines.length > 1) {
			errors.push({
				kind: "changelog",
				heading: name,
				category: "duplicate",
				message: `Heading "## ${name}"${ctx} appears ${lines.length} times (lines ${lines.join(", ")}).`,
			});
		}
	}

	// Order check: user-required headings must be in canonical order.
	let reqIdx = 0;
	for (const occ of h2Occs) {
		// Skip Git Commit in the ordering check — it's optional.
		if (occ.name === "Git Commit") continue;
		const expectedIdx = required.indexOf(occ.name);
		if (expectedIdx < reqIdx) {
			errors.push({
				kind: "changelog",
				heading: occ.name,
				line: occ.line,
				category: "out_of_order",
				message: `Heading "## ${occ.name}"${ctx} is out of canonical order (line ${occ.line}).`,
			});
		}
		reqIdx = Math.max(reqIdx, expectedIdx + 1);
	}

	// Git Commit position check: if present, must be physically between Date and Change Summary.
	const gcOcc = h2Occs.find((o) => o.name === "Git Commit");
	if (gcOcc) {
		const dateOcc = h2Occs.find((o) => o.name === "Date");
		const csOcc = h2Occs.find((o) => o.name === "Change Summary");
		if (dateOcc && csOcc && (gcOcc.line <= dateOcc.line || gcOcc.line >= csOcc.line)) {
			errors.push({
				kind: "changelog",
				heading: "Git Commit",
				line: gcOcc.line,
				category: "out_of_order",
				message: `Heading "## Git Commit"${ctx} must be between "## Date" (line ${dateOcc.line}) and "## Change Summary" (line ${csOcc.line}), found at line ${gcOcc.line}.`,
			});
		}
	}

	// A supplied Git Commit section is code-owned and may only be empty.
	if (gcOcc && sectionBody(content, gcOcc).trim() !== "") {
		errors.push({
			kind: "changelog",
			heading: "Git Commit",
			line: gcOcc.line,
			category: "malformed",
			message: `Heading "## Git Commit"${ctx} must be unfilled so current commit evidence can be written.`,
		});
	}

	// Missing user-required headings.
	const h2Names = new Set(h2Occs.map((o) => o.name));
	for (const name of userRequired) {
		if (!h2Names.has(name)) {
			errors.push({
				kind: "changelog",
				heading: name,
				category: "missing",
				message: `Required heading "## ${name}"${ctx} is missing.`,
			});
		}
	}

	return errors;
}

const STANDARD_FILES: Array<{ path: string; content: string }> = [
	{ path: "AGENTS.md", content: ROOT_AGENTS_CONTENT },
	{ path: "specifications/AGENTS.md", content: SPECIFICATION_AGENTS_CONTENT },
	{
		path: "specifications/index.md",
		content: "# Specification Index\n\nList each living specification and its ownership boundary here.\n",
	},
	{
		path: "specifications/decisions.md",
		content: "# Durable Decisions\n\nRecord accepted decisions, justification, alternatives, caveats, affected specifications, source, and review timing.\n",
	},
	{
		path: "specifications/deferred-features.md",
		content: "# Deferred Features\n\nRecord accepted capabilities that are intentionally deferred.\n",
	},
	{
		path: "specifications/horizon-ideas.md",
		content: "# Horizon Ideas\n\nRecord possible future direction that has not been accepted as a commitment.\n",
	},
];

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function statOrUndefined(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

function assertInside(base: string, candidate: string): void {
	const rel = relative(base, candidate);
	if (rel === "" || rel === ".") return;
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(`Artifact path escapes ${base}.`);
	}
}

async function assertExistingSegmentsAreDirectoriesAndNotSymlinks(base: string, targetDirectory: string): Promise<void> {
	assertInside(base, targetDirectory);
	const rel = relative(base, targetDirectory);
	const segments = rel === "" ? [] : rel.split(sep);
	let current = base;
	for (const segment of segments) {
		current = resolve(current, segment);
		const stat = await statOrUndefined(current);
		if (!stat) break;
		if (stat.isSymbolicLink()) throw new Error(`Refusing to traverse symbolic link: ${current}`);
		if (!stat.isDirectory()) throw new Error(`Expected a directory but found another file type: ${current}`);
	}
}

function displayRelative(projectRoot: string, path: string, directory = false): string {
	const value = relative(projectRoot, path).split(sep).join("/");
	return directory ? `${value}/` : value;
}

function isoDate(now: Date): string {
	return now.toISOString().slice(0, 10);
}

function slug(value: string): string {
	const normalized = value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || "artifact";
}

export function defaultArtifactPath(kind: ArtifactKind, title: string | undefined, now = new Date()): string {
	const date = isoDate(now);
	const name = slug(title ?? kind.replaceAll("_", " "));
	switch (kind) {
		case "bug":
			return `${name}/report.md`;
		case "plan":
			return `${name}/phase-01-implementation.md`;
		case "skill":
			return `${name}/SKILL.md`;
		case "brainstorm":
			return `${name}/findings.md`;
		case "sprint":
			return `${name}/manifest.md`;
		default:
			return `${date}-${name}.md`;
	}
}

export function resolveArtifactPath(
	internalDevPath: string,
	kind: ArtifactKind,
	requestedPath: string | undefined,
	title: string | undefined,
	now = new Date(),
): { absolutePath: string; relativePath: string; storePath: string } {
	let selected = requestedPath?.trim();
	if (selected?.startsWith("@")) selected = selected.slice(1);
	selected ||= defaultArtifactPath(kind, title, now);
	if (selected.includes("\0")) throw new Error("Artifact path cannot contain a NUL byte.");
	if (/[\u0000-\u001f\u007f]/.test(selected)) throw new Error("Artifact path cannot contain control characters.");
	if (isAbsolute(selected) || /^[a-zA-Z]:[\\/]/.test(selected) || /^[/\\]{2}/.test(selected)) {
		throw new Error("Artifact path must be relative to its artifact store.");
	}
	const portableSegments = selected.split(/[\\/]+/);
	if (portableSegments.some((segment) => segment === "." || segment === "..")) {
		throw new Error("Artifact path cannot contain '.' or '..' traversal segments.");
	}

	const storePath = resolve(internalDevPath, ARTIFACT_STORES[kind]);
	const absolutePath = resolve(storePath, selected);
	assertInside(storePath, absolutePath);
	if (absolutePath === storePath) throw new Error("Artifact path must name a file, not the store directory.");
	return {
		absolutePath,
		relativePath: relative(internalDevPath, absolutePath).split(sep).join("/"),
		storePath,
	};
}

function gitCommitValue(git: GitState | undefined): string {
	if (!git?.isRepository) return "Not applicable (not a Git repository).";
	return git.commit ?? "Unavailable (the Git repository has no readable commit yet).";
}

/**
 * Ensure changelog `content` has a `## Git Commit` section in canonical position
 * (after `## Date`, before `## Change Summary`) populated with `git.commit`.
 *
 * An existing canonical section is filled with the current commit without disturbing
 * later sections.  A missing section is inserted at the canonical slot.  Unborn
 * repositories skip mutation; absent-commit repositories throw.
 */
export function ensureChangelogCommit(content: string, git: GitState | undefined): string {
	if (git?.isRepository && !git.commit) {
		throw new Error("Cannot create a compliant changelog because this Git repository has no readable HEAD commit.");
	}
	const evidence = gitCommitValue(git);
	const headings = parseMarkdownAtxHeadings(content);
	const gitCommit = headings.find((heading) => heading.level === 2 && heading.name === "Git Commit");

	if (gitCommit) {
		const body = sectionBody(content, gitCommit);
		if (body.includes(evidence)) return content;
		if (body.trim() !== "") {
			throw new Error("Refusing to replace supplied Git Commit content; the section must be unfilled.");
		}
		const lines = content.split("\n");
		const next = headings.find((heading) => heading.level === 2 && heading.line > gitCommit.line);
		const before = lines.slice(0, gitCommit.line).join("\n");
		const after = lines.slice(next ? next.line - 1 : lines.length).join("\n");
		return `${before}\n\n${evidence}\n\n${after}`;
	}

	const date = headings.find((heading) => heading.level === 2 && heading.name === "Date");
	const changeSummary = headings.find((heading) => heading.level === 2 && heading.name === "Change Summary");
	if (!date || !changeSummary || changeSummary.line <= date.line) {
		throw new Error("Cannot insert Git Commit without canonical Date and Change Summary sections.");
	}
	const lines = content.split("\n");
	const insertion = changeSummary.line - 1;
	return `${lines.slice(0, insertion).join("\n")}\n## Git Commit\n\n${evidence}\n\n${lines.slice(insertion).join("\n")}`;
}

/** Build a Markdown template from an H1 title and ordered H2 heading names. */
function headingsTemplate(title: string, names: readonly string[]): string {
	return [`# ${title}`, "", ...names.flatMap((name) => [`## ${name}`, "", "", ""])].join("\n").trimEnd() + "\n";
}

/**
 * Generate the minimum-heading template for `kind`.  Uses `REQUIRED_HEADINGS`
 * as the heading source so templates and validation stay in sync.
 */
export function artifactTemplate(kind: ArtifactKind, title: string | undefined, now = new Date(), git?: GitState): string {
	const label = title?.trim() || kind.replaceAll("_", " ");
	const template = headingsTemplate(label, REQUIRED_HEADINGS[kind]);
	if (kind === "changelog") {
		return template
			.replace("## Date\n\n", `## Date\n\n${isoDate(now)}\n\n`)
			.replace("## Git Commit\n\n", `## Git Commit\n\n${gitCommitValue(git)}\n\n`);
	}
	return template;
}

async function writeExclusive(path: string, content: string): Promise<boolean> {
	try {
		await writeFile(path, content, { encoding: "utf8", flag: "wx" });
		return true;
	} catch (error) {
		if (errorCode(error) === "EEXIST") return false;
		throw error;
	}
}

async function uniqueInitializationChangelog(
	internalDevPath: string,
	projectRoot: string,
	created: readonly string[],
	now: Date,
	git: GitState | undefined,
): Promise<string> {
	const base = `${isoDate(now)}-internal-dev-initialized`;
	for (let suffix = 1; suffix <= 10_000; suffix++) {
		const filename = `${base}${suffix === 1 ? "" : `-${suffix}`}.md`;
		const resolvedPath = resolve(internalDevPath, "changelogs", filename);
		const relativePath = relative(internalDevPath, resolvedPath).split(sep).join("/");

		let content = [
			"# Internal development store initialized",
			"",
			"## Date",
			"",
			isoDate(now),
			"",
			"## Git Commit",
			"",
			gitCommitValue(git),
			"",
			"## Change Summary",
			"",
			"Created missing `.internal-dev` workflow directories and starter contracts without replacing existing content.",
			"",
			"## Files",
			"",
			...(created.length
				? created.map((entry) => `- \`${entry}\``)
				: ["- No additional scaffold paths were required."]),
			"",
			"## Behavioral Impact",
			"",
			"Persistent internal-development workflow records are now available.",
			"",
			"## Specification Impact",
			"",
			"Specification Impact: none. This initializes workflow storage without changing project behavior.",
			"",
			"## Risks",
			"",
			"Existing files were preserved; their contents may differ from the starter contract.",
			"",
			"## Follow-up Items",
			"",
			"- Add project-specific specification ownership entries as work requires them.",
			"",
		].join("\n");

		// Normalize commit for Git repositories.
		if (git?.isRepository && git.commit) {
			content = ensureChangelogCommit(content, git);
		}

		// Validate final content before exclusive write.
		const errors = validateContent("changelog", content, relativePath);
		if (errors.length) {
			throw new Error(
				`Generated initialization changelog fails validation:\n${formatValidationErrors(errors)}`,
			);
		}

		if (git?.commit) {
			const gcRe = /^## Git Commit[ \t]*$/m;
			const gcMatch = gcRe.exec(content);
			if (!gcMatch) {
				throw new Error("Git Commit section missing after normalization in initialization changelog.");
			}
			const sectionStart = gcMatch.index + gcMatch[0].length;
			const remainder = content.slice(sectionStart);
			const nextHeadingRe = /^##\s/m;
			const nextMatch = nextHeadingRe.exec(remainder);
			const sectionEnd = nextMatch ? sectionStart + nextMatch.index : content.length;
			if (!content.slice(sectionStart, sectionEnd).includes(git.commit)) {
				throw new Error("Git Commit section in initialization changelog does not contain HEAD.");
			}
		}

		if (await writeExclusive(resolvedPath, content)) return displayRelative(projectRoot, resolvedPath);
	}
	throw new Error("Could not allocate a unique initialization changelog filename.");
}

function requiredDirectories(internalDevPath: string): string[] {
	return [
		internalDevPath,
		...STORE_DIRECTORIES.flatMap((store) => [resolve(internalDevPath, store), resolve(internalDevPath, store, ".archive")]),
		resolve(internalDevPath, ".archive"),
	];
}

export async function inspectInternalDev(projectRoot: string): Promise<InternalDevInspection> {
	const root = resolve(projectRoot);
	const internalDevPath = resolve(root, INTERNAL_DEV_DIRECTORY);
	const rootStat = await statOrUndefined(internalDevPath);
	if (!rootStat) {
		return { state: "missing", internalDevPath, missingDirectories: [], missingFiles: [], conflicts: [] };
	}
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		return {
			state: "conflict",
			internalDevPath,
			missingDirectories: [],
			missingFiles: [],
			conflicts: [displayRelative(root, internalDevPath)],
		};
	}

	const missingDirectories: string[] = [];
	const missingFiles: string[] = [];
	const conflicts: string[] = [];
	for (const path of requiredDirectories(internalDevPath).slice(1)) {
		let stat;
		try {
			stat = await statOrUndefined(path);
		} catch (error) {
			if (errorCode(error) === "ENOTDIR") {
				conflicts.push(displayRelative(root, path));
				continue;
			}
			throw error;
		}
		if (!stat) missingDirectories.push(displayRelative(root, path, true));
		else if (stat.isSymbolicLink() || !stat.isDirectory()) conflicts.push(displayRelative(root, path));
	}
	for (const file of STANDARD_FILES) {
		const path = resolve(internalDevPath, file.path);
		let stat;
		try {
			stat = await statOrUndefined(path);
		} catch (error) {
			if (errorCode(error) === "ENOTDIR") {
				conflicts.push(displayRelative(root, path));
				continue;
			}
			throw error;
		}
		if (!stat) missingFiles.push(displayRelative(root, path));
		else if (stat.isSymbolicLink() || !stat.isFile()) conflicts.push(displayRelative(root, path));
	}
	return {
		state: conflicts.length ? "conflict" : missingDirectories.length || missingFiles.length ? "partial" : "ready",
		internalDevPath,
		missingDirectories,
		missingFiles,
		conflicts,
	};
}

export async function scaffoldInternalDev(projectRoot: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
	const root = resolve(projectRoot);
	const internalDevPath = resolve(root, INTERNAL_DEV_DIRECTORY);
	const now = options.now ?? new Date();
	const directories = requiredDirectories(internalDevPath);

	for (const path of directories) {
		const stat = await statOrUndefined(path);
		if (!stat) continue;
		if (stat.isSymbolicLink()) throw new Error(`Refusing to scaffold through symbolic link: ${path}`);
		if (!stat.isDirectory()) throw new Error(`Cannot create required directory because a file exists: ${path}`);
	}
	for (const file of STANDARD_FILES) {
		const path = resolve(internalDevPath, file.path);
		const stat = await statOrUndefined(path);
		if (stat?.isSymbolicLink()) throw new Error(`Refusing to use symbolic link at scaffold file: ${path}`);
		if (stat && !stat.isFile()) throw new Error(`Cannot create scaffold file because another file type exists: ${path}`);
	}

	const createdDirectories: string[] = [];
	for (const path of directories) {
		const existed = await statOrUndefined(path);
		await mkdir(path, { recursive: true });
		if (!existed) createdDirectories.push(displayRelative(root, path, true));
	}

	const createdFiles: string[] = [];
	const existingFiles: string[] = [];
	for (const file of STANDARD_FILES) {
		const path = resolve(internalDevPath, file.path);
		await assertExistingSegmentsAreDirectoriesAndNotSymlinks(internalDevPath, dirname(path));
		if (await writeExclusive(path, file.content)) createdFiles.push(displayRelative(root, path));
		else existingFiles.push(displayRelative(root, path));
	}

	const warnings: string[] = [];
	if (createdDirectories.length > 0 || createdFiles.length > 0) {
		if (options.git?.isRepository && !options.git.commit) {
			warnings.push("Initialization changelog was not created because this Git repository has no readable HEAD commit.");
		} else {
			const changelog = await uniqueInitializationChangelog(
				internalDevPath,
				root,
				[...createdDirectories, ...createdFiles],
				now,
				options.git,
			);
			createdFiles.push(changelog);
		}
	}

	return { internalDevPath, createdDirectories, createdFiles, existingFiles, warnings };
}

export async function createArtifact(internalDevPath: string, options: CreateArtifactOptions): Promise<CreatedArtifact> {
	const root = resolve(internalDevPath);
	const rootStat = await statOrUndefined(root);
	if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
		throw new Error(`${INTERNAL_DEV_DIRECTORY} is not an initialized, non-symbolic-link directory.`);
	}
	const now = options.now ?? new Date();
	const selected = resolveArtifactPath(root, options.kind, options.requestedPath, options.title, now);

	// 1. Resolve content (user-supplied or template).
	const hasSuppliedContent = options.content !== undefined;
	let content = hasSuppliedContent
		? `${options.content!.trimEnd()}\n`
		: artifactTemplate(options.kind, options.title, now, options.git);

	// 2. Pre-creation validation (before any filesystem mutation).
	if (options.kind === "changelog" && hasSuppliedContent) {
		// Changelog pre-validation: accept absent Git Commit.
		const preErrors = validateChangelogPreNormalization(content, selected.relativePath);
		if (preErrors.length) {
			throw new Error(
				`Supplied changelog content fails validation for ${selected.relativePath}:\n${formatValidationErrors(preErrors)}`,
			);
		}
	} else if (hasSuppliedContent) {
		// Non-changelog supplied content: strict validation.
		const errors = validateContent(options.kind, content, selected.relativePath);
		if (errors.length) {
			throw new Error(
				`Supplied ${options.kind} content fails validation for ${selected.relativePath}:\n${formatValidationErrors(errors)}`,
			);
		}
	} else {
		// Generated template: strict validation.
		const errors = validateContent(options.kind, content, selected.relativePath);
		if (errors.length) {
			throw new Error(
				`Generated template fails internal validation for ${options.kind} at ${selected.relativePath}:\n${formatValidationErrors(errors)}`,
			);
		}
	}

	// 3. Changelog normalization (commit insertion/filling) and final validation
	// happen before any requested parent directory is created.
	if (options.kind === "changelog") {
		content = ensureChangelogCommit(content, options.git);

		// 6. Strict final validation after normalization.
		const finalErrors = validateContent("changelog", content, selected.relativePath);
		if (finalErrors.length) {
			throw new Error(
				`Normalized changelog content fails validation for ${selected.relativePath}:\n${formatValidationErrors(finalErrors)}`,
			);
		}

		// 7. Verify current HEAD appears inside the Git Commit section body.
		if (options.git?.commit) {
			const gitCommit = parseMarkdownAtxHeadings(content).find(
				(heading) => heading.level === 2 && heading.name === "Git Commit",
			);
			if (!gitCommit || !sectionBody(content, gitCommit).includes(options.git.commit)) {
				throw new Error(
					`Git Commit section for ${selected.relativePath} does not contain the current HEAD commit.`,
				);
			}
		}
	}

	// 4. Path safety checks and parent creation occur only after content is final.
	await assertExistingSegmentsAreDirectoriesAndNotSymlinks(root, selected.storePath);
	await assertExistingSegmentsAreDirectoriesAndNotSymlinks(root, dirname(selected.absolutePath));
	await mkdir(dirname(selected.absolutePath), { recursive: true });
	await assertExistingSegmentsAreDirectoriesAndNotSymlinks(root, dirname(selected.absolutePath));

	// 5. Exclusive write.
	if (!(await writeExclusive(selected.absolutePath, content))) {
		throw new Error(`Artifact already exists; refusing to overwrite: ${selected.relativePath}`);
	}
	return { kind: options.kind, path: selected.absolutePath, relativePath: selected.relativePath };
}

export async function findInternalDev(startDirectory: string): Promise<{ projectRoot: string; internalDevPath: string } | undefined> {
	let current = resolve(startDirectory);
	while (true) {
		const candidate = resolve(current, INTERNAL_DEV_DIRECTORY);
		const stat = await statOrUndefined(candidate);
		if (stat) return { projectRoot: current, internalDevPath: candidate };
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}
