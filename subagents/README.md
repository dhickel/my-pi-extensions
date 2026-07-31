# Pi Subagents Extension

This extension adds isolated, in-memory Pi SDK subagent sessions (v0.5.0). It provides atomically validated tool policies, immutable result snapshots, UTF-8-safe paginated retrieval, bounded cascading shutdown, and one opt-in nested delegation layer. Nesting is off by default.

## Tools

- `subagent_spawn` — atomically validates and initializes batches of up to eight agents. Omit `tools` to grant every registered child-allowed ordinary tool. Provide a **complete exact** array of non-subagent, case-sensitive tool API names to restrict the child, or `[]` for none. Invalid, unregistered, forbidden, duplicate, or fingerprint-mismatched tools reject the **complete spawn batch** before any delegated task starts. `allowSubagents: true` is the only way to grant the fixed control bundle, and only root children may receive it.
- `subagent_poll` — waits for and consumes newly completed terminal results exactly once. Returns every previously undelivered result. If none is ready, blocks up to `timeoutSeconds` (default 60). Only one blocking poll may run at once.
- `subagent_status` — inspects subagent states, turns, usage, duration, and errors **without consuming** poll results. Use `includeResults: true` to retrieve completed final text, or `resultPage` to page through oversized results one segment at a time.
- `subagent_cancel` — aborts and disposes selected agents by name, or every agent with `all: true`. Terminal results are marked delivered. Cancellation is bounded: a configurable grace period (default 5 seconds) allows cooperative cleanup; non-cooperative children are force-detached.

## Tool Policy

Every `subagent_spawn` agent uses one of three ordinary-tool modes:

- omit `tools` — grant all registered ordinary tools allowed in children;
- `tools: []` — grant no ordinary tools;
- `tools: ["read", ...]` — restrict the child to that complete exact allowlist.

A registered tool may be named even when it is inactive in the caller; the child session enables it. An absent tool definition is unregistered and cannot be requested. In the standard coding harness, use `bash` for grep/find/listing commands instead of requesting separate `grep`, `find`, or `ls` APIs.

The extension validates the resolved tool set atomically:

1. Every requested tool name is resolved against the registered tool catalog.
2. Unknown, duplicate, or forbidden tools reject the entire batch; registered inactive tools are enabled for the child.
3. The tool fingerprints (name, description, parameter schema, prompt guidance, and source metadata) of each active definition are compared against the catalog; a fingerprint mismatch rejects the batch.
4. Default-all mode includes registered inactive tools but excludes always-forbidden child tools and the separately managed control bundle.
5. The four control tools (`subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel`) cannot be listed manually in `tools`.
6. `allowSubagents: true` appends that complete, exact control bundle. The grant fails atomically if any control tool is unregistered, forbidden, or drifted.
7. User-questioning tools (`ask_user_choices` and `ask_user_text`) remain forbidden to every child.
8. Excluded tool definitions, schemas, and prompt guidance never enter child context.

`allowSubagents` defaults to `false`. It is valid only when the root spawns a direct child. A nested agent cannot receive controls or spawn another agent, even if it requests `allowSubagents: true` or manually names a control tool.

Default-all example:

```json
{
  "agents": [
    {
      "name": "implementer",
      "task": "Implement the requested change. Delegate one focused supporting task if useful.",
      "allowSubagents": true
    }
  ]
}
```

Here the child receives every registered child-allowed ordinary tool plus the managed control bundle. Add `"tools": ["read", "bash", "edit"]` to restrict ordinary tools, or `"tools": []` to grant only the managed controls.

## Pool Shape

- Supported hierarchy: root → opted-in child → nested agent. No third agent layer is permitted (`MAX_SUBAGENT_DEPTH = 2`).
- Names are case-insensitively unique for the lifetime of each owning manager; a nested manager has its own namespace.
- Maximum 8 initializing or running agents across the **complete tree**, not eight per manager (`MAX_CONCURRENT_AGENTS`).
- Each child is capped at 300 assistant turns (`MAX_ASSISTANT_TURNS`).
- Children inherit the caller cwd, current model, and thinking level by default. Provider, model, and thinking level can be overridden per child.
- A child receives only its delegated task as conversation history; it does not see the caller transcript.

## Result Snapshots and Pagination

Each completed subagent result is stored in **one immutable in-memory snapshot**. The model-visible tool output is capped at Pi's 50 KB / 2,000-line limit; complete final text remains in memory for the root session lifetime.

For oversized results:

- Use `subagent_status` with `resultPage: { name, cursor?, maxBytes? }` to retrieve UTF-8-safe page segments.
- Each page carries stable versioned identity, digest, total byte count, cursor, page length, and terminal completion metadata.
- Reconstruct by collecting pages in cursor-sorted order and concatenating byte-for-byte (never by string slicing).
- Verify the final digest and byte count against the complete-result digest.
- Pages end on UTF-8 code-point boundaries — multibyte characters are never split.
- Cursors are session-scoped and invalid after root session end.

Pagination supplements truncated delivery. Poll delivery and result-lifetime semantics remain unchanged.

## Cancellation, Shutdown, and Detachment

- `subagent_cancel` aborts, disposes, and marks selected children as delivered.
- Parent cancellation, ordinary parent completion, turn-limit termination, initialization failure, and `session_shutdown` all cascade through the parent's owned nested manager.
- A parent result is not published until descendant shutdown settles or reaches the local cleanup bound.
- Batch initialization is fail-fast: one initializer failure aborts its still-initializing siblings, and late-created sessions are disposed without starting their tasks.
- A configurable grace period (`DEFAULT_SHUTDOWN_GRACE_MS`, 5 seconds) allows cooperative children to finish cleanup.
- After the grace period, non-cooperative children are **force-detached**: their local sessions are disposed, root accounting settles once, and they can never deliver a late result or mutate root state.
- Documentation uses `"root accounting detached"` rather than `"provider terminated"` — the local in-memory session is disposed, but remote provider work may continue when the provider does not honor cancellation.
- Shared capacity is released and retained runtime handles are cleared exactly once on every terminal path.

## Footer

The footer shows `subagents: N` where initializing and running sessions count toward `N`.

## Test

```sh
npm --prefix subagents test
```
