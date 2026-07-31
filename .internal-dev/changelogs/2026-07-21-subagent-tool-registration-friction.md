# Subagent tool registration friction

## Date

2026-07-21

## Git Commit

d259525fac758c5b16710579ee3ce1db04c2a353

## Change Summary

Removed remaining launch retries caused by conflating caller-inactive tools with unregistered tool APIs. Subagent v0.5.0 now selects every registered child-allowed ordinary definition when `tools` is omitted and allows explicit lists to activate registered caller-inactive definitions. Fixed senior and orchestrate skill tool sets now use only standard coding-harness APIs, with search and listing performed through `bash`.

## Files

- `subagents/core.ts`
- `subagents/index.ts`
- `subagents/test/core.test.ts`
- `subagents/README.md`
- `subagents/package.json`
- `skills/senior-agent/SKILL.md`
- `skills/image-viewing/SKILL.md`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `sprint-planner/test/core.test.ts`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/pi-child-session-sdk-and-nested-lifecycle.md`
- `.internal-dev/reviews/2026-07-22-subagents-v0.5-tool-contract-final-review.md`
- `.internal-dev/bugs/.archive/subagent-tool-registration-friction/report.md`

## Behavioral Impact

- Omitted `agents[].tools` grants every registered child-allowed ordinary tool, including definitions inactive in the caller.
- Explicit exact lists may activate registered caller-inactive tools; only absent definitions are rejected as unregistered.
- `tools: []`, forbidden user-questioning tools, and separately gated subagent controls retain their prior semantics.
- Senior advisory now uses only `read`; edit-authorized senior and orchestrate workers use `read`, `bash`, `edit`, and `write` and run search/listing commands through `bash`.
- Image viewing remains exactly read-only.
- Subagents package version is `0.5.0`; senior-agent skill is `3.0.0`, orchestrate is `4.0.0`, and image-viewing is `2.1.0`.

## Specification Impact

Revised the default-all decision to use the complete registered child-allowed catalog rather than only the caller-active subset, and documented the distinction between caller-inactive and unregistered APIs.

## Risks

Default-all is intentionally broad; sensitive delegations should supply exact allowlists. Explicit lists cannot enable a tool whose definition is absent from `pi.getAllTools()`. Exact reproduction still depends on matching root/child definitions and source fingerprints.

## Follow-up Items

The installed extension and global senior/image skill copies were refreshed. Fresh-process acceptance omitted `tools`, received the registered default catalog, and read an unknown nonce. A fresh-process senior review also launched once with the exact standard four-tool edit set and passed. Reload or start a new Pi session because an existing session retains its prior schema and skill prompt context.
