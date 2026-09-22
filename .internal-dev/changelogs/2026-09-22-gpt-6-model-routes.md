# Migrate Luna and Sol agent routes to GPT-6

## Date

2026-09-22

## Git Commit

040c066fac57643ae8f42f09a61597769bd8f86c

## Change Summary

Migrated all active GPT-5.6 Luna assignments to `gpt-6-luna` and GPT-5.6 Sol assignments to `gpt-6-sol`, preserving providers, role assignments, and thinking tiers. Updated the sprint-planner default configuration, model profile catalog, agent configuration table, generated-plan expectations, skill contracts, and job-planner references.

## Files

- `sprint-planner/types.ts`
- `sprint-planner/configs/default.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/AGENTS.md`
- `sprint-planner/README.md`
- `skills/exploration/SKILL.md`
- `skills/image-viewing/SKILL.md`
- `job-planner/README.md`
- `job-planner/index.ts`
- `job-planner/skills/jog/SKILL.md`
- `.internal-dev/specifications/sprint-planner-suite.md`

## Behavioral Impact

New sprint-planner runs, generated plan routes, exploration workers, image-viewing delegates, and job-planner delegations use GPT-6 Luna/Sol instead of the corresponding GPT-5.6 models. Existing plan and execution records retain their frozen model tuples.

## Specification Impact

Updated `.internal-dev/specifications/sprint-planner-suite.md` to describe the active GPT-6 routes.

## Risks

The model ids must be available to the configured `openai-codex` provider and support the assigned thinking levels. Runtime execution still fails closed if model, authentication, or thinking support is unavailable.

## Follow-up Items

- Run the sprint-planner test suite and inspect the final worktree diff.
