import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";
import { ROOT_AGENTS_CONTENT } from "../contract.ts";
import {
	ARTIFACT_KINDS,
	ARTIFACT_STORES,
	REQUIRED_HEADINGS,
	artifactTemplate,
	createArtifact,
	defaultArtifactPath,
	ensureChangelogCommit,
	findInternalDev,
	inspectInternalDev,
	parseMarkdownHeadings,
	resolveArtifactPath,
	scaffoldInternalDev,
	validateChangelogPreNormalization,
	validateContent,
	type ArtifactKind,
} from "../core.ts";

const NOW = new Date("2026-02-03T12:00:00.000Z");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

async function project() {
	return mkdtemp(path.join(os.tmpdir(), "pi-internal-dev-"));
}

// ── REQUIRED_HEADINGS exhaustiveness ──────────────────────────────────────────

test("REQUIRED_HEADINGS covers every ArtifactKind", () => {
	for (const kind of ARTIFACT_KINDS) {
		assert.ok(Array.isArray(REQUIRED_HEADINGS[kind]), `REQUIRED_HEADINGS missing entry for ${kind}`);
		assert.ok(REQUIRED_HEADINGS[kind].length > 0, `${kind} has empty heading list`);
		const set = new Set(REQUIRED_HEADINGS[kind]);
		assert.equal(set.size, REQUIRED_HEADINGS[kind].length, `${kind} has duplicate headings in REQUIRED_HEADINGS`);
	}
});

// ── artifactTemplate uses REQUIRED_HEADINGS ───────────────────────────────────

test("artifactTemplate uses REQUIRED_HEADINGS for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const template = artifactTemplate(kind, "Test", NOW);
		const errors = validateContent(kind, template, `test-${kind}.md`);
		assert.deepEqual(errors, [], `${kind} template fails validation: ${JSON.stringify(errors)}`);
		for (const name of REQUIRED_HEADINGS[kind]) {
			assert.match(template, new RegExp(`## ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${kind} template missing ## ${name}`);
		}
	}
});

// ── Changelog template carries date and commit ────────────────────────────────

test("changelog template populates Date and Git Commit", () => {
	const changelog = artifactTemplate("changelog", "Change", NOW, { isRepository: true, commit: COMMIT });
	assert.match(changelog, /## Date\n\n2026-02-03/);
	assert.match(changelog, new RegExp(`## Git Commit\\n\\n${COMMIT}`));
	// Must be valid after optional commit population.
	const errors = validateContent("changelog", changelog, "changelog-template.md");
	assert.deepEqual(errors, []);
});

// ── Parser: heading detection ─────────────────────────────────────────────────

test("parseMarkdownHeadings detects H2 headings at correct level", () => {
	const content = "# H1\n\n## Purpose\n\nSome text.\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Intended Contract"]));
	assert.equal(occs.length, 2);
	assert.equal(occs[0].name, "Purpose");
	assert.equal(occs[0].level, 2);
	assert.equal(occs[0].line, 3);
	assert.equal(occs[1].name, "Intended Contract");
	assert.equal(occs[1].level, 2);
});

test("parseMarkdownHeadings ignores headings inside backtick fences", () => {
	const content = "## Purpose\n\n```\n## Fake\n```\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Fake", "Intended Contract"]));
	assert.equal(occs.length, 2);
	assert.equal(occs[0].name, "Purpose");
	assert.equal(occs[1].name, "Intended Contract");
});

test("parseMarkdownHeadings ignores headings inside tilde fences", () => {
	const content = "## Purpose\n\n~~~\n## Fake\n~~~\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Fake", "Intended Contract"]));
	assert.equal(occs.length, 2);
	assert.equal(occs[0].name, "Purpose");
	assert.equal(occs[1].name, "Intended Contract");
});

test("parseMarkdownHeadings handles unclosed fence", () => {
	const content = "## Purpose\n\n```\n## Inside\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Inside"]));
	assert.equal(occs.length, 1);
	assert.equal(occs[0].name, "Purpose");
});

test("parseMarkdownHeadings detects wrong-level headings", () => {
	const content = "### Purpose\n\n## Purpose\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose"]));
	assert.equal(occs.length, 2);
	assert.equal(occs[0].level, 3);
	assert.equal(occs[1].level, 2);
});

test("parseMarkdownHeadings skips indented code", () => {
	const content = "## Purpose\n\n    ## Code\n\t## AlsoCode\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Code", "AlsoCode", "Intended Contract"]));
	assert.equal(occs.length, 2);
});

test("parseMarkdownHeadings allows whitespace around heading", () => {
	const content = "  ## Purpose  \n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Intended Contract"]));
	assert.equal(occs.length, 2);
});

test("parseMarkdownHeadings does not match headings inside blockquotes", () => {
	const content = "> ## Purpose\n\n## Purpose\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose"]));
	// The blockquoted line starts with "> " which is not whitespace; the trimmed
	// line is "> ## Purpose", which does not match the ATX heading pattern.
	assert.equal(occs.length, 1);
});

test("parseMarkdownHeadings supports closing fence with extra markers", () => {
	const content = "## Purpose\n\n````\n## Inside\n`````\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Inside", "Intended Contract"]));
	assert.equal(occs.length, 2);
});

test("an indented fence is code and does not hide later headings", () => {
	const content = "    ```\n## Purpose\n\n## Intended Contract\n";
	const occs = parseMarkdownHeadings(content, new Set(["Purpose", "Intended Contract"]));
	assert.deepEqual(occs.map((occ) => occ.name), ["Purpose", "Intended Contract"]);
});

test("closing hashes and extra heading text are not accepted as literal required headings", () => {
	for (const malformed of ["## Purpose ##", "## Purpose extra"]) {
		const errors = validateContent("specification", artifactTemplate("specification", "Test", NOW).replace("## Purpose", malformed));
		assert.ok(errors.some((error) => error.category === "missing" && error.heading === "Purpose"));
	}
});

// ── Validator: strict heading validation ──────────────────────────────────────

test("validateContent rejects missing headings", () => {
	const errors = validateContent("bug", "# Bug\n\n## Summary\n\ntext\n", "test-bug.md");
	assert.ok(errors.some((e) => e.category === "missing"), "should report missing headings");
	assert.ok(errors.some((e) => e.heading === "Scope"));
});

test("validateContent rejects duplicate headings", () => {
	const content = [
		"# Bug",
		"",
		"## Summary",
		"",
		"text",
		"",
		"## Summary",
		"",
		"text2",
		"",
		...REQUIRED_HEADINGS["bug"].filter((h) => h !== "Summary").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateContent("bug", content);
	assert.ok(errors.some((e) => e.category === "duplicate" && e.heading === "Summary"));
});

test("validateContent rejects out-of-order headings", () => {
	const content = [
		"# Bug",
		"",
		"## Scope",
		"",
		"x",
		"",
		"## Summary",
		"",
		"x",
		"",
		...REQUIRED_HEADINGS["bug"].filter((h) => h !== "Summary" && h !== "Scope").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateContent("bug", content);
	assert.ok(errors.some((e) => e.category === "out_of_order" && e.heading === "Summary"));
});

test("validateContent rejects wrong-level headings", () => {
	const content = [
		"# Bug",
		"",
		"### Summary",
		"",
		"x",
		"",
		...REQUIRED_HEADINGS["bug"].filter((h) => h !== "Summary").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateContent("bug", content);
	assert.ok(errors.some((e) => e.category === "wrong_level" && e.heading === "Summary"));
});

test("validateContent accepts valid template for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const template = artifactTemplate(kind, "Test", NOW);
		const errors = validateContent(kind, template);
		assert.deepEqual(errors, [], `${kind}: ${JSON.stringify(errors)}`);
	}
});

test("validateContent accepts extra headings and arbitrary body text", () => {
	const template = artifactTemplate("handoff", "Test", NOW);
	const content = template.replace("## Context\n", "## Extra\n\nbonus\n\n## Context\n");
	const errors = validateContent("handoff", content);
	assert.deepEqual(errors, []);
});

test("validateContent accepts empty section bodies", () => {
	const content = [
		"# Bug",
		"",
		...REQUIRED_HEADINGS["bug"].flatMap((h) => [`## ${h}`, "", ""]),
	].join("\n") + "\n";
	const errors = validateContent("bug", content);
	assert.deepEqual(errors, []);
});

// ── Changelog pre-validation ──────────────────────────────────────────────────

test("validateChangelogPreNormalization accepts missing Git Commit", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.deepEqual(errors, []);
});

test("validateChangelogPreNormalization accepts an unfilled Git Commit in canonical position", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.deepEqual(errors, []);
});

test("validateChangelogPreNormalization rejects supplied Git Commit text", () => {
	const content = artifactTemplate("changelog", "Change", NOW, { isRepository: true, commit: COMMIT });
	const errors = validateChangelogPreNormalization(content);
	assert.ok(errors.some((error) => error.heading === "Git Commit" && error.category === "malformed"));
});

test("validateChangelogPreNormalization rejects misplaced Git Commit", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Change Summary",
		"",
		"x",
		"",
		"## Git Commit",
		"",
		COMMIT,
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit" && h !== "Change Summary").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.ok(errors.some((e) => e.heading === "Git Commit" && e.category === "out_of_order"));
});

test("validateChangelogPreNormalization rejects duplicate Git Commit", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		COMMIT,
		"",
		"## Git Commit",
		"",
		COMMIT,
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.ok(errors.some((e) => e.heading === "Git Commit" && e.category === "duplicate"));
});

test("validateChangelogPreNormalization rejects wrong-level Git Commit", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"### Git Commit",
		"",
		COMMIT,
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.ok(errors.some((e) => e.heading === "Git Commit" && e.category === "wrong_level"));
});

test("validateChangelogPreNormalization rejects missing user-owned heading", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		// Missing Change Summary, Files, etc.
	].join("\n");
	const errors = validateChangelogPreNormalization(content);
	assert.ok(errors.some((e) => e.category === "missing" && e.heading !== "Git Commit"));
});

// ── Changelog commit normalization ────────────────────────────────────────────

test("ensureChangelogCommit inserts missing section after Date before Change Summary", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Change Summary",
		"",
		"Something changed.",
		"",
		"## Files",
		"",
		"- x",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n");
	const result = ensureChangelogCommit(content, { isRepository: true, commit: COMMIT });
	assert.match(result, new RegExp(`## Date\\n\\n2026-01-01\\n\\n## Git Commit\\n\\n${COMMIT}\\n\\n## Change Summary`));
	// Does not disturb later sections.
	assert.match(result, /## Files/);
	// Final validation passes.
	const errors = validateContent("changelog", result);
	assert.deepEqual(errors, []);
});

test("ensureChangelogCommit fills existing unfilled section", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		"",
		"## Change Summary",
		"",
		"Something.",
		"",
		"## Files",
		"",
		"- x",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n");
	const result = ensureChangelogCommit(content, { isRepository: true, commit: COMMIT });
	assert.match(result, new RegExp(`## Git Commit\\n\\n${COMMIT}\\n\\n## Change Summary`));
	const errors = validateContent("changelog", result);
	assert.deepEqual(errors, []);
});

test("ensureChangelogCommit is idempotent when commit already present", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		COMMIT,
		"",
		"## Change Summary",
		"",
		"Something.",
		"",
		"## Files",
		"",
		"- x",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n");
	const result = ensureChangelogCommit(content, { isRepository: true, commit: COMMIT });
	assert.equal(result, content);
});

test("ensureChangelogCommit inserts non-Git repository evidence", () => {
	const content = artifactTemplate("changelog", "No Git", NOW, { isRepository: false })
		.replace("## Git Commit\n\nNot applicable (not a Git repository).\n\n", "");
	const result = ensureChangelogCommit(content, { isRepository: false });
	assert.match(result, /## Git Commit\n\nNot applicable \(not a Git repository\)\./);
	assert.deepEqual(validateContent("changelog", result), []);
});

test("ensureChangelogCommit throws for Git repository with no commit", () => {
	assert.throws(
		() => ensureChangelogCommit("# Changelog\n", { isRepository: true }),
		/no readable HEAD commit/,
	);
});

test("ensureChangelogCommit does not disturb user-owned sections when filling commit", () => {
	const content = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		"",
		"## Change Summary",
		"",
		"User wrote this.",
		"",
		"## Files",
		"",
		"- custom.md",
		"",
		"## Behavioral Impact",
		"",
		"Breaking.",
		"",
		"## Specification Impact",
		"",
		"Specification Impact: minor.",
		"",
		"## Risks",
		"",
		"Data loss.",
		"",
		"## Follow-up Items",
		"",
		"- Recheck.",
		"",
	].join("\n");
	const result = ensureChangelogCommit(content, { isRepository: true, commit: COMMIT });
	// All user-owned content preserved.
	assert.match(result, /User wrote this/);
	assert.match(result, /custom\.md/);
	assert.match(result, /Breaking\./);
	assert.match(result, /Specification Impact: minor/);
	assert.match(result, /Data loss/);
	assert.match(result, /Recheck/);
	assert.match(result, new RegExp(COMMIT));
});

// ── createArtifact: pre-validation rejects before filesystem mutation ─────────

test("createArtifact rejects invalid supplied content before creating directories", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");

	// Nested path that doesn't exist yet
	const nestedRel = "nested/deep/report.md";
	const nestedDir = path.join(internal, "bugs", "nested", "deep");

	await assert.rejects(
		createArtifact(internal, {
			kind: "bug",
			requestedPath: nestedRel,
			content: "# Bad\n\n## Only One Heading\n",
			now: NOW,
		}),
		/fails validation/,
	);

	// Prove no directory and no file were created.
	await assert.rejects(() => stat(nestedDir), /ENOENT/);
});

test("createArtifact rejects invalid supplied changelog content before filesystem mutation", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");

	await assert.rejects(
		createArtifact(internal, {
			kind: "changelog",
			requestedPath: "broken.md",
			content: "# Bad\n\n## Date\n\n2026-01-01\n\n## Change Summary\n\nDone.\n",
			now: NOW,
			git: { isRepository: true, commit: COMMIT },
		}),
		/fails validation/,
	);

	await assert.rejects(() => stat(path.join(internal, "changelogs", "broken.md")), /ENOENT/);
});

test("createArtifact validates generated templates before writing", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");
	// All templates should pass validation automatically, so create should succeed.
	const result = await createArtifact(internal, {
		kind: "review",
		now: NOW,
	});
	assert.ok(result.relativePath);
	const content = await readFile(result.path, "utf8");
	const errors = validateContent("review", content);
	assert.deepEqual(errors, []);
});

test("createArtifact validates changelog commit presence after normalization", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");

	const artifact = await createArtifact(internal, {
		kind: "changelog",
		requestedPath: "supplied-closeout.md",
		content: [
			"# Closeout",
			"",
			"## Date",
			"",
			"2026-01-01",
			"",
			"## Git Commit",
			"",
			"",
			"## Change Summary",
			"",
			"Implemented stuff.",
			"",
			"## Files",
			"",
			"- all the things",
			"",
			"## Behavioral Impact",
			"",
			"none",
			"",
			"## Specification Impact",
			"",
			"Specification Impact: none. Just cleanup.",
			"",
			"## Risks",
			"",
			"none",
			"",
			"## Follow-up Items",
			"",
			"none",
			"",
		].join("\n"),
		now: NOW,
		git: { isRepository: true, commit: COMMIT },
	});
	const content = await readFile(artifact.path, "utf8");
	assert.match(content, new RegExp(COMMIT));
	assert.match(content, /Implemented stuff/);
	// Full validation should pass.
	const errors = validateContent("changelog", content);
	assert.deepEqual(errors, []);
});

// ── Scaffolding ───────────────────────────────────────────────────────────────

test("scaffolding creates the complete approved contract", async () => {
	const root = await project();
	const result = await scaffoldInternalDev(root, {
		now: NOW,
		git: { isRepository: true, commit: COMMIT },
	});

	for (const store of ["specifications", "bugs", "plans", "handoffs", "brainstorm", "sprints", "changelogs"]) {
		const archive = path.join(root, ".internal-dev", store, ".archive");
		assert.equal((await stat(archive)).isDirectory(), true);
	}
	assert.deepEqual(ARTIFACT_KINDS, [
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
	]);
	assert.deepEqual(Object.values(ARTIFACT_STORES), [
		"specifications",
		"bugs",
		"plans",
		"reviews",
		"knowledge",
		"changelogs",
		"debug_reports",
		"skills",
		"handoffs",
		"brainstorm",
		"sprints",
	]);
	assert.ok(result.createdFiles.includes(".internal-dev/AGENTS.md"));
	const changelogPath = result.createdFiles.find((entry) => entry.includes("internal-dev-initialized"));
	assert.ok(changelogPath);
	const changelog = await readFile(path.join(root, changelogPath!), "utf8");
	assert.match(changelog, new RegExp(COMMIT));
	assert.match(changelog, /Specification Impact: none/);

	// Init changelog must pass strict validation.
	const errors = validateContent("changelog", changelog);
	assert.deepEqual(errors, [], `init changelog fails validation: ${JSON.stringify(errors)}`);

	const agents = await readFile(path.join(root, ".internal-dev", "AGENTS.md"), "utf8");
	assert.equal(agents, ROOT_AGENTS_CONTENT, "scaffolding must write the exact maintained contract");
	const maintainedAgents = await readFile(new URL("../../.internal-dev/AGENTS.md", import.meta.url), "utf8");
	assert.equal(maintainedAgents, ROOT_AGENTS_CONTENT, "the maintained guide and scaffolding source must remain byte-identical");
	for (const contractSection of [
		"## Source-of-Truth Policy",
		"## Beginning Workflow",
		"## Mid-Workflow Routing",
		"## Specification Workflow",
		"## Knowledge Workflow",
		"## Workflow Rules",
		"## Closeout Workflow",
		"## Minimum Templates",
		"`handoffs/`",
		"`brainstorm/`",
		"`sprints/`",
		"/sprint reset",
		"`orchestration.md`",
		"full current `HEAD` hash",
	]) {
		assert.ok(agents.includes(contractSection), `generated AGENTS.md should include ${contractSection}`);
	}
	// Explicit initialization section.
	assert.ok(agents.includes("## Initialization"), "generated AGENTS.md should include ## Initialization");
	assert.ok(agents.includes("Initialization is never triggered automatically at session start"));
});

test("routing guidance distinguishes brainstorms from reviews and ordinary answers", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const agents = await readFile(path.join(root, ".internal-dev", "AGENTS.md"), "utf8");
	const extension = await readFile(new URL("../index.ts", import.meta.url), "utf8");
	const promptGuidelines = extension.match(/promptGuidelines: \[([\s\S]*?)\n\t\t\],\n\t\tparameters:/)?.[1];
	const injectedContract = extension.match(/const CONTRACT_PRESENT = `([\s\S]*?)`;\n\nconst CONTRACT_MISSING/)?.[1];
	assert.ok(promptGuidelines);
	assert.ok(injectedContract);
	assert.match(promptGuidelines, /Use internal_dev .*explicit brainstorming or ideation/);
	assert.match(promptGuidelines, /use internal_dev reviews for completed repository-history/);

	for (const guidance of [agents, promptGuidelines]) {
		assert.match(guidance, /explicit brainstorming or ideation/);
		assert.match(guidance, /never merely because subagents participated/);
		assert.match(guidance, /completed repository-history, architecture or codebase assessments, audits, and analytical assessments/);
		assert.match(guidance, /ordinary informational answers need no persistent artifact/i);
		assert.match(guidance, /retain every participating agent's or source's findings separately/);
		assert.doesNotMatch(guidance, /one brainstorm folder per effort/i);
	}
});

test("scaffolding is idempotent and never replaces existing starter files", async () => {
	const root = await project();
	await mkdir(path.join(root, ".internal-dev", "specifications"), { recursive: true });
	await writeFile(path.join(root, ".internal-dev", "AGENTS.md"), "project-owned guide\n");

	const first = await scaffoldInternalDev(root, { now: NOW, git: { isRepository: false } });
	assert.ok(first.existingFiles.includes(".internal-dev/AGENTS.md"));
	assert.equal(await readFile(path.join(root, ".internal-dev", "AGENTS.md"), "utf8"), "project-owned guide\n");

	const second = await scaffoldInternalDev(root, { now: NOW, git: { isRepository: false } });
	assert.deepEqual(second.createdDirectories, []);
	assert.deepEqual(second.createdFiles, []);
	assert.equal(await readFile(path.join(root, ".internal-dev", "AGENTS.md"), "utf8"), "project-owned guide\n");
});

test("a required-directory collision fails without overwriting the colliding file", async () => {
	const root = await project();
	await mkdir(path.join(root, ".internal-dev"));
	const collision = path.join(root, ".internal-dev", "bugs");
	await writeFile(collision, "keep me");
	await assert.rejects(scaffoldInternalDev(root), /(Cannot create required directory|ENOTDIR)/);
	assert.equal(await readFile(collision, "utf8"), "keep me");
});

test("an unborn Git repository initializes without producing a noncompliant changelog", async () => {
	const root = await project();
	const result = await scaffoldInternalDev(root, { now: NOW, git: { isRepository: true } });
	assert.equal((await inspectInternalDev(root)).state, "ready");
	assert.equal(result.createdFiles.some((entry) => entry.includes("internal-dev-initialized")), false);
	assert.match(result.warnings.join(" "), /no readable HEAD commit/);
});

test("inspection distinguishes missing, partial, ready, and conflicting stores", async () => {
	const root = await project();
	assert.equal((await inspectInternalDev(root)).state, "missing");
	await mkdir(path.join(root, ".internal-dev"));
	const partial = await inspectInternalDev(root);
	assert.equal(partial.state, "partial");
	assert.ok(partial.missingDirectories.includes(".internal-dev/handoffs/"));
	await scaffoldInternalDev(root, { now: NOW });
	assert.equal((await inspectInternalDev(root)).state, "ready");

	const conflicting = await project();
	await mkdir(path.join(conflicting, ".internal-dev"));
	await writeFile(path.join(conflicting, ".internal-dev", "bugs"), "collision");
	assert.equal((await inspectInternalDev(conflicting)).state, "conflict");
});

// ── Path handling ─────────────────────────────────────────────────────────────

test("artifact paths allow loose descriptive nesting but reject escapes and absolute paths", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");

	const selected = resolveArtifactPath(internal, "handoff", "release candidate/high level direction.md", undefined, NOW);
	assert.equal(selected.relativePath, "handoffs/release candidate/high level direction.md");
	assert.throws(() => resolveArtifactPath(internal, "handoff", "../plans/escape.md", undefined, NOW), /(escapes|traversal)/);
	assert.throws(() => resolveArtifactPath(internal, "handoff", "..\\outside.md", undefined, NOW), /traversal/);
	assert.throws(() => resolveArtifactPath(internal, "handoff", "C:\\outside.md", undefined, NOW), /relative/);
	assert.throws(() => resolveArtifactPath(internal, "handoff", path.resolve(root, "absolute.md"), undefined, NOW), /relative/);
});

test("artifact creation is exclusive and preserves an existing file byte-for-byte", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const internal = path.join(root, ".internal-dev");
	const fullContent = [
		"# Brainstorm",
		"",
		...REQUIRED_HEADINGS["brainstorm"].flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");

	const options = {
		kind: "brainstorm" as const,
		requestedPath: "renderer redesign/agent one.md",
		title: "Agent one findings",
		content: fullContent,
		now: NOW,
	};
	const created = await createArtifact(internal, options);
	assert.equal(created.relativePath, "brainstorm/renderer redesign/agent one.md");
	await assert.rejects(createArtifact(internal, { ...options, content: fullContent }), /refusing to overwrite/);
	// createArtifact normalizes to one trailing newline.
	assert.equal(await readFile(created.path, "utf8"), `${fullContent.trimEnd()}\n`);
});

test("default paths provide folders for structured artifacts without enforcing supplied names", () => {
	assert.equal(defaultArtifactPath("bug", "GPU timeout", NOW), "gpu-timeout/report.md");
	assert.equal(defaultArtifactPath("plan", "Public API", NOW), "public-api/phase-01-implementation.md");
	assert.equal(defaultArtifactPath("brainstorm", "New renderer", NOW), "new-renderer/findings.md");
	assert.equal(defaultArtifactPath("handoff", "Ship it", NOW), "2026-02-03-ship-it.md");
	assert.equal(defaultArtifactPath("sprint", "Ship it", NOW), "ship-it/manifest.md");
});

// ── Legacy ensureChangelogCommit tests (adapted) ──────────────────────────────

test("templates expose minimum contracts and changelogs always carry Git HEAD", () => {
	const bug = artifactTemplate("bug", "Crash", NOW);
	for (const heading of ["Summary", "Reproduction", "Expected", "Actual", "Next Action"]) {
		assert.match(bug, new RegExp(`## ${heading}`));
	}
	const handoff = artifactTemplate("handoff", "Transfer", NOW);
	assert.match(handoff, /## Settled Decisions/);
	assert.match(handoff, /## Recommended Direction/);
	const brainstorm = artifactTemplate("brainstorm", "Ideas", NOW);
	assert.match(brainstorm, /## Source/);
	assert.match(brainstorm, /## Trade-offs/);
	const sprint = artifactTemplate("sprint", "Delivery", NOW);
	assert.match(sprint, /## Final Validation/);
	assert.match(sprint, /## Outcome/);

	const changelog = artifactTemplate("changelog", "Change", NOW, { isRepository: true, commit: COMMIT });
	assert.match(changelog, /## Git Commit/);
	assert.match(changelog, new RegExp(COMMIT));
	const supplied = ensureChangelogCommit([
		"# Custom",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Change Summary",
		"",
		"Done.",
		"",
		"## Files",
		"",
		"- x",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n"), { isRepository: true, commit: COMMIT });
	assert.match(supplied, /## Git Commit/);
	assert.match(supplied, new RegExp(COMMIT));
	const hashMentionWithoutHeading = ensureChangelogCommit([
		"# Custom",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		`Mentioned ${COMMIT} elsewhere.`,
		"",
		"## Change Summary",
		"",
		"Done.",
		"",
		"## Files",
		"",
		"- x",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n"), { isRepository: true, commit: COMMIT });
	assert.match(hashMentionWithoutHeading, /## Git Commit/);
	const blankCommitSection = ensureChangelogCommit([
		"# Custom",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		"## Git Commit",
		"",
		"",
		"## Files",
		"",
		`Elsewhere: ${COMMIT}`,
		"",
		"## Change Summary",
		"",
		"Done.",
		"",
		"## Behavioral Impact",
		"",
		"none",
		"",
		"## Specification Impact",
		"",
		"none",
		"",
		"## Risks",
		"",
		"none",
		"",
		"## Follow-up Items",
		"",
		"none",
		"",
	].join("\n"), { isRepository: true, commit: COMMIT });
	assert.match(blankCommitSection, new RegExp(`## Git Commit\\n\\n${COMMIT}`));
	assert.throws(() => ensureChangelogCommit("# No HEAD\n", { isRepository: true }), /no readable HEAD commit/);
});

test("created changelog content receives the current commit even when custom content is supplied", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const artifact = await createArtifact(path.join(root, ".internal-dev"), {
		kind: "changelog",
		requestedPath: "custom closeout.md",
		content: [
			"# Closeout",
			"",
			"## Date",
			"",
			"2026-01-01",
			"",
			"## Change Summary",
			"",
			"Implemented.",
			"",
			"## Files",
			"",
			"- x",
			"",
			"## Behavioral Impact",
			"",
			"none",
			"",
			"## Specification Impact",
			"",
			"Specification Impact: none.",
			"",
			"## Risks",
			"",
			"none",
			"",
			"## Follow-up Items",
			"",
			"none",
			"",
		].join("\n"),
		now: NOW,
		git: { isRepository: true, commit: COMMIT },
	});
	const content = await readFile(artifact.path, "utf8");
	assert.match(content, /## Git Commit/);
	assert.match(content, new RegExp(COMMIT));
	// Git Commit must be after Date
	assert.match(content, new RegExp(`## Date\\n\\n2026-01-01\\n\\n## Git Commit\\n\\n${COMMIT}\\n\\n## Change Summary`));
});

// ── An unborn Git repository blocks explicit changelog creation ──────────────

test("createArtifact rejects changelog creation in an unborn Git repository without parent side effects", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW, git: { isRepository: false } });
	const internal = path.join(root, ".internal-dev");
	const parent = path.join(internal, "changelogs", "nested", "unborn");
	await assert.rejects(
		createArtifact(internal, {
			kind: "changelog",
			requestedPath: "nested/unborn/change.md",
			now: NOW,
			git: { isRepository: true },
		}),
		/no readable HEAD commit/,
	);
	await assert.rejects(() => stat(parent), /ENOENT/);
});

// ── Symbolic-link traversal is rejected ───────────────────────────────────────

test("symbolic-link traversal is rejected", async (t) => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const outside = await project();
	const link = path.join(root, ".internal-dev", "handoffs", "external");
	try {
		await symlink(outside, link, "dir");
	} catch (error) {
		t.skip(`symbolic links unavailable: ${String(error)}`);
		return;
	}
	await assert.rejects(
		createArtifact(path.join(root, ".internal-dev"), {
			kind: "handoff",
			requestedPath: "external/escaped.md",
			content: [
				"# Handoff",
				"",
				...REQUIRED_HEADINGS["handoff"].flatMap((h) => [`## ${h}`, "", "x", ""]),
			].join("\n") + "\n",
		}),
		/symbolic link/,
	);
});

test("detection finds the nearest ancestor store and returns undefined when absent", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW });
	const nested = path.join(root, "packages", "one", "src");
	await mkdir(nested, { recursive: true });
	const found = await findInternalDev(nested);
	assert.equal(found?.projectRoot, root);
	assert.equal(found?.internalDevPath, path.join(root, ".internal-dev"));
	assert.equal(await findInternalDev(await project()), undefined);
});

// ── Full table-driven: every ArtifactKind valid template + supplied content ──

test("every ArtifactKind template passes validation and provided content passes validation", async () => {
	const root = await project();
	await scaffoldInternalDev(root, { now: NOW, git: { isRepository: true, commit: COMMIT } });
	const internal = path.join(root, ".internal-dev");

	for (const kind of ARTIFACT_KINDS) {
		// Template creation.
		const tpl = await createArtifact(internal, {
			kind,
			title: `Test ${kind}`,
			now: NOW,
			git: { isRepository: true, commit: COMMIT },
		});
		const tplContent = await readFile(tpl.path, "utf8");
		const tplErrors = validateContent(kind, tplContent, tpl.relativePath);
		assert.deepEqual(tplErrors, [], `${kind} template fails validation: ${JSON.stringify(tplErrors)}`);

		// Full supplied content (simulating user-written artifact).
		const fullContent = [
			`# User-supplied ${kind}`,
			"",
			...REQUIRED_HEADINGS[kind].flatMap((h) => [
				`## ${h}`,
				"",
				kind === "changelog" && h === "Git Commit" ? "" : `Content for ${h}`,
				"",
			]),
		].join("\n") + "\n";

		const supplied = await createArtifact(internal, {
			kind,
			requestedPath: `user-${kind}.md`,
			content: fullContent,
			now: NOW,
			git: { isRepository: true, commit: COMMIT },
		});
		const suppliedContent = await readFile(supplied.path, "utf8");
		// For changelogs, normalize and re-validate.
		if (kind === "changelog") {
			assert.match(suppliedContent, new RegExp(COMMIT));
		}
		const suppliedErrors = validateContent(kind, suppliedContent, supplied.relativePath);
		assert.deepEqual(suppliedErrors, [], `${kind} supplied content fails validation: ${JSON.stringify(suppliedErrors)}`);
	}
});

// ── Table-driven: heading validation edge cases across kinds ──────────────────

test("missing heading rejected for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const headings = REQUIRED_HEADINGS[kind];
		// Drop the first required heading.
		const partial = [
			`# Test ${kind}`,
			"",
			...headings.slice(1).flatMap((h) => [`## ${h}`, "", "x", ""]),
		].join("\n") + "\n";
		const errors = validateContent(kind, partial);
		assert.ok(errors.some((e) => e.category === "missing" && e.heading === headings[0]), `${kind}: should detect missing ${headings[0]}`);
	}
});

test("duplicate heading rejected for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const headings = REQUIRED_HEADINGS[kind];
		// Duplicate the first heading.
		const dup = [
			`# Test ${kind}`,
			"",
			`## ${headings[0]}`,
			"",
			"x",
			"",
			`## ${headings[0]}`,
			"",
			"y",
			"",
			...headings.slice(1).flatMap((h) => [`## ${h}`, "", "x", ""]),
		].join("\n") + "\n";
		const errors = validateContent(kind, dup);
		assert.ok(errors.some((e) => e.category === "duplicate" && e.heading === headings[0]), `${kind}: should detect duplicate ${headings[0]}`);
	}
});

test("out-of-order heading rejected for every kind (swap first two)", () => {
	for (const kind of ARTIFACT_KINDS) {
		const headings = REQUIRED_HEADINGS[kind];
		if (headings.length < 2) continue;
		const swapped = [headings[1], headings[0], ...headings.slice(2)];
		const content = [
			`# Test ${kind}`,
			"",
			...swapped.flatMap((h) => [`## ${h}`, "", "x", ""]),
		].join("\n") + "\n";
		const errors = validateContent(kind, content);
		assert.ok(errors.some((e) => e.category === "out_of_order"), `${kind}: should detect out-of-order`);
	}
});

test("wrong-level heading rejected for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const headings = REQUIRED_HEADINGS[kind];
		// Make the first heading H3 instead of H2.
		const content = [
			`# Test ${kind}`,
			"",
			`### ${headings[0]}`,
			"",
			"x",
			"",
			...headings.slice(1).flatMap((h) => [`## ${h}`, "", "x", ""]),
		].join("\n") + "\n";
		const errors = validateContent(kind, content);
		assert.ok(errors.some((e) => e.category === "wrong_level" && e.heading === headings[0]), `${kind}: should detect wrong-level ${headings[0]}: ${JSON.stringify(errors)}`);
	}
});

test("fenced heading ignored for every kind", () => {
	for (const kind of ARTIFACT_KINDS) {
		const headings = REQUIRED_HEADINGS[kind];
		// The last heading is "fake" inside a fence; first heading is present.
		const content = [
			`# Test ${kind}`,
			"",
			`## ${headings[0]}`,
			"",
			"x",
			"",
			"```",
			`## ${headings[headings.length - 1]}`,
			"```",
			"",
			...headings.slice(1).flatMap((h) => [`## ${h}`, "", "x", ""]),
		].join("\n") + "\n";
		const errors = validateContent(kind, content);
		assert.deepEqual(errors, [], `${kind}: fenced heading should be ignored: ${JSON.stringify(errors)}`);
	}
});

// ── Fake extension lifecycle tests ────────────────────────────────────────────

let extensionModule: Promise<typeof import("../index.ts")> | undefined;
function loadExtension() {
	if (!extensionModule) {
		const stubs: Record<string, string> = {
			"@earendil-works/pi-ai": "export const StringEnum = (values) => values;",
			"@earendil-works/pi-coding-agent": "export const withFileMutationQueue = (_path, operation) => operation();",
			"typebox": "export const Type = new Proxy({}, { get: () => (...args) => ({ args }) });",
		};
		registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier in stubs) return { url: `internal-dev-test:${specifier}`, shortCircuit: true };
				return nextResolve(specifier, context);
			},
			load(url, context, nextLoad) {
				if (url.startsWith("internal-dev-test:")) {
					const specifier = url.slice("internal-dev-test:".length);
					return { format: "module", source: stubs[specifier], shortCircuit: true };
				}
				return nextLoad(url, context);
			},
		});
		extensionModule = import("../index.ts");
	}
	return extensionModule;
}

/** Minimal fake ExtensionAPI / ExtensionContext for lifecycle inspection. */
function fakeExtensionApi() {
	const handlers: Record<string, Array<(...args: any[]) => any>> = {};
	const commands: Record<string, any> = {};
	const tools: Record<string, any> = {};

	return {
		handlers,
		commands,
		tools,
		on(event: string, handler: (...args: any[]) => any) {
			(handlers[event] ??= []).push(handler);
		},
		registerCommand(name: string, def: any) {
			commands[name] = def;
		},
		registerTool(def: any) {
			tools[def.name] = def;
		},
		exec: async (_cmd: string, _args: string[], _opts?: any) => ({ code: 0, stdout: "", stderr: "" }),
	};
}

function fakeContext(overrides: Partial<{
	cwd: string;
	hasUI: boolean;
	isTrusted: boolean;
	mode: string;
	confirm: () => Promise<boolean>;
}> = {}) {
	return {
		cwd: overrides.cwd ?? "/fake/project",
		hasUI: overrides.hasUI ?? true,
		isProjectTrusted: () => overrides.isTrusted ?? true,
		mode: overrides.mode ?? "tui",
		ui: {
			confirm: overrides.confirm ?? (async () => false),
			notify: () => {},
		},
	};
}

test("session_start is absent and startup cannot confirm or mutate any store state", async () => {
	for (const state of ["missing", "partial", "ready", "conflict"] as const) {
		const root = await project();
		if (state === "partial") await mkdir(path.join(root, ".internal-dev"));
		if (state === "ready") await scaffoldInternalDev(root, { now: NOW });
		if (state === "conflict") await writeFile(path.join(root, ".internal-dev"), "collision");
		const before = await inspectInternalDev(root);
		let confirmations = 0;
		const api = fakeExtensionApi();
		const { default: internalDevExtension } = await loadExtension();
		internalDevExtension(api as any);
		assert.equal(api.handlers.session_start, undefined);
		assert.equal(confirmations, 0);
		assert.deepEqual(await inspectInternalDev(root), before);
	}

	const untrustedApi = fakeExtensionApi();
	const { default: internalDevExtension } = await loadExtension();
	internalDevExtension(untrustedApi as any);
	assert.equal(untrustedApi.handlers.session_start, undefined);
});

test("ready, missing, partial, conflict, and untrusted injections are state-appropriate and inert", async () => {
	for (const state of ["missing", "partial", "ready", "conflict"] as const) {
		const root = await project();
		if (state === "partial") await mkdir(path.join(root, ".internal-dev"));
		if (state === "ready") await scaffoldInternalDev(root, { now: NOW });
		if (state === "conflict") await writeFile(path.join(root, ".internal-dev"), "collision");
		const api = fakeExtensionApi();
		const { default: internalDevExtension } = await loadExtension();
		internalDevExtension(api as any);
		const before = await inspectInternalDev(root);
		const result = await api.handlers.before_agent_start[0](
			{ systemPrompt: "base" },
			fakeContext({ cwd: root }),
		);
		assert.match(result.systemPrompt, state === "ready" ? /store is ready/ : /No complete \.internal-dev store/);
		assert.deepEqual(await inspectInternalDev(root), before);
	}

	const root = await project();
	const api = fakeExtensionApi();
	const { default: internalDevExtension } = await loadExtension();
	internalDevExtension(api as any);
	const result = await api.handlers.before_agent_start[0](
		{ systemPrompt: "base" },
		fakeContext({ cwd: root, isTrusted: false }),
	);
	assert.match(result.systemPrompt, /workflow suspended/);
	assert.match(result.systemPrompt, /Do not initialize, read, or follow/);
	assert.equal((await inspectInternalDev(root)).state, "missing");
});

test("explicit initialize and permission-gated create are the only initialization paths", async () => {
	const root = await project();
	let confirmations = 0;
	const api = fakeExtensionApi();
	const { default: internalDevExtension } = await loadExtension();
	internalDevExtension(api as any);
	const approved = fakeContext({
		cwd: root,
		confirm: async () => {
			confirmations++;
			return true;
		},
	});
	await api.tools.internal_dev.execute("call", { action: "initialize" }, undefined, undefined, approved);
	assert.equal(confirmations, 1);
	assert.equal((await inspectInternalDev(root)).state, "ready");

	const declinedRoot = await project();
	const declined = fakeContext({ cwd: declinedRoot, confirm: async () => false });
	await assert.rejects(
		api.tools.internal_dev.execute("call", { action: "create", kind: "review" }, undefined, undefined, declined),
		/user declined/,
	);
	assert.equal((await inspectInternalDev(declinedRoot)).state, "missing");

	const noninteractiveRoot = await project();
	const noninteractive = fakeContext({ cwd: noninteractiveRoot, hasUI: false, mode: "print" });
	await assert.rejects(
		api.tools.internal_dev.execute("call", { action: "initialize" }, undefined, undefined, noninteractive),
		/Cannot ask permission/,
	);
	assert.equal((await inspectInternalDev(noninteractiveRoot)).state, "missing");
});

test("CONTRACT_MISSING does not mention asking user permission", async () => {
	const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
	const contractMissing = source.match(/const CONTRACT_MISSING = `([\s\S]*?)`;/)![1];
	assert.match(contractMissing, /explicitly request initialization/);
	assert.match(contractMissing, /internal-dev init/);
	assert.doesNotMatch(contractMissing, /Ask the user for permission/);
});

test("CONTRACT_UNTRUSTED mentions explicit-only initialization", async () => {
	const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
	const contractUntrusted = source.match(/const CONTRACT_UNTRUSTED = `([\s\S]*?)`;/)![1];
	assert.match(contractUntrusted, /explicit-only/);
	assert.match(contractUntrusted, /never offered at session start/);
});

// ── ROOT_AGENTS_CONTENT parity ────────────────────────────────────────────────

test("ROOT_AGENTS_CONTENT is byte-identical to .internal-dev/AGENTS.md", async () => {
	const diskContent = await readFile(new URL("../../.internal-dev/AGENTS.md", import.meta.url), "utf8");
	assert.equal(diskContent, ROOT_AGENTS_CONTENT, "ROOT_AGENTS_CONTENT must match .internal-dev/AGENTS.md byte-for-byte");
	// Check for explicit init section.
	assert.match(diskContent, /## Initialization/);
	assert.match(diskContent, /explicit user action/);
	assert.match(diskContent, /never triggered automatically at session start/);
	// Check sprint evidence distinction.
	assert.match(diskContent, /Durable execution-only sprint evidence/);
	assert.match(diskContent, /internal-dev stores only the planning artifacts and manifest/);
});

// ── Table-driven: changelog commit insertion and filling ──────────────────────

test("changelog normalization maintains canonical order for every heading", () => {
	const base = [
		"# Changelog",
		"",
		"## Date",
		"",
		"2026-01-01",
		"",
		...REQUIRED_HEADINGS["changelog"].filter((h) => h !== "Date" && h !== "Git Commit").flatMap((h) => [`## ${h}`, "", "x", ""]),
	].join("\n");

	// Without Git Commit: insertion.
	const inserted = ensureChangelogCommit(base, { isRepository: true, commit: COMMIT });
	const insertedErrors = validateContent("changelog", inserted);
	assert.deepEqual(insertedErrors, []);

	// With empty Git Commit section: filling.
	const withEmpty = base.replace("## Change Summary\n", "## Git Commit\n\n\n\n## Change Summary\n");
	const filled = ensureChangelogCommit(withEmpty, { isRepository: true, commit: COMMIT });
	const filledErrors = validateContent("changelog", filled);
	assert.deepEqual(filledErrors, []);
	assert.match(filled, new RegExp(`## Git Commit\\n\\n${COMMIT}\\n\\n## Change Summary`));
});

// ── Concise ready-store injection ─────────────────────────────────────────────

test("injected contract for ready store is concise and points to guides", async () => {
	const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
	const contractPresent = source.match(/const CONTRACT_PRESENT = `([\s\S]*?)`;\n\nconst CONTRACT_MISSING/)![1];
	assert.match(contractPresent, /read .internal-dev\/AGENTS.md and .internal-dev\/specifications\/AGENTS.md/);
	assert.match(contractPresent, /internal_dev tool for exclusive creation/);
	assert.match(contractPresent, /generated guides own routing and workflow details/);
	assert.ok(contractPresent.split("\n").length <= 5, "ready injection should remain concise");
	assert.doesNotMatch(contractPresent, /Route intended contracts|Archive finalized|Finalized code/);
});
