# Sprint Planner model and subagent review

## Scope

Read-only review of the `sprint-planner` planning extension and its separately installed `orchestrate` skill, focused on configured model tuples, child roles, dynamic fan-out, and execution boundaries.

## Findings

The source-of-truth configuration is `sprint-planner/types.ts` (`MODEL_ROUTES`) for extension-owned planning and `sprint-planner/skills/orchestrate/SKILL.md` for skill-owned implementation execution.

### Extension-owned planning models

| Responsibility | Provider/model | Thinking |
| --- | --- | --- |
| Brainstorm role router | `openai-codex/gpt-5.6-sol` | `high` |
| Brainstorm findings and same-session cross-review workers | `deepseek/deepseek-v4-pro` | `max` |
| Brainstorm synthesis and red team | `openai-codex/gpt-5.6-sol` | `high` |
| Ironout author | `openai-codex/gpt-5.6-sol` | `high` |
| Ironout corrective reviewer | `openai-codex/gpt-5.6-terra` | `high` |
| Advanced planner | `openai-codex/gpt-5.6-sol` | `high` |
| Advanced advisor, conditional | `openai-codex/gpt-5.6-sol` | `max` |
| Decomposition, concepts, orchestration, and phase reviewers | `openai-codex/gpt-5.6-terra` | `high` |

The full `/sprint` planning flow is router → N findings → N same-session cross-reviews → synthesis → red team → ironout author → ironout reviewer → planner → decomposition reviewer → concepts reviewer → orchestration reviewer → N phase reviewers. Findings/cross-reviews use 2–8 worker roles (default 4); phase reviews fan out once per generated phase. The planner may call the advisor up to twice; the decomposition reviewer may call it once.

### Skill-owned implementation execution

| Responsibility | Provider/model | Thinking |
| --- | --- | --- |
| Preflight (one child for each fixed execution tuple) | `deepseek/deepseek-v4-pro`; `openai-codex/gpt-5.6-terra` | `max`; `high` |
| Implementer, one per unsplit phase or sequential lettered subphase | `deepseek/deepseek-v4-pro` | `max` |
| Review-and-repair validator, one per phase | `openai-codex/gpt-5.6-terra` | `high` |
| Final integration validator | `openai-codex/gpt-5.6-terra` | `high` |
| Conditional senior escalation | `openai-codex/gpt-5.6-sol` | `xhigh` |

The extension does not itself execute implementation phases or use `subagent_spawn`; it creates planning SDK child sessions through `PiWorkflowRunner`. The separate `orchestrate` skill owns subagent spawning, polling, phase execution, validation, and checkpointing.

## Risk Assessment

`.internal-dev/specifications/sprint-planner-suite.md`, `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`, and small portions of `sprint-planner/README.md` and `sprint-planner/prompts.ts` still describe the older `gpt-5.6-sol:medium` validation route. Current code, `sprint-planner/AGENTS.md`, the orchestrate skill, and execution-record tuple enforcement use `gpt-5.6-terra:high`. Treat the current TypeScript configuration and skill as operational truth; the specification and explanatory documentation need reconciliation.

## Recommendations

Update the stale specification, knowledge, README, and prompt wording to name `openai-codex/gpt-5.6-terra:high` for corrective planning and execution validation. Keep `types.ts` and `skills/orchestrate/SKILL.md` as the canonical sources for planning and execution model routing respectively.

## Follow-ups

No repository files were changed as part of this review. Relevant sources: `sprint-planner/types.ts`, `sprint-planner/engine.ts`, `sprint-planner/pi-runner.ts`, `sprint-planner/skills/orchestrate/SKILL.md`, and `sprint-planner/execution-records.ts`.
