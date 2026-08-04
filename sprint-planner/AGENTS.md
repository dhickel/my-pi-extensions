# Sprint Planner — Model Route Assignments

This file documents the engine-owned model tuples used across the sprint planner workflow. Every agent assignment — planning and execution — is centralized in `configs/default.ts` and loaded into the engine at extension initialization. The orchestrate skill reads its model assignments from this same configuration.

`MODEL_PROFILES` consolidates the exact provider/model/thinking tuples.

## Configuration loading

- `configs/default.ts` contains the complete sprint-planner agent assignment object and must satisfy the `SprintPlannerAgentConfiguration` schema in `types.ts`. Every agent — roleRouter, brainstormWorker, brainstormSynthesis, brainstormRedTeam, ironoutAuthor, ironoutReviewer, planner, advisor, decompositionReviewer, conceptsReviewer, orchestrationReviewer, and phaseReviewer — is assigned here.
- `configs/index.ts` registers named installed configurations, fixes `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` to `default`, and exposes the default loader.
- During `sprintPlannerExtension()` initialization, `index.ts` loads that object into `currentAgentConfiguration` once and passes the snapshot to every new `SprintPlannerEngine`.
- The engine uses only that injected snapshot for every workflow stage — brainstorm, ironout, and advanced planning. It persists resolved `ModelTuple` values in run state; configuration names are not persisted and there is no runtime or caller-selected configuration yet.
- To add a future configuration, add a schema-conforming file beneath `configs/`, register it in `configs/index.ts`, and separately introduce an approved selection contract. Do not change the default as an implicit selection mechanism.

## Default delegation policy

- Default implementation subagents must use `deepseek/deepseek-v4-pro` with `max` thinking unless the user explicitly requests another implementation model or a workflow-specific route below specifies otherwise.
- Do not rely on inherited caller model/provider/thinking for implementation subagents. Every implementation delegation must explicitly set `provider`, `model`, and `thinkingLevel`; omitting them is a policy violation even when the current root agent happens to be DeepSeek.
- Use the senior agent only when the user requests it directly, or as an escalation after ordinary implementation/debugging attempts have failed or produced a concrete blocker that needs senior diagnosis. Do not use the senior agent for routine first-pass implementation or ordinary parallelization. When invoked, senior agents should be launched with `allowSubagents: true` so they can delegate one bounded nested support layer when useful.

## Brainstorm

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Role Router | `openai-codex` | `gpt-5.6-sol` | high |
| Worker (findings) | `deepseek` | `deepseek-v4-pro` | max |
| Cross-Reviewer | `deepseek` | `deepseek-v4-pro` | max |
| Synthesis | `openai-codex` | `gpt-5.6-sol` | high |
| Red Team | `openai-codex` | `gpt-5.6-sol` | high |

## Ironout

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Handoff Author | `openai-codex` | `gpt-5.6-sol` | high |
| Corrective Reviewer | `openai-codex` | `gpt-5.6-terra` | high |

## Advance Plan

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Planner (draft generation) | `openai-codex` | `gpt-5.6-sol` | high |
| Senior Advisor | `openai-codex` | `gpt-5.6-sol` | max |
| Decomposition Reviewer | `openai-codex` | `gpt-5.6-terra` | high |
| Concepts Reviewer | `openai-codex` | `gpt-5.6-terra` | high |
| Orchestration Reviewer | `openai-codex` | `gpt-5.6-terra` | high |
| Phase Reviewer (per phase) | `openai-codex` | `gpt-5.6-terra` | high |

## Orchestrate (Execution)

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Phase Implementer (per phase) | `deepseek` | `deepseek-v4-pro` | max |
| Phase Validator (per phase) | `openai-codex` | `gpt-5.6-terra` | high |
| Final Integration Validator | `openai-codex` | `gpt-5.6-terra` | high |
| Senior Escalation | `openai-codex` | `gpt-5.6-sol` | xhigh |

Execution assignments are drawn from the same `configs/default.ts` configuration. The orchestrate skill lists the resolved default tuples in its Fixed model contract section and treats the configuration as authoritative.

## Rationale for model split

- **DeepSeek Pro V4 max** is used for divergent/creative generation: brainstorm workers, cross-reviewers, and phase implementers.
- **GPT-5.6 Sol** is used for routing, synthesis, red-teaming, authoring, and the senior advisor — analytical and convergent tasks.
- **GPT-5.6 Terra high** is used for the ironout corrective reviewer, all plan reviews (decomposition, concepts, orchestration, phase reviews), and execution validators — balancing analytical rigor with cost-efficiency.
- **GPT-5.6 Sol xhigh** is assigned to the execution senior escalation advisor for deep architectural reasoning when a phase validator cannot resolve a complex issue.

## Change history

- `gpt-5.6-terra` with `high` thinking is used for `ironoutReviewer`, the default advanced-plan decomposition/concepts/orchestration/phase reviewer assignments, and execution-phase validators, replacing `gpt-5.6-sol` at `medium`.
- The default advanced-plan planner and advisor assignments remain on `gpt-5.6-sol` (`high` / `max` respectively).
