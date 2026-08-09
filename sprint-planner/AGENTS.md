# Sprint Planner — Model Route Assignments

This file documents the engine-owned model tuples used across the sprint planner workflow. Planning, validation, senior escalation, and both implementation profiles are centralized in `configs/` (the active configuration `default` is selected in `configs/index.ts`) and loaded into the engine at extension initialization. Advanced planning hard-codes both implementation profiles and one selected profile per phase into `orchestration.md`; orchestration consumes that validated plan contract instead of looking up an implementer from configuration.

`MODEL_PROFILES` consolidates the exact provider/model/thinking tuples.

## Configuration loading

- `configs/default.ts` contains the complete sprint-planner agent assignment object and must satisfy the `SprintPlannerAgentConfiguration` schema in `types.ts`, including `basicImplementer` and `advancedImplementer`.
- `configs/index.ts` registers named installed configurations, fixes `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` to `default`, and exposes the default loader.
- During `sprintPlannerExtension()` initialization, `index.ts` loads that object into `currentAgentConfiguration` once and passes the snapshot to every new `SprintPlannerEngine`.
- The engine uses only that injected snapshot for every workflow stage — brainstorm, ironout, and advanced planning. It persists resolved `ModelTuple` values in run state; configuration names are not persisted and there is no runtime or caller-selected configuration yet.
- To add a future configuration, add a schema-conforming file beneath `configs/`, register it in `configs/index.ts`, and separately introduce an approved selection contract. Do not change the default as an implicit selection mechanism.

## Delegation policy

- The active `default` configuration assigns basic `deepseek/deepseek-v4-flash:max` and advanced `deepseek/deepseek-v4-pro:max`. The `lite` configuration assigns basic `deepseek/deepseek-v4-flash:high` and advanced `deepseek/deepseek-v4-flash:max`.
- Advanced planning writes both tuples plus exactly one `basic` or `advanced` assignment for every phase. Validation rejects missing, duplicate, out-of-order, malformed, or configured-profile-drifted assignments. Orchestration reads only the accepted plan assignment for implementation.
- Assign basic to documentation, writing, closeout, routine code edits, straightforward scripts, and simple non-math/non-logic-heavy programming. Reserve advanced for logic-heavy code, vertical slices, advanced programming, difficult algorithms or mathematics, and work that materially benefits from deeper reasoning.
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
| Basic Implementer | `deepseek` | `deepseek-v4-flash` | max |
| Advanced Implementer | `deepseek` | `deepseek-v4-pro` | max |
| Phase Validator (per phase) | `openai-codex` | `gpt-5.6-terra` | high |
| Final Integration Validator | `openai-codex` | `gpt-5.6-terra` | high |
| Senior Agent (`seniorAgent`) | `openai-codex` | `gpt-5.6-sol` | high |

The planner resolves both implementer profiles and validation from the loaded configuration, then embeds them in the advanced plan. Orchestration treats the validated plan as authoritative for implementation and validation. Only optional senior escalation continues to resolve `seniorAgent` directly from the active configuration. Under `lite`, basic is Flash high, advanced is Flash max, and validation plus senior escalation are Pro max. The `seniorAgent` starts at the resolved thinking level and escalates one step (high → xhigh → max) after each failed pass.

## Rationale for model split

- **DeepSeek Flash V4 max** is the default basic implementation profile; **DeepSeek Pro V4 max** is the default advanced implementation profile.
- **GPT-5.6 Sol** is used for routing, synthesis, red-teaming, authoring, and the senior advisor — analytical and convergent tasks.
- **GPT-5.6 Terra high** is used for the ironout corrective reviewer, all plan reviews (decomposition, concepts, orchestration, phase reviews), and execution validators — balancing analytical rigor with cost-efficiency.
- **GPT-5.6 Sol high** is the `seniorAgent` assignment under the default configuration, escalating to `xhigh` then `max` after failed passes; under lite it is `deepseek-v4-pro` at `max`.

## Change history

- `gpt-5.6-terra` with `high` thinking is used for `ironoutReviewer`, the default advanced-plan decomposition/concepts/orchestration/phase reviewer assignments, and execution-phase validators, replacing `gpt-5.6-sol` at `medium`.
- The default advanced-plan planner and advisor assignments remain on `gpt-5.6-sol` (`high` / `max` respectively).
