# Implementation and Senior Model Routing

## Date

2026-09-09

## Git Commit

040c066fac57643ae8f42f09a61597769bd8f86c

## Change Summary

Changed the active basic implementer to `openai-codex/gpt-5.6-luna:xhigh` and the advanced implementer to `deepseek/deepseek-v4-pro:max`. Updated the senior-agent skill to use high on the first pass, xhigh on the second, and `openai-codex/gpt-6-astra:xhigh` on the third attempt or for an already repeated-failure hard problem. Explicit user-requested senior model overrides now take precedence. Updated the installed senior-agent skill copy, model-route documentation, living specifications, durable decisions, fixtures, and contract tests.

## Files

- `sprint-planner/types.ts`
- `sprint-planner/configs/default.ts`
- `skills/senior-agent/SKILL.md`
- `/home/dhickel/.pi/agent/skills/senior-agent/SKILL.md`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/AGENTS.md`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/changelogs/2026-09-09-implementation-and-senior-model-routing.md`

## Behavioral Impact

New plans resolve basic and advanced implementation phases to the requested Luna and DeepSeek V4 Pro tuples. Senior escalation is bounded to three automatic attempts, supports the Astra third-pass route, and honors explicit user model overrides without changing the active configuration.

## Specification Impact

Updated `sprint-planner-suite.md` and `decisions.md` to define the new implementation assignments, senior escalation ladder, Astra switch, and user-override precedence.

## Risks

Previously validated plans and execution records retain their frozen historical tuples. Requested senior overrides still depend on the named provider/model and thinking level being available to `subagent_spawn`.

## Follow-up Items

None.
