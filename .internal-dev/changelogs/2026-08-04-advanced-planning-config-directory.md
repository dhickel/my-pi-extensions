## Date

2026-08-04

## Git Commit

2b8d04585b0d5ed08333b674df60ebebe5c0ce99

## Change Summary

Moved the default advanced-planning model assignment object into the new extension-local `sprint-planner/configs/` directory. Extension initialization now loads the registered default configuration into one current configuration variable and injects that snapshot into every new planning engine. No model assignment, senior-call limit, role, workflow ordering, retry behavior, or caller-facing configuration selection changed.

## Files

- `sprint-planner/configs/default.ts` — schema-conforming current default model assignments.
- `sprint-planner/configs/index.ts` — named configuration registry, fixed default selector, and default loader.
- `sprint-planner/types.ts`, `core.ts`, `engine.ts`, `index.ts` — shared schema, exports, engine injection, and extension-load initialization.
- `sprint-planner/test/core.test.ts` — configuration schema, default resolution, and extension-load wiring regression coverage.
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md` — configuration location, loading lifecycle, persistence boundary, and future-addition instructions.
- `.internal-dev/specifications/sprint-planner-suite.md`, `decisions.md`, `deferred-features.md`, and `knowledge/sprint-planner-runtime-contracts.md` — updated routing contract, durable decision, deferred selection boundary, and reusable runtime guidance.

## Behavioral Impact

Advanced planning always uses the default configuration loaded when `sprintPlannerExtension()` initializes. The resolved model tuples remain what is persisted in run state. There is no runtime, command, tool, environment, or caller parameter for selecting another configuration.

## Specification Impact

Updated the sprint-planner suite specification to document the configuration directory, default load lifecycle, and exact current review tuples. Recorded named configuration selection as an accepted deferred capability.

## Risks

The full test suite continues to have four unrelated senior-agent skill-contract failures tracked in GitHub Issue #1. All sprint-planner configuration and routing tests pass.

## Follow-up Items

Before adding an alternate configuration, define and approve its ownership, selection scope, validation, and resume/persistence semantics. Do not expose selection implicitly.
