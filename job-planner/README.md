# Job Planner

A Pi package for collaborative, interactive job planning and main-thread implementation.

## What it provides

- `/job [directive]` starts a planning interview in the current Pi session.
- `job_ask_choices` asks up to three related decision questions with meaningful options and an automatic **Other** route.
- `job_ask_text` asks one exceptional open-ended question.
- `job_plan_submit` publishes one structured plan after at least one user answer and only when consequential ambiguity is resolved.
- After publication, the workflow asks whether to proceed immediately; accepting queues `/skill:jog` with the new plan.
- `/skill:jog <plan-path>` executes the plan collaboratively on the root agent thread: it asks the user whenever implementation reveals decisions, may run read-only exploration teams for broad code surveys, and after targets are identified and the approach is ironed out with the user may dispatch large single-domain edits to subagents while it keeps planning other aspects with the user. The root always owns user interaction, integration, validation, and completion.

Job plans are published as `.internal-dev/plans/<job-id>/plan.md`. The nearest ready `.internal-dev` store is used; initialize it before running `/job`.

## Workflow

```text
/job Add configurable frame pacing
  → agent inspects the project
  → agent and user iterate through questions
  → job_plan_submit publishes one plan
  → user chooses whether to start jogging immediately
  → /skill:jog .internal-dev/plans/<job-id>/plan.md
  → root agent collaborates, asks when decisions arise, optionally uses exploration teams, dispatches large settled single-domain edits to subagents, validates, and closes out
```

The plan contains:

- feature and required behavior;
- concrete targets;
- constraints and assumptions;
- settled decisions;
- ordered implementation approach;
- validation criteria;
- explicit out-of-scope boundaries.

## Commands

- `/job <directive>` — begin a new interview.
- `/job` — open a multiline editor for the directive.
- `/job status` — show the active/completed state and published path.
- `/job cancel` — cancel the active interview without publishing a plan.

An unfinished interview is restored from Pi session entries after reload or resume. It does not automatically resume model work; continue the conversation or cancel it.

## Install

From the Pi-extensions workspace:

```bash
pi install ./job-planner
```

Then restart Pi or run `/reload`. Skill commands must be enabled for `/skill:jog`; the skill can also be loaded automatically when the request matches its description.

For a one-run extension smoke test:

```bash
pi -e ./job-planner/index.ts
```

## Behavioral boundaries

- Planning is interactive-only and requires a trusted project with a ready `.internal-dev/plans/` store.
- The extension does not implement the job, launch background agents, or create advanced Sprint Planner artifacts.
- Planning may inspect the repository with read-only exploration teams (fixed `deepseek/deepseek-v4-flash:max` read-only agents per the installed exploration skill); planning decisions, questioning, and implementation are never delegated during an interview.
- Jog keeps user interaction, plan amendments, integration, validation, and completion on the root thread. Its two delegated capabilities are read-only exploration teams for broad surveys and large single-domain edits dispatched only after the targets are identified and the approach for that domain is ironed out with the user.
- Delegated edits resolve exact tuples from the loaded sprint-planner agent configuration: `basicImplementer` for light basic work, document editing, and well-defined simple-logic edits; `advancedImplementer` for anything relatively complicated or important. Subagents never question the user, run sprint workflows, or spawn further agents.
- A cancelled question round yields no partial answers and does not count toward interview completion.
- Plan publication reserves a unique directory and never overwrites an existing plan.

## Test

```bash
cd job-planner
npm test
```
