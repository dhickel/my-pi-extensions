# Handoff: Read-only `/sprint history`

## Context

The sprint-planner package persists planning and execution-only run records under `.internal-dev/sprints/<run-id>/`. Existing `/sprint list` and `/sprint doctor` commands provide structural discovery and diagnosis, but there is no concise view of completed work.

Planning and execution records have different completion evidence:

- Completed execution records have an authoritative, schema-validated `completedAt` in `execution/record.json`.
- A planning run may retain a completed `.state.json` with `completedAt`, but normal successful cleanup removes `.state.json` after publishing `manifest.md`.
- Existing cleaned planning runs therefore have only the safely observed manifest modification time as completion evidence. Copying, restoration, or manual editing can change that value, so it cannot prove the historical completion instant.

The feature must be honest about chronology: it shows up to five completed persisted run records ordered by the best validated completion evidence available, not five guaranteed logical sprint initiatives or an objectively exact historical order when approximate planning evidence is involved.

## Objective

Add `/sprint history` as a trusted-project, no-argument management command that presents a compact, deterministic, read-only chronology of up to five completed planning or execution run records.

Each displayed entry must identify the run, distinguish its kind, show a canonical UTC completion timestamp and whether it is approximate, show a terminal-safe directive summary, and report the number of declarations in the completed record’s canonical artifact inventory. Root failures and damaged or inconclusive records must not be misrepresented as clean empty history.

## Targets

- `sprint-planner/history.ts` — new internal history reader, result model, bounded safe metadata reads, planning-state parsing integration, authority rules, ranking, diagnostics, section parsing, and display-data sanitization.
- `sprint-planner/commands.ts` — recognize `history`, reject every suffix, and update usage text.
- `sprint-planner/index.ts` — trusted-project dispatch, exact formatting, empty/error/degradation messages, severity selection, and command completion.
- `sprint-planner/artifacts.ts`, `sprint-planner/execution-records.ts`, and/or `sprint-planner/run-records.ts` — only as needed to expose existing pure schema parsing, direct-child enumeration/classification, or a shared bounded descriptor-read primitive without duplicating record validation or inheriting discovery’s collapsed root-read failure behavior.
- `sprint-planner/test/core.test.ts` or a focused `sprint-planner/test/history.test.ts` — parser, authority, resilience, security, output, and read-only coverage.
- `sprint-planner/README.md` — command behavior, chronology limitations, completion evidence, diagnostics, and recorded-artifact counts.
- `.internal-dev/specifications/sprint-planner-suite.md` — living command, persistence, security, and validation contract.
- `.internal-dev/specifications/decisions.md` — record the accepted mixed-evidence chronology and canonical inventory-count semantics as durable product decisions.
- `.internal-dev/changelogs/` — finalized implementation record with the required Git baseline and specification impact.

Keep the history model internal to `history.ts`. Do not add a public barrel export unless an actual non-command consumer is introduced.

## Features

- `/sprint history` with no flags, count option, kind filter, or run-id argument.
- A unified timeline containing planning and execution-only persisted records, labeled `[planning]` and `[execution]`.
- Up to five successfully qualified completed records across the project store, independent of Pi session binding and lease ownership.
- Newest-first ranking by validated completion epoch, with a deterministic UTF-8 bytewise run-id tiebreaker.
- Two-line entries:

  ```text
  20260720-143052-auth  [planning]  2026-07-20T14:31:00.000Z (approx.)  recorded-artifacts=24
    Add OAuth authentication for Google and GitHub…
  ```

- Explicit metadata fallbacks: `recorded-artifacts=unknown` and `(directive not recorded)`.
- Exact clean header `Completed sprint runs:` when one through five records qualify.
- Exact truncated header `Completed sprint runs (showing 5 of <N>):` when more than five records qualify, where `<N>` is the total number of successfully qualified completed records before limiting.
- Exact clean empty state, used only when the root scan succeeded and no qualifying or inconclusive completion candidate exists: `No completed sprint runs found in .internal-dev/sprints/.`
- Exact zero-entry degraded lead when no entry can be shown but one or more candidates are inconclusive: `No readable completed sprint runs could be established; history is partial.`
- An exact degradation footer after any displayed entries when diagnostics are nonzero:
  `History is partial: <O> record(s) omitted because completion evidence was unsafe or unreadable; <D> displayed record(s) have incomplete metadata.`
  Omit either semicolon-delimited clause when its count is zero. Use `record` for one and `records` otherwise.

## Settled Decisions

- **Record identity:** “Last five” means up to five persisted run records, not five deduplicated user initiatives. A planning record and a related execution record may both appear.

- **Eligibility:** Include only planning or execution-only records whose canonical completion evidence resolves to `completed`. Active, running, paused, interrupted, blocked, failed, cancelled, ambiguous, malformed, unknown, and unsafe records never appear. Terminal does not mean completed.

- **Planning state precedence:**
  - The presence of any `.state.json` directory entry is authoritative over `manifest.md` for that scan.
  - A state marker must be a safely opened regular file, pass the 4 MiB bound, remain identity- and metadata-stable through the read, and pass the current strict planning-state schema and run-directory ownership checks.
  - A valid state whose status is not `completed` excludes the run normally and does not increment omission diagnostics.
  - A symlinked, non-regular, oversized, unreadable, malformed, unsupported, mismatched, or concurrently changing state marker makes completion inconclusive. Do not fall back to the manifest; omit the candidate and increment the omitted count.
  - A completed valid state with a valid `completedAt` uses that authoritative timestamp.
  - A completed valid state without a usable `completedAt` may use a safely established manifest `mtime` and mark it approximate. Without such a manifest timestamp, omit it and increment the omitted count.

- **Cleaned planning runs:**
  - When `.state.json` is stably absent, a safely opened regular direct-child `manifest.md` is the established completed-and-cleaned-up marker under the current persistence contract.
  - The manifest’s opened-file `mtime` is approximate completion evidence. The file’s Markdown sections are enrichment data, not a second completion gate: missing, repeated, malformed, unreadable, or oversized section content may degrade directive or artifact metadata without erasing otherwise stable completion evidence.
  - A symlinked, non-regular, inaccessible, identity-changing, or metadata-changing manifest cannot establish completion or timestamp; omit the candidate and increment the omitted count.

- **Execution authority:**
  - The safely opened and schema-validated `execution/record.json` is authoritative.
  - Include only `state === "completed"` with a valid schema-owned `completedAt`.
  - The rendered execution manifest never overrides or repairs the record.
  - A valid non-completed execution record is a normal exclusion. An execution-shaped candidate with an unsafe, unreadable, oversized, unsupported, malformed, mismatched, or changing authoritative record increments the omitted count.

- **Marker stability and concurrency:** Capture the run-directory identity and relevant marker presence before inspection and confirm them after inspection. If the run directory changes identity, a relevant marker appears or disappears, or an opened authoritative file changes identity, size, `mtime`, or `ctime`, omit the candidate. In particular, do not qualify a manifest-only planning run if a state marker appears during inspection. Perform one best-effort scan only; lower-ranked successfully inspected records naturally backfill the result.

- **Chronology claim:** Rank all successfully qualified candidates by the exact parsed epoch value of their best evidence, descending. Mixed authoritative and approximate evidence is allowed, and approximate timestamps are visibly marked. Do not claim objectively newest historical completions.

- **Timestamp validation and display:** Accept only timestamps that the governing strict schema accepts and that convert to a finite JavaScript epoch value. Compare the exact epoch value and display `new Date(epoch).toISOString()`, which is canonical UTC with milliseconds. Manifest `mtimeMs` retains its available fractional precision for comparison even though ISO display rounds to milliseconds.

- **Ties:** Compare raw validated run ids by UTF-8 bytes with `Buffer.compare`; ascending run id wins after equal completion epochs. Kind is a final defensive ascending key even though direct-child run ids are unique.

- **Selection:** Inspect every direct child needed to establish completion evidence before sorting and limiting. Do not use run-id creation order, a fixed directory scan cap, `discoverSprintRuns()` summary state, or “first five found.”

- **Discovery reuse:** Reuse safe direct-child resolution and structural classification where their contracts fit. Do not reuse `discoverSprintRuns()` as an authoritative history result if it still converts a root `readdir` failure into an empty list or relies on unbounded path-based metadata reads. Extract a shared primitive rather than changing list behavior accidentally.

- **Directive source:**
  - Planning: use the canonical manifest `## Directive` section; if that section is absent, repeated, empty, unreadable, oversized, or otherwise unusable, fall back to safely read canonical `input.md`.
  - Execution: when `sourcePlanningRunId` safely resolves to a direct-child planning record in the same current sprints store and that source record independently qualifies as completed, use its planning directive resolution. Otherwise use `Source plan: <sourcePlanPath>`.
  - Cross-record lookup must not use the execution record’s persisted `projectRoot` as authority, escape the current sprints store, read an unvalidated source id, or turn source damage into execution-entry omission. Source lookup failure degrades only the directive and uses the source-plan fallback.

- **Section parsing:** Recognize exact level-two headings of the form `## <Name>` only outside fenced code blocks opened and closed by matching backtick or tilde fences of at least three characters. A canonical heading must occur exactly once. Its section ends at the next level-two heading outside a fence. Repeated canonical headings make that section unusable.

- **Directive text:** Select the first nonblank paragraph or list item from the chosen source section, join its physical lines with single spaces, remove Markdown list-prefix syntax from the selected item, and normalize all Unicode whitespace runs to one ASCII space. If no meaningful text remains, continue to the next source or display `(directive not recorded)`.

- **Display sanitization and truncation:** Apply the same sanitizer to every persisted string rendered in the terminal, including run id, directive text, and execution source-path fallback. Remove C0 controls, DEL, C1 controls, ANSI escape content, bidi embedding/override/isolate marks, and zero-width directional marks; normalize remaining whitespace to one ASCII space. Segment with `Intl.Segmenter` using grapheme granularity. Limit directive summaries to 120 grapheme clusters including the final `…`; values over the limit retain the first 119 clusters and append `…`. The raw validated values remain authoritative for lookup and sorting.

- **Planning artifact inventory:** A usable `## Artifacts` section occurs exactly once. Every nonblank line in the section must match the generated declaration grammar `- \`<canonical-relative-path>\` — sha256 \`<64 lowercase hexadecimal characters>\``. Paths must pass existing canonical relative-path validation and be unique. An exactly present section with no nonblank declarations is a valid zero inventory. A missing or repeated section, malformed line, unsafe path, invalid digest, or duplicate path makes the count `unknown`, not zero.

- **Execution artifact inventory:** Use the already validated `record.source.files` entries. Their schema guarantees canonical, unique, sorted entries. A valid empty array counts as zero.

- **Degraded entries:** A record with safely confirmed completion and timestamp remains eligible when only its directive or artifact count is unavailable. It consumes one of the five slots, uses explicit fallback metadata, and increments the degraded displayed-record count once regardless of how many enrichment fields are missing.

- **Omitted diagnostics:** Increment the omitted count once per direct child that has completion-like planning or execution markers but whose completion or timestamp cannot be safely established because evidence is unsafe, unreadable, unsupported, malformed, mismatched, or changed during inspection. Also count ambiguous, malformed, unknown, non-directory, and symbolic-link non-hidden direct children because they make the scan inconclusive. Do not count valid active or other valid non-completed planning/execution records. Ignore known hidden store-internal entries that are not run ids.

- **Failure distinction:** A missing, symbolic-link, non-directory, inaccessible, unreadable, or identity-changing sprints-store root is a command error. Root enumeration failure is never an empty result. Per-record damage is non-fatal and is represented by diagnostics. The exact clean-empty message is allowed only when enumeration and all relevant inspections succeeded and no completed or inconclusive candidate exists.

- **Severity:** Clean nonempty and clean-empty output use `info`. Any nonzero omitted or degraded count uses `warning`, including the zero-entry degraded lead. Store-root and root-enumeration failures use the command’s existing `error` path.

- **Arguments:** `/sprint history extra`, `/sprint history --anything`, and every other suffix are usage errors. `-- history ...` remains literal sprint prompt text under the existing option-terminator contract.

- **Exposure:** Register only the slash command. Do not add `sprint_history`, filters, pagination, or a supported public API.

- **Privacy:** Project-wide directive summaries are intentional and require the existing project-trust gate before store location or scanning. Sanitization protects terminal integrity; it does not redact secrets stored in directives.

## Constraints

- Runtime behavior is strictly read-only under application control: no file creation, writes, renames, deletion, repair, cache updates, session binding, lease acquisition, lease release, takeover, or state transition.
- Shared discovery may inspect leases read-only, but history must neither display nor alter lease ownership.
- Reuse existing direct-child resolution, structural classification, and pure record parsers where their contracts fit. Do not create a second interpretation of run kinds, planning state, or execution schemas.
- Reject symbolic-link roots, run directories, manifests, input files, state files, execution directories, and execution records. An unsafe authoritative marker cannot be bypassed by a lower-precedence fallback.
- Use descriptor-based no-follow reads following the established project pattern: pre-open `lstat`, read-only `open` with `O_NOFOLLOW` where available, opened-file regularity and identity checks, a pre-read size bound, bounded reading, and post-read identity, size, `mtime`, and `ctime` checks. Verify relevant parent and marker identities around the candidate inspection.
- Use named maximum sizes of 4 MiB for `.state.json`, planning manifests, and planning inputs, and 64 KiB for execution records. Oversized state or execution authority causes omission; oversized manifest or input content remains usable only for stable manifest completion evidence and otherwise degrades enrichment as defined above.
- If extraction is needed, expose a pure planning-state parser with the same strict schema and ownership checks currently enforced by `SprintStateStore.load()`. Keep the existing writer and loader behavior compatible.
- The safety claim is direct-child and symbolic-link protection, not containment against hard links, bind mounts, or privileged filesystem manipulation.
- Keep formatting and exact user-facing strings in the command layer; keep filesystem, qualification, diagnostics, sorting, and sanitization semantics in `history.ts`.
- Keep aggregate diagnostics free of raw filesystem error details in normal terminal output. Tests and internal result types may retain stable reason codes, not secret path contents.
- Do not change planning-manifest production, execution-record production, or migrate historical records. The approximate marker is the accepted compatibility behavior for cleaned planning runs.
- Reading can cause operating-system access-time updates on some mounts. Read-only validation must assert the absence of application write operations and ignore atime-only effects.

## Scope

### In scope

- Command parsing, completion, usage text, trust enforcement, and exact UI output.
- Internal typed history entries plus aggregate totals and diagnostics for omitted and degraded records.
- Safe root enumeration and structural classification with independent confirmation of canonical completion evidence.
- Planning and execution enrichment, bounded execution-to-planning directive lookup, ranking, limiting, sanitization, and deterministic formatting.
- Per-record resilience for deletion races, permission failures, malformed content, missing or repeated sections, oversized metadata, unsupported schemas, unsafe links, and identity replacement.
- Documentation, living specification updates, durable decision records, tests, and changelog closeout.

### Out of scope

- Showing blocked, interrupted, failed, cancelled, active, running, or paused records.
- Deduplicating planning and execution records into logical initiatives.
- `--all`, `--count`, `--kind`, pagination, alternate sort modes, or configurable summary length.
- Agent-callable tools or public history APIs.
- Repairing records, clearing leases, mutating manifests, or adding authoritative completion timestamps to planning manifests.
- Checking whether declared artifacts still exist or validating their hashes; `/sprint doctor` owns diagnosis.
- Redacting directive secrets beyond terminal-integrity sanitization.
- Strengthening the security claim to cover hard links, mount manipulation, or privileged actors.

## Assumptions

- Current planning completion cleanup intentionally removes `.state.json` after publishing the canonical manifest, so manifest `mtime` is the only generally available completion evidence for existing cleaned records.
- Current strict execution schema guarantees that a completed record has a valid `completedAt`, completion evidence, passing phase validators, and passing integration validation.
- Current planning manifests generated by the package use the exact level-two section layout and artifact declaration grammar specified above; hand-edited or historical variants may degrade enrichment.
- Run ids are unique within one direct-child sprints namespace.
- The existing project trust and `.internal-dev` readiness checks remain the authorization boundary for displaying project-wide directive summaries.
- Node’s supported runtime provides `O_NOFOLLOW` where the platform exposes it and `Intl.Segmenter` for grapheme-safe truncation; platform absence of `O_NOFOLLOW` still requires the surrounding identity checks.

## Recommended Direction

Create a focused `history.ts` reader that takes the validated sprints root and a limit, performs one complete qualification scan, and returns a narrow internal result such as:

```ts
interface HistoryResult {
  entries: HistoryEntry[];
  totalQualified: number;
  diagnostics: {
    omittedRecords: number;
    degradedDisplayedRecords: number;
  };
}
```

Keep each entry limited to raw run id, display kind, canonical ISO completion timestamp, epoch sort value, approximation flag, sanitized directive summary, and nullable recorded-artifact count. Do not expose filesystem paths or lease data in the command model.

Build or extract one bounded descriptor reader and pure parsers rather than duplicating safety logic. Planning qualification should first establish state-marker presence and authority, then manifest fallback. Execution qualification should use `parseExecutionRecord` as the sole schema authority. Both paths should return structured reason codes that distinguish normal exclusion, omission, and metadata degradation.

Perform all candidate qualification before sorting and slicing. Preserve raw ids for the UTF-8 bytewise comparator and sanitize only display copies. Resolve an execution source planning directive through the same planning qualification and directive helpers, with cycle-free one-hop lookup and a source-path fallback.

Keep `handleSprint` thin: enforce trust first, locate and validate the store, request five entries, format the exact header/rows/footer, distinguish clean empty from degraded zero-entry and root error outcomes, and notify with the settled severity. Follow existing `list` and `doctor` command conventions without copying lease-oriented fields or their non-authoritative summary state.

Do not broaden `core.ts` merely for test convenience. Focused tests may import `history.ts` directly, while public command tests should exercise parser, dispatch, completion, formatting, trust, and absence of mutation.

## Validation

Acceptance requires all of the following:

- Parser tests prove `history` is recognized only for `/sprint`, accepts surrounding whitespace, rejects a run id, arbitrary text, `--`, and every flag-like suffix, appears in usage and argument completions, and remains literal after the option terminator.
- Trust tests prove the command rejects an untrusted project before locating or scanning `.internal-dev`.
- Clean empty, fewer-than-five, exactly-five, and more-than-five stores produce the exact settled headers, counts, rows, and clean-empty text.
- A damaged-only or inconclusive-only store never produces the clean-empty text and instead produces the exact degraded zero-entry lead and applicable diagnostic clause.
- Mixed planning and execution records are ordered by exact validated completion epoch, with ascending UTF-8 bytewise run-id ties, the defensive kind tie, canonical UTC ISO output, and visible approximate planning timestamps.
- Valid active, running, paused, interrupted, blocked, failed, and cancelled records are excluded without incrementing omission diagnostics.
- Ambiguous, malformed, unknown, non-directory, symbolic-link, and completion-shaped unsafe records never appear and increment omission diagnostics once per direct child.
- State-versus-manifest precedence covers completed state, valid non-completed state beside a manifest, malformed or unsupported state beside a manifest, symlinked state beside a manifest, completed state without a timestamp plus manifest fallback, completed state without any usable timestamp, and a cleaned manifest-only planning run.
- Marker-race tests cover state appearance during manifest-only inspection, state disappearance, run-directory replacement, manifest replacement, execution-record replacement, and concurrent deletion. Each produces omission without a repeated scan, and lower-ranked valid records fill available slots.
- Planning directive tests cover exact fenced-code-aware section recognition, repeated headings, first paragraph or list item selection, multiline joining, `input.md` fallback, empty content, and `(directive not recorded)`.
- Execution directive tests cover safe same-store completed planning lookup, rejected or unsafe source ids, non-completed source planning records, missing source records, and exact sanitized `Source plan: <sourcePlanPath>` fallback.
- Sanitization tests cover ANSI sequences, C0/DEL/C1 controls, bidi embedding/override/isolate marks, zero-width directional marks, newlines, tabs, Unicode whitespace, persisted run ids, source paths, and directives. Grapheme tests cover combining marks, emoji sequences, exactly 120 clusters, and truncation to 119 clusters plus `…`.
- Planning recorded-artifact tests cover exact non-empty declarations, exact empty section, duplicate paths, malformed lines, invalid hashes, unsafe paths, missing sections, repeated sections, and unrelated fenced headings. Execution counts cover valid non-empty and valid empty `source.files` arrays.
- Entry degradation tests prove missing directive and unknown artifact count preserve a confirmed entry, consume a slot, display explicit fallbacks, and increment the degraded displayed-record count only once per entry.
- Root tests cover missing, inaccessible, non-directory, symbolic-link, identity-changing, and unreadable roots plus root enumeration failure. All are command errors, never empty history.
- Metadata-bound tests cover 4 MiB planning state, manifest, and input limits and the 64 KiB execution-record limit at the boundary and one byte over. Oversized authoritative state or execution data causes omission; oversized manifest/input enrichment follows the settled degradation rules.
- Schema reuse tests prove execution qualification calls the existing strict execution parser and planning qualification applies the same strict schema and ownership invariants as `SprintStateStore.load()`.
- Exact output assertions cover both headers, two-line rows, UTC timestamp precision, labels, `recorded-artifacts`, approximation marker, unknown metadata, clean empty, degraded zero-entry, singular/plural diagnostic clauses, and omission of zero-count clauses.
- Severity assertions cover clean `info`, degraded `warning`, and root-error `error` behavior.
- Read-only dependency tests assert that the history path invokes no write, publication, lease mutation, repair, binding, reset, or state-transition API.
- Before/after filesystem snapshots confirm unchanged paths, directory entries, content, sizes, mtimes, ctimes, and relevant device/inode identities while ignoring atime. Include records with foreign, uncertain, and current-runtime leases and prove lease bytes and identities remain unchanged.
- Focused history tests pass, followed by `npm --prefix sprint-planner test` and any repository-level typecheck or lint command that applies.
- Final diff review confirms no public tool or API growth, no record migration, no manifest-format change, no mutation path, no loss of existing list/doctor behavior, and no unrelated edits.

## Open Questions

None block implementation. Exact historical planning chronology would require a separately accepted planning-record format change that persists an authoritative completion timestamp. `/sprint history` must not imply that guarantee from manifest `mtime`.

## Sign-off

This corrected handoff settles the product, safety, parsing, diagnostic, formatting, and architecture contract for `/sprint history`. Implementation is authorized only against the complete contract above, including the bounded state read, authoritative marker precedence, exact output semantics, full validation suite, and required specification/documentation records.

**Explicit sign-off: approved for implementation as corrected.**
