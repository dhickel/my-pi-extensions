# Changelog: Remove unused executionAdvisor agent slot

## Date

2026-08-07

## Git Commit

7cefdf0cc278871a93d86bfab1c168bea8a8920e

## Change Summary

Removed the `executionAdvisor` agent assignment from the sprint-planner configuration schema. The slot (default `openai-codex/gpt-5.6-sol:xhigh`, lite `deepseek/deepseek-v4-pro:max`) was originally added for the orchestrate skill's execution senior escalation; both the orchestrate skill and the senior-agent skill now resolve the `seniorAgent` assignment instead, leaving `executionAdvisor` consumed by no engine code and no skill. The `solXhigh` MODEL_PROFILE (added solely for this slot) was removed with it. The `xhigh` thinking level remains valid in the `ThinkingLevel` type, reserved for the senior-agent escalation ladder (high → xhigh → max).

## Files

- `sprint-planner/types.ts` — removed `solXhigh` from `MODEL_PROFILES` and `"executionAdvisor"` from `SprintPlannerAgentId`.
- `sprint-planner/configs/default.ts`, `sprint-planner/configs/lite.ts` — removed the `executionAdvisor` assignment.
- `sprint-planner/test/core.test.ts` — removed `executionAdvisor` from the exact key list and tuple assertions; seniorAgent assertions now cover the senior slot; the ThinkingLevel test records that `xhigh` is no longer used by config tuples (reserved for escalation).
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md` — dropped the `executionAdvisor` table row, note, rationale bullet, and role list mention.

## Behavioral Impact

None at runtime: no engine path or skill referenced `executionAdvisor` after the seniorAgent change. The configuration schema now contains 17 agent slots; both installed configs remain schema-conforming and key-identical.

## Specification Impact

The sprint-planner suite specification should drop any `executionAdvisor` mention if it enumerates configuration keys.

## Risks

None — the slot was dead code.

## Follow-up Items

None.
