# Changelog: roleRouter and brainstormSynthesis switched to gpt-5.6-luna xhigh

## Date

2026-08-14

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

- Added `lunaXhigh` profile to `MODEL_PROFILES` in `sprint-planner/types.ts` (`openai-codex` / `gpt-5.6-luna` / thinking `xhigh`).
- `sprint-planner/configs/default.ts`: `roleRouter` and `brainstormSynthesis` now use `MODEL_PROFILES.lunaXhigh` instead of `solHigh`.
- The active configuration remains `default`; `lite.ts` untouched.

## Files

- `sprint-planner/types.ts`
- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`

## Behavioral Impact

- Brainstorm role routing and synthesis now run on gpt-5.6-luna at xhigh thinking. The engine reads these assignments from the loaded configuration, so no engine changes were needed.

## Specification Impact

- `xhigh` was previously excluded from default config tuples ("reserved for senior-agent escalation"). It is now in use; the senior escalation ladder (high → xhigh → max) is unchanged. Tests updated accordingly.

## Risks

- gpt-5.6-luna availability/quality is unproven in this role; revert to `solHigh` if routing or synthesis output degrades.

## Follow-up Items

- None.

## Commit

- Git commit hash: 70d3e15 (sprint-planner directory)
