# Red-team validator agent assignment

## Date

2026-09-05

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

Added a dedicated `redTeamValidator` assignment under a Red Team area in the active sprint-planner configuration. It resolves to `MODEL_PROFILES.astraHigh` (`openai-codex/gpt-6-astra:high`). The existing `brainstormWorker2` assignment remains `deepseek/deepseek-v4-flash:max`.

Removed stale live documentation claiming that no active configuration assigns a DeepSeek profile. Historical changelogs remain unchanged.

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/types.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/AGENTS.md`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/changelogs/2026-09-05-red-team-validator-agent-assignment.md`

## Behavioral Impact

The loaded configuration now exposes an independently addressable red-team validation model route at GPT-6 Astra high. This change adds the assignment contract only; consumers must explicitly resolve the role when a workflow requires it. Brainstorm worker 2 continues using DeepSeek Flash max.

## Specification Impact

Updated `sprint-planner-suite.md` and `decisions.md` to define the dedicated red-team validation assignment and clarify the current DeepSeek usage.

## Risks

Adding a required key to `SprintPlannerAgentConfiguration` means future configuration files must provide `redTeamValidator` to satisfy the schema.

## Follow-up Items

Wire `redTeamValidator` into any workflow that requires a dedicated red-team validation pass.
