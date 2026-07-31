# Subagent default-all tools

## Date

2026-07-21

## Git Commit

d259525fac758c5b16710579ee3ce1db04c2a353

## Change Summary

Changed omitted `subagent_spawn` agent tool policy from no ordinary tools to every registered child-allowed ordinary tool, including definitions inactive in the caller. Explicit arrays remain exact restrictions: `tools: []` grants none and a nonempty list grants only those names, while explicitly naming a registered inactive tool enables it for the child. Updated the provider-facing schema description and prompt guidance to state the three modes and activation behavior directly.

## Files

- `subagents/core.ts`
- `subagents/index.ts`
- `subagents/test/core.test.ts`
- `subagents/README.md`
- `subagents/package.json`
- `subagents.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/pi-child-session-sdk-and-nested-lifecycle.md`

## Behavioral Impact

- Omitting `agents[].tools` now grants all registered ordinary tools allowed in child sessions, including definitions inactive for the caller.
- `tools: []` continues to create a child with no ordinary tools.
- A nonempty `tools` list remains a complete exact allowlist with atomic validation and fingerprint reproduction; registered inactive names are enabled for the child.
- Default-all mode excludes `ask_user_choices`, `ask_user_text`, and the managed subagent controls.
- `allowSubagents` remains the only way to grant the fixed control bundle.
- Package version is now `0.5.0`.

## Specification Impact

Superseded the v0.3.1 empty-default decision with the user-directed default-all contract while retaining explicit exact restrictions and the existing child-forbidden/control boundaries.

## Risks

Omitted tool policy is intentionally broad and can expose powerful registered project tools to a child even when they are inactive in the caller. Sensitive or least-privilege workflows should always provide an explicit allowlist. Default-all also requires the child session to reproduce every selected tool fingerprint exactly.

## Follow-up Items

Focused tests cover omitted default-all selection, explicit inactive activation, empty allowlists, forbidden names, managed controls, and initialization semantics. Reload or start a new Pi session because an already-running session retains its previously loaded schema, prompt guidance, and module.
