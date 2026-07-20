# Sprint Planner Medium Validation Routing

## Date

2026-07-18

## Git Commit

Not a Git repository.

## Change Summary

Changed every sprint-planner validation route from `openai-codex/gpt-5.6-sol:xhigh` to `openai-codex/gpt-5.6-sol:medium`, including corrective ironout and advanced-plan reviews, orchestrated phase review-and-repair, final integration validation, generated plan metadata, documentation, and contract tests.

## Files

- `sprint-planner/types.ts`
- `sprint-planner/prompts.ts`
- `sprint-planner/validation.ts`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact

Validation continues to use GPT-5.6 Sol with the same corrective authority and PASS/BLOCKED gates, but now runs at `medium` reasoning. Authoring, brainstorming, implementation, and advanced advisory routes are unchanged.

## Specification Impact

Updated `sprint-planner-suite.md` and `decisions.md` so the living validation contract requires `openai-codex/gpt-5.6-sol:medium`.

## Risks

Lower validation reasoning may reduce review depth on difficult phases; the existing deterministic gates, corrective edit authority, retries, and final integration review remain in place.

## Follow-up Items

- Monitor validation quality and revisit the reasoning level only if evidence shows the medium route is insufficient.
