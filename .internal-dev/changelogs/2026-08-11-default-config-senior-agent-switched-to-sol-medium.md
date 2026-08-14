# Changelog: Default config senior agent switched to GPT-5.6 Sol medium

## Date

2026-08-07

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

Lowered the default configuration's senior escalation assignment from `solHigh` to a new `solMedium` profile. `types.ts` gains `MODEL_PROFILES.solMedium` (`openai-codex/gpt-5.6-sol` at `medium` thinking); `configs/default.ts` now assigns `seniorAgent: { model: MODEL_PROFILES.solMedium }`. The lite configuration is unchanged (still `deepseek-v4-pro` at `max`). Because the senior-agent and orchestrate skills resolve `seniorAgent` from the loaded configuration at run time and hardcode no tuple, no skill changes were required; the escalation ladder in the senior-agent skill (start at the resolved level, step up one level per failed pass) now starts at `medium` and steps `medium → high → xhigh → max`.

## Files

- `sprint-planner/types.ts` — added `solMedium` profile to `MODEL_PROFILES`.
- `sprint-planner/configs/default.ts` — `seniorAgent` now references `MODEL_PROFILES.solMedium` instead of `solHigh`.
- `sprint-planner/test/core.test.ts` — active-configuration seniorAgent tuple assertion expects thinking `medium`; ThinkingLevel coverage test now expects `medium` in use and asserts the default seniorAgent resolves to `medium`.
- `sprint-planner/AGENTS.md` — orchestrate table row, escalation-ladder note, and model-split rationale updated to `medium` (ladder `medium → high → xhigh → max`).

## Behavioral Impact

On extension reload, every senior escalation (senior-agent skill, orchestrate skill's optional senior escalation, planner `maxSeniorCalls` advisor escalation) resolves the default config's `seniorAgent` tuple `openai-codex/gpt-5.6-sol` at `medium` thinking instead of `high`. Failed passes still escalate one thinking level per pass, now `medium → high → xhigh → max`. The lite configuration's senior assignment is unaffected.

## Specification Impact

None — no engine contract, schema, or skill contract changed; `SprintPlannerAgentConfiguration` and the fixed-selection loader are untouched.

## Risks

None. `solMedium` is schema-conforming (`medium` is a valid `ThinkingLevel`), and the full test suite (212 tests) passes.

## Follow-up Items

None.
