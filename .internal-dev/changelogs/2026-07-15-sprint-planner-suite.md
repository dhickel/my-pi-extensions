# Resilient sprint planner suite implemented

## Date

2026-07-15

## Git Commit

Not applicable (this workspace is not a Git repository).

## Change Summary

Added an installable deterministic sprint-planner extension with full and standalone workflows, resumable full-run state, multi-turn Pi child sessions, typed artifacts, exact model routing, repair and escalation gates, final corrective validation, root-context questions, and destructive-reset safeguards. Registered the coordinated packages in Pi's user settings and verified an installed standalone workflow against the configured provider. The live check exposed and fixed a provider session-affinity limit by bounding child-session IDs to 64 characters. Workflow inputs are now preserved as raw prompts: command handlers no longer probe or expand possible paths, and agents interpret pasted material and path references through their existing tools.

## Files

- `sprint-planner/`: engine, commands, Pi runner, contracts, prompts, validation, tests, and package documentation.
- `internal-dev/`: added the `sprint` artifact kind, `sprints/` scaffold, templates, reset contract, and regression coverage.
- `user-questioning/`: added a correlated root-context event-bus request/response service, an installable Pi package manifest, and tests while preserving existing tools and UI.
- `.internal-dev/specifications/sprint-planner-suite.md`: living intended contract.
- `.internal-dev/specifications/decisions.md`: accepted routing, persistence, plan-layout, recovery, and reset decisions.
- `sprint-planner.md`: replaced the obsolete sketch with an authoritative-specification pointer.

## Behavioral Impact

Users can run `/sprint`, `/brainstorm`, `/ironout`, `/advanceplan`, and `/orchestrate` without assigning workflow control to the root model. Full sprints can be paused and explicitly resumed; successful runs retain durable evidence while deleting runtime-only files.

The three coordinated packages are registered as user-scoped local-path Pi packages. Child-session identifiers now remain within the 64-character provider prompt-cache-key limit.

Long, multiline, pasted, path-only, and mixed path-plus-instruction prompts follow the same terminal input path without filesystem filename limits or command-layer content rewriting.

## Specification Impact

Added the new living `sprint-planner-suite.md` specification and extended the `.internal-dev` store contract with sprint artifacts and the confirmed reset exception.

## Risks

The package targets Pi 0.80.7 and depends on the configured availability and authentication of `openai-codex/gpt-5.6-sol` and `deepseek/deepseek-v4-pro` with their required thinking levels. Local-path Pi registrations depend on this workspace remaining at its current path.

## Follow-up Items

- Revalidate child-session APIs and model metadata before a future Pi version upgrade.
