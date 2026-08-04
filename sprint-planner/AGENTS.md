# Sprint Planner — Model Route Assignments

This file documents the engine-owned model tuples used across the sprint planner workflow. These are defined in `types.ts` under `MODEL_ROUTES` and in the orchestrate skill at `skills/orchestrate/SKILL.md`.

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

## Rationale for model split

- **DeepSeek Pro V4 max** is used for divergent/creative generation: brainstorm workers, cross-reviewers, and phase implementers.
- **GPT-5.6 Sol** is used for routing, synthesis, red-teaming, authoring, and the senior advisor — analytical and convergent tasks.
- **GPT-5.6 Terra high** is used for the ironout corrective reviewer, all plan reviews (decomposition, concepts, orchestration, phase reviews), and execution validators — balancing analytical rigor with cost-efficiency.

## Change history

- `gpt-5.6-terra` with `high` thinking is used for `ironoutReviewer`, all `advancedReviewer` roles, and execution-phase validators, replacing `gpt-5.6-sol` at `medium`.
- `advancedPlanner` and `advancedAdvisor` remain on `gpt-5.6-sol` (`high` / `max` respectively).
