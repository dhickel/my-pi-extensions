## Prompt

Review every other required report from the History Command Contract Explorer brainstorm. Compare useful ideas, conflicts, omissions, feasibility, and trade-offs; preserve a broad lens without merely defending the first answer. The three reports to review are:

- `record-model/findings.md` — analyzes manifest formats, timestamp gaps, artifact-count semantics, and recommends a new `history.ts` module
- `readonly-resilience/findings.md` — focuses on read-only safety, path/symlink protection, graceful degradation, and recommends a `discoverHistory` function
- `project-integration/findings.md` — covers command-parsing integration, test architecture, and recommends a hybrid command+tool approach

## Source

- My original findings from the first cross-review synthesis (submitted as `synthesis.md`)
- `record-model/findings.md` (the "record-model" report)
- `readonly-resilience/findings.md` (the "readonly-resilience" report)
- `project-integration/findings.md` (the "project-integration" report)
- The full sprint-planner codebase at `/home/dhickel/AI/Workspaces/Pi-extensions/sprint-planner/`:
  - `commands.ts`, `index.ts`, `run-records.ts`, `execution-records.ts`, `engine.ts`, `types.ts`, `artifacts.ts`, `validation.ts`, `test/core.test.ts`, `README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Findings

### 1. Areas of strong agreement across all four reports

Four independent analyses converged on these points with no meaningful dissent:

| Decision | Consensus |
|---|---|
| Add `"history"` as a management action in `parseCommand` | Unanimous — all reports agree this is the right command surface |
| `/sprint history` takes no arguments (like `list`) | Unanimous |
| Use `discoverSprintRuns` or its classification logic as the discovery foundation | Unanimous |
| Filter strictly to completed runs; skip active/paused/interrupted/failed | Unanimous; one report (project-integration) raises including `blocked` but acknowledges the directive says "completed" |
| Read-only — no writes, no leases, no mutations | Unanimous |
| Sort by completion timestamp descending, take top 5 | Unanimous |
| Include both planning and execution runs in a unified view | Unanimous, with kind labels |
| Planning-run timestamp must fall back to manifest `mtime` (no `.state.json` after cleanup) | Unanimous |
| Execution-run timestamp from `record.json` `completedAt` is authoritative | Unanimous |
| Graceful degradation on malformed records (skip, don't crash) | Unanimous |

This level of convergence across four independent lenses is strong evidence that the core design is correct.

### 2. Conflicts and tensions that need resolution

#### 2.1 Directive summary source for planning runs

- **record-model**: Extract from `manifest.md` `## Directive` section
- **readonly-resilience**: Extract from `manifest.md` `## Directive` section
- **project-integration**: Extract from `input.md` first line
- **My synthesis**: Extract from `manifest.md` `## Directive` section (agrees with record-model and readonly-resilience)

**Analysis**: Both sources contain the same text — `input.md` is written as `# Sprint Input\n\n<directive>` and the manifest's `## Directive` section contains the exact same directive string passed to `#manifestContent(directive, ...)`. `input.md` is never cleaned up (it's the original input artifact, not a runtime file), while `manifest.md` is the canonical completed-run artifact. `input.md` is simpler to parse (just strip the `# Sprint Input\n\n` prefix), while `manifest.md` requires section extraction. However, `manifest.md` is the authoritative completed artifact and both exist for all completed runs. Either source works; `manifest.md` is more semantically correct for "history of completed runs."

**Resolution**: Use `manifest.md` `## Directive` as the primary source, falling back to `input.md` if the manifest heading is missing or malformed.

#### 2.2 Artifact count semantics

This is the most significant unresolved tension across reports:

- **record-model**: Notes that planning `## Artifacts` lists 15–30+ pipeline artifacts (brainstorm findings, cross-reviews, ironout drafts, reviews, plan files). Recommends counting **plan files only** (concepts + orchestration + phases) as more meaningful. Labels counts by kind.
- **readonly-resilience**: Count `## Artifacts` list items from manifest. This yields all pipeline artifacts for planning runs.
- **project-integration**: Count `phase-NN-*.md` files in `planning/` directory, plus `concepts.md` and `orchestration.md`. For execution runs, count `frozen.phases.length`.
- **My synthesis**: Count from `## Artifacts` list items in manifest (agrees with readonly-resilience).

**Analysis**: The record-model report correctly identifies the problem: a planning run's `## Artifacts` section includes every checkpointed artifact from the entire pipeline. For a typical 4-agent brainstorming sprint with 4 phases, this section has ~25 entries. A user asking "how many artifacts did this sprint produce?" likely means the final planning output (the plan files), not the intermediate pipeline artifacts.

However, counting only `planning/` directory files has a subtle problem: it requires the `planning/` directory to exist. For edge cases where `planning/` was not published (publication failure after manifest write), the count would be wrong or zero. The manifest's `## Artifacts` section is always authoritative and always present.

The project-integration report's approach (count `planning/` files only for planning runs, `frozen.phases.length` for execution) produces more user-meaningful numbers but creates two different count semantics under one "artifact count" label.

**Resolution**: Use kind-specific counting with clear labels. For planning runs, extract the phase count from `## Stages` (which says "Planning: N corrected phases") and add 2 for concepts + orchestration, labeling it "N plan files." For execution runs, count source artifacts from `## Artifacts` or `frozen.phases.length`, labeling it "N source artifacts." This makes the count meaningful for each kind without misleading the user about what "artifact" means. The `## Stages` section is present in both manifest formats and is always written by the engine.

#### 2.3 Module location

- **record-model**: New `sprint-planner/history.ts` module (Option C — recommended)
- **readonly-resilience**: New function in `run-records.ts` or a new `history.ts` (Option A — recommended)
- **project-integration**: New function in `run-records.ts` or new `history.ts` (Option D — recommended)
- **My synthesis**: New `history.ts` module (agrees with record-model)

**Analysis**: The disagreement is narrow — all reports agree the function should be separately exported and testable. The question is whether to add it to the existing `run-records.ts` (which already handles discovery, classification, leases, and doctor) or a new module.

Arguments for `run-records.ts`:
- Single shared discovery boundary — all sprint-record reading lives in one place
- Simpler imports for consumers
- Follows the precedent of `discoverSprintRuns` and `runDoctor` co-existing in the same module

Arguments for `history.ts`:
- `run-records.ts` is already 450+ lines covering leases, discovery, classification, and doctor
- History has distinct concerns (content parsing, timestamp extraction, truncation) not shared by other discovery consumers
- Manifest content parsing is a new responsibility not currently in `run-records.ts`
- The record-model report's justification — "The shared discovery boundary is consumed, not mutated" — is architecturally cleaner

**Resolution**: New `history.ts` module. The deciding factor is that manifest content parsing (extracting `## Directive`, counting artifacts, parsing `## Outcome` timestamps) is a distinct responsibility from structural discovery (checking file presence, classifying by markers, inspecting leases). Mixing these in `run-records.ts` would make that module responsible for both structure and content, which the existing code intentionally separates (`discoverSprintRuns` is structure-only; `runDoctor` reads content for diagnosis). A new module for content-oriented history extraction is consistent with this existing separation.

#### 2.4 Should blocked execution records appear in history?

- **record-model**: Only completed (silent on blocked)
- **readonly-resilience**: Strictly completed; `blocked` and `interrupted` are explicitly excluded
- **project-integration**: Suggests including `blocked` alongside `completed`: "Blocked is a terminal state — arguably 'completed' in the sense of 'finished.'"
- **My synthesis**: Only completed

**Analysis**: This is a product decision, not a technical one. The directive says "completed sprint runs." A blocked execution record is terminal — it will never progress — but it represents a plan whose implementation was stopped by an unresolvable defect, not successfully finished. Including blocked records in a "history of completed work" creates a misleading impression that the work was done. The user can always find blocked records via `/sprint list`.

**Resolution**: Only `completed` runs. `blocked`, `interrupted`, `failed`, and `cancelled` are excluded. This follows the directive's literal wording and avoids misrepresenting blocked runs as successes.

#### 2.5 Hybrid command+tool exposure

- **record-model**: Slash command only (silent on tool registration)
- **readonly-resilience**: Slash command only (silent on tool registration)
- **project-integration**: Recommends hybrid: command + optional `sprint_history` tool for agent consumption
- **My synthesis**: Slash command only (silent on tool registration)

**Analysis**: The project-integration report makes a good point — the project already exposes several features as both commands and tools (`/brainstorm` ↔ `sprint_brainstorm`, `/ironout` ↔ `sprint_ironout`, `/advanceplan` ↔ `sprint_advanceplan`). However, those are all **workflow tools** that launch provider work. History is a **read-only inspection** command like `list` and `doctor`, which are command-only. The directive specifically says `/sprint history` (slash command), not a tool.

**Resolution**: Implement as a slash command only for v1. If agent consumption becomes a need, a `sprint_history` tool can be added later with the same underlying function. This follows the precedent of `list` and `doctor` being command-only inspection verbs. The hybrid architecture (separate function consumed by command handler) makes adding a tool trivial if needed.

### 3. Ideas unique to each report worth preserving

**record-model report:**
- **Adding `completedAt` to the planning manifest format (Phase 2)**: This is a high-value forward-looking improvement. Currently, `#manifestContent()` writes `## Outcome` as a static string: `"Planning completed successfully."` Adding `Completed at ${new Date().toISOString()}.` would give future planning runs an authoritative timestamp, eliminating the mtime fragility. This is a one-line engine change with no breaking impact on existing manifests. **Worth adopting as a follow-up specification.**
- **Shared `parseManifest()` function suggestion**: While the report doesn't recommend this as the primary approach, the idea of a reusable manifest-section parser is valuable. If history, doctor, and future features all need to extract sections from manifests, a shared parser prevents duplication. However, the report correctly notes this mixes content-parsing into `run-records.ts`.

**readonly-resilience report:**
- **Comprehensive error-handling grid**: The detailed table mapping every missing piece to a degradation strategy is the most thorough error-handling analysis across all reports. It covers: missing manifest, missing `## Directive` heading, missing `## Artifacts` heading, missing `## Outcome` timestamp, malformed `record.json`, concurrent deletion (`ENOENT`), and permission errors (`EACCES`/`EPERM`). **This grid should become the implementation contract for error handling.**
- **Lease non-interference proof**: The report explicitly states that the history function must not import any write-bearing functions and should be grep-able for mutation verbs. This is a concrete, verifiable correctness property. **Worth including as a validation step.**
- **Concurrent deletion during enumeration**: The observation that a run's directory can be `rm -rf`'d between `readdir` and `lstat`/`readFile` is a real-world concern given that `/sprint reset` deletes directories. The report's recommended tolerance strategy (`ENOENT` → skip, continue) is correct and should be tested.

**project-integration report:**
- **Detailed test plan**: The 13-point test plan covering zero completions, fewer than 5, more than 5, mixed kinds, tie-breaking, corruption resilience, read-only proof, exact field validation, lease non-interference, directive extraction, fallback paths, and edge cases is comprehensive. **This should be the test specification.**
- **Command-parsing integration details**: The report identifies the exact lines that need changes in `parseCommand` (the management keywords array and `ParsedCommand.action` type), `commandUsage`, `getArgumentCompletions`, and `handleSprint`. This level of specificity reduces implementation ambiguity.
- **Argument guard consistency**: Noting that `history` should reject arguments the same way `list` does (`"/sprint list does not accept arguments."`) is a good consistency point.

### 4. Omissions across all reports

These are gaps that no report addressed:

1. **What about planning runs that completed with the old state format (version 1 or 2)?** The specification states that older incomplete state versions are incompatible with resume, but completed runs from older versions may still have manifests in the store. The history command should handle manifests regardless of the state version that produced them — but this isn't discussed.

2. **Running total or summary line**: Should the history output include a summary like "Showing 5 of 12 completed runs"? This helps users understand they're seeing a window, not the full set. No report addressed this.

3. **Integration with Pi session binding**: Should the history output highlight the currently-bound sprint if it appears in the last 5? The existing `/sprint status` already reports the bound sprint. History probably doesn't need this, but it's worth acknowledging as a deliberate omission.

4. **Performance ceiling for large stores**: All reports assume the sprints directory is small (tens of entries). If a project accumulates hundreds of runs over months, reading manifests for all completed runs to find the top 5 by timestamp could be slow. The project-integration report mentions "check at most 30 directories" as a stop threshold; the readonly-resilience report mentions sorting directory names by recency (they embed timestamps). A concrete strategy: read directory names, sort by embedded timestamp prefix descending, check manifests in order until 5 completed runs are found, stopping after some reasonable limit (e.g., 50 directories). This avoids reading all manifests in a large store.

5. **Output format consistency test**: No report proposed testing the exact output format against a golden string. While not strictly necessary, this would catch accidental format changes. The existing test suite doesn't golden-test notification strings for `list` either, so this is consistent.

6. **What if `manifest.md` is a symlink?** All reports mention symlink rejection for directory enumeration, but not for `manifest.md` itself. The readonly-resilience report mentions `O_NOFOLLOW` on open, which covers this, but it should be explicit: `lstat` on `manifest.md` must check `isSymbolicLink()` before opening, and `open` must use `O_NOFOLLOW`.

### 5. Feasibility assessment

All four reports converge on a design that is straightforward to implement:

| Component | Complexity | Risk |
|---|---|---|
| `parseCommand` changes | Trivial — one line added to management keywords, one type union addition | None |
| `handleSprint` history branch | Low — follows existing `list` pattern | None |
| `getSprintHistory` function | Medium — 60–90 lines of manifest parsing, sorting, filtering | Low — pure function, no side effects |
| Manifest section parsing | Low — regex or line-by-line extraction of well-known headings | Low — manifest format is engine-generated, not user-editable |
| Manifest mtime fallback | Trivial — `lstat` call | Low — documented as approximate |
| Error handling | Medium — 6–8 specific error paths, each with a skip-or-annotate decision | Low — all paths are read-only, no partial state to clean up |
| Tests | Medium — 10–13 test cases with temp directory fixtures | Low — existing test infrastructure supports this pattern |

Total estimated effort: 200–350 lines of new code, 150–250 lines of tests. This is a well-scoped feature.

### 6. Risk of drift from the "completed runs" detection heuristic

All reports acknowledge that planning-run completion detection relies on a heuristic: `manifest.md` present + `.state.json` absent = completed. The readonly-resilience report correctly notes that this could false-positive if `.state.json` was manually deleted but the run never actually completed. However, this is the same heuristic used by the existing `discoverSprintRuns` and `runDoctor` — it's not a new risk introduced by history. If the heuristic ever proves problematic, fixing it in the shared classification layer fixes it for all consumers.

### 7. Overall recommendation synthesis

The strongest synthesis across all four reports is:

1. **Module**: New `sprint-planner/history.ts` exporting `getSprintHistory(sprintsRoot, limit?)` → `Promise<HistoryEntry[]>`
2. **Command**: Add `"history"` to `parseCommand` management actions, wire a handler branch in `handleSprint`
3. **Data sources**:
   - Planning: `manifest.md` `## Directive` for summary (fallback `input.md`), manifest `mtime` for timestamp, `## Stages` phase count + 2 for artifact count (labeled "N plan files")
   - Execution: `record.json` `completedAt` for timestamp, source plan path for directive, `frozen.phases.length` for artifact count (labeled "N source artifacts")
4. **Filtering**: Only `state === "completed"` for both planning and execution runs
5. **Sort**: `completedAt` descending, `runId` ascending tiebreaker
6. **Error handling**: Follow the readonly-resilience report's grid — every missing field has a degradation annotation, every filesystem error is caught and skipped
7. **Phase 2**: Add `Completed at <ISO>` to planning manifest `## Outcome` in `#manifestContent()`
8. **Testing**: Follow the project-integration report's 13-point test plan plus a read-only proof

## Options

### Option 1 — Converged Consensus (RECOMMENDED)

Adopt the synthesis above: new `history.ts`, slash command only, kind-specific artifact counting with clear labels, mtime fallback for planning timestamps, `completedAt` from record for execution, only `completed` runs, graceful degradation for all error paths. Phase 2 adds authoritative planning timestamps.

**Pros**: All four reports independently converged on this overall shape. The remaining disagreements (artifact count semantics, timestamp source for planning) have clear resolution paths supported by the majority of analyses. Low implementation risk.

**Cons**: Kind-specific artifact counting creates two different "count" meanings that must be clearly labeled to avoid confusion. Manifest mtime for planning timestamps is imprecise until Phase 2.

### Option 2 — Maximal Minimalism

Add history as a lightweight filter on top of the existing `list` output. No new module, no new exported function, no manifest parsing beyond what `discoverSprintRuns` already does. The "directive summary" is the first 80 chars of the runId (which contains a slug of the directive). Timestamp is the runId's embedded creation time. Artifact count is omitted or derived from `## Stages` in a quick manifest read.

**Pros**: Fastest to implement (~30 lines). No new module. No manifest parsing complexity.
**Cons**: Directive summary from runId slug is low-quality (runId slug is truncated to 48 chars of safeSlug'd text). Timestamp from runId is creation time, not completion time — misleading for long-running sprints. Omitting artifact count loses one of the three requested fields.

### Option 3 — Full Rich History

Go beyond the directive: add `--kind`, `--all`, `--count N` flags. Parse full manifest content into structured records. Cross-reference execution records with their source planning runs for richer directive summaries. Include blocked and interrupted terminal states with clear status labels. Add a `sprint_history` agent-callable tool. Add a `completedAt` field to the planning manifest immediately (not Phase 2).

**Pros**: Most complete feature. Agent-consumable. No Phase 2 needed for authoritative timestamps.
**Cons**: Scope creep beyond the directive ("last 5 completed sprint runs"). Adding `completedAt` to the manifest requires changing the engine and the specification in the same change. Cross-referencing execution → planning runs adds complexity and brittleness. The `--kind`, `--all`, `--count` flags are not requested and add parsing complexity.

## Trade-offs

| Dimension | Option 1 (Consensus) | Option 2 (Minimal) | Option 3 (Rich) |
|---|---|---|---|
| **Scope alignment** | Matches directive | Under-delivers on directive summary and artifact count | Exceeds directive with unrequested flags and cross-referencing |
| **Implementation effort** | Medium (200–350 lines + tests) | Low (~30 lines) | High (400–600 lines + tests + spec + engine changes) |
| **Directive summary quality** | Good — first ~120 chars of actual directive | Poor — runId slug only | Best — cross-referenced planning directives |
| **Timestamp accuracy** | Good for execution, approximate for planning (improved in Phase 2) | Wrong — uses creation time, not completion | Best — authoritative for both (with engine change) |
| **Artifact count meaning** | Kind-specific with labels; slightly complex but accurate | Omitted or crude | Kind-specific with labels |
| **Code organization** | New module, clean separation | Inline in handler | New module or extended run-records |
| **Test surface** | Well-defined, independently testable function | Hard to test independently (inline in handler) | Large test surface; cross-referencing creates complex fixtures |
| **Risk** | Low | Very low | Medium — engine/spec changes add risk |

**Recommendation**: Option 1. It meets the directive's requirements with high quality, stays within scope, and defers the engine change for authoritative planning timestamps to a natural Phase 2. The mtime fallback is documented as approximate, and the Phase 2 improvement eliminates the approximation going forward.

## Open Questions

1. **Should we immediately add `completedAt` to the planning manifest (bundling Phase 2 with Phase 1)?** The engine change is one line. The specification change is one sentence. Bundling them avoids the mtime fragility entirely for new runs. The counter-argument: it's a specification change and an engine behavior change that should go through its own review. **Lean: separate Phase 2.** The mtime fallback is good enough for v1; making the manifest change independently lets it be reviewed and tested in isolation.

2. **Should the history output include a summary line like "Showing 5 of 12 completed runs"?** This is a UX detail no report addressed. It's low-cost and helps users understand they're seeing a window. **Suggestion:** Include if total completed > 5.

3. **What label text should disambiguate planning vs. execution artifact counts?** "N plan files" for planning, "N source artifacts" for execution. These are concise enough for a single-line display while being semantically distinct. If a single column heading is needed, use "Artifacts" with the kind-appropriate label in each row.

4. **Should the output include a hint to use `/sprint doctor <runId>` for full details?** The readonly-resilience report suggests this implicitly. It's a one-line footer that improves discoverability of the doctor command. **Suggestion:** Add as a footer line.

5. **Should the `history` management action be hidden from `getArgumentCompletions` if the store has no completed runs?** No — argument completions should always show available commands. The empty-state message handles the no-runs case.

6. **When exactly should we stop searching through directories for completed runs?** The project-integration report suggests "check at most 30 directories." Since run IDs embed a timestamp prefix, sorting directory names by that prefix descending and checking in order is efficient. Stop after finding 5 completed runs or after checking 30 directories (whichever comes first). If fewer than 5 are found within 30 directories, return what was found with a note that the store may have more older completed runs.

## Recommended Next Step

Adopt the **Option 1 consensus synthesis** with these concrete implementation decisions:

1. **Create `sprint-planner/history.ts`** exporting:
   ```ts
   interface HistoryEntry {
     runId: string;
     kind: "planning" | "execution-only";
     directiveSummary: string;     // first ~120 chars, truncated with "…"
     completedAt: string;          // ISO 8601
     completedAtSource: "record-completedAt" | "manifest-mtime";
     artifactCount: number;
     artifactLabel: string;        // "plan files" | "source artifacts"
   }

   async function getSprintHistory(
     sprintsRoot: string,
     limit?: number,              // default 5
     retainedHandle?: RunLeaseHandle | readonly RunLeaseHandle[],
   ): Promise<HistoryEntry[]>
   ```

2. **Implement the function** following the readonly-resilience report's error-handling grid:
   - Every filesystem error → skip entry, continue
   - Every missing heading → annotation, continue
   - Every malformed record → skip entry, continue
   - Never throw from enumeration; only throw on store-not-ready (same as `discoverSprintRuns`)
   - Sort: `completedAt` descending → `runId` ascending; take `limit`
   - Stop searching after 30 directories even if fewer than `limit` found

3. **Wire the command** in `index.ts`:
   - Add `"history"` to `ParsedCommand.action`, management keywords, `commandUsage`, and `getArgumentCompletions`
   - Add `if (parsed.action === "history")` branch following the `list` pattern
   - Output: one line per entry with runId, kind icon, completedAt, artifactCount+label, directiveSummary
   - Footer: "Use /sprint doctor <runId> for full details." (if entries > 0)
   - Empty state: "No completed sprint runs found in .internal-dev/sprints/."

4. **Write tests** following the project-integration report's 13-point plan plus:
   - Read-only proof: snapshot directory before/after, assert zero mutations
   - Lease non-interference: runs with foreign leases still appear
   - Symlink rejection on manifest files

5. **File a Phase 2 specification change** to add `Completed at <ISO>` to the planning manifest `## Outcome` in `#manifestContent()`, with a corresponding decision record.

6. **Re-export from `core.ts`** so the function is available through the existing barrel export pattern.
