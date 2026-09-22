# Advanced implementation returns to Luna

## Date

2026-09-19

## Git Commit

040c066fac57643ae8f42f09a61597769bd8f86c

## Change Summary

Changed the active advanced implementation route back to `openai-codex/gpt-5.6-luna:max`, while retaining basic implementation at `openai-codex/gpt-5.6-luna:high`.

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `sprint-planner/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

New plans and configuration fallbacks assign Luna max thinking to advanced phases. Previously validated plans and execution records retain their frozen model tuples.

## Specification Impact

Updated the sprint-planner model-route specification and durable decision record.

## Risks

The route change affects newly resolved advanced implementation work only; historical plan-owned assignments remain authoritative.

## Follow-up Items

None.
