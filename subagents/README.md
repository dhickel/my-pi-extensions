# Pi Subagents Extension

This extension adds a flat pool of isolated, in-memory Pi SDK sessions (v0.2.0). It provides exact, atomically validated tool policies, immutable result snapshots, UTF-8-safe paginated retrieval, and bounded terminal shutdown. Nested subagents are unsupported.

## Tools

- `subagent_spawn` — atomically validates and initializes batches of up to eight agents. Every agent supplies a **complete exact** array of case-sensitive tool API names (use `[]` for no project tools). Invalid, unavailable, forbidden, duplicate, or fingerprint-mismatched tools reject the **complete spawn batch** before any child initializes.
- `subagent_poll` — waits for and consumes newly completed terminal results exactly once. Returns every previously undelivered result. If none is ready, blocks up to `timeoutSeconds` (default 60). Only one blocking poll may run at once.
- `subagent_status` — inspects subagent states, turns, usage, duration, and errors **without consuming** poll results. Use `includeResults: true` to retrieve completed final text, or `resultPage` to page through oversized results one segment at a time.
- `subagent_cancel` — aborts and disposes selected agents by name, or every agent with `all: true`. Terminal results are marked delivered. Cancellation is bounded: a configurable grace period (default 5 seconds) allows cooperative cleanup; non-cooperative children are force-detached.

## Tool Policy

Every `subagent_spawn` call supplies a **complete exact** array of tool API names per agent. The extension validates the batch atomically:

1. Every requested tool name is resolved against the active tool catalog.
2. Inactive, unknown, duplicate, forbidden, or root-only tools reject the entire batch.
3. The tool fingerprints (name + description + parameter schema) of each active definition are compared against the catalog; a fingerprint mismatch rejects the batch.
4. Excluded tool definitions, schemas, and prompt guidance never enter child context.

Children **never** receive subagent tools (`subagent_spawn`, `subagent_poll`, `subagent_status`, `subagent_cancel`) or user-questioning tools (`ask_user_choices`, `ask_user_text`). This list is encoded in `CHILD_EXCLUDED_TOOL_NAMES` and cannot be overridden by callers. Nesting is structurally impossible in the current version.

## Pool Shape

- Flat, root-owned pool. No nested pools or parent-child hierarchies.
- Names are case-insensitively unique for the lifetime of a root session.
- Maximum 8 active agents at once (`MAX_CONCURRENT_AGENTS`).
- Each child is capped at 300 assistant turns (`MAX_ASSISTANT_TURNS`).
- Children inherit the root cwd, current model, and thinking level by default. Provider, model, and thinking level can be overridden per child.
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
- `session_shutdown` (quit, reload, new, resume, fork) cancels all active children.
- A configurable grace period (`DEFAULT_SHUTDOWN_GRACE_MS`, 5 seconds) allows cooperative children to finish.
- After the grace period, non-cooperative children are **force-detached**: their sessions are disposed, root accounting settles once, and they can never deliver a late result or mutate root state.
- Documentation uses `"root accounting detached"` rather than `"provider terminated"` — the local session was disposed, but remote provider work may continue.
- Active-count leaks and duplicate completion are prevented: every child settles exactly once.

## Footer

The footer shows `subagents: N` where initializing and running sessions count toward `N`.

## Test

```sh
npm --prefix subagents test
```
