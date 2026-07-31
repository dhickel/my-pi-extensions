## Prompt

Synthesize the brainstorming for a read-only `/sprint history` command that shows the five most recently completed sprint runs, including a directive summary, completion timestamp, and artifact count. This is a recommended product and architecture direction, not an accepted implementation plan.

## Source

- history-contract/findings.md
- record-model/findings.md
- readonly-resilience/findings.md
- project-integration/findings.md
- history-contract/cross-review.md
- record-model/cross-review.md
- readonly-resilience/cross-review.md
- project-integration/cross-review.md

## Findings

The reports strongly converge on the core shape:

- Add `history` as a no-argument `/sprint` management action, parallel to `list` and `doctor`.
- Show the newest five completed runs across the project store, independent of session binding.
- Include completed planning and execution records in one timeline, with explicit kind labels.
- Exclude active, paused, interrupted, blocked, failed, cancelled, ambiguous, malformed, and unknown records. “Terminal” is not synonymous with “completed.”
- Sort by completion time descending with a deterministic run-ID tiebreaker.
- Keep the operation strictly read-only: no lease acquisition or release, repair, binding, state changes, or filesystem writes.
- Reuse existing run discovery and classification rather than creating a second interpretation of run layout.
- Put history-specific enrichment in a dedicated `history.ts`-style module rather than making lightweight discovery read every manifest.
- Provide a compact empty state: `No completed sprint runs found in .internal-dev/sprints/.`

The strongest resolution of disputed details is:

1. **Completion evidence**
   - Treat the existing discovery result’s `state === "completed"` as the qualification boundary.
   - For execution records, the structured record and its `completedAt` are authoritative.
   - For planning records that retain completed state, prefer state `completedAt`. For cleaned-up records, use a future manifest completion timestamp if present, otherwise manifest `mtime` as an explicitly approximate fallback.
   - Do not attempt to parse a timestamp from current planning manifests: their outcome is static text and presently contains no completion time.

2. **Exact newest-five selection**
   - Inspect every structurally completed candidate sufficiently to obtain its completion timestamp, then sort and limit.
   - Do not stop after an arbitrary 30 or 50 directories and do not select by run-ID creation time; either shortcut can return something other than the actual last five completions.
   - Expensive directive and artifact enrichment can occur only after the timestamp pass identifies the five winners.

3. **Directive summary**
   - For planning runs, use the canonical completed manifest’s `## Directive` content, falling back to `input.md`. Normalize whitespace and truncate a first meaningful line to roughly 100 characters with an ellipsis.
   - For execution runs, use the originating planning directive when a safe, valid `sourcePlanningRunId` can be resolved read-only. Otherwise show an honest source-plan summary rather than pretending the generated source reference is a user directive.

4. **Artifact count**
   - Define the field narrowly as **the number of artifacts declared in the completed record’s canonical artifact inventory**: manifest `## Artifacts` entries for planning and the structured source-file inventory for execution, which should correspond to the execution manifest.
   - This is preferable to silently changing the meaning by kind (for example, “plan files” for planning but “phases” for execution). If users later want plan size or phase count, that should be a separately named field.
   - Missing or corrupt inventory data should display `artifacts=unknown`, not the misleading value zero.

5. **Resilience and safety**
   - Reject symlinked roots, run directories, manifests, and execution records; use no-follow reads and retain direct-child path validation.
   - Tolerate concurrent deletion and per-record `ENOENT`, `EACCES`, `EPERM`, or malformed content without crashing the whole command.
   - Skip a record only when completion or timestamp cannot be established. Preserve otherwise confirmed entries with explicit `not recorded` or `unknown` metadata, and summarize omitted/degraded entries if useful.
   - Validate read-only behavior with both a narrow dependency boundary (only read operations in the history module) and a before/after filesystem snapshot test. A source-text grep alone is not a sufficient proof of transitive behavior.

A readable output is likely better as two lines per entry because run IDs, timestamps, counts, and summaries make a one-line table excessively wide:

```text
20260720-143052-auth  [planning]  2026-07-20 14:31 UTC (approx.)  artifacts=24
  Add OAuth authentication for Google and GitHub…
exec-auth             [execution] 2026-07-20 16:08 UTC            artifacts=6
  Add OAuth authentication for Google and GitHub…
```

## Options

### 1. Dedicated history reader and thin command handler — strongest

Create a focused, independently testable history reader that consumes existing discovery/classification, performs timestamp selection, and enriches only the selected entries. Keep formatting in the command layer. Expose only the slash command initially; do not add an agent tool or public barrel export without a demonstrated consumer.

This best preserves module boundaries, testability, exact selection, and minimal API surface.

### 2. Add history logic to `run-records.ts`

Place a new exported history function beside discovery and doctor. This reduces file count and colocates record operations, but further mixes structural discovery, leases, diagnosis, manifest parsing, display metadata, and error degradation in an already broad module.

This is viable but less coherent than a dedicated module.

### 3. Inline history in the command handler

Call discovery, parse records, sort, and format directly in `handleSprint`. This has the smallest initial diff but couples filesystem semantics to UI dispatch, is harder to test independently, and encourages duplicated parsing later.

This is suitable only for a prototype, not the preferred lasting design.

Rejected expansions include overloading `/sprint list`, adding `--all`, `--kind`, or `--count`, registering a `sprint_history` tool, including blocked records, or changing planning manifest production as part of the same initial feature. They are either semantically weaker or beyond the requested scope.

## Trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Unified planning/execution timeline | One useful chronology of completed sprint activity | Directive and persistence models differ, so kind labels and fallbacks are necessary |
| Canonical recorded-artifact count | Stable definition aligned with the requested term and persisted records | Planning counts include intermediate pipeline artifacts; this is not a plan-size metric |
| Planning manifest `mtime` fallback | Supports existing cleaned-up runs without mutation or migration | It is filesystem evidence, not authoritative completion data, and must be marked approximate |
| Full timestamp pass before limiting | Guarantees the true newest five | Requires a small read/stat operation for every completed candidate |
| Cross-reference execution to planning directive | Better satisfies “directive summary” | The source planning run may be missing; safe fallback behavior is required |
| Preserve degraded entries | Avoids hiding a genuinely completed run because one display field is damaged | Output needs `unknown`/`not recorded` states and possibly a concise warning |
| Dedicated module without tool/barrel export | Clean separation and no speculative API growth | Direct module imports are needed for the command and tests |
| Two-line output | Readable at normal terminal widths | Less dense than `/sprint list` |

## Open Questions

1. Should “artifact count” be accepted as the canonical recorded inventory count, or does product intent actually mean final plan-file count? The label and contract must not leave this ambiguous.
2. Should execution entries attempt the safe planning-run cross-reference for the original directive in the first version, or initially show only `Source plan: …`?
3. Should approximate planning timestamps be visibly marked with `(approx.)`, `~`, or only tracked internally? Visible marking is more honest.
4. When a completed record has missing display metadata, should it remain in the five with `unknown` fields, or be omitted with a warning? Retaining it better preserves “last five completed.”
5. Should adding an authoritative completion timestamp to future planning manifests be a separate follow-up specification change? This would improve future accuracy but would not repair historical records.
6. Does the project consider the history reader an internal command helper or a supported core API? The latter would justify a barrel export; the former should avoid one.

## Recommended Next Step

Before implementation planning, turn this synthesis into a small feature-contract proposal and obtain agreement on the two semantic choices that affect user-visible truth: the artifact-count definition and execution directive sourcing.

The leading contract candidate is: `/sprint history` takes no arguments; shows the five most recently completed planning or execution records; orders by authoritative completion time with an approximate planning-manifest `mtime` fallback; displays kind, UTC timestamp, canonical recorded-artifact count, and a normalized directive summary; excludes every non-completed state; tolerates damaged metadata without mutation; and performs no lease or write operation.

Once that contract is accepted, implementation planning can map it to a dedicated history reader, thin command wiring, symlink-safe reads, deterministic formatting, and focused tests without reopening product semantics.
