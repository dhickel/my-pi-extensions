## Prompt

Synthesize the three analysis reports on `/sprint history` — `history-contract/findings.md` (product and command semantics), `record-model/findings.md` (record model and data), and `project-integration/findings.md` (project integration and wiring) — comparing ideas, resolving conflicts, identifying omissions, and producing a unified recommended next step.

## Source

Three analysis reports plus the original direct inspection of the sprint-planner codebase:

- `history-contract/findings.md` — product semantics: completion qualification, ordering, directive summaries, timestamps, artifact counts, empty states, output format, and consistency with existing `/sprint` management commands.
- `record-model/findings.md` — data model: discovery infrastructure, planning vs execution manifest formats, timestamp source gaps, artifact count incommensurability, manifest parsing boundaries, and module architecture options (A–E).
- `project-integration/findings.md` — integration: command-parsing changes, data retrieval paths, completion timestamp sources, read-only contract enforcement, existing test architecture, and four implementation options (A–D).
- Original source code inspection (same files as referenced by all three reports).

## Findings

### 1. Areas of strong consensus

All three reports independently converge on these points:

| Decision | Contract | Record-Model | Integration |
|---|---|---|---|
| Add `"history"` as a new management action in `parseCommand` | ✓ (B+D) | ✓ | ✓ |
| Create a dedicated `getSprintHistory` / `discoverCompletedRuns` function | ✓ | ✓ (new `history.ts`) | ✓ (Option D hybrid) |
| Filter strictly by completion status — not paused, interrupted, failed, cancelled, active | ✓ | ✓ | ~ (suggests including blocked) |
| Sort by completion timestamp descending, tiebreak by runId, top 5 | ✓ | ✓ | ✓ |
| Read-only: no mutation, no lease manipulation, no repair | ✓ | ✓ | ✓ |
| Reuse `sprintsRoot`, `discoverSprintRuns`, `classifyRun` for discovery | ✓ | ✓ | ✓ |
| Include both planning and execution records with kind labels | ✓ | ✓ | ✓ |
| Compact one-line-per-run output format | ✓ | ✓ | ✓ |
| Empty-state message following `/sprint list` precedent | ✓ | — | ✓ |
| Manifest mtime as planning-run timestamp fallback | ✓ | ✓ | ✓ |

This is a strong foundation. The consensus architecture is: a new exported function that consumes the existing discovery boundary, filters to completed, enriches with manifest/record content, sorts, limits, and returns a typed result. The command handler formats and displays it.

### 2. Conflicts requiring resolution

#### Conflict 1: Directive source for planning runs

- **Contract report**: manifest `## Directive` section OR `input.md`
- **Record-model report**: manifest `## Directive` section
- **Integration report**: `input.md` line 1 (explicitly prefers `input.md` over manifest)

**Analysis**: The integration report's preference for `input.md` is the stronger position. Reasons:
1. `input.md` is written once at sprint start and never modified — it's the literal user directive.
2. The manifest `## Directive` section is produced by `#manifestContent()` in the engine and could paraphrase or truncate the directive.
3. `input.md` is always present for completed planning runs (it's never cleaned up by `removeRuntimeFiles()`).
4. The contract report acknowledges `input.md` as a fallback source, but the integration report makes the case that it should be the *primary* source.

**Resolution**: Use `input.md` first non-blank line as the primary directive summary for planning runs. Fall back to manifest `## Directive` section only if `input.md` is missing or unreadable (degraded-manifest scenario). For execution records, show the source plan path and/or `sourcePlanningRunId` reference.

#### Conflict 2: Artifact count semantics

- **Contract report**: Count bullets under `## Artifacts` in manifest (all pipeline artifacts — could be 20+ for planning)
- **Record-model report**: Kind-specific — planning = plan files (concepts + orchestration + phases), execution = source artifact entries. Explicitly calls out that planning and execution artifact counts are "incommensurable."
- **Integration report**: Planning = count of `phase-NN-*.md` files in `planning/`; execution = `frozen.phases.length`

**Analysis**: The record-model report's diagnosis is correct — "artifact count" means fundamentally different things across run kinds. The contract report's simple "count manifest bullets" approach would show wildly different numbers for planning (20+ pipeline artifacts) vs execution (5–10 source plan files), which is confusing. The integration report's approach (count plan phases) is more meaningful but only counts phases, not concepts + orchestration + phases.

The integration report's "count phase files in `planning/`" is attractive because:
1. It reads the directory, not the manifest — zero parsing ambiguity.
2. Phase count directly reflects plan complexity/scope.
3. For execution records, `frozen.phases.length` is the exact equivalent.

**Resolution**: For planning runs, count entries in `planning/` directory (concepts.md + orchestration.md + phase files). For execution runs, use `frozen.phases.length`. Label the count as "N plan files" for planning and "N phases" for execution to make the incommensurability explicit rather than hiding it behind a single "artifacts" label. The label itself disambiguates the meaning.

#### Conflict 3: Should blocked execution records appear in history?

- **Contract report**: Only genuinely completed (excludes blocked explicitly: "not cancelled, failed, blocked, interrupted")
- **Record-model report**: Only completed (implicitly excludes blocked by only discussing `state === "completed"`)
- **Integration report**: Include both `completed` and `blocked` as terminal states

**Analysis**: The integration report argues `blocked` is a "terminal state — arguably 'completed' in the sense of 'finished.'" This conflates "finished" with "completed." A BLOCKED verdict means the implementation did not pass validation — it's a failure to complete, not a successful completion. The directive says "completed sprint runs" — blocked is not completed.

Furthermore, including blocked runs would blur the history command's purpose. Users checking history want to see what was *successfully accomplished*, not what failed. Failed/cancelled/blocked runs belong in `/sprint list` and `/sprint doctor`.

**Resolution**: Exclude blocked execution records. Only `state === "completed"` for both planning and execution runs. The contract and record-model reports are correct here. The integration report's broader inclusion should be rejected.

#### Conflict 4: Module location — new `history.ts` vs. extending `run-records.ts`

- **Contract report**: Extend `run-records.ts` or new module (flexible)
- **Record-model report**: New `history.ts` module (Option C, strongly preferred)
- **Integration report**: `run-records.ts` or new `history.ts` (flexible)

**Analysis**: The record-model report makes a compelling architectural argument: `run-records.ts` is currently focused on structure (discovery, classification, leases, path validation) and diagnosis (`runDoctor`). Adding content-parsing logic (reading manifests, extracting sections, parsing timestamps, counting artifacts) would mix concerns. `runDoctor` already reads content, but it does so for diagnosis — a fundamentally different purpose than feature extraction for display. The separation is cleaner: discovery stays structure-only, history content parsing lives in its own consumer module.

**Resolution**: New `sprint-planner/history.ts` module. This is the strongest architectural choice. It imports the discovery boundary (`discoverSprintRuns`, `classifyRun`, path helpers) from `run-records.ts` and adds its own manifest/record parsing layer. No modification to `run-records.ts` needed.

### 3. Omissions addressed

#### Omission 1: Planning manifest lacks a completion timestamp (record-model report)

The record-model report identifies a critical gap: the planning manifest's `## Outcome` section is static text (`"Planning completed successfully."`) — it contains no machine-readable completion timestamp. The `.state.json` has `completedAt` but is removed by `removeRuntimeFiles()`.

This means planning-run history timestamps are *always* derived from manifest `mtime`, which is fragile (git operations, file copies, `touch` can reset it). The record-model report proposes Option E (future engine change) to fix this, which the other reports don't address.

**Assessment**: This is the single most important quality issue for the history feature. Without an authoritative completion timestamp in the planning manifest, history ordering is approximate for planning runs. The resolution should track this as a required follow-up.

#### Omission 2: Test strategy is only detailed in the integration report

The integration report provides an extensive test coverage list (14 specific scenarios). The other reports mention testing in passing. The integration report's list is comprehensive and should be adopted as the test plan.

#### Omission 3: Agent-callable tool exposure (integration report only)

Only the integration report considers registering `sprint_history` as an agent-callable tool. The other reports focus exclusively on the slash command. Given the project's pattern (every major function has a corresponding tool), this is a legitimate consideration. However, for a lightweight read-only listing command, a tool adds marginal value — agents can already use `readdir` + `readFile` on `.internal-dev/sprints/`. The orchestrate skill has its own execution-record tracking.

**Recommendation**: Command-only for V1. Tool registration can follow if agent demand emerges.

#### Omission 4: `input.md` vs. manifest `## Directive` for planning run directive source

The integration report is the only one that explicitly prefers `input.md` over manifest for the directive source. The other reports default to manifest. This is a consequential choice because `input.md` contains the literal user prompt while the manifest may paraphrase it. The integration report's position is correct but under-explained — my resolution in Conflict 1 above addresses this.

### 4. Unique insights from each report

**Contract report** contributes:
- Detailed analysis of output format consistency with existing `/sprint list` and `/sprint doctor` commands
- Empty-state UX following the `list` precedent exactly
- Rejection of `--completed` flag extension to `list` (would overload `list` with different output formats)
- Treatment of orphaned execution records without a corresponding planning run

**Record-model report** contributes:
- Critical gap identification: planning manifest `## Outcome` has no timestamp (the most important finding across all three reports)
- Incommensurability analysis of artifact counts between planning and execution
- Option E (two-phase: MVP with mtime, future with authoritative timestamps) — the only report proposing a forward-looking strategy
- Clean architecture argument for separating discovery (structure) from content parsing (new `history.ts`)
- Recognition that `discoverSprintRuns` is structure-only and should stay that way

**Integration report** contributes:
- Detailed command-parsing changes needed (specific to `parseCommand`, `commandUsage`, `getArgumentCompletions`)
- `input.md` as primary directive source for planning runs (the correct choice)
- Comprehensive 14-scenario test plan including read-only proof via before/after snapshot
- Tool registration consideration (dual consumer: user + agent)
- Specific integration-level concerns: trust check, store location, retained lease handles

### 5. Feasibility assessment

The feature is straightforward to implement given the existing infrastructure:

- **Discovery**: `discoverSprintRuns()` already does 90% of the work — it enumerates, classifies, and reports state/markers for every run. No changes needed.
- **Completion detection**: Already implemented in `discoverSprintRuns` and `classifyRun`. History just needs to filter `state === "completed"`.
- **Manifest reading**: Both manifest formats share identical heading structure. A single parser can handle both with kind-specific extraction.
- **Timestamp extraction**: Trivial for execution records (`record.completedAt`). For planning, `lstat(manifest.md).mtime` is a one-liner.
- **Directive extraction**: `readFile(input.md, "utf8")` and take the first non-blank, non-heading line. Trivial.
- **Artifact counting**: Planning = `readdir(planning/)` → count. Execution = `record.frozen.phases.length`. Both are simple.
- **Command wiring**: One new action keyword, one new handler branch (10–15 lines), one new completions entry.
- **Overall scope**: ~80–120 lines in `history.ts`, ~30 lines in `index.ts`, ~5 lines in `commands.ts`. Well within a single implementation session.

No external dependencies, no new npm packages, no engine changes, no schema migrations.

### 6. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Manifest mtime is fragile (git clone, rsync) | Medium | Label timestamps as approximate for planning runs. Track follow-up to add `completedAt` to planning manifest. |
| Large number of runs makes discovery slow | Low | `discoverSprintRuns` does stat-only enumeration — no content reads. History reads content only for at most 5 runs. |
| Concurrent `/sprint reset` during history read | Low | Catch `ENOENT` on every file read; skip the entry. History is inherently a snapshot — no consistency guarantees across runs. |
| Planning `input.md` format changes in a future engine version | Low | `input.md` has been stable since v0.1.0. If it changes, the regex/line-extraction logic is isolated in `history.ts`. |
| Manifest `## Directive` content differs from `input.md` | Low | By using `input.md` as primary, we avoid this entirely. Fallback to manifest only if `input.md` is missing. |
| Permission errors on individual run directories | Low | Catch `EACCES`/`EPERM`, skip the entry, continue with remaining runs. |

## Options

Three viable implementation paths emerge from synthesizing the reports:

### Option 1: Pure command-handler approach (integration Option A, minimal)

Implement a private `getHistory()` inside `index.ts` or as a helper function in the handler closure. No new module, no new exports. The `handleSprint` history branch calls `discoverSprintRuns`, filters, reads manifests inline, formats, and displays.

**Pros**: Minimal blast radius. Quickest to ship.  
**Cons**: No reuse. Harder to test (must test through the command handler or extract-and-export for testing, which defeats the purpose). Mixes display logic with data retrieval.  
**Verdict**: Acceptable for a prototype; not recommended for the permanent feature given the project's architecture standards.

### Option 2: New `history.ts` module, command-only (record-model Option C, command-only variant)

Create `sprint-planner/history.ts` exporting `getSprintHistory(sprintsRoot, limit)`. Wire it into the `/sprint history` command branch. No tool registration. Functions are exported and independently testable.

**Pros**: Clean architecture. Testable. Follows existing patterns (`run-records.ts` for discovery, `validation.ts` for plan inspection, `history.ts` for history). No coupling to the UI layer.  
**Cons**: One new module to maintain. No agent exposure (but agents don't need this — they can read directories).  
**Verdict**: The recommended approach. All three reports converge here.

### Option 3: New `history.ts` module + agent tool (integration Option D, full hybrid)

Same as Option 2, plus register `sprint_history` as an agent-callable tool with `executionMode: "sequential"`. The tool calls the same `getSprintHistory()` function.

**Pros**: Dual consumer. Follows `sprint_validate_plan` / `sprint_execution_record` pattern of tool+function separation.  
**Cons**: Adds a tool that agents are unlikely to use (agents have filesystem tools). The tool's TypeBox schema must duplicate the `HistoryEntry` type contract. Maintenance overhead.  
**Verdict**: Defer the tool registration. If agent demand materializes, adding it is a non-breaking addition since the underlying function already exists.

## Trade-offs

### Unified history timeline vs. kind-separated views

All three reports agree on a unified timeline (planning + execution together, sorted by completion time). The trade-off is that planning and execution have incommensurable data (different directive sources, different timestamp qualities, different artifact meanings). A unified timeline requires clear kind labels to avoid user confusion. A separated view (planning history, then execution history) would let each section have its own column meanings, but would lose the chronological narrative. **The unified view is correct for V1** — kind labels are sufficient disambiguation.

### `input.md` vs. manifest `## Directive` for directive source

| Source | Reliability | Always present? | Contains literal directive? |
|---|---|---|---|
| `input.md` | High — written once, never modified | Yes (never cleaned up) | Yes (exact user input) |
| `manifest.md` `## Directive` | Medium — written at completion | Yes | May be paraphrased or truncated |

**`input.md` wins on all axes.** The only advantage of manifest is that it's already being read for timestamp/artifact data, so directive extraction is a "free" additional parse. But `input.md` is a separate file in the same directory — one extra `readFile` per run, which is negligible. Use `input.md` as primary, manifest as fallback.

### `planning/` directory listing vs. manifest `## Artifacts` for planning artifact count

| Method | Accuracy | Performance | Robustness |
|---|---|---|---|
| `readdir(planning/)` | Exact file count | One `readdir` call | Survives manifest corruption |
| Parse manifest `## Artifacts` bullets | Depends on manifest correctness | One `readFile` + regex | Fragile if manifest format changes |

**`readdir(planning/)` is more robust.** It directly reflects what the plan contains, not what the manifest claims it contains. If the manifest and directory disagree, the directory is truth. This aligns with the project's philosophy of treating "code as logical truth, specifications as intended truth."

### Including vs. excluding blocked execution records

Already resolved above (exclude). Re-stating the trade-off: including blocked records would show "what was attempted" alongside "what succeeded," which has some diagnostic value. But the directive says "completed" not "terminal" or "finished." Blocked records are a failure to complete. The user can find blocked records via `/sprint list` and inspect them with `/sprint doctor`. History should celebrate successes.

### Approximate timestamps for planning runs

The record-model report correctly diagnoses this as the feature's biggest quality gap. Options:

1. **Accept mtime and label as approximate** — ship now, fix later. The timestamp is still useful for ordering (most recent completions still sort correctly by mtime under normal operation).
2. **Add `completedAt` to planning manifest first** — block history on an engine change. This delays the feature.
3. **Read `.state.json` from a backup or journal** — there is no backup; `.state.json` is deleted.

**Accept mtime now, track the follow-up.** The two-phase approach (record-model Option E) is the pragmatic path. The user gets history immediately with approximate timestamps; a one-line engine change (`Completed at ${new Date().toISOString()}.` in the manifest `## Outcome`) makes future planning-run timestamps authoritative.

## Open Questions

1. **Should history show the last 5 of each kind (5 planning + 5 execution) or the last 5 overall?** All reports assume "5 overall." But if the user runs many execution records and few planning runs, planning completions get crowded out. A future `--kind` filter addresses this without changing the default.

2. **What happens when a planning run's `planning/` directory is missing?** The engine publishes `planning/` at completion. If it's absent (manual deletion, partial store), artifact count = 0. Should the run still appear? Yes — the run completed; the plan files were just cleaned up. Show `0 plan files`.

3. **How should the directive summary handle multi-line prompts with leading blank lines?** `input.md` format is `# Sprint Input\n\n<directive>`. Skip the heading line, skip blank lines, take the first non-blank line. Truncate at ~100 chars with ellipsis. If every line after the heading is blank (unlikely), show `"(empty directive)"`.

4. **Should the output include the run kind as a column or as a prefix on the runId?** The integration report suggests `[planning]` / `[execution]` tags. The contract report suggests a `kind` column. Either works. A prefix like `[P]` / `[E]` is more compact and scannable; a full word is clearer. Start with `[planning]` / `[execution]` and iterate.

5. **Is there a single correct answer for the "artifact count" label?** For planning: "N plan files" (counts concepts.md + orchestration.md + phase files). For execution: "N phases" (counts `frozen.phases.length`). The labels make the difference explicit.

6. **Should the output mention that timestamps are approximate for planning runs?** Yes. Add `(approx.)` after planning-run timestamps. This is honest about data quality and sets user expectations.

## Recommended Next Step

Implement **Option 2: New `history.ts` module, command-only**, with the following resolved positions from this synthesis:

### Architecture

1. **New file `sprint-planner/history.ts`** exporting a single function:
   ```ts
   export async function getSprintHistory(
     sprintsRoot: string,
     limit?: number,
   ): Promise<HistoryEntry[]>
   ```

2. **New type in `types.ts`**:
   ```ts
   interface HistoryEntry {
     runId: string;
     kind: "planning" | "execution-only";
     directiveSummary: string;       // first ~100 chars of directive
     completedAt: string;            // ISO-8601
     completedAtApproximate: boolean; // true for planning (mtime), false for execution
     artifactCount: number;
     artifactLabel: string;          // "plan files" or "phases"
   }
   ```

3. **Function logic**:
   - Call `discoverSprintRuns(sprintsRoot)` — zero modifications needed
   - Filter to `state === "completed"` AND `kind === "planning" || kind === "execution-only"`
   - For each completed run:
     - **Planning**: Read `input.md` for directive; `readdir(planning/)` for artifact count; `lstat(manifest.md).mtime` for timestamp (marked approximate)
     - **Execution**: Call `loadExecutionRecord()` for `completedAt` and `frozen.phases.length`; read manifest `## Directive` for directive summary (source plan reference)
   - Sort by `completedAt` descending, tiebreak by `runId` ascending
   - Take top `limit` (default 5)

4. **Error handling**: Every `readFile`, `readdir`, `lstat` wrapped in try/catch. `ENOENT` → skip entry. `EACCES` → skip entry. Malformed JSON → skip entry. Never throw from the top-level function — return whatever valid entries were collected, even if fewer than `limit`.

### Command wiring

5. **`commands.ts` changes**:
   - Add `"history"` to `ParsedCommand.action` union
   - Add `"history"` to the management keyword list in `parseCommand()`
   - Add guard: `if (workflow === "sprint" && action === "history" && run) throw new Error("/sprint history does not accept arguments.")`
   - Update `commandUsage("sprint")` to include `history`

6. **`index.ts` changes**:
   - Import `getSprintHistory` and `HistoryEntry` from `history.ts`
   - Add `"history"` to `getArgumentCompletions`
   - Add `parsed.action === "history"` branch in `handleSprint` (before or after the `list` branch):
     - Check `ctx.isProjectTrusted()`
     - `const location = await locateStore(ctx.cwd)`
     - `const root = await sprintsRoot(location.internalDevPath)`
     - `const entries = await getSprintHistory(root, 5)`
     - Format and display via `ctx.ui.notify()`

### Output format

7. **Compact one-line-per-run**:
   ```
   Completed sprint runs (newest first):
   20260720-143052-slug  [planning]  2026-07-20 14:31 (approx.)  5 plan files  Add user authentication with OAuth2 supporting Google...
   exec-some-record      [execution] 2026-07-20 14:30             3 phases      Source: .internal-dev/sprints/.../planning
   ```
   Or empty state:
   ```
   No completed sprint runs found in .internal-dev/sprints/.
   Start one with /sprint <prompt>.
   ```

### Test plan (from integration report, adapted)

8. **Tests in `test/core.test.ts`** (or new `test/history.test.ts`):
   - Empty store → empty result
   - Fewer than 5 completed → returns all, no error
   - More than 5 completed → returns exactly 5, newest first
   - Mixed kinds interleaved → all appear with correct kind labels
   - Planning run with `planning/` directory → correct file count
   - Planning run without `planning/` directory → 0 plan files, still appears
   - Planning run without `input.md` → falls back to manifest directive
   - Execution record with `completedAt` → authoritative timestamp, not approximate
   - Execution record with BLOCKED state → excluded
   - Run with `state: "active"` → excluded
   - Run with `state: "cancelled"` → excluded
   - Malformed manifest → entry skipped, no crash
   - Concurrent deletion (ENOENT during read) → entry skipped, no crash
   - Permission error (EACCES) → entry skipped, no crash
   - Read-only proof: before/after snapshot of sprints directory — inodes, mtimes, sizes, file contents all unchanged
   - Sort stability: two runs with same mtime → tiebroken by runId

### Future follow-up (tracked separately)

9. **Planning manifest timestamp gap** — add `Completed at ${new Date().toISOString()}.` to the planning manifest `## Outcome` section in `engine.ts` `#manifestContent()`. This makes future planning-run timestamps authoritative without breaking existing manifests. The history parser should prefer a parseable ISO timestamp in `## Outcome` over mtime when both are available.
