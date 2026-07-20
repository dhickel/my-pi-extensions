---
name: orchestrate
description: Execute complex workflows, raw task directives, checklists, or phased plan files with dependency-aware sequential or safe parallel subagents. Uses DeepSeek Pro V4 at max for implementation and GPT-5.6 Sol at xhigh to validate every phase. Use when the user asks to orchestrate, execute, or implement a multi-phase or long-running workflow.
compatibility: Requires Pi with subagent_spawn, subagent_poll, subagent_status, and subagent_cancel; configured deepseek/deepseek-v4-pro max and openai-codex/gpt-5.6-sol xhigh model tuples.
metadata:
  version: "1.0.0"
---

# Orchestrate

Interpret and execute an authoritative workflow supplied by the user. The input may be prose, a checklist, pasted plan content, one or more plan files, or a plan directory. Support long-running dependency chains and safe parallel phases without changing accepted scope.

## Fixed model contract

Use exactly these tuples for delegated work:

- Implementation and repair — DeepSeek Pro V4:
  - `provider`: `deepseek`
  - `model`: `deepseek-v4-pro`
  - `thinkingLevel`: `max`
- Validation of **every phase** and final integration — GPT-5.6 Sol:
  - `provider`: `openai-codex`
  - `model`: `gpt-5.6-sol`
  - `thinkingLevel`: `xhigh`

Never inherit, omit, downgrade, clamp, or substitute either tuple. If a required model, authentication, or thinking level is unavailable, stop before implementation and report the exact failure. In particular, do not replace GPT-5.6 Sol with another GPT version.

Implementation self-reports, root inspection, and test output do not replace independent GPT-5.6 Sol xhigh phase validation.

## Preflight

Before any implementation edit, launch one atomic `subagent_spawn` batch containing two uniquely named no-op agents:

1. One with `deepseek/deepseek-v4-pro` at `max`.
2. One with `openai-codex/gpt-5.6-sol` at `xhigh`.

Each task is only: `Return READY without reading or modifying the project.` Poll until both reach a terminal state. Confirm the reported provider, model, and thinking level exactly. Because a spawn batch is validated atomically, a rejected tuple prevents either preflight task from starting.

Do not proceed when either preflight fails.

## Interpret the directive

Treat the complete user input as prompt text, not as a filename. Inspect any referenced project paths with root tools.

Before scheduling:

1. Read applicable project instructions, accepted specifications, and explicitly required guides.
2. Preserve the user's scope, decisions, phase boundaries, exclusions, and completion criteria.
3. For a plan directory, identify shared `concepts.md` guidance and every `phase-NN-*.md` file. Do not omit a phase.
4. For a single phase, follow its dependencies and shared concepts when present.
5. For raw prose or a checklist, derive only the minimum executable phases needed; do not invent features.
6. Resolve discoverable questions from the repository. Ask the user only when missing intent or authority prevents safe execution.

Build a phase ledger containing:

- stable phase id and title;
- authoritative source paths;
- goal, scope, and exit criteria;
- dependencies;
- declared files or write areas;
- required guides and validation;
- status, implementation attempt, validation verdict, and repairs.

Reject unknown dependencies and dependency cycles.

## Schedule work

Sequential execution is the default. A dependency becomes complete only after its independent validator returns `VERDICT: PASS`.

Run phases in parallel only when the authoritative workflow permits it and every phase in the wave:

- has all dependencies validated as passed;
- has a known write set;
- has no overlapping file or directory target with a sibling;
- shares no generated artifact, migration, schema, lockfile, or mutable global state with a sibling;
- can be implemented and validated independently.

An empty or uncertain write set is not evidence of safety; schedule that phase sequentially. Limit each implementation or validation wave to four agents.

## Delegate implementation

Spawn one DeepSeek Pro V4 `max` agent for each ready phase. Children receive no caller transcript, so every task must be self-contained and include:

- the user objective and settled constraints;
- the exact assigned phase, source paths, scope, and criteria;
- relevant shared concepts and required guides;
- completed dependencies;
- declared write targets;
- required validation commands or expectations;
- unrelated edits that must be preserved;
- authority to edit only the assigned scope.

Require each implementer to:

1. Inspect assigned files and guides before editing.
2. Confirm required toolchain executables before substantial edits.
3. Implement the complete phase without placeholders, stubs, fake behavior, or speculative scope.
4. Stay within declared write targets unless an unavoidable adjacent change is explained.
5. Run focused validation, including relevant failures and edge cases.
6. Return `Summary`, `Files Changed`, `Validation`, `Criteria`, `Remaining Risks`, and `Blockers` sections.

A missing executable must be reported with the dependency and exact user action; validation must never be faked.

## Poll every agent

After spawning agents, call `subagent_poll` repeatedly until every launched agent reaches a terminal state. A poll timeout is only a status update; continue polling. Use `subagent_status` with `includeResults: true` when a visible result is truncated. Never abandon active or undelivered agents, and never start dependent work while a prior wave awaits validation.

If an implementation agent fails after possible edits, stop downstream scheduling and still validate the actual repository state for that phase.

## Validate every phase

After an implementation wave fully settles, spawn one read-only GPT-5.6 Sol `xhigh` validator per phase. Validators may run in parallel only after all implementation agents in that wave have stopped.

Each validation brief must include the phase contract and implementation report. Require the validator to:

1. Inspect the actual repository state independently.
2. Check every phase criterion and applicable project instruction.
3. Review changed files and integration boundaries.
4. Run or verify required tests, typecheck, lint, or build checks.
5. Check failure cases, regressions, placeholders, unrelated edits, and accidental API growth.
6. Make no source edits.
7. Return exactly `VERDICT: PASS`, `VERDICT: REPAIR`, or `VERDICT: BLOCKED` plus `Criteria Checked`, `Commands and Results`, `Findings`, `Required Repairs`, and `Remaining Risks` sections.

`PASS` requires every criterion to be checked and no unresolved blocker. A missing or ambiguous verdict is not a pass; retry once with a new uniquely named GPT-5.6 Sol validator, then stop as blocked if the verdict remains malformed.

## Repair loop

For `REPAIR`, spawn a fresh DeepSeek Pro V4 `max` repair agent with the original phase contract, implementation report, complete validator report, and authority limited to required repairs. Then run a fresh GPT-5.6 Sol `xhigh` validator for that phase.

Allow at most two automatic repair rounds per phase. If the phase still does not pass, stop downstream scheduling and report the unresolved findings without claiming completion.

For `BLOCKED`, cancel active siblings when continuing them would be unsafe, start no later dependency wave, and report the concrete user action or external decision required.

## Final integration gate

After every phase has a recorded `PASS`, launch one GPT-5.6 Sol `xhigh` integration validator for the complete workflow. It must inspect cross-phase behavior, run applicable broader checks, and verify the final criteria from shared concepts or the user directive.

If integration needs repair, use the same bounded DeepSeek repair followed by fresh GPT-5.6 Sol validation. Do not sign off until integration passes or a genuine blocker is reported.

## Completion

Before reporting completion:

1. Confirm every phase and final integration have independent `PASS` verdicts.
2. Review the final diff or changed-file set for scope and accidental edits.
3. Complete the project's required specification, knowledge, review, plan, and changelog workflow.
4. Report completed phases, parallel waves, exact model tuples, files changed, validation commands, repairs, and any genuine blocker.

Do not claim extension-owned background execution, durable orchestration checkpoints, or automatic resume. This skill is root-session orchestration; reload, session replacement, fork, shutdown, or root cancellation can end active subagents.
