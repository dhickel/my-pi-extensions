# Sprint Planner — Model Route Assignments

This file documents the engine-owned model tuples used across the sprint planner workflow. These are defined in `types.ts` under `MODEL_ROUTES` and in the orchestrate skill at `skills/orchestrate/SKILL.md`.

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
| Corrective Reviewer | `openai-codex` | `gpt-5.6-sol` | medium |

## Advance Plan

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Planner (draft generation) | `openai-codex` | `gpt-5.6-sol` | high |
| Senior Advisor | `openai-codex` | `gpt-5.6-sol` | max |
| Decomposition Reviewer | `openai-codex` | `gpt-5.5` | high |
| Concepts Reviewer | `openai-codex` | `gpt-5.5` | high |
| Orchestration Reviewer | `openai-codex` | `gpt-5.5` | high |
| Phase Reviewer (per phase) | `openai-codex` | `gpt-5.5` | high |

## Orchestrate (Execution)

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Phase Implementer (per phase) | `deepseek` | `deepseek-v4-pro` | max |
| Phase Validator (per phase) | `openai-codex` | `gpt-5.5` | high |
| Final Integration Validator | `openai-codex` | `gpt-5.5` | high |

## Rationale for model split

- **DeepSeek Pro V4 max** is used for divergent/creative generation: brainstorm workers, cross-reviewers, and phase implementers.
- **GPT-5.6 Sol** is used for routing, synthesis, red-teaming, authoring, and the senior advisor — analytical and convergent tasks.
- **GPT-5.5 high** is used for all plan reviews (decomposition, concepts, orchestration, phase reviews) and execution validators — balancing analytical rigor with cost-efficiency.

## Change history

- `gpt-5.5` with `high` thinking was introduced for all `advancedReviewer` roles and execution-phase validators, replacing `gpt-5.6-sol` at `medium`.
- `advancedPlanner` and `advancedAdvisor` remain on `gpt-5.6-sol` (`high` / `max` respectively).
