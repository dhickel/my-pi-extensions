# Job Planner

A Pi package for collaborative, interactive job planning and main-thread implementation.

## What it provides

- `/job [directive]` starts a planning interview in the current Pi session.
- `job_ask_choices` asks up to three related decision questions with meaningful options and an automatic **Other** route.
- `job_ask_text` asks one exceptional open-ended question.
- `job_plan_submit` submits a complete candidate to the configured `redTeamValidator`, preserves inferable corrections, returns unresolved decisions to another user-question loop, and publishes only after a PASS.
- After publication, the workflow asks whether to proceed immediately; accepting queues `/skill:jog` with the new plan.
- `/skill:jog <plan-path>` executes the plan collaboratively on the root agent thread: it asks the user whenever implementation reveals decisions, may run read-only exploration teams for broad code surveys, and after targets are identified and the approach is ironed out with the user may dispatch large single-domain edits to subagents while it keeps planning other aspects with the user. The root always owns user interaction, integration, validation, and completion.

Job plans are published as `.internal-dev/plans/<job-id>/plan.md`. The nearest ready `.internal-dev` store is used; initialize it before running `/job`.

## Workflow

```text
/job Add configurable frame pacing
  → agent inspects the project
  → agent and user iterate through questions
  → job_plan_submit runs mandatory whole-plan red-team validation
  → validator repairs inferable oversights, inconsistencies, and architectural contradictions
  → unresolved decisions return to the planning agent for another user-question loop
  → revised plans repeat validation until PASS
  → the single validated plan is published
  → user chooses whether to start jogging immediately
  → /skill:jog .internal-dev/plans/<job-id>/plan.md
  → root agent collaborates, asks when decisions arise, optionally uses exploration teams, dispatches large settled single-domain edits to subagents, validates and commits each completed phase, and closes out
```

The plan contains:

- feature and required behavior;
- concrete targets;
- constraints and assumptions;
- settled decisions;
- ordered implementation approach;
- validation criteria;
- explicit out-of-scope boundaries; and
- a Planning Record containing the red-team PASS, exact validator tuple, attempt count, applied-repair count, and no remaining consequential questions.

## Commands

- `/job <directive>` — begin a new interview.
- `/job` — open a multiline editor for the directive.
- `/job status` — show the active/completed state and published path.
- `/job cancel` — cancel the active interview without publishing a plan.

An unfinished interview is restored from version-2 Pi session entries after reload or resume, including structured user-answer evidence, a corrected draft, cumulative repairs, and an unresolved red-team handoff when present. A malformed or legacy active snapshot fails closed as blocked until `/job cancel`; terminal version-1 snapshots remain readable. Restoration does not automatically resume model work; continue the user-question loop or cancel it.

## Install

Requires Pi Coding Agent and Pi AI 0.85.0 or newer. From the Pi-extensions workspace:

```bash
pi install ./sprint-planner
pi install ./job-planner
```

The Sprint Planner extension supplies the active `redTeamValidator` assignment through its versioned inter-extension configuration service. Job-plan publication fails closed if that service or its exact model tuple is unavailable. Then restart Pi or run `/reload`. Skill commands must be enabled for `/skill:jog`; the skill can also be loaded automatically when the request matches its description.

For a one-run extension smoke test:

```bash
pi -e ./sprint-planner/index.ts -e ./job-planner/index.ts
```

## Behavioral boundaries

- Planning is interactive-only and requires a trusted project with a ready `.internal-dev/plans/` store.
- The extension does not implement the job or create advanced Sprint Planner artifacts. It launches one in-memory, read-only red-team child for each candidate submission.
- Planning may inspect the repository with read-only exploration teams (fixed `openai-codex/gpt-6-luna:high` read-only agents per the installed exploration skill); planning decisions, user questioning, and implementation authority remain on the root thread.
- Every candidate is reviewed section-by-section by the active configuration's `redTeamValidator` (`openai-codex/gpt-6-astra:high`). The validator receives recorded user answers, inspects repository evidence as needed, fixes safely inferable defects in the structured draft, and returns heavy contradictions, missing authority, or insufficient context as a typed handoff rather than guessing.
- A handoff publishes nothing and requires at least one additional answer through `job_ask_choices` or `job_ask_text` before resubmission. Each new validator must reconcile every prior issue against recorded answer evidence and preserve earlier repairs unless later user authority supersedes them. Validation repeats until PASS; only the validator's corrected passing plan reaches cancellation-aware exclusive publication.
- Jog keeps user interaction, plan amendments, integration, validation, and completion on the root thread. Its delegated capabilities are read-only exploration teams for broad surveys, large single-domain edits dispatched only after the targets are identified and the approach for that domain is ironed out with the user, the per-domain luna validation loop (config-resolved `lunaXhigh`, read-only, PASS-gated before the next domain), and a final sol:medium review pass (`openai-codex/gpt-6-sol` at `medium`, fixed) that gates the completion report.
- Every completed plan phase gets its own Git commit after focused checks and a luna PASS, before the next phase starts. Jog stages only phase-owned changes, preserves unrelated worktree edits, and reports each full commit hash so work can be tracked and rolled back per phase.
- Delegated edits resolve exact tuples from the loaded sprint-planner agent configuration: `basicImplementer` for light basic work, document editing, and well-defined simple-logic edits; `advancedImplementer` for anything relatively complicated or important. Subagents never question the user, run sprint workflows, or spawn further agents.
- A cancelled question round yields no partial answers and does not count toward interview completion.
- Plan publication reserves a unique directory and never overwrites an existing plan. A final plan cannot be rendered or published without a passing red-team validation record.

## Test

```bash
cd job-planner
npm test
```
