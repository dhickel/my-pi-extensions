## Prompt

Add a `/sprint history` command that shows the last 5 completed sprint runs with their directive summary, completion timestamp, and artifact count. Read-only, no mutations.

## Source

Inspected the complete sprint-planner codebase:

- `sprint-planner/run-records.ts` — shared discovery (`discoverSprintRuns`, `classifyRun`), lease management, path resolution, doctor
- `sprint-planner/execution-records.ts` — execution record lifecycle, `renderManifest`, `parseExecutionRecord`, `doctorExecutionRecord`
- `sprint-planner/engine.ts` — planning engine, `#manifestContent` (planning-run manifest format)
- `sprint-planner/commands.ts` — command parsing (`parseCommand`, `ParsedCommand`)
- `sprint-planner/index.ts` — extension registration, slash-command wiring, `handleSprint`
- `sprint-planner/types.ts` — `RunRecordSummary`, `RunRecordKind`, `ExecutionRecord`, `SprintState`, `DoctorReport`
- `sprint-planner/validation.ts` — plan directory and content validators
- `sprint-planner/artifacts.ts` — `assertSafeRelativePath`, `sha256`, `RunArtifactStore`, `SprintStateStore`
- `.internal-dev/specifications/sprint-planner-suite.md` — living specification
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` — reusable implementation lessons

## Findings

### 1. Current discovery infrastructure (`run-records.ts`)

`discoverSprintRuns()` enumerates every direct child under `.internal-dev/sprints/`, classifies each as `planning`, `execution-only`, `ambiguous`, `malformed`, or `unknown`, and returns `RunRecordSummary` entries with `runId`, `kind`, `state`, `leaseOwnership`, and `markers` (presence of `.state.json`, `manifest.md`, execution record). It reads directory entries and stats but does **not** read file contents.

`classifyRun()` determines the run kind purely from file presence — `.state.json` → planning, `execution/record.json` → execution-only, both → ambiguous. It never opens or parses these files.

Both planning and execution runs produce a `manifest.md` with six required level-two headings: `## Directive`, `## Stages`, `## Artifacts`, `## Implementation Evidence`, `## Final Validation`, `## Outcome`.

### 2. Planning-run manifest format (from `engine.ts` `#manifestContent`)

```
# Sprint <runId>

## Directive

<raw directive text>

## Stages

- Brainstorm: <N> roles, all findings and cross-reviews complete
- Ironout: corrective handoff signed off
- Planning: <N> corrected phases plus concepts and orchestration

## Artifacts

- `path` — sha256 `hash`
...

## Implementation Evidence

Not produced by sprint-planner...

## Final Validation

Not run by sprint-planner...

## Outcome

Planning completed successfully.
```

**Critical gap**: The planning manifest does **not** include a completion timestamp. The `.state.json` has `completedAt` but is removed after successful completion (phase 01 cleanup). The `## Outcome` section is a static message, not a timestamp-bearing record.

### 3. Execution-run manifest format (from `execution-records.ts` `renderManifest`)

```
# Execution Record <runId>

## Directive

Source plan `path` is authoritative...

## Stages

- phase-NN-slug.md: wave-NN, implementation recorded/not recorded, validator PASS/BLOCKED/not recorded

## Artifacts

- `path` — sha256 `hash`, N bytes

## Implementation Evidence

- `phase`: timestamp, N changed-file observation(s)

## Final Validation

- `phase`: PASS/BLOCKED at timestamp
- integration: PASS/BLOCKED at timestamp

## Outcome

Completed at <ISO timestamp>.   OR   Blocked: <reason>   OR   Interrupted: <reason>   OR   Active, revision N.
```

Execution manifests **do** include a completion timestamp in `## Outcome` — `renderManifest()` writes `Completed at ${record.completedAt}` for `state === "completed"`.

### 4. What "completed" means for history filtering

- **Planning**: `state === "completed"` in `RunRecordSummary`, which is derived from `.state.json` status when present, or from `manifest.md` presence without `.state.json` (phase 01 cleanup case). Planning runs can also be `cancelled` or `failed` — these are terminal but should not appear in a "completed history" listing.
- **Execution**: `state === "completed"` in the execution record (`record.json`), reflected as `"completed"` in `RunRecordSummary.state` via `doctorExecutionRecord`.

For history, only genuinely completed runs (not `cancelled`, `failed`, `blocked`, `interrupted`) should appear. Execution runs in `blocked` or `interrupted` state are terminal but not "completed."

### 5. Timestamp source options

| Source | Planning | Execution | Reliability |
|---|---|---|---|
| `manifest.md` mtime | ✅ always available | ✅ always available | Fragile — git clone resets it, `touch` changes it |
| `.state.json` `completedAt` | ✅ when state file retained | N/A | Removed after phase 01 cleanup; unreliable |
| `record.json` `completedAt` | N/A | ✅ always present for completed | Authoritative for execution |
| Run ID prefix (creation time) | ✅ always available | ✅ always available | Creation time, not completion time |

**For a read-only MVP**, mtime of `manifest.md` is the most practical universal fallback. For execution records, `record.json`'s `completedAt` (parsed from the authoritative record) is strictly better and should be preferred. For planning runs, mtime is the only non-mutating option that works for all existing runs.

### 6. Artifact count semantics

The meaning of "artifact count" is fundamentally different between planning and execution runs:

- **Planning**: The `## Artifacts` section lists every artifact from the entire pipeline — input, brainstorm outputs, ironout drafts, final plan files, review. This is a long list (often 15–30+ entries). A more meaningful count for users is **plan file count** — `concepts.md` + `orchestration.md` + phase files (typically 4–12), representing "how big the plan was."
- **Execution**: The `## Artifacts` section lists the frozen source plan files (concepts, orchestration, phases). This equals the immutable source descriptor file count — meaningful as "plan size." Alternatively, the count of changed-file observations across all phases (from `## Implementation Evidence` or parsed from `record.json`) represents "how much was changed."

The two artifact-count meanings are incommensurable. A unified history display must either pick one meaning per run kind (and label accordingly) or use different columns.

### 7. Parsing boundary: manifest format similarities and differences

Both manifest formats share:
- Six identical level-two headings (`## Directive`, `## Stages`, `## Artifacts`, `## Implementation Evidence`, `## Final Validation`, `## Outcome`)
- `## Directive` as the first content section
- `## Artifacts` as a Markdown list of `- \`path\` — sha256 \`hash\`` entries (planning) or `- \`path\` — sha256 \`hash\`, N bytes` entries (execution)

Differences that a shared parser must handle:
- Planning `## Directive` is the raw user prompt; execution `## Directive` is a summary referencing the source plan
- Planning `## Artifacts` has the format `` `path` — sha256 `hash` ``; execution adds byte counts: `` `path` — sha256 `hash`, N bytes ``
- Planning `## Outcome` is a static message with no timestamp; execution `## Outcome` is state-dependent and includes timestamps
- Planning `## Stages` is prose; execution `## Stages` is a structured per-phase list

### 8. Command-parsing extension

`parseCommand()` in `commands.ts` returns a `ParsedCommand` with `action` typed as `"start" | "status" | "cancel" | "pause" | "resume" | "reset" | "list" | "doctor"`. Adding `"history"` requires:

1. Adding `"history"` to the `action` union type (in `types.ts` or `commands.ts`)
2. Adding it to the management-verb detection regex in `parseCommand()`
3. Routing it in `handleSprint()` in `index.ts`
4. Updating argument completions in `registerCommand`

The `history` action takes no run ID argument (it shows the last 5 across all runs), aligning with `/sprint list` which also takes no arguments.

## Options

### Option A — Extend `discoverSprintRuns()` to populate history fields inline

Add history-specific fields (`directiveSummary`, `completionTimestamp`, `artifactCount`) to the `RunRecordSummary` type. During discovery, when a run is classified as completed and has a manifest, parse the manifest sections and populate these fields. The `/sprint history` command calls the extended `discoverSprintRuns()`, filters completed, sorts by timestamp, and takes 5.

**Pros**
- Single filesystem pass — no double-stat or double-readdir
- History fields are validated at discovery time
- Consistent with the "shared discovery boundary" principle

**Cons**
- `discoverSprintRuns()` changes from stat-only to file-reading — significantly more I/O for every caller (list, doctor, engine startup)
- `RunRecordSummary` accumulates history-specific fields not needed by list or doctor
- Couples structurally-focused discovery with semantically-focused content parsing
- Every `RunRecordSummary` consumer pays the I/O cost of reading manifests

### Option B — Shared `parseManifest()` in `run-records.ts` + command-layer composition

Add a `parseManifestContent(runDirectory, kind)` function to `run-records.ts` that reads `manifest.md`, extracts sections (`## Directive`, artifact list, `## Outcome`), and returns a structured `ManifestSummary` with directive text, artifact count, and completion timestamp (if parseable). For execution runs, also read `record.json` for the authoritative `completedAt`. The `/sprint history` command calls `discoverSprintRuns()` (unchanged), filters completed, calls `parseManifestContent` for each, sorts, and displays.

**Pros**
- `discoverSprintRuns()` stays lightweight (no content reads)
- `parseManifestContent()` is reusable — doctor could use it, future tooling could use it
- The parsing boundary is explicitly in the shared run-records module

**Cons**
- `run-records.ts` takes on content-parsing responsibility beyond its current structural focus
- Requires manifest reads for history entries after discovery already stated the files
- Mixed responsibility: leases, paths, discovery, diagnosis, and now content parsing in one module

### Option C — New `history.ts` module consuming the discovery boundary (**RECOMMENDED**)

Create `sprint-planner/history.ts` that imports `discoverSprintRuns()`, `classifyRun()`, and path helpers from `run-records.ts`, adds its own manifest parsing layer on top, and exports a `getHistory(maxCount)` function. The module:

1. Calls `discoverSprintRuns()` to get all runs (stat-only, no content reads)
2. Filters to completed planning and execution runs
3. Reads each `manifest.md` and parses the three needed sections
4. For execution runs, optionally reads `record.json` for the authoritative `completedAt`
5. Sorts by completion timestamp descending
6. Returns the top N entries with directive summary, timestamp, artifact count

**Pros**
- `discoverSprintRuns()` is reused without modification — zero filesystem logic duplication
- `run-records.ts` stays focused on structure, leases, discovery, and diagnosis
- History-specific concerns (timestamp fallback strategy, artifact-count semantics, truncation) are encapsulated
- The manifest parser handles planning/execution schema differences internally — callers see a unified `HistoryEntry`
- Easy to unit-test independently with mock manifests
- Clean separation: the shared discovery boundary is consumed, not mutated

**Cons**
- One new module in the codebase (~80–120 lines)
- Re-stats manifest files already seen during discovery (acceptable — discovery doesn't read contents)
- Manifest path knowledge is slightly duplicated (paths like `manifest.md`, `execution/record.json` are already known to multiple modules)

### Option D — Inline manifest parsing in the command handler (`index.ts`)

Parse manifests directly inside the `handleSprint` history case. Call `discoverSprintRuns()`, filter, sort, parse sections with regex, display. No new modules, no new exported functions.

**Pros**
- Minimal blast radius — changes only `commands.ts` (add action) and `index.ts` (add handler case)
- Quickest to implement (single function in the handler)
- No API surface growth

**Cons**
- No reuse — other tools or future features must re-implement manifest parsing
- Harder to test independently
- Inline regex parsing duplicates manifest structure knowledge
- Command handler grows longer with non-command-concern logic
- Planning/execution schema differences handled in a switch inside the UI layer

### Option E — Two-phase: extend manifests going forward, parse best-effort now

Phase 1 (now): Add `/sprint history` using mtime-based timestamps and whatever artifact counts are parseable from existing manifests. No engine changes.

Phase 2 (future): Add `completedAt` to the planning manifest format in `#manifestContent()` (a one-line change). Newly completed planning runs get authoritative timestamps. The history command prefers authoritative timestamps when available, falls back to mtime for older runs.

This is not a standalone option — it complements Options A–D with a forward-looking timestamp strategy.

**Pros**
- Addresses the timestamp gap definitively without blocking the MVP
- Backward-compatible — old manifests still work
- The history command is ready for authoritative timestamps when they arrive

**Cons**
- Requires a spec change and engine change in a follow-up
- Two different timestamp qualities in the same history display

## Trade-offs

### Discovery coupling vs. content parsing separation

The core architectural tension is whether to push manifest content parsing into the shared discovery layer (Options A, B) or keep it in a separate consumer (Option C). The project already draws a clear line: `discoverSprintRuns()` and `classifyRun()` are structure-only (file presence, stat results), while `runDoctor()` reads content for diagnosis. Adding content parsing to discovery would blur this line and make every discovery consumer pay for manifest reads.

**Recommendation**: Keep discovery structure-only. Add content parsing in a dedicated consumer. This preserves the clean boundary and follows the existing pattern where `runDoctor()` reads content but `discoverSprintRuns()` does not.

### Unified vs. kind-specific artifact count

A single "artifact count" number that means different things for planning vs. execution runs is confusing. Options:

1. **Single column, kind-labeled**: "12 plan files" / "8 source artifacts" — the label disambiguates
2. **Different columns per kind**: Not practical in a compact history listing
3. **Always count manifest artifact list entries**: Consistent but less meaningful for planning (shows 25+ pipeline artifacts, not what the user cares about)

**Recommendation**: Use kind-specific counts with clear labels. Planning → count of `planning/` files (concepts + orchestration + phases). Execution → count of source artifact entries. Both are derivable from the manifest's `## Artifacts` section by counting list items.

### Timestamp quality

Using manifest mtime is the only zero-mutation universal option, but it's fragile (git operations, filesystem touches). The alternatives require either a state file that may not exist (`.state.json` `completedAt`) or an engine change. The pragmatic path:

1. **For execution records**: Parse `record.json` and use `completedAt` — authoritative, always present for completed runs
2. **For planning runs**: Use manifest mtime; label it as "file timestamp" to be honest about its quality
3. **Future**: Add `completedAt` to the planning manifest and prefer it when present

### Sorting key

All completed runs (planning + execution) in one unified history timeline sorted by completion time. This is the cleanest user experience. Alternative: separate planning-history and execution-history views, but that loses the unified timeline.

## Open Questions

1. **Should the history include execution runs that completed via the orchestrate skill, or only planning runs?** The directive says "completed sprint runs" — this naturally includes both. Execution records with `state === "completed"` represent successfully implemented and validated plans. A unified timeline of planning-then-execution pairs (where the execution record references the source planning run) would be the most useful view.

2. **How should directive summaries be truncated for display?** The raw directive can be hundreds of words. First-line or first-sentence truncation (e.g., 80–120 chars with ellipsis) is standard. The full directive is always available via `/sprint doctor <runId>` or by reading the manifest directly.

3. **Should we surface the run kind (planning vs. execution) in each history row?** A `kind` column (or icon) helps users distinguish "I planned this" from "I implemented this." The run kind is already available from `RunRecordSummary.kind`.

4. **What about runs that are execution-only but never had a corresponding planning run in this store?** Execution records reference `source.sourcePlanPath` — which could be an external plan path or a planning run in the same sprints store. When the source planning run is in the same store, the history view could show only the execution record (since it subsumes the planning record's outcome). When there's no corresponding planning run, the execution record stands alone.

5. **Should history show the last 5 of each kind or the last 5 overall (any kind)?** Last 5 overall, sorted by completion time, is the most intuitive. A future iteration could add `--kind planning|execution` filtering.

6. **Is the `## Artifacts` section count always the right "artifact count"?** For planning runs, the artifact list includes every intermediate artifact (brainstorm reports, ironout drafts, reviews) — often 20+ entries. Users likely care more about "how many phases did this plan have?" The phase count is embedded in `## Stages` (e.g., "Planning: 5 corrected phases"). For execution, the source artifact count (plan files) is more meaningful than the total changed-file count. The meaning of "artifact count" should be specified in the feature contract.

## Recommended Next Step

Adopt **Option C** (new `history.ts` module consuming the shared discovery boundary) with the following concrete design:

1. **Add `"history"` to the command parser** — a management action in `parseCommand()` with no arguments (like `list`).

2. **Create `sprint-planner/history.ts`** exporting a single function:

   ```ts
   async function getHistory(
     sprintsRoot: string,
     maxCount: number,
     retainedHandle?: RunLeaseHandle,
   ): Promise<HistoryEntry[]>
   ```

   Where `HistoryEntry` is:
   ```ts
   interface HistoryEntry {
     runId: string;
     kind: RunRecordKind;           // "planning" | "execution-only"
     directiveSummary: string;      // first ~120 chars of ## Directive
     completedAt: string;           // ISO timestamp (mtime for planning, record.completedAt for execution)
     completedAtSource: "manifest-mtime" | "execution-record";
     artifactCount: number;         // plan files for planning, source artifacts for execution
     artifactLabel: string;         // "plan files" | "source artifacts"
   }
   ```

3. **Manifest parsing strategy**:
   - Read `manifest.md` for all completed runs
   - Extract `## Directive` — take first non-blank line after the heading, truncate to ~120 chars
   - Extract `## Artifacts` — count list items (lines matching `^- \``)
   - For execution runs, also read `execution/record.json` for the authoritative `completedAt`
   - For planning runs, use `manifest.md` stat mtime as completion timestamp
   - For execution runs with `record.json`, extract `## Outcome` for the `Completed at` timestamp

4. **Wire into `index.ts`**:
   - Add `"history"` case in `handleSprint()`
   - Call `getHistory(root, 5)`, format each entry as a line with runId, timestamp, directive preview, artifact count
   - Display via `ctx.ui.notify()` with clear column alignment

5. **Future follow-up** (separate from this brainstorm):
   - Add `completedAt` to the planning manifest format in `#manifestContent()` — a one-line addition: `Completed at ${new Date().toISOString()}.` appended to `## Outcome`
   - Update the history parser to prefer the in-manifest timestamp over mtime
   - This makes planning timestamps authoritative without changing any existing manifests

This approach respects the shared discovery boundary, adds no filesystem logic duplication, keeps planning/execution schema differences encapsulated, and enables a clean read-only MVP.
