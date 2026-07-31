# Subagent SDK repair and nested escalation

## Date

2026-07-21

## Git Commit

d259525fac758c5b16710579ee3ce1db04c2a353

## Change Summary

Repaired Pi 0.80.8+ child-session model lookup and added an explicit, single nested escalation layer to the subagents extension. Direct children may opt in with `allowSubagents: true`; escalation agents cannot delegate again. Capacity is shared across the full tree, and parent lifecycle paths now own bounded descendant cleanup. Initialization cancellation, fail-fast batch failure, late-resource disposal, stale terminal-race prevention, and terminal handle release were hardened.

## Files

- `subagents/core.ts`
- `subagents/index.ts`
- `subagents/test/core.test.ts`
- `subagents/README.md`
- `subagents/package.json`
- `subagents.md`
- `global-AGENTS.md`
- `skills/senior-agent/SKILL.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/pi-child-session-sdk-and-nested-lifecycle.md`
- `.internal-dev/reviews/2026-07-21-subagent-nested-lifecycle-review.md`
- `.internal-dev/bugs/.archive/subagent-launch-sdk-regression/report.md`

## Behavioral Impact

- Child initialization now uses `services.modelRuntime.getModel()` and `hasConfiguredAuth()`, restoring launch compatibility with Pi 0.80.10.
- Nesting remains denied by default. `allowSubagents: true` atomically grants the fixed spawn/poll/status/cancel bundle only to a root child.
- The supported hierarchy is root → direct child → escalation agent; depth-2 agents cannot receive another grant.
- The eight-agent cap applies across the complete hierarchy.
- Cancellation, completion, turn limits, initialization failure, reload, and shutdown cascade through owned descendants with bounded local accounting.
- Exact tool fingerprints, immutable result snapshots, paginated retrieval, and delivery semantics remain enforced.
- Package version is now `0.3.0`.

## Specification Impact

Updated `specifications/decisions.md` with the accepted one-layer delegation, fixed control-bundle, tree-wide capacity, and parent-owned lifecycle contract. Updated the public subagents contract, global escalation guidance, and senior-agent skill compatibility.

## Risks

Remote provider work may continue after local cancellation when the provider does not cooperate; only bounded local accounting and session disposal are guaranteed. Exact tool fingerprints include source identity, so root and child sessions must load the same installed extension identity.

## Follow-up Items

The installed extension, global policy, and senior-agent skill copies were refreshed. Fresh-process acceptance reached `openai-codex/gpt-5.6-sol:xhigh` through the nested layer and returned `ADVANCED_READY`. Reload or start a new Pi session because an already-running session retains its previously loaded module and prompt context.
