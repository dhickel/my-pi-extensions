# DeepSeek implementation model routes

## Date

2026-07-18

## Git Commit

dd12f850427e19bab948a1c558abad4bc8264c72

## Change Summary

Updated the default sprint-planner implementation model assignments: basic implementation now uses DeepSeek V4 Flash at high, and advanced implementation uses DeepSeek V4 Pro at max. Updated coverage, fixtures, and current model documentation accordingly.

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `sprint-planner/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md`

## Behavioral Impact

New plans and orchestration fallback assignments use DeepSeek V4 Flash high for basic phases and DeepSeek V4 Pro max for advanced phases. Existing plan-owned model tuples and legacy execution records are unchanged.

## Specification Impact

Updated `.internal-dev/specifications/sprint-planner-suite.md` to reflect the new active default implementation model assignments.

## Risks

The DeepSeek model routes must be available and support the specified thinking tiers in the executing environment; model preflight remains responsible for failing closed if unavailable.

## Follow-up Items

None.
