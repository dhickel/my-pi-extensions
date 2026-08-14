# Changelog: Default config migrates to GPT-5.6 Luna xhigh; orchestrate and jog resolve agents from config

## Date

2026-08-14

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

- `configs/default.ts`: all seven former `gpt-5.6-terra:high` agents (`ironoutReviewer`, `decompositionReviewer`, `conceptsReviewer`, `orchestrationReviewer`, `phaseReviewer`, `phaseValidator`, `integrationValidator`) now use `MODEL_PROFILES.lunaXhigh` (`openai-codex/gpt-5.6-luna`, thinking `xhigh`). Together with the earlier luna change, `roleRouter`, `brainstormSynthesis`, and all nine review/validation slots run on luna xhigh.
- `skills/orchestrate/SKILL.md` (v6.0.0): restored the plan-owned model contract as the primary authority (the validated plan's `Model Assignments`, which advanced planning resolved from configuration and embedded in the plan — not inline to the skill), and added a configuration fallback: when the input carries no validated model assignments (raw prose, checklists, legacy plans, single plan files), the skill resolves `basicImplementer`, `advancedImplementer`, `phaseValidator`, and `seniorAgent` from the active configuration instead. Spawn examples keep `<plan-*>` placeholders.
- `job-planner/skills/jog/SKILL.md` (v2.0.0): delegated-edit model policy now resolves `basicImplementer`/`advancedImplementer` from the active sprint-planner configuration instead of inlining `deepseek-v4-flash:max` / `deepseek-v4-pro:max`. The exploration-team contract remains fixed (exploration and image-viewing keep their inlined assignments per user direction).

## Files

- `sprint-planner/configs/default.ts`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `job-planner/skills/jog/SKILL.md`
- `sprint-planner/test/core.test.ts` (config tuple assertions, plan fixtures to luna, orchestrate contract/preflight tests to plan-owned-with-fallback, legacy v1 test pins the v1-era terra tuple)
- `job-planner/test/core.test.ts` (jog skill assertions now check config resolution)
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md`, `job-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`, `.internal-dev/specifications/job-planner-suite.md`, `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact

- Brainstorm routing/synthesis, ironout review, all advanced-plan reviews, and execution-phase/integration validation run on gpt-5.6-luna at xhigh.
- Orchestration consumes the plan-owned tuples from validated plans (unchanged contract) and now falls back to the active configuration for non-plan input; jog delegated edits follow the config's implementer profiles. Config changes propagate to jog without editing the skill.

## Specification Impact

- `sprint-planner-suite.md` Orchestrate Skill Contract and model tables updated; `job-planner-suite.md` delegated-edit tuples replaced by config resolution; durable decision recorded in `decisions.md` (2026-08-14), superseding in part the 2026-08-12 jog model-policy tuples.

## Risks

- Raw-prose/legacy orchestration now proceeds via configuration fallback instead of requiring advanced-planning conversion; exact tuples still fail rather than substituting another model.
- `terraHigh` remains in `MODEL_PROFILES` but is unused by installed configs; version-1 execution records keep the legacy `gpt-5.6-terra:high` contract unchanged.
- gpt-5.6-luna availability/quality unproven in review roles; revert slots to `solHigh`/`terraHigh` if output degrades.

## Follow-up Items

- None.

## Commit

- Git commit hash: 70d3e15 (working tree changes; commit to update)
