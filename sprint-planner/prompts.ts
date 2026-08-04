import type { BrainstormRole, ModelTuple, RetryFeedback } from "./types.ts";

function formatModelTuple(m: ModelTuple): string {
	return `${m.provider}/${m.model}:${m.thinking}`;
}

const SUBMIT = "Do not put the artifact only in chat. Submit it through the typed sprint_submit tool exactly once when complete.";
const INTERPRET_INPUT = "Treat the authoritative input as a user prompt, not as preprocessed file content. It may contain pasted material, one or more project-relative paths, or natural-language instructions around paths. Decide what it means and use your read-only project tools to inspect referenced files or directories when useful.";
const COMPLETE_PRODUCTION_SCOPE = "Cover the full requested user scope. Do not propose or accept mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as satisfying the request; when sequencing work, make every required behavior feature-complete and production-ready by the end of the plan or handoff.";

export const BRAINSTORM_LIFECYCLE_REQUIREMENT =
	"Every worker must submit findings, then continue in the same session to review every other worker report; synthesis must not start until every findings.md and cross-review.md exists. The cross-review round is unconditional and must never be skipped.";

export const BRAINSTORM_TOOL_DESCRIPTION =
	`Run the engine-owned standalone brainstorm lifecycle. ${BRAINSTORM_LIFECYCLE_REQUIREMENT} Use this agent-callable workflow instead of manually spawning brainstorm subagents.`;

export const BRAINSTORM_TOOL_GUIDELINES = [
	"Use sprint_brainstorm instead of subagent_spawn when the user asks the agent to run the sprint-planner brainstorm workflow.",
	"Never synthesize sprint-planner brainstorm findings without every original worker completing the same-session all-to-all cross-review; sprint_brainstorm enforces this barrier.",
] as const;

export function routeRolesPrompt(directive: string, count: number): string {
	return `You route a brainstorming task into complementary broad lenses. Do not solve the task and do not create narrow nit-picking roles.

${INTERPRET_INPUT}

Return exactly ${count} roles as JSON: {"roles":[{"id":"safe-slug","name":"...","lens":"..."}]}. Cover useful combinations of architecture, scope, constraints, risks, project alignment, implementation approaches, and domain research according to the directive. Roles must remain broad idea-generating lenses and must not duplicate each other.

<directive>
${directive}
</directive>

${SUBMIT}`;
}

export function brainstormPrompt(directive: string, role: BrainstormRole): string {
	return `You are the ${role.name} brainstorming worker. Explore approaches, ideas, features, targets, and their scope through this lens: ${role.lens}. Stay exploratory; do not implement or edit the project.

${INTERPRET_INPUT}

Brainstorm for feature completeness and production quality. ${COMPLETE_PRODUCTION_SCOPE}

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

<directive>
${directive}
</directive>

${SUBMIT}`;
}

export function crossReviewPrompt(ownRole: BrainstormRole, otherReports: readonly { path: string; content: string }[]): string {
	return `Continue in the same child session that produced ${ownRole.name}'s findings. Review every other required report below. Compare useful ideas, conflicts, omissions, feasibility, and trade-offs; preserve your broad lens without merely defending your first answer. Do not edit the project.

Check whether the combined ideas preserve feature completeness and production quality. ${COMPLETE_PRODUCTION_SCOPE}

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

${otherReports.map((report) => `<report path="${report.path}">\n${report.content}\n</report>`).join("\n\n")}

${SUBMIT}`;
}

export function synthesisPrompt(directive: string, reports: readonly { path: string; content: string }[]): string {
	const reportPaths = reports.map((report) => `- ${report.path}`).join("\n");
	return `Synthesize the complete brainstorming effort into a concise best-of-class direction. Select the strongest approach for each facet, reconcile conflicts, and contribute a better idea only where it improves the result. This is still a brainstorming synthesis, not an accepted implementation plan. Do not edit the project.

Prioritize feature completeness and production quality. ${COMPLETE_PRODUCTION_SCOPE}

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step. Under Source, list every supplied report path verbatim as one literal Markdown list item per path so structural coverage can be validated. The exact required Source entries are:

${reportPaths}

<directive>${directive}</directive>
${reports.map((report) => `<report path="${report.path}">\n${report.content}\n</report>`).join("\n\n")}

${SUBMIT}`;
}

export function redTeamPrompt(synthesis: string): string {
	return `Red-team only the synthesis supplied below. You have intentionally not received raw worker reports. Identify overlooked issues, hidden constraints, likely defects, failure modes, invalid assumptions, production-quality gaps, incomplete scope coverage, and any reliance on mocks, stubs, placeholders, deferred work, partial implementations, or shortcuts without reconstructing or asking for the raw reports. Do not edit the project.

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

<authoritative-synthesis>
${synthesis}
</authoritative-synthesis>

${SUBMIT}`;
}

export function ironoutPrompt(input: string, supplementary: readonly { path: string; content: string }[], interactive: boolean, reportPaths?: readonly string[]): string {
	const reportRefs = reportPaths?.length
		? `\n<retained-report-paths>\n${reportPaths.map((p) => `- ${p}`).join("\n")}\n</retained-report-paths>`
		: supplementary.length
			? `\n<supplementary-raw-reports>\n${supplementary.map((item) => `<report path="${item.path}">\n${item.content}\n</report>`).join("\n")}\n</supplementary-raw-reports>`
			: "";
	return `Turn the authoritative input into a robust high-level handoff. Settle targets, features, expected behavior, constraints, scope, assumptions, direction, and validation criteria. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Do not produce detailed implementation phases and do not edit the project.

${INTERPRET_INPUT}

${COMPLETE_PRODUCTION_SCOPE}

${interactive ? "This is an interactive standalone run. You may use sprint_ask_questions for genuine missing user intent, at most three rounds with at most three questions per round. Inspect available project context first and do not ask discoverable questions." : "This run is autonomous. Do not ask the user questions; make explicit, conservative assumptions where required."}

The handoff must contain these level-two headings: Context, Objective, Targets, Features, Settled Decisions, Constraints, Scope, Assumptions, Recommended Direction, Validation, Open Questions, Sign-off.

<authoritative-input>
${input}
</authoritative-input>
${reportRefs}

${SUBMIT}`;
}

export function ironoutReviewPrompt(handoff: string): string {
	return `Perform one corrective high review of this handoff. Enforce complete production scope: the corrected handoff must cover the full requested user scope and must not accept mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as satisfying the request. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Return two files in one typed submission: review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups; and handoff.md containing the complete corrected handoff, even if the original was already sound. The corrected handoff must retain all required headings and end with an explicit sign-off. Do not edit the project and do not return a patch.

<handoff>
${handoff}
</handoff>

${SUBMIT}`;
}

export function advancedPlanPrompt(handoff: string, implementationModel: ModelTuple, validationModel: ModelTuple): string {
	return `Convert the handoff into a detailed phased implementation plan that amortizes senior reasoning for implementation workers. Do not edit the project. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Technical machine semantics such as timeout, TTL, retry, backoff, polling, cache, retention, lease, and complexity notation remain valid.

${INTERPRET_INPUT}

${COMPLETE_PRODUCTION_SCOPE} Every phase and subphase must drive toward complete, production-quality behavior; do not plan scaffolding, mock-only paths, fake integrations, TODO placeholders, deferred acceptance criteria, or partial feature slices as acceptable endpoints.

## Scope Classification

Classify the work as **small** (tight, focused feature or fix), **medium** (multi-file feature with moderate cross-cutting), or **large** (broad system change, migration, or multi-package work). This determines the phase budget:

- Small: 2–3 phases
- Medium: 3–5 phases
- Large: 6–10 phases
- Extra-large: 11–20 phases

## Phase Design

A phase is the atomic validation and dependency unit, not necessarily one implementation session. Group cohesive edits by target, domain, or vertical behavior — do not create one phase per bullet or aspect. Each unsplit phase must be a coherent, self-contained unit an implementer can own end-to-end and should reasonably fit within one agent session, using a practical assumed maximum of roughly 200,000–300,000 tokens. Use planning judgment only; do not perform or print a formal token estimate.

Prefer lettered subphases whenever a cohesive phase is likely to exceed one implementation agent's context, needs too many files/details for one focused session, or would force an implementer to re-derive later work after a long edit chain. Divide the Implementation Steps into contiguous lettered subphases (A, B, C, and so on). Each subphase maps to its own separate sequential DeepSeek implementation agent session — do NOT write boilerplate claiming all subphases are one agent or one unit. Make each subphase a granular, ordered unit of work that should itself fit within one agent session under the same practical assumption. Keep the parent phase as the validation unit: phase validation happens only after every lettered subphase is complete, with no independent validation gate between subphases. The phase must explicitly instruct the implementer that each subphase is a separate agent session executed in letter order before the shared phase validator runs.

Every phase must declare exact files in scope, ordered edits an implementer can follow without re-deriving architecture, invariants to preserve, edge cases to handle, and concise code or pseudocode examples only where they materially reduce ambiguity. Do not bloat context with obvious details.

## Output

Submit one flat files collection containing exactly:

- \`concepts.md\` — shared architecture, approach, features, constraints, cross-phase guidance, and final validation criteria.
- \`orchestration.md\` — scope-size declaration, phase ledger with dependencies, execution waves, model assignments, and post-phase review-repair PASS gate.
- \`phase-NN-slug.md\` — one file per phase, contiguously numbered from 01.

Submit 4–22 files total (1 concepts + 1 orchestration + 2–20 phases). No nested files and no review inside the plan.

## concepts.md Headings

Use these level-two headings: Architecture, Conceptual Approach, Features, Constraints, Assumptions, Cross-phase Guidance, Final Validation Criteria.

## orchestration.md Headings

Use these level-two headings: Scope Size, Phase Ledger, Execution Waves, Model Assignments, Validation Gate, Final Integration.

Use the headings and machine-readable lines below literally. Do not add prose or other list items inside these six sections.

- **Scope Size**: exactly one \`**Size**: small\`, \`**Size**: medium\`, \`**Size**: large\`, or \`**Size**: extra-large\` line.
- **Phase Ledger**: exactly one line per phase, in phase order: \`- phase-NN-slug.md | depends: none | targets: path/to/file, other/path | goal: concise goal\`. Replace \`none\` with comma-separated phase filenames when needed. Targets are canonical project-relative write paths without backticks.
- **Execution Waves**: contiguous lines such as \`- wave-01: phase-01-slug.md\` or \`- wave-02: phase-02-a.md, phase-03-b.md\`. List every phase exactly once. A dependency must be in an earlier wave; phases sharing a wave must have non-overlapping targets and no shared mutable state.
- **Model Assignments**: exactly these three lines: \`- Implementation: ${formatModelTuple(implementationModel)}\`; \`- Validation: ${formatModelTuple(validationModel)}\`; \`- Implementers: exactly one implementation agent per unsplit phase, or one sequential agent per lettered subphase for split phases\`.
- **Validation Gate**: exactly these two lines: \`- Gate: post-phase validator review-and-repair must PASS before a phase is complete.\` and \`- Dependencies: no dependent phase starts before every dependency has PASS.\`
- **Final Integration**: exactly \`- Integration: after all phases PASS, run final integration validation with ${formatModelTuple(validationModel)}.\`

## Phase Headings

Each phase must contain level-two headings: Context, Goal, In Scope, Out of Scope, Dependencies, Constraints, Implementation Steps, Required Guides, Technical Guidance, Validation, Exit Criteria.

The Implementation Steps must be ordered and specific enough for an implementer to follow without re-deriving architecture. Include exact file paths, required edits, invariants, and edge cases. The Required Guides section must name only guides the implementer actually needs.

You may use sprint_consult_senior at most twice, only for genuinely advanced or blocked areas. The senior adviser is advisory; you remain responsible for a complete coherent plan.

<authoritative-handoff>
${handoff}
</authoritative-handoff>

${SUBMIT}`;
}

export function advancedConceptReviewPrompt(handoff: string, concepts: { path: string; content: string }, phasePaths: readonly string[]): string {
	return `Correctively review the shared advanced-plan concepts at high. Check architecture, cross-phase guidance, constraints, and final validation against the handoff. Enforce full production scope: concepts must not accept mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as satisfying the request. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Submit exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus the complete corrected concepts.md. Do not return a patch, edit the project, or change the phase file set: ${phasePaths.join(", ")}.

<authoritative-handoff>
${handoff}
</authoritative-handoff>
<file path="${concepts.path}">
${concepts.content}
</file>

${SUBMIT}`;
}

export function advancedOrchestrationReviewPrompt(handoff: string, concepts: { path: string; content: string }, orchestration: { path: string; content: string }, phasePaths: readonly string[], implementationModel: ModelTuple, validationModel: ModelTuple): string {
	return `Correctively review the advanced-plan orchestration at high. Verify scope-size classification, phase budget, dependency ordering, wave scheduling, model assignments, practical one-session phase sizing, and the review-repair PASS gate against the handoff and corrected concepts. Enforce full production scope: the phase graph must cover the complete requested user scope and must not use mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as acceptance endpoints. Use planning judgment rather than a formal token calculation: each unsplit phase or lettered subphase should reasonably fit within one agent session under an assumed maximum of roughly 200,000–300,000 tokens; a cohesive phase likely to exceed one implementation agent's context, file/detail load, or focused edit chain should use granular lettered subphases A, B, C, and so on, with phase validation only after every subphase completes. The implementation model is ${formatModelTuple(implementationModel)} with exactly one implementer per unsplit phase (or one sequential agent per lettered subphase for split phases); the validation model is ${formatModelTuple(validationModel)} for the mandatory post-phase review-repair PASS gate. No dependent phase starts before its dependencies pass. You may not add, remove, split, or merge phases; the phase set is fixed: ${phasePaths.join(", ")}. Use the planner's exact machine-readable Phase Ledger, Execution Waves, Model Assignments, Validation Gate, and Final Integration line formats without extra prose in those sections. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Technical machine timeout/TTL/retry/backoff/polling/cache/retention/lease semantics and complexity notation remain valid. Submit exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus the complete corrected orchestration.md. Do not return a patch and do not edit the project.

<authoritative-handoff>
${handoff}
</authoritative-handoff>
<file path="${concepts.path}">
${concepts.content}
</file>
<file path="${orchestration.path}">
${orchestration.content}
</file>

${SUBMIT}`;
}

export function advancedPhaseReviewPrompt(concepts: { path: string; content: string }, orchestration: { path: string; content: string }, phase: { path: string; content: string }, phasePaths: readonly string[]): string {
	return `Correctively review exactly one advanced-plan phase at high. Check its scope, dependencies, one-agent executability, schedule consistency with the orchestration, implementation guidance, validation, and exit criteria against the corrected shared concepts. Enforce full production scope: the phase must implement its assigned behavior completely and must not treat mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as acceptable exit criteria. Using practical planning judgment rather than a formal token calculation, ensure each unsplit phase should reasonably fit within one agent session under an assumed maximum of roughly 200,000–300,000 tokens. If the phase is likely to exceed one implementation agent's context, file/detail load, or focused edit chain, organize its Implementation Steps into granular contiguous lettered subphases A, B, C, and so on — each subphase gets its own sequential DeepSeek implementation agent. Require all subphases to complete in order before the phase-level validation and exit criteria apply, without intermediate independent validation gates. Do NOT write boilerplate claiming all subphases are one agent or one implementation unit; instead explicitly state that each lettered subphase maps to one sequential agent session. The complete corrected phase must preserve or correct its exact ordered edit steps, invariants, and edge cases, while retaining only necessary concise code or pseudocode examples that materially reduce ambiguity. Preserve detailed head-down implementation guidance without context bloat, obvious background, repetition, or speculative detail. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Submit exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus a complete corrected ${phase.path}. Do not return a patch, edit any other phase, or change the plan file set: ${phasePaths.join(", ")}.

## Metadata Alignment (mandatory)

The corrected orchestration.md already defines the canonical metadata for every phase in its Phase Ledger. You MUST copy these three fields from the ledger entry for ${phase.path} into your corrected phase file verbatim:

1. **Goal**: The first non-blank line under \`## Goal\` must be the exact goal text from the ledger's \`goal:\` field for this phase. Do not rephrase, expand, or summarize it.
2. **Dependencies**: The \`## Dependencies\` section must contain exactly one non-blank, non-code line: either \`none\` or the comma-separated phase filenames listed in the ledger's \`depends:\` field.
3. **Write Targets**: The \`## In Scope\` section must contain exactly one \`**Write Targets**:\` line whose comma-separated paths match the ledger's \`targets:\` field in canonical order.

If the ledger goal is genuinely wrong for this phase, note the discrepancy in your review.md Recommendations and still copy the ledger goal verbatim — the orchestration review must be re-run first to change ledger goals. Never let the phase goal and ledger goal diverge.

<file path="${concepts.path}">
${concepts.content}
</file>
<file path="${orchestration.path}">
${orchestration.content}
</file>
<file path="${phase.path}">
${phase.content}
</file>

${SUBMIT}`;
}

export function retryPrompt(feedback: RetryFeedback, attempt: number): string {
	return `Attempt ${attempt}: the previous attempt failed with a ${feedback.category} error: ${feedback.message} Correct this specific failure and resubmit the complete artifact.`;
}

export function advancedDecompositionReviewPrompt(handoff: string, planFiles: readonly { path: string; content: string }[]): string {
	const phasePaths = planFiles.filter((f) => f.path !== "concepts.md" && f.path !== "orchestration.md").map((f) => f.path);
	return `Perform one high decomposition correction review of this advanced plan draft before the phase set freezes. You may add, remove, split, merge, or rename phases to improve one-agent executability, eliminate unnecessary coupling, reduce context bloat, or merge trivial phases — as long as the total phase count stays within the declared scope budget, every phase remains a cohesive implementable unit, and the corrected phase set covers the complete requested user scope. Do not approve mocks, stubs, placeholders, deferred work, partial implementations, bare-minimum shortcuts, or non-production-quality paths as acceptable plan endpoints. Use practical planning judgment rather than a formal token calculation: each unsplit phase or lettered subphase should reasonably fit within one agent session under an assumed maximum of roughly 200,000–300,000 tokens. If cohesive work would otherwise produce a phase likely to exceed one implementation agent's context, file/detail load, or focused edit chain, organize it into granular contiguous lettered subphases A, B, C, and so on — each lettered subphase maps to its own sequential DeepSeek implementation agent. Validation happens only after all of its subphases complete, never between them. Do NOT write boilerplate claiming all subphases are one agent or one implementation unit; the phase must explicitly say subphases are separate sequential agent sessions. Adjust goals, dependencies, targets, and wave assignments accordingly across the corrected plan. You may NOT change model routes, the flat plan layout, ownership boundaries, the no-replace publication semantics, or the review-and-repair PASS gate. Do not include time estimates, duration, effort, ETA, or calendar scheduling language. Plans and handoffs describe what to do, not how long it takes. Technical machine timeout, TTL, retry, backoff, polling, cache, retention, lease, and complexity notation remain valid. Return exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups plus the complete corrected file set: concepts.md, orchestration.md, and every phase file. Do not return a patch and do not edit the project.

Current phase set: ${phasePaths.join(", ")}

<authoritative-handoff>
${handoff}
</authoritative-handoff>

${planFiles.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join("\n\n")}

${SUBMIT}`;
}

