# Changelog: Active sprint-planner configuration switched to default

## Date

2026-08-07

## Git Commit

72a02941b6af4272f19dd4819dbd8b7ca9af94f6

## Change Summary

Switched the sprint-planner extension's active agent configuration from `lite` to `default`. `configs/index.ts` now fixes `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` to `"default"`, so `loadDefaultSprintPlannerAgentConfiguration()` returns the full OpenAI/DeepSeek production assignment set instead of the all-DeepSeek lite set. The orchestrate skill's execution tuples change accordingly: phase implementation stays `deepseek/deepseek-v4-pro:max`, while phase/integration validation moves from `deepseek/deepseek-v4-pro:max` to `openai-codex/gpt-5.6-terra:high` and senior escalation resolves `openai-codex/gpt-5.6-sol:high`. The `lite` configuration remains installed and registered but is no longer active. Documentation and tests that asserted the active name or the lite-derived execution tuples were updated to match; a stale lite test expectation (implementation worker) was aligned with the already-modified `configs/lite.ts`.

## Files

- `sprint-planner/configs/index.ts` — `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` changed from `"lite"` to `"default"`.
- `sprint-planner/index.ts` — load-time snapshot comment now says the active configuration is `default`.
- `sprint-planner/test/core.test.ts` — active-configuration assertion now expects `default`; standalone advance-plan orchestration-reviewer model assertion resolves from the `default` configuration; lite implementation-worker expectation updated to `deepseek/deepseek-v4-flash:max` (was stale against `configs/lite.ts`).
- `sprint-planner/README.md` — orchestrate skill section now documents the active `default` configuration's execution tuples.
- `sprint-planner/AGENTS.md` — configuration-loading, delegation-policy, and execution-assignment notes now describe `default` as active and the `lite` configuration's real tuples (`deepseek-v4-flash:max` implementation worker, `deepseek-v4-pro:max` elsewhere).

## Behavioral Impact

On extension reload, every workflow (brainstorm, ironout, advanced planning) and every orchestrate-skill delegation resolves the `default` configuration's model tuples: planning/review roles use `openai-codex/gpt-5.6-sol` and `gpt-5.6-terra`, brainstorm workers and phase implementers use `deepseek/deepseek-v4-pro:max`. Execution validators upgrade from DeepSeek to GPT-5.6 Terra high; senior escalation uses GPT-5.6 Sol high (escalating to xhigh then max). No engine or skill code path needed changes — both consume the loaded snapshot at run time.

## Specification Impact

none — no engine contract, skill contract, or schema changed; this only selects between two already-registered, schema-conforming configurations at the documented selection point.

## Risks

None — the switch is a configuration selection change at the documented fixed-selection point. The orchestrate skill re-resolves tuples at run time and does not depend on a static active name. Note that a prior uncommitted working-tree batch (lite implementation worker on `deepseek-v4-flash:max`, plan metadata-consistency prompt additions, package.json tooling) is included in the same commit sequence as this switch.

## Follow-up Items

None.
