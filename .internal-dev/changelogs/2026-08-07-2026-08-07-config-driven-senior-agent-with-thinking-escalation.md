# Changelog: Config-driven senior agent with thinking escalation

## Date

2026-08-07

## Git Commit

bb58a22089d85460b9006f57bcdd9461c4db0c51

## Change Summary

Added a `seniorAgent` assignment to the sprint-planner agent configuration and made both the orchestrate skill and the standalone senior-agent skill resolve senior escalation models from it at run time, mirroring the orchestrate skill's config-driven Model resolution contract.

- `configs/lite.ts` — `seniorAgent: deepseek/deepseek-v4-pro:max` (matches the rest of lite).
- `configs/default.ts` — `seniorAgent: openai-codex/gpt-5.6-sol:high` (the user's requested "chatgpt-5.6-sol:high" normalized to the repo's canonical `openai-codex/gpt-5.6-sol` model).
- `sprint-planner/skills/orchestrate/SKILL.md` (4.2.0 -> 4.3.0) — the Model resolution contract and the Senior escalation from validation section now resolve `seniorAgent` instead of `executionAdvisor` for senior escalation spawns.
- `skills/senior-agent/SKILL.md` (3.1.0 -> 3.2.0) — replaced the hard-coded `openai-codex/gpt-5.6-sol:high` contract with mandatory config resolution steps (configs/index.ts active name, active config file, `seniorAgent` entry, `MODEL_PROFILES` expansion through types.ts, `thinking` -> `thinkingLevel` mapping) and added a Thinking-level escalation rule: first pass at the resolved thinking level; after a failed pass, relaunch at the next higher level (`high` -> `xhigh` -> `max`, never exceeding `max`; stays at `max` if already there). Provider and model stay fixed across passes. Spawn examples use resolved-tuple placeholders.

## Files

- `sprint-planner/types.ts` — added `"seniorAgent"` to `SprintPlannerAgentId`.
- `sprint-planner/configs/default.ts`, `sprint-planner/configs/lite.ts` — `seniorAgent` assignments.
- `sprint-planner/skills/orchestrate/SKILL.md` — senior escalation resolves `seniorAgent`; version 4.3.0.
- `skills/senior-agent/SKILL.md` — config-driven contract, thinking-level escalation, placeholder spawn examples; version 3.2.0.
- `sprint-planner/test/core.test.ts` — orchestrate contract updated (version 4.3.0, `seniorAgent` slot); senior-agent contract rewritten (version 3.2.0, resolution assertions, escalation ladder, placeholder examples); config key lists include `seniorAgent`.
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md` — `seniorAgent` row and resolution lists; noted `executionAdvisor` (sol xhigh) is now defined but not consumed by either skill.

## Behavioral Impact

Senior escalation spawns (both from orchestrate validation escalations and from the standalone senior-agent skill) now follow the loaded configuration. Under the active `lite` config they resolve to `deepseek/deepseek-v4-pro:max`; under `default` to `openai-codex/gpt-5.6-sol:high` with escalation to xhigh then max after failed passes. Previously the senior-agent skill was hard-coded to gpt-5.6-sol (high under 3.1.0; the tests still expected the v3.0.0-era xhigh).

## Specification Impact

None beyond the model-assignment tables; the sprint-planner suite specification should be updated to mention the `seniorAgent` assignment if it enumerates configuration keys.

## Risks

- The senior-agent skill now depends on the sprint-planner extension configuration being readable from the caller's workspace; it stops with a concrete failure if the extension root cannot be located, matching the orchestrate skill's behavior.
- `executionAdvisor` remains in the schema (and its default xhigh assignment) but is no longer referenced by either skill; a future cleanup could remove it or re-purpose it.

## Follow-up Items

- The four pre-existing senior-agent skill-contract test failures (GitHub Issue #1) are fixed as part of this change; the suite now passes 212/212.
- Consider whether `executionAdvisor` should be removed from the schema or reassigned.
