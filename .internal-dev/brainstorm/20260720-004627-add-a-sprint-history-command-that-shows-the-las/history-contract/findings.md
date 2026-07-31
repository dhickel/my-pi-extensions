## Prompt

Explore the broad product and command semantics for `/sprint history`: what qualifies as a completed sprint run across planning and execution records, how the newest five are selected and ordered, and how directive summaries, completion timestamps, artifact counts, empty states, and concise user-facing output should behave consistently with existing `/sprint` management commands.

## Source

All analysis derives from the authoritative sprint-planner source code, specifications, decisions, and knowledge files under `/home/dhickel/AI/Workspaces/Pi-extensions/`:

- `sprint-planner/commands.ts` — command parsing, action routing, existing `parseCommand` for `"sprint"` including `"list"` and `"doctor"`
- `sprint-planner/types.ts` — `SprintState`, `RunStatus`, `RunRecordSummary`, `ExecutionRecord`, `ArtifactRecord`, `WorkflowName`, `DoctorReport`, and all version/schema constants
- `sprint-planner/run-records.ts` — `discoverSprintRuns`, `classifyRun`, `runDoctor`, lease lifecycle, reservation semantics, and canonical `sprintsRoot` helpers
- `sprint-planner/execution-records.ts` — `parseExecutionRecord`, `doctorExecutionRecord`, `renderManifest`, `loadExecutionRecord`, and the immutable-source / frozen-orchestration snapshot contracts
- `sprint-planner/engine.ts` — `SprintPlannerEngine`, `#driveSprint` completion path (writes manifest, sets `status = "completed"`, cleans runtime files), `#manifestContent` shape
- `sprint-planner/index.ts` — `handleSprint`, `/sprint list` output shape, `latestBinding`, `uniqueId`, `locateStore`, `notifyCompletion`, footer progress
- `sprint-planner/validation.ts` — `inspectPlanDirectory` and structured validation categories
- `.internal-dev/specifications/sprint-planner-suite.md` — run record, lease, discovery, and doctor contracts; artifact layout; persistence and recovery; completed-plan publication boundaries
- `.internal-dev/specifications/decisions.md` — recorded decisions on lease conservatism, read-only doctor, no-replace publication, execution-record separation, pre-freeze decomposition gate, prompt-only estimate guidance
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` — runtime lessons on fan-out, retry accounting, resume revalidation, subagent pagination, and cancellation
- `.internal-dev/AGENTS.md` — store contract: sprints directory contains self-contained staged sprint records; runtime state is temporary; durable execution evidence belongs to sprint-planner

## Findings

### 1. What qualifies as a completed sprint run

A sprint run is any direct-child directory under `.internal-dev/sprints/<run-id>/`. The existing classification system (`classifyRun` in `run-records.ts`) recognizes two completed forms:

**A. Completed planning run (`.state.json` still present)**
When the engine finishes the full brainstorm → ironout → advanced-planning pipeline, it sets `state.status = "completed"`, writes `state.completedAt`, persists `.state.json`, publishes the manifest and `planning/` directory, and removes runtime files (`.sessions/`, etc.). The `.state.json` persists with `status: "completed"` and `completedAt`. This is the `RunStatus` value `"completed"`.

**B. Completed planning run (`.state.json` cleaned up)**
The engine's `#publishFullSprint` path writes `manifest.md` and `planning/`. After a successful run, the engine calls `this.#artifactStore!.removeRuntimeFiles()`. The `.state.json` may be cleaned up (the code removes runtime files but leaves the state — though the `#publishFullSprint` path suggests runtime cleanup). In practice, `discoverSprintRuns` treats a run with a `manifest.md` and no `.state.json` as `stateSummary = "completed"`:

```typescript
// From discoverSprintRuns in run-records.ts
if (stateEntry?.isFile() && !stateEntry.isSymbolicLink()) {
    stateSummary = (await new SprintStateStore(runDir).load()).status;
} else {
    // Has manifest but no state — likely completed and cleaned up
    const manifestEntry = await entryStat(resolve(runDir, "manifest.md"));
    stateSummary = manifestEntry?.isFile() && !manifestEntry.isSymbolicLink() ? "completed" : "unknown";
}
```

**C. Completed execution record**
Execution records (`exec-<id>`) are separate from planning runs. Their `ExecutionRecord.state` can be `"completed"` when all phases have PASS verdicts and integration validation passes. They have their own `completedAt` timestamp, manifest, and source descriptors. Execution records never contain `.state.json`.

**D. What should NOT be considered completed**
- Runs with status `"paused"`, `"interrupted"`, `"failed"`, `"cancelled"`, `"running"`, or `"starting"`
- Runs classified as `"malformed"`, `"unknown"`, or `"ambiguous"` (both planning and execution markers)
- Runs that have a manifest but are genuinely incomplete (manifest exists from a prior stage, but the run didn't reach completion)

### 2. How the newest five are selected and ordered

The discovery pipeline (`discoverSprintRuns`) already enumerates all direct-child directories in `.internal-dev/sprints/` sorted alphabetically by name. Run ids contain a timestamp prefix (`YYYYMMDD-HHMMSS-<slug>`) generated by `timeId()`, so alphabetical order approximates chronological creation order.

For a history command, the relevant sort key is the **completion timestamp**, not creation time. Several options exist for extracting it:

| Source | Field | Availability |
|---|---|---|
| `SprintState` in `.state.json` | `completedAt` (ISO 8601) | Present when `status === "completed"` |
| `manifest.md` | No embedded timestamp — the canonical headings don't include one | Must fall back to file `mtime` |
| `ExecutionRecord` in `execution/record.json` | `completedAt` (ISO 8601) | Present when `state === "completed"` |
| Execution `manifest.md` | No embedded timestamp | Must fall back to file `mtime` |

For a planning run without `.state.json` (cleaned up after completion), the manifest file's `mtime` is the only available completion timestamp. This is imperfect (git checkout or file copy could change it) but is the best available evidence after runtime state cleanup.

**Ordering should be `completedAt` descending**, since the user asked for "newest five." For planning runs where only manifest mtime is available, fall back to that mtime as an approximate timestamp.

### 3. Directive summary

The directive is the original user input that kicked off the sprint. For a planning run:

- **Primary source**: The `## Directive` section of `manifest.md`. The engine's `#manifestContent` stores the directive verbatim under `## Directive` heading. This is the most accessible source for completed runs (state may be cleaned up).
- **Fallback source**: `input.md` in the run directory, which contains `# Sprint Input\n\n<directive>`. This file persists even after runtime cleanup.
- **Conciseness**: The full directive could be a long multi-line prompt. A history summary needs a single-line truncation. A reasonable approach: take the first non-blank line after the heading, strip Markdown formatting, and truncate to approximately 80–120 characters with an ellipsis.

For an execution record:
- The renderManifest `## Directive` section includes the source plan path and optional planning-run-id reference. The actual directive lives in the source planning run's manifest, not the execution record. For history display, showing the execution record's source plan path and planning-run-id is more informative than trying to cross-reference.

### 4. Completion timestamps

Displayed as a human-readable ISO 8601 date/time. For planning runs with `.state.json`, `state.completedAt` is authoritative. For clean-state planning runs, manifest `mtime` converted to ISO 8601. For execution records, `record.completedAt`.

The format should be concise: `YYYY-MM-DD HH:MM UTC` or relative ("completed 2 hours ago") depending on UX preference. Given the existing `/sprint list` and `/sprint doctor` output style (dense, terse, single-line-per-run), a compact timestamp like `2026-07-20 14:30` is more consistent than relative times.

### 5. Artifact counts

"No mutation" means artifact count is read-only, not that artifacts are counted differently.

**For planning runs**: Count distinct artifact paths from either:
- `SprintState.steps` — each step has `artifacts: ArtifactRecord[]`, plus `inputArtifact`. Summing step artifacts gives total checkpointed artifacts.
- `manifest.md` `## Artifacts` section — a bullet list of artifact paths with SHA-256 digests. Simply counting the bullet items gives the artifact count.
- The manifest is the simpler source when `.state.json` is absent. Parsing the manifest headings is more robust than reading `.state.json` for cleaned-up runs.

**For execution records**: Count from:
- `ExecutionRecord.source.files` (frozen source plan artifacts) plus phase evidence records. The `renderManifest` output already has an `## Artifacts` section listing source files.
- A simpler heuristic: count bullets under `## Artifacts` in the execution manifest.

### 6. Empty states

When no completed sprint runs exist, the command should produce a clear, helpful message consistent with existing commands:

- `/sprint list` currently says: `"No sprint runs found in .internal-dev/sprints/."`
- `/sprint status` says: `"No sprint is bound to this Pi session."`
- A consistent message: `"No completed sprint runs found in .internal-dev/sprints/."` with a hint like `"Start one with /sprint <prompt>."`

### 7. User-facing output format

The existing `/sprint list` output is dense table-like lines:

```
<runId>  <kind>  <state>  markers=<markers>  lease=<leaseOwnership> <icon>
```

For history, each entry needs to convey directive summary, completion time, and artifact count. The format should be a compact multi-line-per-run layout or a one-line-per-run with key fields. Given the existing style, one line per run with relevant columns is appropriate:

```
<runId>  <completedAt>  artifacts=<count>  <directive-summary>
```

The directive summary is the most variable-length field, so it should come last. A two-line format could also work:

```
<runId> — completed <completedAt> — <count> artifacts
  <directive-summary>
```

### 8. Consistency with existing commands

Key constraints from the existing command surface:

- **Read-only**: `/sprint history` must be read-only, like `/sprint list` and `/sprint doctor`. No state mutation, no lease acquisition, no file writes. This is already stated in the directive.
- **No run-id argument**: Unlike `status`, `doctor`, or `reset`, history operates globally across all runs. The `parseCommand` function should treat it like `list` — no arguments accepted.
- **Project-trust**: Must check `ctx.isProjectTrusted()` before reading sprint data, consistent with all existing management commands.
- **Store readiness**: Must call `locateStore` and `sprintsRoot` to find the sprints directory, consistent with `list` and `doctor`.
- **Lease-awareness**: While history doesn't need lease handles for mutations, it should still pass the current runtime's retained handles to `discoverSprintRuns` (or a new discovery variant) so lease ownership can be displayed accurately. The existing `discoverSprintRuns` already accepts optional retained handles.
- **Existing classification**: Use the same `classifyRun`, `discoverSprintRuns`, and state-reading paths as `list` and `doctor` to avoid code duplication and classification drift.

## Options

### Option A: Extend `/sprint list` with a `--completed` flag

Add `--completed` and `--last <n>` options to the existing `/sprint list` command. When present, filter to completed runs, sort by completion timestamp descending, limit to n, and show richer detail.

**Pros**: Reuses existing command structure; minimal new parsing; `list` already has the discovery pipeline.
**Cons**: Overloads `list` with different output formats for different flags; `--completed` and `--last` don't naturally compose with the current flat listing; adding options to a management verb that currently takes none requires parsing changes.

### Option B: New `history` management action

Add `"history"` to the `ParsedCommand.action` union and the management-verb list in `parseCommand`. Route it in `handleSprint` to a new code path that filters and formats completed runs.

**Pros**: Clean semantic separation; `history` is a distinct user intent; consistent with `doctor`, `list`, `status` being separate actions.
**Cons**: Adds another management verb to the already-growing set; requires `parseCommand` changes and argument-completion updates.

### Option C: New dedicated function, same `list`-style action routing

Parse `history` as a management action alongside `status`, `list`, etc. Use the same `discoverSprintRuns` pipeline but post-filter to completed runs and enrich with manifest-derived summary/timestamp/artifact info per run.

**Pros**: Same as B but simpler since it reuses the existing discovery pipeline and `RunRecordSummary` type.
**Cons**: Same as B for verb proliferation.

### Option D: Add a dedicated `RunHistoryEntry` type and `discoverCompletedRuns` function

Define a new type carrying just the fields needed for history display (`runId`, `kind`, `completedAt`, `directiveSummary`, `artifactCount`). Implement a new discovery function that filters to completed runs, reads manifests and state files as needed, and returns sorted entries.

**Pros**: Clean type separation; doesn't pollute `RunRecordSummary` with history-specific fields; clear contract for what history shows.
**Cons**: More code; potential duplication with existing discovery if not carefully factored.

### Recommended approach: Combine B and D

Add `"history"` as a management action. Create a focused `discoverCompletedRuns` (or extend `discoverSprintRuns` with an optional filter) that returns a narrow `RunHistoryEntry` type. Route it cleanly in `handleSprint` following the same pattern as `list` and `doctor`. The output format should be a compact one-line-per-run layout consistent with existing command output style.

## Trade-offs

| Dimension | Trade-off |
|---|---|
| **Completion detection** | Using manifest presence without `.state.json` as a completion signal is the established pattern (`discoverSprintRuns` already does it), but it can't distinguish "completed and cleaned up" from "manifest written by an earlier incomplete run." In practice, the manifest is only written by `#publishFullSprint` at the very end, so this ambiguity is theoretical for planning runs. Execution records have their own authoritative state. |
| **Timestamp source** | `completedAt` in state/record is authoritative but requires reading the full file. Manifest `mtime` is cheaper but fragile. The history command should prefer `completedAt` and fall back to `mtime` only for cleaned-up planning runs. |
| **Directive truncation** | Truncating to a single line at ~80 chars is user-friendly but loses context for long prompts. An alternative is to show the first sentence/line verbatim and offer `/sprint doctor <runId>` or opening the manifest for full detail. The existing UX convention is dense output with more detail available through other commands. |
| **Execution records in history** | Execution records are semantically different from planning runs — they represent implementation evidence, not planning directives. Including them alongside planning runs in history provides a unified view of "everything that completed," but they have different directive semantics (source plan path vs. user prompt). A flag or separate section could disambiguate. |
| **Sort stability** | When two runs have identical `completedAt` timestamps (theoretically possible with cleaned-up runs using mtime), tie-breaking by runId (which contains a creation timestamp) provides deterministic ordering. |
| **Performance** | Reading manifests for every discovered run could be slow with hundreds of runs. In practice, the `.internal-dev/sprints/` directory is expected to stay small (planning runs are heavyweight AI pipelines). Limiting to the newest 5 avoids reading all manifests. A two-pass approach — discover and filter by markers, then read only the top 5 — is efficient. |
| **Empty state UX** | A message like "No completed sprint runs found" is clear but passive. Adding a call to action ("Start one with /sprint <prompt>") is consistent with the assistant-like tone of existing notifications but could feel pushy. Following the `/sprint list` precedent ("No sprint runs found in .internal-dev/sprints/.") is safer. |

## Open Questions

1. **Should execution records appear in `/sprint history`?** The user directive says "completed sprint runs." Execution records are sprint runs (they live in the same store, are discovered by `discoverSprintRuns`, and have their own completion state). But their "directive" is a source plan path, not a user prompt. Showing them alongside planning runs with different directive semantics could be confusing. A reasonable default: include both but prefix each with `[planning]` or `[execution]` so the kind is clear at a glance.

2. **What exactly counts as an "artifact"?** For planning runs, should the count include only the `planning/` directory outputs (concepts, orchestration, phases) or all checkpointed artifacts (brainstorm findings, cross-reviews, ironout drafts, reviews)? The manifest's `## Artifacts` section lists all artifacts including intermediate ones. For user-facing history, the total artifact count is likely more meaningful than just the final plan files, since it represents the volume of work produced.

3. **Should `history` accept a `--kind planning|execution` filter?** The user directive doesn't mention one, but it would be a natural extension. Without it, the command can show all completed runs with kind labels. Adding a filter later is backward-compatible.

4. **Should the raw directive text be retrievable?** The summary in history output is truncated. Offering `/sprint doctor <runId>` to see the full directive is natural since doctor already exists. Should `history` explicitly mention this, e.g., "Use /sprint doctor <runId> for full details"?

5. **Should paused/interrupted runs that have made significant progress appear in history?** No — the directive is explicit about "completed." Incomplete runs belong to `/sprint list` and `/sprint status`. Mixing incomplete runs into history dilutes its purpose as a record of finished work.

6. **How should the `parseCommand` management-verb list be extended?** Currently it's `["status", "cancel", "pause", "resume", "reset", "list", "doctor"]` with sprint-specific exclusions (no `cancel`, `list` takes no args). Adding `"history"` requires updating the list, the `commandUsage` string, argument completions, and adding a case in `handleSprint`. It should follow the same pattern as `list`: no run-id argument.

## Recommended Next Step

Implement Option B+D: Add `"history"` as a management action in `parseCommand`, create a `discoverCompletedRuns` function (or a filtering mode on `discoverSprintRuns`), and route it in `handleSprint` with a compact one-line-per-run output.

The discovery function should:
1. Call `discoverSprintRuns` to get all runs with classification and lease info
2. Filter to completed runs (state === "completed" for both planning and execution)
3. Sort by completion timestamp descending (preferring `completedAt` from state/record, falling back to manifest mtime)
4. Take the top 5
5. For each, extract directive summary (from manifest `## Directive` or `input.md` first non-blank line) and artifact count (from manifest `## Artifacts` bullet count)
6. Return a lightweight `RunHistoryEntry[]` with `runId`, `kind`, `completedAt`, `directiveSummary`, `artifactCount`

Output format:

```
Completed sprint runs (newest first):
20260720-143052-some-slug  [planning]  2026-07-20 14:31  12 artifacts  Add user authentication with OAuth2 supporting Google and GitHub...
exec-some-name             [execution] 2026-07-20 14:25   5 artifacts  Source plan: .internal-dev/sprints/.../planning
```

Or when empty:

```
No completed sprint runs found in .internal-dev/sprints/.
Start one with /sprint <prompt>.
```
