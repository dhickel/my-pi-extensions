# Sprint Planner — Model Route Assignments

This file documents the engine-owned model tuples used across the sprint planner workflow. Planning, validation, senior escalation, and both implementation profiles are centralized in `configs/` (the active configuration `default` is selected in `configs/index.ts`) and loaded into the engine at extension initialization. Advanced planning hard-codes both implementation profiles and one selected profile per phase into `orchestration.md`; orchestration consumes that plan-owned contract and falls back to resolving from the active configuration only when the input carries no validated model assignments.

`MODEL_PROFILES` consolidates the exact provider/model/thinking tuples.

## Configuration loading

- `configs/default.ts` contains the complete sprint-planner agent assignment object and must satisfy the `SprintPlannerAgentConfiguration` schema in `types.ts`, including `basicImplementer` and `advancedImplementer`.
- `configs/index.ts` registers named installed configurations, fixes `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` to `default`, and exposes the default loader.
- During `sprintPlannerExtension()` initialization, `index.ts` loads that object into `currentAgentConfiguration` once, passes the snapshot to every new `SprintPlannerEngine`, and exposes role-specific tuples through the version-1 agent-assignment event-bus service. Job Planner resolves `redTeamValidator` through that service for mandatory pre-publication validation.
- The engine uses only that injected snapshot for every workflow stage — brainstorm, ironout, and advanced planning. It persists resolved `ModelTuple` values in run state; configuration names are not persisted and there is no runtime or caller-selected configuration yet.
- To add a future configuration, add a schema-conforming file beneath `configs/`, register it in `configs/index.ts`, and separately introduce an approved selection contract. Do not change the default as an implicit selection mechanism.

## Delegation policy

- The active `default` configuration assigns basic `openai-codex/gpt-6-luna:high` and advanced `openai-codex/gpt-6-luna:max`; planning roles formerly assigned to Sol use `openai-codex/gpt-6-astra` at their existing thinking tiers, while the configured `seniorAgent` base is `openai-codex/gpt-6-sol:high`.
- Advanced planning writes both implementation tuples plus exactly one `basic` or `advanced` assignment for every phase. Validation rejects missing, duplicate, out-of-order, malformed, or configured-profile-drifted assignments. Orchestration reads the accepted plan assignment for implementation and validation; only when the input carries no validated model assignments (raw prose, checklists, legacy plans) does it fall back to the active configuration's assignments. The `seniorAgent` assignment drives senior escalation directly from the active configuration.
- Assign basic to documentation, writing, closeout, routine code edits, straightforward scripts, and simple non-math/non-logic-heavy programming. Reserve advanced for logic-heavy code, vertical slices, advanced programming, difficult algorithms or mathematics, and work that materially benefits from deeper reasoning.
- Do not rely on inherited caller model/provider/thinking for implementation subagents. Every implementation delegation must explicitly set `provider`, `model`, and `thinkingLevel`; omitting them is a policy violation even when the current root agent happens to be the assigned model.
- Use the senior agent only when the user requests it directly, or as an escalation after ordinary implementation/debugging attempts have failed or produced a concrete blocker that needs senior diagnosis. Do not use the senior agent for routine first-pass implementation or ordinary parallelization. When invoked, senior agents should be launched with `allowSubagents: true` so they can delegate one bounded nested support layer when useful.

## Brainstorm

The brainstorm pipeline routes exactly 3 domains; each domain is explored independently by two workers (6 findings total), the synthesis condenses every finding and records where the workers differ in opinion, and the red team then reviews all six findings plus the synthesis, resolves disagreements, and checks for undersights or oversights.

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Role Router | `openai-codex` | `gpt-6-luna` | xhigh |
| Worker 1 (findings) | `openai-codex` | `gpt-6-luna` | max |
| Worker 2 (findings) | `deepseek` | `deepseek-v4-flash` | max |
| Synthesis | `openai-codex` | `gpt-6-luna` | xhigh |
| Red Team | `openai-codex` | `gpt-6-astra` | high |

## Red Team

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Red Team Validator (`redTeamValidator`) | `openai-codex` | `gpt-6-astra` | high |

## Ironout

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Handoff Author | `openai-codex` | `gpt-6-astra` | high |
| Corrective Reviewer | `openai-codex` | `gpt-6-luna` | xhigh |

## Advance Plan

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Planner (draft generation) | `openai-codex` | `gpt-6-astra` | high |
| Senior Advisor | `openai-codex` | `gpt-6-astra` | max |
| Decomposition Reviewer | `openai-codex` | `gpt-6-luna` | xhigh |
| Concepts Reviewer | `openai-codex` | `gpt-6-luna` | xhigh |
| Orchestration Reviewer | `openai-codex` | `gpt-6-luna` | xhigh |
| Phase Reviewer (per phase) | `openai-codex` | `gpt-6-luna` | xhigh |

## Orchestrate (Execution)

| Step | Provider | Model | Thinking |
|------|----------|-------|----------|
| Basic Implementer | `openai-codex` | `gpt-6-luna` | high |
| Advanced Implementer | `openai-codex` | `gpt-6-luna` | max |
| Phase Validator (per phase) | `openai-codex` | `gpt-6-luna` | xhigh |
| Final Integration Validator | `openai-codex` | `gpt-6-luna` | xhigh |
| Senior Agent base (`seniorAgent`) | `openai-codex` | `gpt-6-sol` | high |

The planner resolves both implementation profiles and validation from the loaded configuration, then embeds them in the advanced plan. Orchestration consumes the plan-owned tuples from the validated plan and falls back to the active configuration only when the input carries no validated model assignments. Senior escalation resolves its base model from `seniorAgent`: pass one uses high, pass two uses xhigh, and pass three (or an already hard blocker with repeated evidenced failures) may switch to `openai-codex/gpt-6-astra:xhigh`. An explicit user-requested senior model override takes precedence.

## Rationale for model split

- **GPT-6 Luna** is the default profile for role routing, brainstorm worker 1, synthesis, corrective review, plan review, basic and advanced implementation, and validation.
- **GPT-6 Astra** is used for red-teaming, red-team validation, authoring, and the advanced planner and advisor — analytical and convergent planning tasks.
- **DeepSeek V4 Flash** at `max` remains worker 2's independent second opinion on every domain.
- **GPT-6 Sol high** is the base `seniorAgent` assignment; the skill steps to xhigh, then may switch to **GPT-6 Astra xhigh** on the third attempt. Explicit user model overrides are supported.

## Change history

- Current routes use GPT-6 Luna for all former GPT-5.6 Luna assignments and GPT-6 Sol for the senior-agent base; thinking tiers and role assignments are unchanged.
- Basic implementation is `gpt-5.6-luna:high`, advanced implementation is `gpt-5.6-luna:max`, and senior escalation follows high → xhigh → third-pass Astra xhigh with explicit user model overrides.
- The `seniorAgent` assignment moved from `openai-codex/gpt-6-astra:medium` back to `openai-codex/gpt-5.6-sol:medium`; the senior-agent skill remains config-resolved and does not inline an authoritative model tuple.
- The default configuration previously moved its former Sol assignments to `openai-codex/gpt-6-astra` (red team, authoring, planner/advisor, and senior-agent roles); Luna and DeepSeek assignments remained unchanged.
- `gpt-5.6-luna` with `xhigh` thinking is used for `roleRouter`, `brainstormSynthesis`, `ironoutReviewer`, the default advanced-plan decomposition/concepts/orchestration/phase reviewer assignments, and execution-phase validators, replacing `gpt-5.6-terra` at `high` (and `gpt-5.6-sol` at `high` for the two brainstorm roles).
- The default advanced-plan planner and advisor assignments remain on `gpt-5.6-sol` (`high` / `max` respectively).
- The brainstorm workflow was redesigned: the role router now fixes 3 domains, two workers (worker 1 on `gpt-5.6-luna:max`, worker 2 on `deepseek/deepseek-v4-flash:max`) explore every domain for 6 findings, the same-session all-to-all cross-review stage was removed, synthesis now condenses all findings and records worker disagreements, and the red team now reviews every raw finding plus the synthesis, picks the best path on disagreements, and resolves any undersights or oversights it finds. The `--agents` option (previously 2–8 workers) was removed; the domain count is fixed.
- The default `brainstormWorker1` (previously `brainstormWorker`) is `gpt-5.6-luna:max`; `brainstormWorker2` is `deepseek-v4-flash:max`.
- The all-DeepSeek `lite` configuration was removed and `configs/default.ts` is the only installed configuration; the `exploration` skill's fixed contract moved to `openai-codex/gpt-5.6-luna:high`. DeepSeek profiles remain available for active assignments, label translation, and legacy record parsing.
