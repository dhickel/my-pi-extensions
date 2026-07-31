# Subagent launch SDK model runtime regression

## Summary

`subagent_spawn` fails every batch during child initialization after the Pi SDK moved `createAgentSessionServices()` model access from `modelRegistry` to `modelRuntime`.

## Scope

`subagents/index.ts` child-session initialization against `@earendil-works/pi-coding-agent` 0.80.8 and newer.

## Reproduction

1. Load the repository `subagents` extension under Pi 0.80.10.
2. Call `subagent_spawn` with one valid no-tool agent.
3. Observe failure before the delegated task starts.

## Expected

The child resolves the requested model and configured authentication through the current SDK service object, initializes, and runs the task.

## Actual

The batch fails before any task starts with `Cannot read properties of undefined (reading 'find')`.

## Evidence

- Live reproduction on Pi 0.80.10: `launch-repro-baseline` failed at turn 0 with `Batch initialization failed before any task started: Cannot read properties of undefined (reading 'find')`.
- The failing implementation read `services.modelRegistry.find(...)`.
- Pi 0.80.10 `AgentSessionServices` exposes `modelRuntime`, not `modelRegistry`.
- Pi changelog 0.80.8 documents the SDK breaking migration from `modelRegistry` to `modelRuntime`, whose current methods are `getModel(provider, id)` and `hasConfiguredAuth(provider)`.
- The repaired implementation uses `services.modelRuntime.getModel(provider, id)` and `services.modelRuntime.hasConfiguredAuth(provider)`.
- Fresh isolated Pi 0.80.10 acceptance completed a root child and its opt-in nested child: `ROOT_RESULT:completed:NESTED_RESULT:completed:NESTED_READY`.
- The complete subagents suite passes 79/79, and an independent `openai-codex/gpt-5.6-sol:xhigh` review found no remaining in-scope defect.

## Impact

All subagent launches fail, including sprint orchestration, senior escalation, and image delegation.

## Status

Resolved and validated on 2026-07-21.

## Next Action

Archived. Reopen only if a future Pi SDK migration changes the `AgentSessionServices.modelRuntime` contract or fresh-process child initialization regresses.
