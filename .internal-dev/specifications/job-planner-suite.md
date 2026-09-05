# Interactive Job Planner Suite

## Purpose

Define the installable `job-planner` Pi package: an interactive planning extension that reaches a robust task contract through repository inspection and repeated user questions, plus a `jog` skill that implements the resulting plan collaboratively on the root agent thread.

## Installed Resources

The package manifest loads `job-planner/index.ts` as an extension and `job-planner/skills/jog/SKILL.md` as a skill.

The extension registers:

- `/job [directive]` to start an interactive planning interview;
- `/job status` and `/job cancel` for session-local management;
- `job_ask_choices` for one to three related choice questions with two to five meaningful options and an automatic open-answer route;
- `job_ask_text` for one exceptional nuanced written question; and
- `job_plan_submit` for mandatory red-team validation of a complete candidate and deterministic publication of the single corrected plan only after PASS.

The installed skill is exposed as `/skill:jog` when skill commands are enabled.

## Planning Contract

Job planning runs on the current root agent. It inspects the repository, relevant instructions, intended specifications, tests, and integration boundaries before asking the user for facts. For broader repository inspection it may run read-only exploration teams under the installed exploration skill's fixed contract (`openai-codex/gpt-5.6-luna:high` read-only agents); exploration is context acquisition only. Planning decisions, user questioning, and implementation authority remain on the root thread. It asks the user about intent, authority, trade-offs, compatibility, edge behavior, scope, constraints, and validation until no known consequential ambiguity remains. The number of interview rounds is not capped. At least one user answer is required before the first candidate submission.

Choice questions are preferred for concrete decisions. Open-ended written questions are reserved for required nuance that meaningful choices cannot express. A cancelled question round publishes no partial answers and does not advance interview counts.

Planning mode prohibits implementation and ordinary file-based plan creation. While an interview is active, built-in `edit` and `write` calls are blocked. `job_plan_submit` is the sole plan publication path. It may receive multiple candidate submissions when red-team handoffs require further user decisions, but exactly one submission may successfully publish. Immediately after successful publication, the extension asks whether the user wants to proceed to jogging. Acceptance queues `/skill:jog <published-plan-path>` as a follow-up; declining or cancelling leaves the completed plan ready for later use.

### Mandatory red-team validation

Every complete candidate submitted through `job_plan_submit` is reviewed by one in-memory, read-only child using the active Sprint Planner configuration's `redTeamValidator` assignment (`openai-codex/gpt-6-astra:high`). The Job Planner resolves that exact tuple through the Sprint Planner extension's version-1 agent-assignment event-bus service; missing service, model, authentication, or thinking support blocks publication without substitution.

The validator receives the initial directive, complete structured candidate, recorded interview answers, and any previous handoff's corrected draft, repairs, unresolved issues, and answers collected since that handoff. It may inspect repository evidence with read-only `read`, `grep`, `find`, and `ls` tools, and must review `Feature`, `Required Behavior`, `Targets`, `Constraints`, `Assumptions`, `Settled Decisions`, `Implementation Approach`, `Validation Criteria`, and `Out of Scope` exactly once each. It checks the whole plan for omissions, internal inconsistencies, architectural contradictions, incorrect targets or assumptions, missing edge and failure behavior, incomplete validation, repository-contract conflicts, and scope drift. On every resubmission it must reconcile each prior issue exactly once against recorded user-answer evidence and restore dropped repairs unless later user authority supersedes them.

The validator acts in best faith to minimize further questions. It directly corrects every issue whose solution follows safely from the directive, repository evidence, settled decisions, or an unambiguous consistency repair, then rereads the corrected plan before returning PASS. It may not invent product decisions, broaden scope, or silently choose among materially different outcomes.

A heavy contradiction, missing authority, or insufficient context that prevents a safe fix produces a typed `needs-user` handoff containing the preserved corrected draft, all inferable repairs with explanations, and each unresolved issue's stable id, section, summary, reason user authority is required, proposed question, and complete choice labels plus descriptions. No artifact is published. The root planning agent must ask at least one additional question through `job_ask_choices` or `job_ask_text`, incorporate every answer and preserved repair, and resubmit the complete revised plan. This validation/question loop repeats without a fixed round cap until the validator returns PASS. Provider failure, malformed output, cancellation, or an unresolved handoff never degrades into publication.

## Plan Artifact

The extension publishes exactly one Markdown plan at `.internal-dev/plans/<job-id>/plan.md` beneath the nearest ready project store. Publication reserves a unique direct child and never overwrites an existing artifact.

Every plan contains:

- `Feature`;
- `Required Behavior`;
- `Targets`;
- `Constraints`;
- `Assumptions`;
- `Settled Decisions`;
- `Implementation Approach`;
- `Validation Criteria`;
- `Out of Scope`; and
- `Planning Record` confirming interview coverage, red-team PASS, exact validator tuple, validation-attempt count, inferable-repair count, validation timestamp, and no remaining consequential open questions.

The job plan is intentionally simpler than Sprint Planner's advanced-plan directory. It has no concepts file, orchestration ledger, phase files, execution waves, per-phase model assignments, background state machine, or execution record. Its mandatory whole-plan red-team review is an in-memory pre-publication gate rather than a persisted advanced-plan review artifact.

## Session State

The extension persists version-2 planning snapshots as Pi custom session entries. Choice evidence records the exact rendered option meaning, including its description, and resolves selections by exact rendered identity rather than label prefixes. Snapshots include structured question-and-answer evidence, validation-attempt count and, when validation requires user authority, the preserved corrected draft, cumulative repairs, exact validator tuple, unresolved issue handoff, question count, and answer-evidence index at handoff. Reloading or resuming reconstructs active, completed, cancelled, or blocked state and restores the planning status indicator. A malformed active snapshot or legacy active version fails closed as blocked until `/job cancel`; terminal version-1 snapshots remain readable. Restoration never automatically triggers provider work; the root resumes a valid pending user-question loop explicitly.

## Jog Contract

Jog consumes one completed job plan whose Planning Record contains a red-team PASS. It keeps repository inspection decisions, user questions, plan amendments, validation, closeout, and completion ownership on the root agent thread. It does not use Sprint Planner workflows, sprint tools, or advanced-plan conversion. Delegated implementation review happens only through the mandatory luna domain validation loop and the fixed sol:medium final review pass; the root owns every verdict.

Jog permits two delegated implementation aids under fixed contracts, in addition to its mandatory validators and senior debugging path:

- **Exploration teams.** For broad repository surveys, jog follows the installed exploration skill: read-only `openai-codex/gpt-5.6-luna:high` agents with an exact `["read", "bash"]` allowlist. Exploration never edits and never replaces direct reading of critical code before edits.
- **Large single-domain edits.** After the targets are identified and the approach for that domain is ironed out with the user, jog may dispatch one subagent per coherent domain edit. Spawns resolve exact tuples from the loaded sprint-planner agent configuration: the `basicImplementer` assignment for light basic work, document editing, and well-defined simple-logic edits; the `advancedImplementer` assignment for anything relatively complicated or important. Children receive exact edit-capable tool allowlists and never user-questioning, subagent, or sprint tools; they return escalation requests for the root to put to the user. While a child works one domain, the root continues planning other aspects and collaborating with the user.

Delegated review is mandatory and bounded:

- **Luna domain validation loop.** Every completed implementation domain passes a read-only validator review before the next domain starts. The validator tuple resolves from the loaded sprint-planner agent configuration exactly like the implementer tuples: the `lunaXhigh` profile (currently `openai-codex` / `gpt-5.6-luna` / thinking `xhigh`). Verdicts are PASS or BLOCKED; the root reviews every finding, repairs in-scope defects itself, and runs confirmation passes with the same tuple until PASS. A BLOCKED finding that resists root repair is escalated through the senior-agent skill.
- **Final sol:medium review pass.** After every domain holds a PASS verdict and the root-run validation gate is complete, one final fresh-eyes review of the complete job runs at the fixed contract `openai-codex` / `gpt-5.6-sol` / thinking `medium` (read-only, never substituted) before the completion report. Its verdict and BLOCKED handling mirror the luna loop.

Jog treats the accepted plan as its implementation contract. It asks the user collaboratively when implementation reveals a consequential choice, contradicted assumption, unclear scope authority, irreversible action, or multiple materially different valid outcomes. It resolves discoverable facts from the repository rather than asking the user. Explicit user decisions during jogging may amend the plan; the root summarizes and records that amendment before implementing it.

Every completed plan phase is a distinct Git checkpoint. After the phase's focused checks and luna validation pass, jog stages only phase-owned changes, reviews the staged diff, and creates one phase-identifying commit before starting the next phase. Explicit plan phases define the boundaries; otherwise each coherent implementation domain is a phase. Jog preserves unrelated worktree changes, blocks progression when a phase cannot be committed safely, uses an empty commit for a legitimate no-diff phase, never rewrites or combines completed phase commits, commits later repairs or closeout changes separately, and reports the resulting full commit hashes.

A governing senior-escalation policy may require narrowly scoped expert work after a concrete failed attempt or genuine blocker. The senior may be advisory or edit-authorized under that policy; the root integrates the result and retains validation, user interaction, and completion ownership.

Jog validates every stated criterion itself, reviews every delegated diff, runs focused edge and failure checks plus applicable broader checks, reviews the final diff, and completes repository closeout records. A child self-report is evidence, not completion. Jog never claims completion with an unmet criterion or unresolved blocker.

## Security and Trust

Planning requires an interactive UI, a trusted project, a ready `.internal-dev/plans/` store, the Sprint Planner agent-assignment service, and availability plus authentication for the exact configured `redTeamValidator` tuple. Validator children are in-memory and read-only. A non-swallowing wrapper around the child agent's provider stream rejects cancellation or any provider, model, or thinking-level drift immediately before every provider request, including after asynchronous prompt preflight. Validation operations are tracked from startup through extension shutdown and disposal; every bound child extension runtime receives its graceful `session_shutdown`, and root shutdown aborts then settles active and starting operations. The submission operation remains active through publication; cancellation is checked before and after asynchronous publication boundaries, removes only identity- and content-verified owned output, removes a reservation only when it remains empty, preserves foreign entries, and may not overwrite a cancelled or replacement workflow state. Store discovery rejects a non-directory or symbolic-link `.internal-dev` or plans path. User-supplied artifact paths are not used for publication; ids are generated from a bounded safe slug and collision-resistant timestamp/suffix allocation.

## Validation

The package test suite covers question validation and cancellation, plan normalization, complete mandatory validation-record rendering, cancellation-aware nearest-store publication, no-overwrite allocation, red-team exhaustive section coverage, verdict consistency, prior-handoff reconciliation, best-faith repair guidance, configured model resolution, malformed-restoration blocking, answer-evidence propagation, unresolved-handoff re-entry, cancellation during publication, publication only after PASS, package resource declarations, and the jog delegation contract (root ownership, exploration teams, delegated domain-edit gate, the config-resolved implementer policy, the luna domain loop, per-phase Git commits, and the fixed sol:medium final pass). Sprint Planner tests cover the versioned agent-assignment event-bus service. Pi RPC `get_commands` must resolve `/job` to the extension and `skill:jog` to the packaged skill path. Loading both required packages must register their resources without extension errors.
