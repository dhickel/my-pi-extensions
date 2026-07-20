## Summary

Implemented phase-05-exact-subagent-tool-policy: every `AgentSpec` now carries a required `tools: string[]` exact allowlist. Preflight validation is atomic — model, auth, thinking, tool availability, eligibility, and fingerprints are all validated before any child initialization. A catalog snapshot is built once per spawn from root `getAllTools()` and `getActiveTools()`, and post-bind fingerprint drift detection disposes siblings and starts no tasks on mismatch.

## Changes

### `subagents/core.ts`
- Added `ToolDef`, `ToolCatalogEntry`, `ToolCatalog` types for the spawn-local catalog snapshot.
- Added `stableStringify` (moved from index.ts) and `fingerprintToolDef` for deterministic tool fingerprinting.
- Added `buildToolCatalog(allTools, activeNames, forbiddenNames)` — pure function that builds a `ReadonlyMap` with `active`, `forbidden`, and `fingerprint` per tool. Rejects on duplicate definitions and active names without registered metadata.
- `AgentSpec.tools: string[]` — required field (omission, non-array, non-string entries, duplicates all reject).
- `ValidationContext.expectedTools` replaced by `catalog: ToolCatalog`.
- `validateSpawnBatch` validates each agent's `tools` exactly once in requested order: registered, active, not forbidden, fingerprints preserved. Tool validation is part of the preflight before model/thinking checks.

### `subagents/index.ts`
- Removed local `stableStringify` and `fingerprintTool` (now in core.ts).
- Updated `agentParameters` TypeBox schema to include required `tools: Type.Array(Type.String())`.
- `validationContext` builds one catalog snapshot from `pi.getAllTools()` / `pi.getActiveTools()` / `CHILD_EXCLUDED_TOOL_NAMES`.
- `createChild`: uses `noTools: "all"` when `tools: []` to prevent SDK defaults. Post-bind drift detection uses `session.getActiveToolNames()` (not `session.getAllTools()`) to compare only active names with the accepted policy.
- Updated `subagent_spawn` description to mention explicit tools array.
- Removed unused `ToolInfo` import.

### `subagents/package.json`
- Added `peerDependencies` for `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` with `"*"` ranges.

### `subagents/test/core.test.ts`
- 38 tests total (up from 19). New tests cover:
  - `fingerprintToolDef` determinism and field coverage.
  - `buildToolCatalog` rejects duplicates, active-without-definition, marks forbidden/inactive distinctly.
  - `tools` omission, non-array, non-string, duplicate, unknown, inactive, forbidden rejection with distinct error messages.
  - `tools: []` accepted as explicit no-tools.
  - Ordered fingerprint preservation per agent.
  - Mixed-batch preflight rejection with zero initialization and zero record creation.
  - Catalog construction failure rejects before manager mutation.
  - `THINKING_LEVELS` regression: `xhigh` appears exactly once.
- All existing lifecycle tests (poll, cancel, shutdown, reminders, turn limits, truncation) adapted to include `tools: ["read"]` on agent specs.

## Specification Impact

None — phase-05 is a standalone hardening of the existing `subagents` subsystem. Existing pool limits, lifetime name uniqueness, model selection, poll/status/cancel/shutdown behavior are preserved.

## Git Commit

d9c380f803ea7134759ac6c1c59eb0395225e413
