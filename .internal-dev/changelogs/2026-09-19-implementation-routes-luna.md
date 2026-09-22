# Implementation routes use Luna tiers

## Date

2026-09-19

## Git Commit

040c066fac57643ae8f42f09a61597769bd8f86c

## Change Summary

Changed the active `default` sprint-planner implementation routes to GPT-5.6 Luna: basic implementation uses `high` thinking and advanced implementation uses `max` thinking.

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `sprint-planner/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

New plans and configuration fallbacks assign `openai-codex/gpt-5.6-luna:high` to basic phases and `openai-codex/gpt-5.6-luna:max` to advanced phases. Previously validated plans and execution records retain their frozen model tuples.

## Specification Impact

Updated the sprint-planner model-route specification and durable decision record to make the Luna basic/high and advanced/max assignments current.

## Risks

The route change affects newly resolved implementation work only; historical plan-owned assignments remain authoritative and may still reference prior models.

## Follow-up Items

None.
