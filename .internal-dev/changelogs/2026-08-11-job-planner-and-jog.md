# Job Planner and Jog

## Date

2026-08-11

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

Added the installable `job-planner` Pi package. The extension runs an uncapped interactive repository-informed interview, provides choice and written question tools, persists session state, and exclusively publishes one structured job plan. After publication it asks whether to proceed immediately and, when accepted, queues the packaged `jog` skill. Jog implements the plan collaboratively on the root agent thread without delegated implementation or validation.

## Files

- `job-planner/package.json`
- `job-planner/index.ts`
- `job-planner/core.ts`
- `job-planner/README.md`
- `job-planner/skills/jog/SKILL.md`
- `job-planner/test/core.test.ts`
- `.internal-dev/specifications/job-planner-suite.md`
- `.internal-dev/specifications/index.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/changelogs/2026-08-11-job-planner-and-jog.md`

## Behavioral Impact

Pi can load `/job`, the three job-planning tools, and `/skill:jog` from one package. Job interviews require at least one user answer, remain active across session reloads, create no partial plan on cancellation, and publish collision-safe plans under `.internal-dev/plans/<job-id>/plan.md`. Successful publication prompts the user to start jogging; acceptance queues the exact published path as a follow-up. Jog keeps implementation, user decisions, repairs, and validation on the main thread.

## Specification Impact

Added `job-planner-suite.md` as the living contract and recorded the durable decision to separate conversational jobs from delegated advanced Sprint Planner execution.

## Risks

The planning workflow requires an interactive trusted project with an initialized `.internal-dev/plans/` store. The quality of semantic completeness remains agent-governed; deterministic submission enforces structure and at least one answer but cannot prove that every possible ambiguity was asked.

## Follow-up Items

None.
