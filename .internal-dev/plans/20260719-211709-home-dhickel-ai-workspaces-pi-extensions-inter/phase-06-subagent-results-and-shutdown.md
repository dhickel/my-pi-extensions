## Context

Large child results are currently truncated in model-visible output but cannot be reconstructed through bounded requests. Complete payloads can also escape through tool details. Cancellation and session shutdown can wait indefinitely when initialization, run, abort, or disposal is non-cooperative, allowing blocked root teardown and late state mutation.

## Goal

Add root-session-only, reconstructable result pagination and terminal, bounded root accounting for cooperative and non-cooperative children.

## In Scope

**Write Targets**: `subagents/core.ts`, `subagents/index.ts`, `subagents/test/core.test.ts`

- One immutable terminal result snapshot per child.
- UTF-8-safe result pages with authenticated opaque cursors and integrity metadata.
- Bounded cancellation, turn-limit escalation, shutdown, and disposal.
- Generation-guarded late-settlement suppression and single-settlement root accounting.
- Existing poll consumption behavior and result availability within the root-session lifetime.

## Out of Scope

- Persistent or cross-session result storage.
- Model, thinking, or exact-tool-policy changes from phase 05.
- Nested subagents.
- Generic process or provider supervision outside child sessions.
- Orchestration recovery.

## Dependencies

`phase-05-exact-subagent-tool-policy.md`

## Constraints

- `subagent_poll` continues to deliver each terminal child exactly once; status and page reads never consume poll delivery.
- Every preview and page derives from one immutable accepted terminal snapshot. Identity, digest, byte count, and terminal metadata never change afterward.
- Complete oversized bytes remain only in manager memory for the current root runtime. Model-visible content and tool details must not retain an unbounded duplicate.
- Pages reconstruct the original UTF-8 bytes exactly and return stable result identity, SHA-256 digest, total byte count, byte range, terminal metadata, completion state, and an opaque next cursor when bytes remain.
- Invalid, foreign, stale, cross-result, non-boundary, out-of-range, or modified cursors fail deterministically.
- Cancel, turn-limit escalation, reload, and shutdown reach terminal root accounting even if initialize, run, abort, or dispose never settles.
- Forced detachment does not claim provider work stopped. Late callbacks or settlements cannot alter status, turns, usage, result identity, errors, reminders, completion notifications, or active count.
- Preserve terminal cause: turn-limit terminalizes as `turn_limit`; explicit cancellation and root shutdown terminalize as `cancelled`; initialization failure terminalizes as `failed`.

## Implementation Steps

1. Extend terminal `InternalRecord` state in `subagents/core.ts` with a single immutable result snapshot created only by the winning terminalization path. Store canonical UTF-8 bytes, a stable random result id, SHA-256 digest, total bytes, and copied terminal metadata including status, provider/model/thinking, turns, usage, stop reason/error, and terminal timestamps. Derive all previews and pages from this snapshot; do not regenerate identity or digest during status calls.

2. Add a typed page request and response API. Extend `subagent_status` with an exclusive `resultPage: { name, cursor?, maxBytes? }` mode; reject combinations with `names` or `includeResults`. Keep ordinary status behavior and non-oversized `includeResults` compatibility. For oversized results, poll/status responses expose a bounded preview and page reference metadata rather than complete `finalText` in either content or details. A page response contains schema version, child name, result id, status, SHA-256, total bytes, `[startByte, endByte)`, page text, terminal metadata, `complete`, and optional `nextCursor`.

3. Implement manager-local, versioned authenticated cursors. Generate a per-manager secret and encode `{ version, resultId, offset }` with an HMAC; compare authentication data without timing-sensitive equality. Validate schema, authentication, selected record, immutable result id, integer range, and UTF-8 boundary before reading bytes. Require integer `maxBytes` within a documented bounded range with a minimum of four bytes. End each page at the largest code-point boundary within the cap, emit a cursor only when bytes remain, and return an empty complete page for a zero-byte result. The same request against the same snapshot must produce the same page and cursor.

4. Update `capModelOutput`, truncation notices, `subagent_status` schema/description, and renderable details in `subagents/index.ts`. Direct callers to `resultPage` with the child name and stable result metadata. Ensure spawn, poll, status, cancel, and page tool results never place complete oversized output in model-visible content or persisted tool details. Keep the full immutable snapshot only inside the current manager instance; reload creates a new manager and old cursors become invalid.

5. Add a lifecycle generation token and detachment state to each record. Route all terminal outcomes through one idempotent terminalization primitive that atomically wins the generation, freezes terminal fields and the result snapshot, resolves `done` once, updates active accounting once, and emits at most one change/completion notification. A losing finish attempt is a no-op across status, turns, usage, result data, errors, reminders, and accounting.

6. Add exception-safe bounded helpers for abort and disposal, with the bound scheduler injectable through `SubagentManagerOptions`. For running records, request abort without assuming it settles, allow cooperative completion within the configured grace bound, then terminalize with the requested cause, detach the handle, request bounded idempotent disposal, and return. For starting records, cancellation/shutdown must race and terminalize without awaiting batch initialization. Observe every late initialization promise; a late handle is never started and is disposed through the same bounded helper. Use bounded disposal as well for successful handles in an atomically failed initialization batch. Catch synchronous throws and observe all rejected promises.

7. In `#run` and `onTurn`, capture the accepted generation token and check it before every mutation. Copy result, usage, stop reason, errors, and turn counts only while that token remains current. If detachment has won, discard all late fields, request idempotent bounded disposal, and never invoke terminalization again. A non-cooperative run promise may remain detached, but it must have rejection observation and no root-state authority.

8. Make explicit cancel, root shutdown, and turn-limit escalation call the same terminalization flow with their distinct terminal causes. Mark selected explicit-cancel and shutdown results delivered according to existing behavior; leave turn-limit results available to normal poll delivery. Resolve `done` once, clear active count before each operation returns, keep reminder state consistent with delivery state, and ensure repeated cancel/shutdown/disposal calls are idempotent. `session_shutdown` for reload uses this path and cannot retain old page state.

9. Extend `subagents/test/core.test.ts` with deterministic fake handles and an injectable bound scheduler. Cover multibyte multi-page reconstruction, zero-byte output, digest and byte verification, stable identity/cursors, minimum and maximum page sizes, exact boundaries, tampering, foreign/cross-result/stale cursors, nonterminal requests, and reordered or duplicated page detection from ranges and digest. Assert ordinary status paging is non-consuming and poll still delivers each terminal result once. Independently exercise synchronous throws and never-settling initialize, run, abort, and dispose behavior during explicit cancel, turn-limit escalation, reload-labeled shutdown, and ordinary shutdown; assert terminal cause, bounded return, zero active count, one completion notification, no unhandled rejection, and no mutation after detachment.

## Invariants

- A record has at most one accepted terminal generation and one result snapshot.
- Snapshot identity, bytes, digest, byte count, and terminal metadata are immutable.
- Every emitted page starts and ends on UTF-8 code-point boundaries; contiguous emitted ranges cover `[0, totalBytes)` exactly.
- Only an authenticated cursor emitted by the current manager for the selected immutable result can advance paging.
- Status and paging are read-only with respect to poll delivery.
- Terminal records never contribute to active count, and each `done` promise resolves once.
- Disposal is idempotent and never grants a detached child authority to mutate root state.

## Edge Cases

- Empty text returns one complete empty page with no next cursor.
- A four-byte character fits the minimum page request and is never split.
- A cursor for another child, another result generation, or a prior manager is rejected even when its offset is numerically valid.
- A validly shaped but modified cursor, a non-integer or out-of-range offset, and a non-boundary offset are rejected.
- Cancellation while one batch member is still initializing terminalizes the affected records without starting any late handle or violating atomic batch start.
- Abort may settle while run does not; run may settle while disposal does not; every combination still reaches one terminal root state.
- A child may complete concurrently with forced detachment. Exactly one generation wins, and the loser publishes nothing.
- Late `onTurn`, resolution, rejection, abort, or disposal activity cannot recreate reminders or alter terminal snapshots.

## Required Guides

- Pi `docs/extensions.md`, especially session shutdown, custom-tool output truncation, and tool details.
- Pi `docs/sdk.md`, especially `AgentSession.abort()` and `dispose()` behavior.

## Technical Guidance

Use Node crypto primitives already available to the package for result ids, SHA-256, HMAC, and constant-time authentication checks. Cursor secrecy is unnecessary; authenticity and manager-local invalidation are required. Keep paging synchronous over the immutable byte buffer if that matches the existing manager API. A forced-detachment error should state that root accounting ended after the child failed to cooperate and that provider execution may not have stopped.

## Validation

- Run `npm --prefix subagents test`.
- Reconstruct output containing one-, two-, three-, and four-byte characters plus thousands of lines; assert exact bytes, text, digest, ranges, identity, and terminal metadata.
- Verify cursor authentication and deterministic rejection for modified, foreign, stale, cross-result, out-of-range, non-boundary, and nonterminal requests.
- Verify complete oversized text is absent from model-visible content and tool details while page reconstruction remains complete within the root manager lifetime.
- Confirm status/page reads never consume results and poll still delivers each terminal result exactly once.
- Simulate every independently non-settling or synchronously throwing lifecycle operation across cancel, turn-limit, reload shutdown, and ordinary shutdown; assert terminal status, zero active count, one settlement notification, observed late rejections, and immutable post-detachment state.

## Exit Criteria

- Oversized child output is exactly reconstructable through authenticated UTF-8-safe pages during the root runtime without an unbounded copy in tool output or details.
- Page identity, integrity metadata, ranges, boundaries, and cursor failures are deterministic.
- Poll consumption and root-session result availability remain compatible.
- Cancellation, turn-limit escalation, reload, and shutdown terminalize root accounting for cooperative and non-cooperative initialization, run, abort, and disposal.
- Late child activity cannot double-complete, mutate a terminal snapshot, leak active/reminder state, or produce unhandled rejections.
- The focused subagents suite passes.
