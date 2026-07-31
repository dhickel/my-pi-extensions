## Prompt

Cross-review the three sibling brainstorming reports on the `/sprint history` feature: `history-contract/findings.md` (command semantics and UX), `record-model/findings.md` (data model and module boundaries), and `readonly-resilience/findings.md` (resilience, malformation handling, and read-only proof). Compare useful ideas, identify conflicts and gaps, assess feasibility, and synthesize the strongest unified direction. Do not edit the project.

## Source

Three reports generated in the same brainstorming session, each from a distinct lens:

- **history-contract/findings.md** — Product and command semantics lens: completion criteria, ordering, directive summaries, timestamps, artifact counts, empty states, UX format consistency with existing `/sprint list` and `/sprint doctor`.
- **record-model/findings.md** — Data model and architecture lens: manifest parsing, `HistoryEntry` type design, discovery boundary reuse vs. new module, manifest format differences between planning and execution runs, artifact count semantics, timestamp gap analysis, and the architectural tension between pushing content parsing into the shared discovery layer vs. keeping it in a separate consumer.
- **readonly-resilience/findings.md** — Resilience and safety lens: malformed records, missing metadata, concurrent deletion, path/symlink safety, active lease safety, read-only proof strategy, test patterns for edge cases and degradation, and concrete implementation scope boundaries.

Plus my own initial findings from the Project Integration and Validation Strategist lens (submitted as a separate artifact in this session), which explored implementation shapes across command parsing, extension registration, formatting conventions, specifications, README guidance, and the existing test architecture.

## Findings

### 1. Strong consensus areas (no conflict — worth locking in)

All four reports (including my own) agree on these design choices:

| Decision | Consensus strength | Notes |
|---|---|---|
| Add `"history"` as a management action in `parseCommand` | Unanimous | Single-line addition to the management-verb array, no argument parsing needed (like `list`) |
| Include both planning and execution runs | Unanimous | With kind labels to disambiguate |
| Sort by completion timestamp descending, take top 5 | Unanimous | `runId` as deterministic tiebreaker |
| Read-only — zero filesystem mutations | Unanimous | Import only `readFile`, `readdir`, `lstat`; never `writeFile`, `mkdir`, `unlink`, lease primitives |
| Graceful degradation for malformed/corrupt records | Unanimous | Skip and continue, never throw; annotate degraded entries |
| Require project trust before reading sprint data | Implicit consensus | Follows existing `list`/`doctor` pattern; all three reports imply it through consistency arguments |
| Planning-run timestamps are fragile (mtime as fallback) | Unanimous | All three reports identify the gap and propose a future engine change to embed `completedAt` in manifests |
| Future-proof: add `completedAt` to the planning manifest | Unanimous | A one-line engine change in `#manifestContent()`; all reports recommend this as a Phase 2 follow-up |

These are low-risk, high-confidence decisions. Implementation should proceed with these locked in.

### 2. Key divergence: module placement and API surface

This is the most important unresolved design choice. The reports offer three distinct models:

**Model A — Function in `run-records.ts`** (readonly-resilience Option A, history-contract endorses reuse of `discoverSprintRuns`)
- `discoverHistory(sprintsRoot)` as a new exported function alongside `discoverSprintRuns` and `runDoctor`.
- Shares path helpers and classification logic.

**Model B — New `history.ts` module** (record-model Option C, my Option D)
- Imports `discoverSprintRuns` from `run-records.ts` (unchanged, lightweight stat-only pass).  
- Adds its own manifest-parsing layer in a dedicated module.
- Exports `getHistory(sprintsRoot, maxCount)`.

**Model C — Extend `RunRecordSummary`** (record-model Option A, briefly mentioned)
- Add `directiveSummary`, `completionTimestamp`, `artifactCount` to `RunRecordSummary`.
- `discoverSprintRuns` reads manifests during discovery.
- All consumers pay the I/O cost.

**My assessment:**

Model C should be rejected because it violates the existing architecture's clear boundary: `discoverSprintRuns` and `classifyRun` are structure-only (file presence via `lstat`/`readdir`, never content). `runDoctor` is the existing content-reading consumer. Pushing manifest parsing into discovery would make every `/sprint list` call read dozens of manifest files — a regression from the current O(directory-entries) stat-only pass.

Between Model A and Model B, the substantive difference is organizational, not functional. Both produce a clean exported function. The record-model report makes a strong case for Model B: `run-records.ts` already handles leases, paths, discovery, reservation, and diagnosis — adding content parsing for manifests would make it a kitchen-sink module. A `history.ts` module has a single responsibility: "given a sprints root, return the last N completed runs with summary data." This is easier to test, review for read-only safety, and extend.

**I recommend Model B** (new `history.ts` module), with one refinement from Model A: the function should live in `history.ts` but be re-exported through `core.ts` for consistency with the existing barrel pattern. Command handler and tests import from `core.ts`.

### 3. Artifact count semantics — unresolved

This is the most substantive semantic gap. The reports diverge on what "artifact count" means:

| Source | Proposal | Example value |
|---|---|---|
| **history-contract** | Count all items under `## Artifacts` in manifest | "25 artifacts" (includes brainstorm, ironout, planning, and review artifacts) |
| **record-model** | Kind-specific: `planning/` files for planning; source artifacts for execution | "5 plan files" / "8 source artifacts" |
| **readonly-resilience** | Count list items under `## Artifacts` | "12 artifacts" (vague, same for both kinds but means different things) |
| **My report** | Phase file count (concepts + orchestration + phases) for planning; frozen phases for execution | "4 phases" / "8 phases" |

**Analysis:**

The `## Artifacts` section in a planning manifest lists *every* checkpointed artifact from the entire pipeline: input.md, brainstorm findings and cross-reviews (one per lens), synthesis, red-team, ironout drafts, reviews, and final plan files. For a 4-agent sprint, this is 20–30 entries. This count is technically accurate but not useful — it tells the user "the pipeline produced a lot of intermediate files," which is noise. The count the user actually wants is "how big was the plan?" — the number of phase files, concepts, and orchestration (typically 4–12).

For execution records, the `## Artifacts` section lists the frozen source plan files — concepts, orchestration, and phases. This count is meaningful and directly useful: it tells the user the plan size that was implemented.

**Recommendation:** Use kind-specific counts with kind-specific labels. For planning runs, count files under the `planning/` directory (or parse the phase count from `## Stages`). For execution runs, count source artifact entries. Label them `"N plan files"` and `"N source artifacts"` respectively. This is more work at display time but produces more useful output.

If the `planning/` directory is absent (rare but possible for a completed run whose `planning/` was cleaned up), fall back to the `## Artifacts` section count and label it `"N artifacts"` to signal the degraded meaning.

### 4. Timestamp extraction strategy — partially resolved

All reports agree on the hierarchy but differ on the planning-run fallback details:

| Priority | Source | Availability | Reports endorsing |
|---|---|---|---|
| 1 (execution) | `record.json` `completedAt` | Always present for completed | All |
| 2 (planning, best) | Parse "Completed at &lt;ISO&gt;" from `manifest.md` `## Outcome` | Best-effort parse | history-contract, readonly-resilience |
| 3 (planning, fallback) | `manifest.md` file `mtime` | Always available | All |
| 4 (execution fallback) | `manifest.md` file `mtime` | Always available | readonly-resilience |

**Refinement:** The readonly-resilience report's "annotate mtime-derived timestamps with `(approx.)`" is a good practice. The history-contract report notes that the `## Outcome` section of planning manifests currently contains `"Planning completed successfully."` (from `engine.ts` `#manifestContent`) — which is a static message, not a timestamp-bearing line. This means priority 2 will *always* fail for current planning runs until the engine is changed. So for V1, planning-run timestamps will always come from mtime.

**Recommendation:** Use mtime for all planning runs in V1. Label them honestly — show the timestamp without annotation (users don't benefit from seeing "approx." on every planning entry). Add `Completed at ${new Date().toISOString()}.` to the planning manifest's `## Outcome` section in a follow-up engine PR. When the history parser sees a parseable ISO timestamp in `## Outcome`, use it; otherwise fall back to mtime. This is forward-compatible.

### 5. Directive summary for execution records — resolved

All three reports agree: execution manifests have a machine-generated `## Directive` section (source plan path reference), not a human directive. The real directive lives in the source planning run.

**Consensus approach (all reports):** For V1, show the source plan path as the directive summary for execution runs. For V2, optionally cross-reference the source planning run's `input.md` if it still exists.

**Refinement from history-contract:** Prefix with `[execution]` and show: `Source plan: .internal-dev/sprints/<runId>/planning`. This is clear, honest, and actionable — the user can trace back to the planning run.

### 6. Handling of runs with ambiguous completion evidence — gap identified

The readonly-resilience report proposes filtering: planning runs need `manifest.md` present AND `.state.json` absent (or `.state.json` with `status: "completed"`). The history-contract report notes that `discoverSprintRuns` already infers `stateSummary = "completed"` for runs with manifest but no state file.

**Gap:** What about a planning run where `.state.json` is present with `status: "running"` or `"interrupted"` but a `manifest.md` also exists (from a previous attempt's partial output)? The `classifyRun` function would classify this as `"planning"` with state `"running"` — not completed. The history filter should reject it. But what if the state file is corrupted and can't be loaded? The `discoverSprintRuns` code falls through to `stateSummary = "malformed"`. History should reject these too.

**Recommendation:** Use the `RunRecordSummary.state` field from `discoverSprintRuns` as the primary filter. Only accept `state === "completed"`. This already handles the `.state.json`-present and manifest-only cases correctly via existing logic. Do not re-implement completion detection.

### 7. Output format — partially explored

The history-contract report has the most UX exploration with concrete format examples. Two formats proposed:

**Compact (one line per run):**
```
<runId>  [kind]  <timestamp>  <count> <label>  <directive-summary-truncated>
```

**Two-line:**
```
<runId> — completed <timestamp> — <count> <label>
  <directive-summary-truncated>
```

The existing `/sprint list` uses compact one-line format. Consistency favors compact, but the directive summary makes lines very long (runId ~30 chars + kind ~12 + timestamp ~20 + count ~15 + summary ~80 = ~157 chars). Two-line is more readable.

**Recommendation:** Two-line format. The `/sprint doctor` already uses multiline output with icons (❌ ⚠️ ℹ️). History should use a similar multiline pattern for readability. Each entry gets a header line with runId, timestamp, and counts, plus an indented directive summary. Kind can be shown via a prefix icon or `[planning]` / `[execution]` label.

### 8. Empty state message — minor divergence

| Report | Proposed empty message |
|---|---|
| history-contract | `"No completed sprint runs found in .internal-dev/sprints/."` (mirrors `list`), optionally with CTA |
| readonly-resilience | Not specified |
| record-model | Not specified |

The history-contract report's proposal to optionally add `"Start one with /sprint <prompt>."` adds helpful guidance. The existing `/sprint list` says `"No sprint runs found in .internal-dev/sprints/."` without a CTA. Consistency with `list` is safer; adding a CTA could be seen as inconsistent or pushy.

**Recommendation:** Mirror `/sprint list` exactly: `"No completed sprint runs found in .internal-dev/sprints/."` with `"info"` severity. No CTA.

### 9. Test architecture — readonly-resilience has the strongest coverage

The readonly-resilience report proposes the most comprehensive test scenarios, including:

- Empty store
- Mixed kinds (planning + execution interleaved)
- Various completion states (active/blocked/interrupted filtered out)
- Malformed manifests (missing headings, invalid JSON)
- Concurrent deletion (ENOENT between readdir and readFile)
- Permission errors (EACCES/EPERM)
- Deterministic ordering with ties
- Read-only proof via import audit

The record-model report adds: testing with mock manifests to isolate parsing from filesystem, and testing manifest format differences (planning vs execution artifact list formats).

My report adds: integration test for `parseCommand("sprint", "history")` returning `action === "history"`, and testing the exact notification output format.

**Recommendation:** Combine all these into a test plan. The most critical for correctness are ordering determinism, filtering accuracy (non-completed excluded), and malformation resilience. The most important for the read-only contract is the import audit — a test or lint rule that verifies no write primitive is imported by `history.ts`.

### 10. Lease interaction — all reports agree on non-interference

All three reports agree: history must never touch leases. The readonly-resilience report adds a useful detail: history *may* call `inspectLease` (which is read-only) to display lease ownership context, but must never call `acquireLease`, `releaseLease`, or pass lease handles to mutating functions.

**Recommendation:** For V1, don't display lease ownership in history output. The existing `/sprint list` and `/sprint doctor` already serve that purpose. Keep history focused on the requested fields (directive summary, timestamp, artifact count). This simplifies the implementation and removes any temptation to interact with lease data.

## Options

### Unified recommendation: the synthesis path

Combine the strongest proposals from all four lenses:

1. **Module**: New `sprint-planner/history.ts` exporting `getHistory(sprintsRoot, maxCount = 5): Promise<HistoryEntry[]>`. Re-exported through `core.ts`.

2. **Data flow**: Call `discoverSprintRuns()` (unchanged, stat-only), filter `state === "completed"`, sort by timestamp descending, take N, then read manifests and (for execution) `record.json` only for the top N entries.

3. **`HistoryEntry` type**:
   ```ts
   interface HistoryEntry {
     runId: string;
     kind: "planning" | "execution";
     directiveSummary: string;       // truncated to ~120 chars with ellipsis
     completedAt: string;            // ISO 8601
     completedAtSource: "execution-record" | "manifest-outcome" | "manifest-mtime";
     artifactCount: number;
     artifactLabel: string;          // "plan files" | "source artifacts" | "artifacts"
   }
   ```

4. **Timestamp extraction**:
   - Execution: `record.completedAt` from `execution/record.json` (authoritative).
   - Planning: parse "Completed at &lt;ISO&gt;" from `manifest.md` `## Outcome`; if unparseable, use `manifest.md` `lstat.mtimeMs` converted to ISO 8601.
   - Label the source for debuggability.

5. **Directive extraction**:
   - Planning: first non-blank, non-code-fence line after `## Directive` in `manifest.md`.
   - Execution: `` `Source plan: ${record.source.sourcePlanPath}` ``.
   - Truncate to 120 characters with `…`.

6. **Artifact count**:
   - Planning (with `planning/` directory): count files in `planning/` directory. Label: `"N plan files"`.
   - Planning (without `planning/` directory): count `- \`...\`` list items under `manifest.md` `## Artifacts`. Label: `"N artifacts"`.
   - Execution: `record.source.files.length` from `record.json`. Label: `"N source artifacts"`.

7. **Resilience**: Every read wrapped in try/catch. ENOENT → skip entry. EACCES/EPERM → skip entry with optional warning. Malformed JSON → skip entry. Missing manifest heading → use fallback or `"(not recorded)"`. Never throw from the top-level function.

8. **Read-only proof**: Import only `readFile`, `readdir`, `lstat` from `node:fs/promises`. Import `discoverSprintRuns`, `classifyRun`, `resolveRunDirectory`, `assertSafeRelativePath` from existing modules (all read-only). A test should grep `history.ts` for any write primitive names (`writeFile`, `mkdir`, `unlink`, `rm`, `rename`, `acquireLease`, `releaseLease`, `atomicWriteFile`, `publishDirectoryExclusively`, `checkpointExecutionRecord`, `finishExecutionRecord`) and assert none are present.

9. **Command wiring**: Add `"history"` to `parseCommand` management list, `commandUsage`, `getArgumentCompletions`. In `handleSprint`, follow the `list` pattern: trust check → `locateStore` → `sprintsRoot` → `getHistory(root, 5)` → format output → `ctx.ui.notify(...)`.

10. **Output format** (two-line entries):
    ```
    Completed sprint runs (newest first):
    ─────────────────────────────────────
    20260720-143052-slug  [planning]  completed 2026-07-20T14:31:00Z  5 plan files
      Add user authentication with OAuth2 supporting Google and GitHub…
    exec-record-name      [execution] completed 2026-07-20T14:25:00Z  8 source artifacts
      Source plan: .internal-dev/sprints/20260720-120000-auth/planning
    ```

11. **Future follow-up** (Phase 2): Add `\nCompleted at ${new Date().toISOString()}.` to the planning manifest's `## Outcome` section in `engine.ts` `#manifestContent`. This makes planning timestamps authoritative going forward without breaking existing manifests.

## Trade-offs

### Unified history vs. separate planning/execution views

Showing planning and execution runs in a single timeline is simple and provides the "one stop" view the user likely wants. But the two run types have different directive semantics, different artifact count meanings, and different timestamp authorities. The unified view burdens the user with interpreting these differences in context. A future enhancement could split into `/sprint history planning` and `/sprint history execution`, but for V1 the unified view with clear kind labels is the right starting point.

### Two-pass discovery (stat pass + content read) vs. single manifest-reading pass

The recommended approach does a lightweight stat-only pass first (`discoverSprintRuns`) to classify all runs, then reads manifests for the ~5 completed runs. This is two passes through the directory listing but only reads content for a bounded number of entries. The alternative — reading manifests during discovery — makes `discoverSprintRuns` heavier for all consumers. The two-pass approach is the right trade-off: discovery stays fast for `list`/`doctor`, and history pays the content-read cost only for its target entries.

### Manifest parsing in a new module vs. extending `run-records.ts`

Adding manifest content parsing to `run-records.ts` would be simpler (fewer files) but would blur the module's focus. `run-records.ts` is already 500+ lines covering leases, paths, reservation, discovery, classification, and diagnosis. Adding content parsing for a different feature domain (history display) would make it a grab-bag. A dedicated `history.ts` module (~100 lines) is cleaner: it imports the discovery boundary, adds its own parsing, and exports a single function. The record-model report's Option C argument is persuasive here.

### Artifact count: pipeline artifacts vs. plan files

Counting plan files (concepts + orchestration + phases) for planning runs is more meaningful to users than counting all pipeline artifacts. But it requires reading the `planning/` directory or parsing `## Stages` — slightly more work than counting `## Artifacts` list items. The `planning/` directory is the authoritative publication output and is always present for completed runs. The extra `readdir` is a small cost for a more useful number.

### Timestamp honesty

Showing `manifest.md` mtime as the completion timestamp for planning runs is imprecise but is the only universally available option. Labelling the source internally (in the `HistoryEntry` type for tests/debugging) but not in the user-facing output keeps the display clean while enabling future improvements. When the engine change adds `completedAt` to manifests, old runs will show mtime-derived timestamps and new runs will show authoritative ones — the user sees a consistent format either way.

## Open Questions

1. **Should history display the run's kind via an icon or a text label?** The existing `/sprint list` uses emoji for lease ownership (🔒 🔐 ❓). History could use 📋 for planning and ⚙️ for execution, or the text labels `[planning]` / `[execution]`. Text labels are more accessible and unambiguous. Decision: text labels.

2. **Should history count artifacts at all for execution records that are blocked, or only for completed?** The feature filters to completed runs only, so blocked runs won't appear. This is self-resolving.

3. **What happens when `.internal-dev/sprints/` doesn't exist yet?** `sprintsRoot()` throws `"The .internal-dev/sprints store is not ready."` This is the correct behavior — same as `/sprint list` and `/sprint doctor`. The user sees a clear actionable error.

4. **Should history work when the sprints directory exists but is empty?** Yes — returns an empty list, displays `"No completed sprint runs found in .internal-dev/sprints/."` via `ctx.ui.notify` with `"info"` severity. No error.

5. **If a planning run's `manifest.md` has `## Directive` but the content under it is empty or whitespace-only, what should the summary show?** `"(no directive recorded)"`. This handles edge cases where the manifest was written but the directive section is somehow empty.

6. **Do we need to handle the case where `manifest.md` is a symlink?** The existing infrastructure (`sprintsRoot`, `resolveRunDirectory`, `assertSafeRelativePath`, `classifyRun`) already validates that the sprints root and its direct children are regular directories without symlinks. Individual files within a run directory are not currently validated for symlinks by the discovery layer. History should use `O_NOFOLLOW` when opening `manifest.md` and `record.json` to prevent symlink traversal, consistent with the validation module's approach.

## Recommended Next Step

Proceed with the synthesis implementation following the unified recommendation above. The implementation order:

1. **Define `HistoryEntry`** in `types.ts` (or `history.ts` if it's self-contained).
2. **Implement `history.ts`** with `getHistory()` — the pure read-only function, fully tested in isolation with filesystem fixtures.
3. **Re-export from `core.ts`**.
4. **Add `"history"` parsing** to `commands.ts` (`parseCommand`, `commandUsage`, action union).
5. **Wire command handler** in `index.ts` `handleSprint`, following the `list` pattern.
6. **Add argument completion** in `registerCommand`.
7. **Update README.md** with the new `/sprint history` entry under "Extension commands."
8. **Write comprehensive tests** covering zero/fewer-than-5/more-than-5 completions, mixed kinds, missing manifests, malformed records, symlink rejection, ordering determinism, exact output format, and read-only import audit.
9. **Future follow-up issue**: Add `Completed at <ISO>` to planning manifest `## Outcome` in `engine.ts`.

The read-only contract is the highest-stakes constraint — the import audit test must be written first as a gate. If any write primitive leaks into `history.ts`, the implementation must be restructured before proceeding.
