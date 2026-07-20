import type { BrainstormRole } from "./types.ts";

const SUBMIT = "Do not put the artifact only in chat. Submit it through the typed sprint_submit tool exactly once when complete.";
const INTERPRET_INPUT = "Treat the authoritative input as a user prompt, not as preprocessed file content. It may contain pasted material, one or more project-relative paths, or natural-language instructions around paths. Decide what it means and use your read-only project tools to inspect referenced files or directories when useful.";

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

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

<directive>
${directive}
</directive>

${SUBMIT}`;
}

export function crossReviewPrompt(ownRole: BrainstormRole, otherReports: readonly { path: string; content: string }[]): string {
	return `Continue in the same child session that produced ${ownRole.name}'s findings. Review every other required report below. Compare useful ideas, conflicts, omissions, feasibility, and trade-offs; preserve your broad lens without merely defending your first answer. Do not edit the project.

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

${otherReports.map((report) => `<report path="${report.path}">\n${report.content}\n</report>`).join("\n\n")}

${SUBMIT}`;
}

export function synthesisPrompt(directive: string, reports: readonly { path: string; content: string }[]): string {
	return `Synthesize the complete brainstorming effort into a concise best-of-class direction. Select the strongest approach for each facet, reconcile conflicts, and contribute a better idea only where it improves the result. This is still a brainstorming synthesis, not an accepted implementation plan. Do not edit the project.

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step. Under Source, list every supplied report path verbatim so structural coverage can be validated.

<directive>${directive}</directive>
${reports.map((report) => `<report path="${report.path}">\n${report.content}\n</report>`).join("\n\n")}

${SUBMIT}`;
}

export function redTeamPrompt(synthesis: string): string {
	return `Red-team only the synthesis supplied below. You have intentionally not received raw worker reports. Identify overlooked issues, hidden constraints, likely defects, failure modes, and invalid assumptions without reconstructing or asking for the raw reports. Do not edit the project.

Your Markdown must contain these level-two headings: Prompt, Source, Findings, Options, Trade-offs, Open Questions, Recommended Next Step.

<authoritative-synthesis>
${synthesis}
</authoritative-synthesis>

${SUBMIT}`;
}

export function ironoutPrompt(input: string, supplementary: readonly { path: string; content: string }[], interactive: boolean): string {
	return `Turn the authoritative input into a robust high-level handoff. Settle targets, features, expected behavior, constraints, scope, assumptions, direction, and validation criteria. Do not produce detailed implementation phases and do not edit the project.

${INTERPRET_INPUT}

${interactive ? "This is an interactive standalone run. You may use sprint_ask_questions for genuine missing user intent, at most three rounds with at most three questions per round. Inspect available project context first and do not ask discoverable questions." : "This run is autonomous. Do not ask the user questions; make explicit, conservative assumptions where required."}

The handoff must contain these level-two headings: Context, Objective, Targets, Features, Settled Decisions, Constraints, Scope, Assumptions, Recommended Direction, Validation, Open Questions, Sign-off.

<authoritative-input>
${input}
</authoritative-input>
${supplementary.length ? `\n<supplementary-raw-reports>\n${supplementary.map((item) => `<report path="${item.path}">\n${item.content}\n</report>`).join("\n")}\n</supplementary-raw-reports>` : ""}

${SUBMIT}`;
}

export function ironoutReviewPrompt(handoff: string): string {
	return `Perform one corrective xhigh review of this handoff. Return two files in one typed submission: review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups; and handoff.md containing the complete corrected handoff, even if the original was already sound. The corrected handoff must retain all required headings and end with an explicit sign-off. Do not edit the project and do not return a patch.

<handoff>
${handoff}
</handoff>

${SUBMIT}`;
}

export function advancedPlanPrompt(handoff: string): string {
	return `Convert the handoff into a detailed phased implementation plan that amortizes senior reasoning for implementation workers. Do not edit the project.

${INTERPRET_INPUT}

Submit one flat files collection containing exactly concepts.md and one or more phase-NN-safe-slug.md files. No nested files and no review inside the plan.

concepts.md must contain level-two headings: Architecture, Conceptual Approach, Features, Constraints, Assumptions, Cross-phase Guidance, Final Validation Criteria.

Each phase must contain level-two headings: Context, Goal, In Scope, Out of Scope, Dependencies, Constraints, Implementation Steps, Required Guides, Technical Guidance, Validation, Exit Criteria. Include concrete technical examples only where advanced logic needs direct explanation. The Required Guides section must name only guides the implementer actually needs.

You may use sprint_consult_senior at most twice, only for genuinely advanced or blocked areas. The senior adviser is advisory; you remain responsible for a complete coherent plan.

<authoritative-handoff>
${handoff}
</authoritative-handoff>

${SUBMIT}`;
}

export function advancedConceptReviewPrompt(handoff: string, concepts: { path: string; content: string }, phasePaths: readonly string[]): string {
	return `Correctively review the shared advanced-plan concepts at xhigh. Check architecture, cross-phase guidance, constraints, and final validation against the handoff. Submit exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus the complete corrected concepts.md. Do not return a patch, edit the project, or change the phase file set: ${phasePaths.join(", ")}.

<authoritative-handoff>
${handoff}
</authoritative-handoff>
<file path="${concepts.path}">
${concepts.content}
</file>

${SUBMIT}`;
}

export function advancedPhaseReviewPrompt(concepts: { path: string; content: string }, phase: { path: string; content: string }, phasePaths: readonly string[]): string {
	return `Correctively review exactly one advanced-plan phase at xhigh. Check its scope, dependencies, implementation guidance, validation, and exit criteria against the corrected shared concepts. Submit exactly review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus a complete corrected ${phase.path}. Do not return a patch, edit any other phase, or change the plan file set: ${phasePaths.join(", ")}.

<file path="${concepts.path}">
${concepts.content}
</file>
<file path="${phase.path}">
${phase.content}
</file>

${SUBMIT}`;
}

export function advancedReviewPrompt(files: readonly { path: string; content: string }[]): string {
	return `Correctively review this advanced plan for completeness, phase boundaries, dependencies, technical guidance, validation, and implementer usability. Submit a complete replacement files collection containing review.md with level-two headings Scope, Findings, Risk Assessment, Recommendations, Follow-ups, plus the corrected concepts.md and corrected phase files. You may add, remove, split, or merge phases when correction genuinely requires it, but keep numbering contiguous. Do not return a patch and do not edit the project.

${files.map((file) => `<file path="${file.path}">\n${file.content}\n</file>`).join("\n\n")}

${SUBMIT}`;
}

