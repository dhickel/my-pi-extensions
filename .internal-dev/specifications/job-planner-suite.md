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
- `job_plan_submit` for deterministic publication of one completed plan.

The installed skill is exposed as `/skill:jog` when skill commands are enabled.

## Planning Contract

Job planning runs on the current root agent. It inspects the repository, relevant instructions, intended specifications, tests, and integration boundaries before asking the user for facts. For broader repository inspection it may run read-only exploration teams under the installed exploration skill's fixed contract (`deepseek/deepseek-v4-flash:max` read-only agents); exploration is context acquisition only, and planning decisions, questioning, and implementation are never delegated. It asks the user about intent, authority, trade-offs, compatibility, edge behavior, scope, constraints, and validation until no consequential ambiguity remains. The number of interview rounds is not capped. At least one user answer is required before publication.

Choice questions are preferred for concrete decisions. Open-ended written questions are reserved for required nuance that meaningful choices cannot express. A cancelled question round publishes no partial answers and does not advance interview counts.

Planning mode prohibits implementation and ordinary file-based plan creation. While an interview is active, built-in `edit` and `write` calls are blocked. `job_plan_submit` is the sole plan publication path and may be called exactly once for a completed interview. Immediately after successful publication, the extension asks whether the user wants to proceed to jogging. Acceptance queues `/skill:jog <published-plan-path>` as a follow-up; declining or cancelling leaves the completed plan ready for later use.

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
- `Planning Record` confirming interview coverage and no remaining consequential open questions.

The job plan is intentionally simpler than Sprint Planner's advanced-plan directory. It has no concepts file, orchestration ledger, phase files, execution waves, model assignments, corrective model reviews, background state machine, or execution record.

## Session State

The extension persists version-1 planning snapshots as Pi custom session entries. Reloading or resuming reconstructs active, completed, or cancelled state and restores the planning status indicator. It does not automatically trigger provider work after restoration.

## Jog Contract

Jog consumes one completed job plan and keeps repository inspection decisions, user questions, plan amendments, validation, closeout, and completion ownership on the root agent thread. It does not use Sprint Planner workflows, sprint tools, delegated validators, or advanced-plan conversion.

Jog has exactly two delegated capabilities, each under a fixed contract:

- **Exploration teams.** For broad repository surveys, jog follows the installed exploration skill: read-only `deepseek/deepseek-v4-flash:max` agents with an exact `["read", "bash"]` allowlist. Exploration never edits and never replaces direct reading of critical code before edits.
- **Large single-domain edits.** After the targets are identified and the approach for that domain is ironed out with the user, jog may dispatch one subagent per coherent domain edit. Spawns resolve exact tuples from the loaded sprint-planner agent configuration: the `basicImplementer` assignment for light basic work, document editing, and well-defined simple-logic edits; the `advancedImplementer` assignment for anything relatively complicated or important. Children receive exact edit-capable tool allowlists and never user-questioning, subagent, or sprint tools; they return escalation requests for the root to put to the user. While a child works one domain, the root continues planning other aspects and collaborating with the user.

Jog treats the accepted plan as its implementation contract. It asks the user collaboratively when implementation reveals a consequential choice, contradicted assumption, unclear scope authority, irreversible action, or multiple materially different valid outcomes. It resolves discoverable facts from the repository rather than asking the user. Explicit user decisions during jogging may amend the plan; the root summarizes and records that amendment before implementing it.

A governing senior-escalation policy may require narrowly scoped expert consultation after a concrete failed attempt or genuine blocker. Such consultation remains advisory; the root retains implementation and validation ownership.

Jog validates every stated criterion itself, reviews every delegated diff, runs focused edge and failure checks plus applicable broader checks, reviews the final diff, and completes repository closeout records. A child self-report is evidence, not completion. Jog never claims completion with an unmet criterion or unresolved blocker.

## Security and Trust

Planning requires an interactive UI, a trusted project, and a ready `.internal-dev/plans/` store. Store discovery rejects a non-directory or symbolic-link `.internal-dev` or plans path. User-supplied artifact paths are not used for publication; ids are generated from a bounded safe slug and collision-resistant timestamp/suffix allocation.

## Validation

The package test suite covers question validation, slug generation, complete plan headings, nearest-store publication, no-overwrite allocation, package resource declarations, and the jog delegation contract (root ownership, exploration teams, delegated domain-edit gate, and exact flash/pro max model policy). Pi RPC `get_commands` must resolve `/job` to the extension and `skill:jog` to the packaged skill path. Loading the package must register all three tools without extension errors.
