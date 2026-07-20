# Sprint Planner Orchestration Skill Refactor

## Date

2026-07-16

## Git Commit

Not applicable — `/home/dhickel/AI/Workspaces/Pi-extensions` is not a Git repository.

## Change Summary

Removed implementation orchestration from the deterministic sprint-planner extension. `/sprint` now ends after corrected advanced-plan publication, the extension no longer registers `/orchestrate`, implementation routes and coding tools were removed, and state version 2 contains planning stages only.

Added an Agent Skills-standard `orchestrate` skill to the same Pi package. It interprets user workflows or plan files, schedules dependency-aware sequential or safe parallel phases, requires `deepseek/deepseek-v4-pro` at `max` for implementation and repair, and requires independent `openai-codex/gpt-5.6-sol` at `xhigh` validation for every phase and final integration.

## Files

- `sprint-planner/package.json` and `sprint-planner/skills/orchestrate/SKILL.md`
- `sprint-planner/index.ts`, `engine.ts`, `pi-runner.ts`, `types.ts`, `commands.ts`, `prompts.ts`, `validation.ts`, and `artifacts.ts`
- `sprint-planner/test/core.test.ts` and `sprint-planner/README.md`
- `internal-dev/contract.ts`, `internal-dev/index.ts`, and `internal-dev/README.md`
- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/index.md`, `.internal-dev/specifications/sprint-planner-suite.md`, and `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `backups/sprint-planner-0.2.0-20260716/` — verified byte-for-byte backup copy of the installed local-path package source.

## Behavioral Impact

Pi now discovers `/skill:orchestrate` from the installed sprint-planner package, while extension command discovery contains only `/sprint`, `/brainstorm`, `/ironout`, and `/advanceplan`. Persisted `/sprint` runs stop at planning and explicitly delegate implementation and validation to the skill. Version-1 incomplete sprint state cannot resume under state version 2 but remains removable through confirmed `/sprint reset`. A complete snapshot of the linked installed package is retained under `backups/`.

## Specification Impact

Updated `sprint-planner-suite.md` to make corrected plan publication the terminal extension stage and define the separate skill's exact model, scheduling, repair, and per-phase validation contract. Updated the durable decisions and generic sprint-record wording to support explicitly delegated or unrun implementation and validation stages.

## Risks

- Skill orchestration is root-session prompt coordination and does not provide the former extension's background persistence or resume state machine.
- Existing incomplete state-version-1 sprint runs require reset or use of the prior package version.
- Exact model preflight remains mandatory; unavailable authentication or thinking support stops before implementation.

## Follow-up Items

None.
