# Subagent tools safe default

## Date

2026-07-21

## Git Commit

d259525fac758c5b16710579ee3ce1db04c2a353

## Change Summary

Made `subagent_spawn`'s per-agent `tools` field optional with a least-privileged empty default. Omission now behaves exactly like `tools: []` instead of failing before launch. Supplied lists remain complete exact grants and retain all existing atomic availability, prohibition, duplicate, and fingerprint checks. Updated nesting terminology to describe general delegated tasks rather than only escalation.

## Files

- `subagents/core.ts`
- `subagents/index.ts`
- `subagents/test/core.test.ts`
- `subagents/README.md`
- `subagents/package.json`
- `subagents.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/pi-child-session-sdk-and-nested-lifecycle.md`
- `.internal-dev/bugs/.archive/subagent-tools-schema-omission/report.md`

## Behavioral Impact

- `agents[].tools` may be omitted and safely resolves to no ordinary child tools.
- The provider-facing schema requires only `name` and `task`, while still exposing `tools` with `default: []` and explicit guidance.
- Explicit tool lists remain exact rather than additive or inherited.
- `allowSubagents` remains the only control-bundle grant and is unchanged.
- Package version is now `0.3.1`.

## Specification Impact

Added a durable decision that omission means the exact empty ordinary-tool set and generalized the existing one-layer contract from escalation-only wording to arbitrary focused delegation.

## Risks

A child launched without tools may be unable to complete a task that requires repository or environment access. Callers must still list every required ordinary tool explicitly; omission never grants implicit capabilities.

## Follow-up Items

The installed extension was refreshed and fresh-process acceptance completed without a `tools` property. Reload or start a new Pi session because an already-running session retains its previously loaded schema and module.
