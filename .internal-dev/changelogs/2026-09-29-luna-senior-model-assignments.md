# Restore GPT-5.6 Luna and update senior model base

## Date
2026-09-29

## Git Commit

dd12f850427e19bab948a1c558abad4bc8264c72

## Change Summary
Updated the active default sprint-planner configuration to use `openai-codex/gpt-5.6-luna` for every Luna role, preserving each role's existing thinking tier, and changed the senior-agent base to `openai-codex/gpt-6.1-sol:medium`. Added reusable model profiles, aligned configuration-bound test fixtures and assertions, and refreshed the intended specification and user-facing route documentation. Astra and DeepSeek assignments are unchanged.

## Files
- `sprint-planner/types.ts`
- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/AGENTS.md`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact
Newly resolved Luna assignments use GPT-5.6 Luna and new senior-agent resolutions use GPT-6.1 Sol at medium. Existing generated plans and execution records retain their frozen tuples. Full validation: `cd sprint-planner && npm test` passed 212/212 tests; `git diff --check` passed.

## Specification Impact
Updated `.internal-dev/specifications/sprint-planner-suite.md` and `.internal-dev/specifications/decisions.md` to reflect the user-approved active model routes.

## Risks
Previously generated plan files and persisted execution records may still contain historical GPT-6 Luna or other senior tuples; these remain valid plan-owned/frozen assignments and are not rewritten.

## Follow-up Items
None.
