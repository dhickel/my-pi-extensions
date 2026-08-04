## Date

2026-08-04

## Git Commit

2b8d04585b0d5ed08333b674df60ebebe5c0ce99

## Change Summary

Consolidated all sprint-planner agent assignments into one unified configuration schema. The former fixed `MODEL_ROUTES` (role router, brainstorm workers, synthesizer, red team, ironout author and reviewer) were merged with the advanced-planning configuration table (planner, advisor, and review roles) into a single `SprintPlannerAgentConfiguration` type. Every agent is now assigned in `configs/default.ts` and injected into the engine at extension load time.

## Files

- `sprint-planner/types.ts` — merged `MODEL_ROUTES` constants into an expanded `SprintPlannerAgentConfiguration` schema with full `SprintPlannerAgentId` union. Removed the separate fixed-route object.
- `sprint-planner/configs/default.ts` — expanded to include `roleRouter`, `brainstormWorker`, `brainstormSynthesis`, `brainstormRedTeam`, `ironoutAuthor`, and `ironoutReviewer` alongside the existing advanced-planning agents.
- `sprint-planner/configs/index.ts` — renamed exports from `ADVANCED_PLANNING_*` to `SPRINT_PLANNER_*`.
- `sprint-planner/engine.ts` — replaced all `MODEL_ROUTES.*` references with configuration lookups through `this.agentConfiguration`. Added local `agents` aliases to sprint and standalone brainstorm/ironout methods.
- `sprint-planner/index.ts` — renamed load-time variable to `currentAgentConfiguration`.
- `sprint-planner/test/core.test.ts` — rewrote routing-tuple tests as configuration-tuple tests; removed `MODEL_ROUTES` import; updated extension-wiring regex assertions.
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md` — documented the unified configuration loading lifecycle and removed stale route-table prose.

## Behavioral Impact

No model assignment, senior-call limit, role name, workflow stage, fan-out, retry, artifact, or publication behavior changed. Every agent still resolves the same provider/model/thinking tuples as before; the resolution path now passes through the configuration instead of a separate constant.

## Specification Impact

Updated the sprint-planner suite specification prose to reference the unified agent configuration rather than separate fixed routes.

## Risks

The full test suite continues to have four unrelated senior-agent skill-contract failures tracked in GitHub Issue #1. All sprint-planner configuration and routing tests pass.

## Follow-up Items

To add an alternate configuration (e.g., `lite`), add a schema-conforming file in `configs/`, register it in `configs/index.ts`, and introduce an explicit approved selection contract.
