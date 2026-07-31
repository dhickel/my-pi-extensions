## Prompt

Add a `/sprint history` command that shows the last 5 completed sprint runs with their directive summary, completion timestamp, and artifact count. Read-only, no mutations.

## Source

Authoritative input: `<directive>` block from the project instructions, plus the entire sprint-planner extension codebase at `/home/dhickel/AI/Workspaces/Pi-extensions/sprint-planner/`.

Key files inspected:

- **`commands.ts`** — `parseCommand` returns `ParsedCommand` with `action: "start" | "status" | "cancel" | "pause" | "resume" | "reset" | "list" | "doctor"`. Management keywords like `status`, `pause`, `resume`, `reset`, `list`, `doctor` are recognized as the first non-whitespace token; remaining input is ignored or validated as an optional run-id. Adding `"history"` requires extending the `ParsedCommand.action` union, the management keyword list, and the `commandUsage` output.
- **`index.ts`** — The sprint command is registered with `pi.registerCommand("sprint", { ..., getArgumentCompletions: ... })` at line ~850. The completions list (`["status", "pause", "resume", "reset", "list", "doctor"]`) must include `"history"`. The `handleSprint` function dispatches on `parsed.action`; a new `if (parsed.action === "history")` branch is needed.
- **`run-records.ts`** — `discoverSprintRuns(sprintsRoot, retainedHandle)` returns `RunRecordSummary[]` with `runId`, `kind` (`"planning" | "execution-only" | "ambiguous" | "malformed"`), `state` (string summary), `leaseOwnership`, and `markers` (`{ state, manifest, execution }`). This is the primary discovery mechanism. `classifyRun` uses marker-file presence only; `runDoctor` reads `manifest.md` and `.state.json` for richer diagnosis. The `resolveRunDirectory` and `assertValidRunDirectory` helpers enforce direct-child constraints.
- **`execution-records.ts`** — `loadExecutionRecord(runDirectory, runId)` parses `execution/record.json` and returns `ExecutionRecord` with `completedAt`, `completion.report`, `state`, `source`, and `frozen.phases`. The `parseExecutionRecord` function performs strict structural validation.
- **`types.ts`** — Core types: `RunRecordSummary`, `RunRecordKind`, `ExecutionRecord`, `ExecutionRecordState`, `DoctorReport`, `DoctorFinding`, `WorkflowName`. The `RunRecordSummary.markers` is a three-boolean bag (`state`, `manifest`, `execution`) used for classification.
- **`artifacts.ts`** — `assertSafeRelativePath`, `atomicWriteFile` (only for writes), `sha256`, `RunArtifactStore`, `SprintStateStore`. The `SprintStateStore.load()` reads and validates `.state.json`.
- **`test/core.test.ts`** — 4,243 lines of Node built-in `node:test` + `node:assert/strict`. Tests use temporary `mkdtemp` project directories, `FakeRunner` / `DelayedRunner` / `CrossReviewFailureRunner` mocks, and validate command parsing boundaries, state transitions, file-system artifacts, read-only contracts, and lease agreements. No existing test for `list` or `doctor` commands via the command-layer path (only their underlying functions).
- **`README.md`** — Documents the extension's command surface and tool surface. A `/sprint history` entry would belong in the "Extension commands" section alongside `status`, `pause`, `resume`, `reset`, `list`, and `doctor`.

## Findings

### 1. Command Parsing Fit

The `parseCommand` function already handles a fixed set of management actions. Adding `"history"` is a one-line addition to the management keywords array and the `ParsedCommand.action` type. No option flags (`--name`, `--agents`) apply to `history`, and it takes no run-id argument (mirroring `list` which also rejects arguments):

```ts
// Existing guard pattern for list (commands.ts ~line 118):
if (workflow === "sprint" && action === "list" && run) throw new Error("/sprint list does not accept arguments.");
```

The same guard applies to `history`. The `commandUsage` function would show: `/sprint [status|pause|resume|reset|list|doctor|history] [run-id]`.

### 2. Data Retrieval Paths

There are two candidate approaches for gathering the last 5 completed runs:

**Path A — `discoverSprintRuns` + targeted reads:**
- Call `discoverSprintRuns` to enumerate all runs with classification.
- Filter to runs where `kind === "planning" || kind === "execution-only"` and state indicates completion.
- For planning runs: read `manifest.md` to extract directive and completion evidence; count files in `planning/` directory for artifact count.
- For execution runs: call `loadExecutionRecord` to get `completedAt`, `completion.report`, and `frozen.phases.length` for artifact count.
- Sort by completion timestamp descending, take top 5.

**Path B — Direct directory scan with `runDoctor`:**
- Enumerate `.internal-dev/sprints/` directly, call `runDoctor` per run, parse the doctor findings for completion status.
- Heavier-weight but reuses the existing comprehensive diagnosis.

**Recommendation:** Path A is lighter and more targeted. `discoverSprintRuns` already classifies runs and reads leases without touching `.state.json` or `record.json` content. We only deep-read the 5 (or fewer) completed runs.

### 3. Completion Timestamp Sources

Planning runs store completion evidence differently from execution runs:

- **Planning runs:** When a planning run completes, `manifest.md` is written with a `## Outcome` section. The timestamp appears in prose (e.g., `Planning completed at 2025-07-18T...`). The `.state.json` is removed on completion. The manifest's `mtime` is a reliable fallback.
- **Execution-only runs:** `ExecutionRecord.completedAt` is an ISO-8601 string in `execution/record.json`. This is the authoritative source.

For planning runs without a parseable timestamp in the manifest, we can fall back to the `manifest.md` file's `mtime` via `lstat`.

### 4. Directive Summary Sources

- **Planning runs:** `input.md` in the run directory contains the raw directive. The first line or a truncated prefix (e.g., first 80 characters) serves as the summary. The `manifest.md` `## Directive` section may contain a paraphrase.
- **Execution-only runs:** The `SourceDescriptor.sourcePlanPath` points to the plan, not a directive. If `sourcePlanningRunId` is present, we can look up that planning run's `input.md`. Otherwise the execution record's `completion.report` provides a summary.

### 5. Artifact Count Semantics

- **Planning runs:** Count of phase files in `planning/` (i.e., `phase-NN-*.md` files), plus `concepts.md` and `orchestration.md` if present. This represents the planning output size.
- **Execution-only runs:** `frozen.phases.length` gives the phase count. The execution directory itself contains `execution/record.json` and `manifest.md`.

### 6. Read-Only Contract Enforcement

The existing codebase is rigorous about read-only operations:
- `runDoctor` is explicitly read-only ("Never writes, acquires, releases, or mutates").
- `inspectLease` is read-only.
- `discoverSprintRuns` is read-only.
- `loadExecutionRecord` / `doctorExecutionRecord` are read-only.

A `/sprint history` command should:
- Never call `acquireLease`, `releaseLease`, `atomicWriteFile`, `reserveSprintRun`, or any mutation primitive.
- Use only `lstat`, `readFile`, `readdir`, `open(O_RDONLY)` paths.
- Not alter any `.state.json`, `.lease.json`, `manifest.md`, or `record.json`.
- Be provably read-only via a before/after directory snapshot test.

### 7. Existing Test Architecture

Tests use `node:test` + `assert/strict` with:
- Temporary directories via `mkdtemp(path.join(os.tmpdir(), "pi-sprint-planner-"))`
- `project()` helper that creates `.internal-dev/{sprints,brainstorm,handoffs,plans,reviews}`
- Fake runners (`FakeRunner`, `DelayedRunner`, `CrossReviewFailureRunner`)
- Filesystem assertions (`entryExists`, `readFile`, `readdir`, `stat`)
- Snapshot-style validation (before/after directory state)

Tests for `list` and `doctor` subcommands don't exercise them via the command-layer `handleSprint`; they test the underlying `discoverSprintRuns` and `runDoctor` functions directly. A `history` test could follow the same pattern with both unit-level (`gatherHistory`) and integration-level (command dispatch) coverage.

## Options

### Option A — Minimal: Filtered `list` Reuse

Add `"history"` to the command parser, then in `handleSprint` reuse `discoverSprintRuns` but narrow the output to the last 5 completed runs with directive summaries.

**Shape:**
1. Add `"history"` to `ParsedCommand.action` and management keywords.
2. Add `"history"` to `commandUsage` and `getArgumentCompletions`.
3. In `handleSprint`, add a branch after the `list` handler:
   - Call `discoverSprintRuns` → filter to completed → sort by timestamp → take 5.
   - For each run, deep-read manifest/record to extract directive, timestamp, artifact count.
   - Format as a notification line per run.

**Pros:** Reuses existing discovery; minimal new surface area; consistent with `list` UX.  
**Cons:** `discoverSprintRuns` loads all runs including lease inspection; slightly heavier than necessary. Each of the 5 runs requires a separate file read. Still well within performance bounds for a human-facing command.

### Option B — Dedicated Lightweight Scraper

Implement a standalone `gatherHistory` function in a new or existing module (e.g., `history.ts` or added to `run-records.ts`) that:
1. Reads `.internal-dev/sprints/` directory entries.
2. For each entry, checks for a `manifest.md` marker (indicating a completed planning run) or `execution/record.json` (indicating an execution run).
3. Reads only the minimal data needed: directive from `input.md`, timestamp from manifest mtime or `record.json`, artifact count from directory listing.
4. Sorts by timestamp, takes top 5.

**Pros:** Lighter touch; doesn't run lease inspection; explicit single-purpose function.  
**Cons:** New module or function to maintain; duplicates some classification logic from `classifyRun`; risk of drift from `discoverSprintRuns` semantics.

### Option C — Agent-Callable Tool Instead of Slash Command

Register `sprint_history` as a `pi.registerTool` rather than a command sub-action. This would make it available to agents as well as users.

**Pros:** Dual-consumer (user + agent); follows `sprint_validate_plan` and `sprint_execution_record` pattern.  
**Cons:** The directive says `/sprint history` (slash command); a tool-only approach wouldn't provide the `/sprint history` UX. Could do both — register a tool and wire it to the command handler.

### Option D — Hybrid: Command + Reusable Function

Add a pure `getSprintHistory(sprintsRoot, limit = 5)` function in `run-records.ts` (or a new `history.ts`) that gathers completed-run summaries. Wire it to:
1. A `/sprint history` command branch in `handleSprint`.
2. An optional `sprint_history` tool for agent consumption.
3. Future programmatic consumers (e.g., orchestrate skill reporting).

**Pros:** Clean separation; the function is independently testable; dual exposure.  
**Cons:** Slightly more code than Option A; requires deciding on the return type contract.

### Recommendation: Option D (Hybrid)

The project already follows this pattern — underlying functions are exported from `core.ts` and consumed by both command handlers and tools. A `getSprintHistory` function returns a typed array; the command handler formats it for display; a tool can expose it for agents. This respects the existing architecture.

## Trade-offs

| Dimension | Option A (list reuse) | Option B (lightweight scraper) | Option C (tool only) | Option D (hybrid) |
|---|---|---|---|---|
| **Code reuse** | High — reuses `discoverSprintRuns` | Low — duplicates classification logic | Medium — new tool, no command | High — new function, consumed by both |
| **Performance** | Reads leases for all runs | Only reads target 5 | Same as underlying impl | Same as underlying impl |
| **Maintainability** | Adds to existing handler, low risk | New module, risk of drift | Misses `/sprint history` UX | Single-source function, testable |
| **Testability** | Indirect (must test via `handleSprint`) | Direct function test | Direct tool test | Direct function + integration test |
| **Agent exposure** | None | None | Yes | Yes (if tool is also registered) |
| **Alignment w/ directive** | `/sprint history` ✓ | `/sprint history` ✓ | No `/sprint history` | `/sprint history` ✓ |

The key tension is between Option A (simplest, follows `list` precedent) and Option D (cleaner architecture, testable). For a small feature like this, Option A is defensible. However, the project's `core.ts` barrel export pattern and the existing precedent of `discoverSprintRuns` as a standalone function suggest Option D is the natural fit.

### Specific design choice: What to display for directive summary

For planning runs, `input.md` line 1 (truncated to 80 chars) is simplest and most informative. For execution-only runs without a `sourcePlanningRunId`, fall back to `completion.report`'s first line. If neither is available, show `"(no directive recorded)"`.

### Specific design choice: Completion timestamp for planning runs

Planning runs remove `.state.json` on completion; the `manifest.md` mtime is the most reliable proxy for completion time. Alternatively, parse the `## Outcome` section for a timestamp string. The manifest's `birthtime`/`mtime` via `lstat` is always available and doesn't require parsing Markdown prose.

### Specific design choice: Artifact count

For planning runs: count of `phase-NN-*.md` files in `planning/` directory. For execution runs: `frozen.phases.length`. Display format: `"3 phases"` or `"5 artifacts"`.

## Open Questions

1. **Should `history` accept a `--count N` option?** The directive says "last 5", but the `list` command takes no options. Consistency favors no options initially; a CLI flag can be added later.

2. **Should in-progress runs appear in history?** The directive says "completed sprint runs". In-progress, paused, interrupted, failed, and cancelled runs are excluded. What about blocked execution records? Blocked is a terminal state — arguably "completed" in the sense of "finished." I'd recommend including `completed` and `blocked` but excluding `active`, `interrupted`, `paused`, `failed`, and `cancelled`.

3. **How to handle runs with ambiguous completion evidence?** A planning run with a `manifest.md` but no `.state.json` is classified as `"planning"` with state `"completed"` by `classifyRun`. But if the manifest is corrupt or missing the `## Outcome` section, we can't confirm completion. Include with a `(evidence uncertain)` annotation? Or skip? I'd recommend skipping — only show runs where we can confidently determine completion.

4. **Does `history` need its own doctor-level validation?** No — it's a lightweight listing command. Malformed runs are silently skipped. If the user wants diagnosis, they use `/sprint doctor`.

5. **Should execution runs that reference a planning run show the planning run's directive?** Cross-referencing via `sourcePlanningRunId` adds value but also complexity. For a v1, show the execution record's own `completion.report` or the `frozen` phase summary as the "directive" for execution-only runs.

6. **Output format — notification vs. editor?** `list` uses `ctx.ui.notify`. `history` should follow the same pattern. The output should be scannable: one line per run with runId, kind icon, directive summary, timestamp, artifact count.

7. **Timezone/normalization of timestamps?** `ExecutionRecord.completedAt` is ISO-8601 UTC. Manifest mtimes are Unix epochs. Display both as local time for human readability.

## Recommended Next Step

1. **Define the return type contract** in `types.ts`: a `HistoryEntry` interface with `runId`, `kind`, `directiveSummary`, `completedAt` (ISO-8601), `artifactCount`, and `artifactLabel`.

2. **Implement `getSprintHistory`** as a pure, exported function (in `run-records.ts` or a new `history.ts`):
   - Accept `sprintsRoot: string`, `limit: number = 5`.
   - Enumerate directories, classify with `classifyRun`, deep-read only the top N after sorting.
   - Return `HistoryEntry[]`. Never write, lease, or mutate.

3. **Wire the `/sprint history` command** in `index.ts`:
   - Add `"history"` to `parseCommand` action union, management keywords, `commandUsage`, and `getArgumentCompletions`.
   - Add a `parsed.action === "history"` branch following the `list` pattern (trust check → locate store → call function → format → notify).

4. **Optionally register `sprint_history` tool** for agent consumption with `executionMode: "sequential"`.

5. **Write comprehensive tests** covering:
   - **Zero completions:** Empty sprints directory → "No completed sprint runs found."
   - **Fewer than 5:** 2 completed, 1 active → shows exactly 2, skips active.
   - **More than 5:** 7 completed → shows exactly 5, most recent first.
   - **Mixed run kinds:** Planning completions interleaved with execution-only completions → all displayed with kind labels.
   - **Tie-breaking:** Two runs with identical mtimes → secondary sort by runId descending.
   - **Corruption resilience:** Malformed manifest in completed-looking run → skip with no crash.
   - **Read-only proof:** Before/after snapshot of `.internal-dev/sprints/` (all entry paths, inodes, mtimes, sizes) — assert zero differences.
   - **Exact field validation:** Assert each history line contains runId, kind marker, directive summary (truncated at 80 chars with `…`), completion timestamp, and artifact count label.
   - **Lease non-interference:** Runs with active leases held by other PIDs → history still reads them (no lease interaction).
   - **Planning run directive extraction:** Verify `input.md` first-line extraction.
   - **Execution-only run directive fallback:** Verify `completion.report` fallback.
   - **Edge case: run with manifest but no planning/ subdirectory** → artifact count 0.
   - **Integration test** exercising `parseCommand("sprint", "history")` → `action === "history"`.
