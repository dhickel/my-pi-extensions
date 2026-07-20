## Context

`subagent_spawn` currently derives every child’s tools from the caller’s filtered active set. An agent cannot request a complete exact set, and tool-policy failures are not part of the same side-effect-free spawn preflight as model, authentication, and thinking validation. Child construction also needs an exact post-bind active-definition check, and the package omits peer declarations for directly imported Pi APIs.

## Goal

Enforce a complete exact child tool policy for every agent and reject an invalid spawn batch atomically before child initialization.

## In Scope

**Write Targets**: `subagents/core.ts`, `subagents/index.ts`, `subagents/package.json`, `subagents/test/core.test.ts`

- Required exact tool-name sets on every agent specification.
- Atomic model, authentication, thinking, tool-availability, eligibility, and fingerprint resolution.
- Exact child active-tool construction and removal of excluded active-only prompt metadata.
- Post-bind fingerprint drift detection before any delegated task starts.
- Required `subagents` peer dependencies.

## Out of Scope

- Result snapshots, pagination, cancellation bounds, detachment, or shutdown accounting.
- Orchestrate, senior-agent, or image-viewing skill policy.
- Nested subagents or a new child sandboxing framework.
- Caller-supplied fingerprints, wildcard policies, role registries, or fallback tool sets.

## Dependencies

none

Phase 06 consumes the resolved exact policy. Phase 08 consumes the public spawn behavior and supplies role-specific exact sets.

## Constraints

- `tools` is required and is the complete case-sensitive API-name set; `[]` means no project tools.
- Requested order is preserved. Identical duplicate names are invalid rather than deduplicated.
- Unknown, inactive, unavailable, forbidden, root-only, or subagent-control names reject the complete batch. Never silently remove, add, inherit, clamp, substitute, or fall back to another tool set.
- Preflight rejection creates no records, reserves no lifetime names, invokes no adapter initialization, and starts no task.
- Root catalog fingerprints are computed internally from exact registered metadata. The caller does not provide trusted fingerprint values.
- A child receives only the accepted active definitions and their active-only prompt snippets/guidelines. Excluded metadata must not enter its model context.
- A post-bind active-set or fingerprint mismatch fails batch initialization, disposes every initialized sibling, and starts no task.
- Preserve the flat root-owned pool, case-insensitive lifetime agent-name uniqueness, existing model-selection semantics, and the eight-active-agent limit.
- Preserve existing poll, status, result-delivery, cancellation, and shutdown behavior for phase 06.

## Invariants and Edge Cases

- Build one immutable catalog snapshot per `subagent_spawn` execution from `pi.getAllTools()` and `pi.getActiveTools()`. A requested name is eligible only when it has one reproducible registered definition, is active in that snapshot, and is not forbidden.
- Treat an active name with no registered metadata, duplicate catalog identity, or non-reproducible fingerprint input as an invalid catalog; reject before manager mutation.
- Fingerprints include `name`, `description`, `parameters`, `promptGuidelines`, and `sourceInfo`. Canonicalization sorts object keys, omits only `undefined` object properties, and preserves array order.
- Resolve each agent independently from the shared catalog; store a fresh immutable ordered fingerprint list on each `ResolvedAgentSpec` so one agent’s policy cannot alias mutable caller data.
- Empty policies must remain empty through SDK session creation and extension binding. If the SDK path needs an explicit no-tools option to avoid defaults, use it in addition to the empty allowlist.
- After binding child extensions, compare the requested names with `session.getActiveToolNames()`. Then map only those active names to `session.getAllTools()` metadata and compare ordered identities plus fingerprints. Do not compare the request with every configured inactive child tool.
- Dynamic child extension activation during binding is drift when it adds or removes an active tool relative to the accepted policy.
- Preserve the existing batch initialization barrier: initialize siblings as needed to reproduce resources, but invoke no `run` method until every child has passed model, thinking, active-tool, and fingerprint checks.
- Explicitly forbid `subagent_spawn`, `subagent_poll`, `subagent_status`, `subagent_cancel`, `ask_user_choices`, and `ask_user_text`. Requests containing one of these names fail; nested spawning remains unsupported.
- Model/authentication/thinking and tool-policy checks form one pure preflight. Explicit unsupported thinking remains an error; do not weaken existing exact override validation while adding tools.

## Implementation Steps

1. Add required `tools: string[]` to `AgentSpec` in `subagents/core.ts` and to the TypeBox agent schema in `subagents/index.ts`. Allow `[]`; reject omission, non-arrays, non-string entries, and duplicates. Update `subagent_spawn` descriptions and rendering as needed to say that each agent supplies its complete exact set.

2. Replace `ValidationContext.expectedTools` with a catalog snapshot that distinguishes registered metadata, currently active names, and explicit forbidden names. Keep catalog and fingerprint helpers in the pure core boundary where tests can exercise them without starting sessions. Canonicalize the reproducible `ToolInfo` fields listed above; do not expose a caller fingerprint parameter.

3. Update `validateSpawnBatch` to validate every requested name exactly once in requested order and resolve it only when registered, active, child-eligible, and fingerprintable. Perform all agent-name, capacity, model-pair, authentication, thinking, tool, and catalog checks before returning resolved specs. Any failure must occur before records, lifetime reservations, adapter initialization, or task execution.

4. Carry each agent’s ordered exact fingerprints on `ResolvedAgentSpec`. Preserve the manager’s all-children initialization barrier: if any child cannot reproduce its model, thinking level, active tool names, or fingerprints, dispose fulfilled sibling handles, mark the attempted initialization consistently with existing manager semantics, and start no child task. Do not turn a drift failure into partial launch.

5. In `subagents/index.ts`, construct each child with `tools: spec.expectedTools.map((tool) => tool.name)`; ensure `[]` cannot restore SDK defaults. Bind extensions, read `session.getActiveToolNames()`, resolve metadata for only those active names from `session.getAllTools()`, and compare names and fingerprints with the accepted ordered snapshot before returning the handle. Prove excluded definitions, prompt snippets, and prompt guidelines are absent from active child context, not merely uncallable.

6. Retain explicit forbidden entries for `subagent_spawn`, `subagent_poll`, `subagent_status`, `subagent_cancel`, `ask_user_choices`, and `ask_user_text`. Reject requested forbidden names without filtering them out. Keep all subagent-control tools unavailable to children and do not enable nested spawning.

7. Add `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as `"*"` entries in `subagents/package.json` `peerDependencies`, matching the direct imports and Pi package guidance. Do not add unrelated dependencies.

8. Rewrite focused tests in `subagents/test/core.test.ts` around explicit `tools` values. Cover omission, malformed entries, empty sets, exact subsets and order, duplicate, unknown, inactive, forbidden/root-only names, malformed catalog metadata, mixed-batch preflight rejection with zero initialization and zero lifetime reservation, and post-bind fingerprint/active-set drift with sibling disposal and zero task starts. Use sentinel descriptions/guidelines to prove excluded prompt metadata is absent. Include implementer- and validator-style edit-capable sets and a preflight-style empty set. Use fakes or local in-memory session construction only; no paid model calls.

9. Add a regression assertion that `THINKING_LEVELS` contains `xhigh` exactly once. The current list is already correct; do not otherwise rewrite it.

## Required Guides

- Pi `docs/extensions.md`, especially active versus configured tools and active-only prompt metadata.
- Pi `docs/sdk.md`, especially exact `tools` allowlists and no-tools behavior.
- Pi `docs/packages.md`, especially core-package peer dependencies.

## Technical Guidance

Prefer a catalog shape equivalent to:

```ts
type ToolCatalog = ReadonlyMap<string, {
  active: boolean;
  forbidden: boolean;
  fingerprint: ToolFingerprint;
}>;
```

The exact type may follow repository conventions, but validation must consume one spawn-local snapshot rather than repeatedly querying mutable Pi state. Keep `compareToolFingerprints` deterministic and diagnostic: report missing, unexpected, and changed active definitions without dumping schemas or prompt text. Copy arrays at boundaries so later caller or extension mutation cannot alter an accepted policy.

`pi.getAllTools()` is the configured metadata source; it is not the child’s active set. Use `pi.getActiveTools()` at root preflight and `session.getActiveToolNames()` after child binding to establish availability. Resolve metadata by those names before fingerprint comparison.

## Validation

- Run `npm --prefix subagents test`.
- Assert schema/runtime rejection when `tools` is omitted and acceptance when `tools: []` is explicit.
- Assert a two-agent batch with one invalid requested set initializes zero children, reserves zero names, and leaves status empty.
- Assert a post-bind mismatch disposes every initialized sibling and invokes no child `run` method.
- Assert a child with `tools: []` has no active project definition, snippet, or guideline.
- Assert a child requesting an edit-capable subset receives exactly that active set and no subagent or user-questioning metadata.
- Assert unknown, inactive, duplicate, forbidden, and fingerprint-drift cases have distinct deterministic diagnostics.
- Validate `subagents/package.json` peer declarations against every Pi core import in `subagents/index.ts`.
- Confirm `THINKING_LEVELS.filter((level) => level === "xhigh").length === 1`.

## Exit Criteria

- Every spawn agent specification carries an explicit complete exact tool-name set.
- All preflight failures reject the complete batch before records, lifetime reservations, child initialization, or task starts.
- Every initialized child’s active names and fingerprints exactly match its accepted policy before any task starts.
- Excluded tool definitions and active-only prompt guidance do not enter child model context.
- `tools: []` reliably creates a preflight-style child with no project tools.
- Implementer and validator policies can retain the exact inspection, editing, and command tools their callers request.
- Root-only, user-questioning, and subagent-control tools remain forbidden; nested subagents remain unsupported.
- Existing pool limits and unrelated lifecycle/result behavior remain unchanged.
- The package declares all directly consumed Pi core peer dependencies.
- `npm --prefix subagents test` passes, with the required atomicity, drift, context-filtering, role-policy, and thinking-level regressions.
