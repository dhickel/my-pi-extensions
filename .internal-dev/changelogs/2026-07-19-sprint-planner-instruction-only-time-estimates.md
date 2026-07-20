# Sprint Planner Instruction-Only Time-Estimate Guidance

## Date

2026-07-19

## Git Commit

Not a Git repository.

## Change Summary

Removed the regex-based time-estimate rejection path from sprint-planner handoff and plan validation. Standardized clear instruction-only guidance across all handoff and advanced-plan author/reviewer prompts, while preserving structural and orchestration validation.

## Files

- `sprint-planner/validation.ts`
- `sprint-planner/prompts.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact

Handoffs, concepts, phases, and plans are no longer rejected because their prose contains durations, time estimates, ETA language, dates, or effort wording. Prompts still instruct every relevant author and corrective reviewer to omit human scheduling estimates because plans and handoffs describe what to do, not how long it takes. Heading, submission, plan-shape, orchestration, persistence, and publication validation remain unchanged.

## Specification Impact

Updated `sprint-planner-suite.md` and `decisions.md` to define time-estimate guidance as prompt-only and to state that deterministic validators do not scan output wording for durations.

## Risks

Prompt-only guidance cannot deterministically guarantee that generated handoffs or plans omit human scheduling language. This tradeoff intentionally avoids false-positive rejection of valid technical content and opaque retries.

## Follow-up Items

- None.
