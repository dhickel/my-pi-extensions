# Sprint Planner Luna Fixture Alignment

## Date
2026-09-29

## Git Commit
dd12f850427e19bab948a1c558abad4bc8264c72 (dirty-worktree baseline)

## Change Summary
Aligned current-configuration orchestration fixtures with `openai-codex/gpt-5.6-luna:xhigh`, including Final Integration references. Updated dependent mutation selectors, retained standalone arbitrary-tuple examples and the legacy Terra contract, and added assertions for configuration-bound drift and frozen validation tuples.

## Files
- `sprint-planner/test/core.test.ts`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact
Tests only; no runtime changes. Before repair, `npm test` passed 178/212 and failed 34. Standalone failures reported `[model-route] Orchestration model profiles drifted from the loaded sprint-planner configuration.` Persistent workflows exhausted planning retries and paused before downstream reviews. The shared fake planner emitted the previous Luna tuple while the active configuration expected GPT-5.6 Luna.

Validation: focused Node test selection passed 7/7; full `cd sprint-planner && npm test` passed 212/212 with no failures, cancellations, skips, or TODOs. `git diff --check` passed.

## Specification Impact
None. These tests exercise the already-updated active-model contract in `.internal-dev/specifications/sprint-planner-suite.md` without changing intended runtime behavior.

## Risks
Mutation selectors must continue matching shared fixtures after future route changes. Arbitrary and legacy plan-owned tuples must not be globally rewritten.

## Follow-up Items
None for this fixture repair. Configuration, profile, and user-facing documentation changes remain owned by the parent implementation session.
