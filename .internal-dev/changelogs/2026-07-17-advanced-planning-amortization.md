# Advanced Planning Amortization

## Date

2026-07-17

## Git Commit

Not applicable — `/home/dhickel/AI/Workspaces/Pi-extensions` is not a Git repository.

## Change Summary

Upgraded advanced planning into a size-budgeted executor contract. Plans now include structured orchestration metadata, cohesive one-agent phases, detailed head-down implementation guidance, selective code examples, explicit safe sequential/parallel waves, and no human scheduling estimates. Updated the separate orchestration skill so GPT-5.6 Sol xhigh validators review and repair each phase themselves before PASS and downstream scheduling.

## Files

- `sprint-planner/types.ts`, `prompts.ts`, `validation.ts`, `engine.ts`, and `artifacts.ts`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `sprint-planner/test/core.test.ts` and `sprint-planner/README.md`
- `internal-dev/contract.ts` and `internal-dev/test/core.test.ts`
- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md` and `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/plans/.archive/advanced-planning-amortization/`
- `.internal-dev/reviews/2026-07-17-advanced-planning-integration-review.md`

## Behavioral Impact

Small plans contain 2–3 phases, medium plans 3–5, and large plans 6–10. Published planning directories contain exactly corrected `concepts.md`, structured `orchestration.md`, and contiguous phases. Orchestration assigns one DeepSeek Pro V4 max implementer to each complete phase, records dependencies and execution waves, blocks unsafe generated topology, and requires an editing GPT-5.6 Sol xhigh PASS gate after each phase and at final integration. State version 3 rejects older incomplete checkpoints. Publication is no-replace and ownership-safe on reported failures.

## Specification Impact

Updated `sprint-planner-suite.md` to define the new plan bundle, phase budgets, executor-detail contract, structured scheduling metadata, editing validator behavior, semantic recovery, state version 3, and publication guarantees. Added durable decisions that supersede the earlier concepts-plus-phases-only and read-only-validator mechanics while preserving their historical context.

## Risks

- Incomplete state versions 1 and 2 require `/sprint reset`; they are not migrated.
- Multi-path publication cannot be made crash-atomic with portable Node/POSIX APIs; the implementation does not claim that guarantee.
- Linked package users must reload or restart Pi before the updated skill and extension resources are active.

## Follow-up Items

None.
