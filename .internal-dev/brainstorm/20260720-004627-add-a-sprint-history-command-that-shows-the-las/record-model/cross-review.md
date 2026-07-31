## Prompt

Cross-review all four reports produced by the Run Record Architecture Mapper brainstorming: the original Architecture Mapper findings, the history-contract semantics report, the readonly-resilience safety report, and the project-integration wiring report. Compare useful ideas, conflicts, omissions, feasibility, and trade-offs. Preserve the Architecture Mapper's broad lens without merely defending its first answer.

## Source

Four reports, each read in full:

- **Run Record Architecture Mapper** (`Architecture Mapper`) — architectural approaches for building history on the shared discovery/parsing boundary. Five concrete options (A–E) analyzed. Recommended new `history.ts` module (Option C).
- **history-contract/findings.md** (`Contract`) — product and command semantics: completion qualification, ordering, directive summaries, timestamps, artifact counts, UX output format, empty states. Recommended `"history"` management action + `discoverCompletedRuns` function (Option B+D).
- **readonly-resilience/findings.md** (`Resilience`) — read-only safety, path/symlink discipline, malformed-record handling, lease non-interference, deterministic sorting, testability. Recommended `discoverHistory()` exported function (Option A).
- **project-integration/findings.md** (`Integration`) — command-parsing integration points, data-retrieval paths, directive-summary sourcing, test architecture, agent-tool exposure. Recommended hybrid: standalone function + command + optional tool (Option D).

All reports share the same authoritative source codebase at `/home/dhickel/AI/Workspaces/Pi-extensions/sprint-planner/`.

## Findings

### 1. Areas of strong convergence

All four reports independently agree on these foundations, lending them high confidence:

| Decision | All reports |
|---|---|
| Add `"history"` as a management action to `parseCommand` | ✓ |
| Read-only — zero mutations, no lease acquisition or release | ✓ |
| Sort by completion timestamp descending, tiebreak by `runId` | ✓ |
| Include both planning and execution runs with kind labels | ✓ |
| Planning manifests lack a machine-readable `completedAt` — use `manifest.md` mtime as fallback | ✓ |
| Reuse `discoverSprintRuns()` / `classifyRun()` — do not duplicate discovery logic | ✓ |
| Graceful degradation on malformed/missing data — never crash | ✓ |
| Limit output to 5 entries | ✓ |
| Consistent with existing `/sprint list` and `/sprint doctor` UX conventions | ✓ |

This degree of independent convergence across four different analytical lenses (architecture, product semantics, safety/resilience, integration) is a strong signal that the core design is correct. The disagreements are refinements, not fundamental.

### 2. Primary divergence: module organization

This is the only substantive disagreement. Each report proposes a different function location:

| Report | Proposal | Rationale |
|---|---|---|
| Architecture Mapper | New `history.ts` module (Option C) | Keeps `run-records.ts` focused on structure/leases; content parsing is a separate concern |
| Contract | `discoverCompletedRuns()` in `run-records.ts` or filtering mode on `discoverSprintRuns` (Option B+D) | Reuses the discovery pipeline; minimal new surface |
| Resilience | `discoverHistory()` exported from `run-records.ts` (Option A) | Clearest reuse path; single exported function |
| Integration | Standalone `getSprintHistory()` function, consumed by command + optional tool (Option D) | Testable, dual-consumer pattern consistent with existing `core.ts` barrel exports |

**Analysis**: The underlying tension is real but the practical difference is small. All four proposals call `discoverSprintRuns()` or equivalent discovery from `run-records.ts`, add manifest parsing on top, and return a typed array. Whether that function lives in `run-records.ts` or `history.ts` is a ~30-line difference in import structure. The Architecture Mapper's concern about coupling content parsing with structural discovery is valid but may be over-optimizing for a module that already reads manifests in `runDoctor()`. The Integration report's point about testability and the `core.ts` barrel-export pattern is the most pragmatic tiebreaker — the project already exports standalone functions from `core.ts`; a `getSprintHistory` function following the same pattern is consistent.

**Recommended resolution**: Place the core logic in `history.ts` (as Architecture Mapper proposed) but export it through `core.ts` (as Integration proposed for testability). This satisfies all four reports: separate module for the Architecture Mapper, exported function for Resilience and Integration, consumed by the command handler for Contract.

### 3. Directive summary sourcing conflict

The reports disagree on the primary source for planning-run directive summaries:

| Report | Primary source | Rationale |
|---|---|---|
| Architecture Mapper | `manifest.md` `## Directive` | Same source for both plan/exec; the engine stores the raw directive verbatim here |
| Contract | `manifest.md` `## Directive` (primary), `input.md` (fallback) | manifest is more accessible when `.state.json` is cleaned up |
| Resilience | `manifest.md` `## Directive` | Same as Architecture Mapper |
| Integration | `input.md` line 1 | Simpler to extract (first line of a file vs. parsing a Markdown section); `input.md` is always written and persists after cleanup |

**Analysis**: This is a real trade-off with different failure modes. The Integration report's recommendation of `input.md` has a concrete advantage: extracting the first line of a plain file is simpler and less error-prone than parsing a Markdown section from `manifest.md`. However, `input.md` contains the directive formatted as `# Sprint Input\n\n<directive>`, so we'd still need to skip the heading. The Architecture Mapper's `manifest.md` approach has the advantage of working for both planning and execution manifests through the same code path.

Looking at the engine code: `#manifestContent` stores the directive verbatim under `## Directive` with no formatting wrapper. Reading it is straightforward section extraction. But `input.md` is also straightforward — it's `# Sprint Input\n\n<directive>` with the directive on the third line.

**Recommended resolution**: Use `manifest.md` `## Directive` as primary (it's the canonical completion artifact and works for both planning and execution). Fall back to `input.md` if the manifest's `## Directive` section is empty or absent. Truncate the first non-blank meaningful line to ~120 characters. This combines the Architecture Mapper's single-source preference with the Contract's fallback pattern and the Integration report's insight about `input.md` availability.

### 4. Artifact count semantics divergence

| Report | Planning count | Execution count |
|---|---|---|
| Architecture Mapper | Plan file count (concepts + orchestration + phases) | Source artifact count |
| Contract | Manifest `## Artifacts` bullet count | Manifest `## Artifacts` bullet count |
| Resilience | Manifest `## Artifacts` list items | Manifest `## Artifacts` list items |
| Integration | `planning/` directory count | `frozen.phases.length` |

**Analysis**: The Contract and Resilience reports propose counting manifest artifact bullets. But for planning runs, the manifest includes every intermediate artifact — brainstorm findings, cross-reviews, ironout drafts, reviews. This could be 20–30+ entries, which is less meaningful to a user than "how many phases were in the plan." The Architecture Mapper and Integration reports converge on kind-specific semantics: plan size for planning runs, source descriptor size for execution runs.

The practical difference in displayed output: "12 artifacts" (manifest bullet count) vs "5 plan files" (phase count). The kind-labeled approach is more informative because it says what was actually produced, not just how many files the pipeline touched.

**Recommended resolution**: Use kind-specific artifact counts with descriptive labels, as proposed by Architecture Mapper and Integration. For planning runs, count plan files in `planning/` (concepts.md + orchestration.md + phase files) and label "N plan files." For execution runs, count `source.files.length` (source artifacts) and label "N source artifacts." If `planning/` is absent for a planning run, fall back to manifest artifact count.

### 5. Timestamp sourcing: the critical gap

All reports acknowledge the planning-manifest timestamp gap, but they differ subtly on mitigation:

| Report | Strategy |
|---|---|
| Architecture Mapper | Use `manifest.md` mtime universally for planning runs; add `completedAt` to manifest format in a future engine change |
| Contract | Prefer `.state.json` `completedAt` when state file exists; fall back to manifest mtime with `(approx.)` annotation |
| Resilience | Try to parse `## Outcome` for ISO timestamp; fall back to mtime with annotation |
| Integration | Use mtime as primary; optionally parse `## Outcome` for a timestamp string |

**Critical correction**: The Resilience and Integration reports both suggest parsing `## Outcome` for a completion timestamp. But the engine's `#manifestContent()` method (line ~1099 of `engine.ts`) writes the `## Outcome` section as the **static string** `"Planning completed successfully."` — not a timestamp-bearing line. There is no ISO 8601 timestamp anywhere in the planning manifest. The Architecture Mapper and Contract correctly identify this gap.

The `.state.json` `completedAt` field IS authoritative, but the entire `.state.json` is removed by `removeRuntimeFiles()` after successful completion. So for a fully cleaned-up planning run, the only timestamp evidence is the filesystem mtime of `manifest.md`.

**Recommended resolution**: For planning runs, use `manifest.md` mtime as the completion timestamp, labeled `(file timestamp)` to be transparent about its quality. For execution runs, use `record.completedAt` from `record.json` — this is authoritative. Follow the Architecture Mapper's recommendation to add `completedAt` to the planning manifest format as a separate, non-blocking follow-up so future completed runs get authoritative timestamps.

### 6. Should blocked execution records appear in history?

Only the Integration report raises this question explicitly. The other three assume only `state === "completed"`.

**Analysis**: A blocked execution record has reached a terminal state — the validator returned `BLOCKED`, and the record was finished via `finish: blocked`. It's "done" in the sense that no further work is expected. Including it in history with a `[blocked]` label would give users visibility into runs that ended without success. However, the directive explicitly says "completed sprint runs." A blocked execution record is not "completed" in the ordinary sense — it didn't pass validation.

**Recommended resolution**: Exclude blocked execution records from the initial `history` implementation. They are terminal but not successful. The user asked for "completed" — show only genuinely completed runs. If users later want visibility into blocked runs, that's a separate feature request.

### 7. Agent-callable tool exposure

Only the Integration report proposes registering a `sprint_history` tool alongside the slash command. The Architecture Mapper, Contract, and Resilience reports focus exclusively on the slash-command UX.

**Analysis**: The project already has a pattern of dual exposure — `sprint_validate_plan` and `sprint_execution_record` are both tools callable by agents and indirectly accessible through their respective workflows. However, `sprint_brainstorm`, `sprint_ironout`, and `sprint_advanceplan` are the only planning tools. The management commands (`list`, `doctor`, `status`, `pause`, `resume`, `reset`) are slash-command-only. History fits more naturally in the management-command category than the actionable-tool category. It's a read-only inspection, not a workflow step.

**Recommended resolution**: Implement `/sprint history` as a slash command only for the initial release, consistent with `list` and `doctor`. A `sprint_history` tool can be added later if agents need programmatic access to completed-run metadata. This keeps the initial scope tight and avoids premature API surface growth.

### 8. Omissions map

| Concern | Architecture Mapper | Contract | Resilience | Integration |
|---|---|---|---|---|
| `input.md` as directive fallback | ✗ | ✓ | ✗ | ✓ (primary) |
| Malformed/ambiguous record handling | ✗ (brief) | ✗ (brief) | ✓ (detailed matrix) | ✗ |
| Concrete test cases enumerated | ✗ | ✗ | ✓ (detailed) | ✓ (detailed) |
| Exact code integration locations | ✗ | ✗ | ✗ | ✓ (line-level) |
| `completedAtSource` transparency field | ✓ | ✗ | ✗ | ✗ |
| Future engine change for manifest timestamp | ✓ | ✗ | ✗ | ✗ |
| Performance (two-pass vs full scan) | ✗ | ✓ | ✗ | ✗ |
| Lease non-interference proof | ✗ | ✗ | ✓ | ✗ |
| Concurrent deletion tolerance | ✗ | ✗ | ✓ | ✗ |
| Blocked execution records question | ✗ | ✗ | ✗ | ✓ |
| Agent tool exposure | ✗ | ✗ | ✗ | ✓ |

The Resilience report is the most thorough on safety and edge-case handling. The Integration report is the most thorough on concrete implementation coordinates. The Contract report is the most thorough on UX semantics. The Architecture Mapper is strongest on architectural boundary analysis and forward-looking timestamp strategy.

## Options

### Synthesis Option 1 — Conservative merge (all reports, minimal divergence)

Take the common ground all four reports agree on, use the Architecture Mapper's `history.ts` module location, the Integration report's `core.ts` barrel export pattern, the Resilience report's degradation matrix for implementation, and the Contract report's UX format for display. Add `completedAt` to the planning manifest as a deferred follow-up.

**Pros**: Respects every report's strongest contribution. The `history.ts` module keeps `run-records.ts` focused. The barrel export enables testing. The degradation matrix ensures robustness.  
**Cons**: Slightly more files than putting everything in `run-records.ts`. The follow-up engine change is out of scope for the initial implementation.

### Synthesis Option 2 — Maximal integration (single function in `run-records.ts`)

Put `getSprintHistory()` in `run-records.ts` alongside `discoverSprintRuns`, following the Resilience and Contract reports' preference. Use `input.md` for directive as Integration recommends. Use kind-specific artifact counts. The `completedAtSource` field from Architecture Mapper is optional metadata.

**Pros**: Fewest new files. Function is colocated with the discovery it depends on.  
**Cons**: `run-records.ts` grows further beyond its structural focus. Content parsing creeps into what was a structure/lease module. Less clean separation.

### Synthesis Option 3 — Command-handler inlining (shortest path)

Inline all history logic in `handleSprint` following the `list` precedent, as the Contract report's simplest interpretation. Use Integration's `input.md` line extraction, Resilience's error tolerance, and Architecture Mapper's kind-specific artifact counts. No new exported functions. No new modules.

**Pros**: Fastest to implement. Zero API surface growth.  
**Cons**: Not independently testable without command-layer mocking. No reuse. Harder to maintain.

## Trade-offs

### Module separation vs. colocation

The Architecture Mapper's case for `history.ts` is that content parsing (manifest sections, timestamps, directive truncation) is a different concern from structural discovery (directory enumeration, classification, lease inspection). The counterargument from the Contract, Resilience, and Integration reports is that `run-records.ts` already does content reading in `runDoctor()` — so adding manifest parsing there is consistent with existing patterns.

**Finding**: Both are defensible. The deciding factor is future growth. If history grows to include cross-referencing (e.g., linking execution records to their source planning runs), the logic becomes complex enough to warrant its own module. Starting with `history.ts` anticipates this without over-engineering the initial implementation. The barrel export through `core.ts` makes the module boundary invisible to consumers anyway.

### `input.md` vs `manifest.md` for directive extraction

`input.md` is simpler to parse (third line of a file) and always available for planning runs. `manifest.md` `## Directive` is the canonical completion artifact and works uniformly for both planning and execution manifests. 

**Recommendation**: Use `manifest.md` as the primary source with `input.md` as a planning-only fallback. This gives the best of both: uniform code path for most runs, and a reliable fallback when the manifest section is problematic. The Integration report's advocacy for `input.md` as primary is reasonable but loses the single-code-path advantage.

### Truncation length for directive summaries

The Architecture Mapper proposed ~120 characters; the Integration report proposed 80 characters with ellipsis. Shorter is safer for terminal-width displays. 80 characters is aggressive but keeps the one-line-per-run format scannable. The full directive is always available via `/sprint doctor <runId>`.

**Recommendation**: 100 characters with `…` ellipsis as a middle ground. Wide enough to convey meaningful context, narrow enough for consistent formatting.

### Performance: scan-all vs scan-until-found

The Contract report raises the performance concern: if `.internal-dev/sprints/` has hundreds of runs, reading all manifests to find 5 completed ones is wasteful. A two-pass approach — enumerate directory names (which embed creation timestamps), stat the newest N, read only those — is efficient. 

**Recommendation**: Since run IDs embed ISO timestamps (`timeId()` format: `YYYYMMDD-HHMMSS-slug`), sort candidate directory names reverse-lexicographically (newest first), then stat and classify each in order until 5 completed runs are found (with a reasonable upper bound, say 30 candidates checked). This avoids reading every manifest in a large store.

## Open Questions

1. **What if a planning run's `planning/` directory is absent?** The run could have a manifest (from `#publishFullSprint`) but a partially failed or cleaned-up `planning/`. For artifact count, fall back to `manifest.md` `## Artifacts` list-item count, or show `0` with a note. This is a resilience concern the Resilience report would flag.

2. **Should the history output be paginated if there are exactly 5 runs?** No — 5 entries fit comfortably in a single notification. Pagination only becomes relevant with `--all` or higher limits in a future release.

3. **How to handle runs where completion time is uncertain (mtime only)?** The Architecture Mapper's `completedAtSource` field (`"manifest-mtime"` vs `"execution-record"`) can annotate the output. For the initial release, a simple `(approx.)` suffix on mtime-derived timestamps is sufficient. The field itself is useful for tests and future consumers but doesn't need to be user-visible yet.

4. **Should the `manifest.md` mtime be read with `birthtime` (creation time) instead?** `birthtime` is not available on all filesystems (Linux ext4 doesn't support it reliably before kernel 4.11). `mtime` is universally available. Since the manifest is written once and never updated, `mtime` === `birthtime` in practice.

5. **Does the command need its own `--kind` filter now?** No — the directive doesn't mention one, and all four reports treat kind labeling (not filtering) as sufficient. Adding a filter later is backward-compatible.

6. **Should history show the planning run that an execution record originated from?** The Integration report raises cross-referencing via `sourcePlanningRunId`. The Architecture Mapper mentions it as an Open Question. For the initial release, showing the execution record's own metadata with a `[execution]` label is sufficient. Cross-referencing adds a dependency chain (source planning run could be reset/deleted) and should be deferred.

## Recommended Next Step

Adopt a synthesis that selects the strongest element from each report:

1. **Module**: Create `sprint-planner/history.ts` with an exported `getSprintHistory(sprintsRoot, limit = 5)` function (Architecture Mapper). Export it through `core.ts` (Integration).

2. **Discovery**: Call `discoverSprintRuns()` for enumeration and classification. Two-pass: sort candidate directory names reverse-lexicographically, stat-and-classify in order until `limit` completed runs found, capped at 30 candidates (Contract performance insight).

3. **Completion filtering**: Planning runs need `manifest.md` present + `.state.json` absent (or `.state.json` with `status === "completed"`). Execution runs need `record.state === "completed"` in `record.json`. Exclude blocked, interrupted, failed, cancelled, paused, active, malformed, ambiguous, and unknown runs (all reports).

4. **Directive summary**: Parse `manifest.md` `## Directive` section — take the first non-blank, non-heading line, strip Markdown formatting, truncate to 100 characters with `…`. Fall back to `input.md` line 3 for planning runs if the manifest section is absent (Contract + Integration synthesis).

5. **Completion timestamp**: Execution records → `record.completedAt` (authoritative). Planning runs → `manifest.md` stat `mtime` formatted as ISO 8601. Annotate planning timestamps with `(file timestamp)` in the output (Architecture Mapper + Resilience).

6. **Artifact count**: Planning → count of files in `planning/` directory matching `phase-NN-*.md` plus `concepts.md` and `orchestration.md`; label `"N plan files"`. Execution → `source.files.length`; label `"N source artifacts"`. Fall back to manifest `## Artifacts` bullet count if the primary source is unavailable (Architecture Mapper + Integration, with Resilience fallback).

7. **Output format**: One line per run: `runId  [kind]  completedAt  artifactCount  directiveSummary`. Empty state: `"No completed sprint runs found in .internal-dev/sprints/."` (Contract UX).

8. **Error tolerance**: Catch and skip on `ENOENT`, `EACCES`, `EPERM`, malformed JSON, missing manifest headings. Never throw from the enumeration loop. Log degraded entries with `(incomplete)` annotation in the output (Resilience degradation matrix).

9. **Command integration**: Add `"history"` to `ParsedCommand.action`, management keywords in `parseCommand`, `commandUsage`, and `getArgumentCompletions`. Add a `parsed.action === "history"` branch in `handleSprint` following the `list` pattern (Integration code locations).

10. **Read-only proof**: The implementation must import only `lstat`, `readFile`, `readdir`, and pure functions from the existing codebase. No `writeFile`, `mkdir`, `unlink`, `acquireLease`, `releaseLease`, or any mutation-bearing import (Resilience).

11. **Deferred follow-up** (out of scope for initial implementation): Add `Completed at <ISO timestamp>` to the planning manifest's `## Outcome` section in `#manifestContent()`. The history function will parse it when present and prefer it over mtime. This is a one-line engine change tracked as a separate task (Architecture Mapper).

12. **Tests**: Write unit tests for `getSprintHistory` covering: empty store, 0–7 completed runs of mixed kinds, mtime-only planning runs, authoritative execution timestamps, malformed manifests, missing `planning/` directories, concurrent deletion tolerance, and deterministic tie-breaking. Add a read-only proof test: snapshot `.internal-dev/sprints/` entry paths, inodes, mtimes, and sizes before and after — assert zero differences (Resilience + Integration test patterns).
