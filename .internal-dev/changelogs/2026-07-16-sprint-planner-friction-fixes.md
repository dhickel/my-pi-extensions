# Sprint Planner Friction Fixes

## Date

2026-07-16

## Git Commit

Not applicable — `/home/dhickel/AI/Workspaces/Pi-extensions` is not a Git repository.

## Change Summary

Replaced monolithic advanced-plan correction with deterministic concepts and per-phase `xhigh` reviews, added lightweight artifact-contract gates between stages, introduced a recoverable structured missing-toolchain escalation path, and documented and strengthened tests for existing same-session brainstorm cross-review.

## Files

- `sprint-planner/engine.ts`
- `sprint-planner/pi-runner.ts`
- `sprint-planner/prompts.ts`
- `sprint-planner/types.ts`
- `sprint-planner/validation.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/reviews/2026-07-16-sprint-planner-sprint-friction-review.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact

Advanced plans retain their public file shape but are corrected in smaller focused `xhigh` calls. Stage drift now fails before downstream model work with a precise structural error. Missing implementation toolchains pause full sprints with a user command and resumable pending unit; standalone orchestration emits an escalation and requires rerun. Brainstorm cross-review continues to reuse each worker's original session.

## Specification Impact

Updated `sprint-planner-suite.md` with per-phase review ownership, structural boundary gates, exact phase headings, toolchain blocked-state recovery, and the Pi SDK continuation semantics. Added matching durable decisions for review granularity, validation boundaries, and missing-toolchain handling.

## Risks

Per-phase reviewers do not alter phase count; structural validators cannot establish semantic defect coverage; standalone orchestration remains non-resumable; worker-supplied environment commands require user review.

## Follow-up Items

Measure per-phase review token use in the next real sprint and revisit only if the fixed fan-out remains unexpectedly expensive.
