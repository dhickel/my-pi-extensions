# GPT-6 Astra model route migration

## Date

2026-09-05

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

Moved the active sprint-planner default assignments that previously used GPT-5.6 Sol to `openai-codex/gpt-6-astra`, preserving their existing thinking tiers. Added named Astra profiles and updated the model-route documentation.

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/types.ts`
- `sprint-planner/AGENTS.md`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `sprint-planner/test/core.test.ts`

## Behavioral Impact

New sprint-planner workflows resolve GPT-6 Astra only for the former Sol assignments: brainstorm red team, ironout author, advanced planner/advisor, and senior-agent escalation. Luna and DeepSeek routes remain unchanged. The senior-agent skill was audited and contains no inline Sol model tuple; it continues to resolve `seniorAgent` from configuration. Legacy profile values and historical execution-record tuples remain available for compatibility.

## Specification Impact

Updated the sprint-planner model-route documentation and recorded the new active default decision. Separate skills with intentionally fixed model contracts were not changed.

## Risks

The configured `gpt-6-astra` route must be available and authenticated in the runtime provider. Previously generated plans retain their frozen model tuples by design.

## Follow-up Items

Reload Pi after installing the updated package so the new configuration snapshot is loaded.
