## Context

The orchestrate skill currently retains outcomes only in root memory. This phase adds a distinct execution-only sprint record containing immutable source identity, revisioned phase and integration evidence, observed changed-file state, a canonical manifest, and terminal outcome without modifying the source plan or moving worker coordination into sprint-planner.

## Goal

Persist versioned execution-only orchestration evidence behind one narrow tool while preserving sprint-planner as a deterministic record package rather than an implementation runner.

## In Scope

**Write Targets**: `sprint-planner/execution-records.ts`, `sprint-planner/artifacts.ts`, `sprint-planner/index.ts`, `sprint-planner/core.ts`, `sprint-planner/types.ts`, `sprint-planner/test/core.test.ts`

- Versioned execution-record parsing and state transitions.
- Strict `sprint_execution_record` actions: `start`, `checkpoint`, and `finish`.
- Immutable source plan identity, entry set, hashes, and validated orchestration snapshot.
- Revisioned implementation, phase-validator, changed-file, integration-validator, blocker, interruption, and terminal evidence.
- Canonical execution-only manifest, phase-03 lease use, reload inspection, and clean-shutdown interruption.

## Out of Scope

- Spawning, polling, validating, cancelling, or selecting implementation workers.
- Automatic continuation, orchestration recovery, or provider work on load.
- Runtime files in, reuse of, or mutation of the source plan or source planning-run directory.
- Durable storage of complete subagent response snapshots beyond the bounded reports submitted as execution evidence.
- New discovery, path, ownership, or lease variants that duplicate phase 03.

## Dependencies

`phase-03-run-leases-list-and-doctor.md`

Consume its canonical sprint root lookup, safe direct-child discovery, path and ownership checks, schema findings, and exclusive versioned lease lifecycle. The dependency must expose a composition point for execution-record parsing in list/doctor; if it does not, report a dependency defect rather than editing phase-03-owned targets or implementing a second discovery path.

## Constraints

- Allocate or exclusively reserve one safe `exec-...` direct-child id. Reject an explicit existing id, any source direct-child id, and any source/execution path alias or ancestor relationship.
- Validate the source with the structured read-only plan inspector before creation. Store exactly the accepted flat plan files, their relative paths, SHA-256 digests, and byte counts; never rewrite this descriptor.
- Keep all execution material under `.internal-dev/sprints/<execution-run-id>/`. Never write in the source plan or source planning-run directory.
- Freeze the validated phase ledger, dependencies, waves, goals, write targets, and exact model contract at start. Implementation evidence must use `deepseek/deepseek-v4-pro:max`; phase and integration validation evidence must use `openai-codex/gpt-5.6-sol:medium`.
- Require the caller's `expectedRevision` to equal the parsed current revision for every checkpoint and finish. Increment once for each accepted record transition; stale or rejected calls do not alter record state.
- Serialize operations per owned execution record and require its live `runKind: execution` lease. Never steal or infer ownership from process presence alone.
- Persist accepted evidence before returning success. The parsed JSON record is machine authority; the manifest is derived evidence and may never independently authorize a transition.
- Keep every report and reason non-empty and within explicit tool-schema bounds. Timestamps and observed file metadata are persistence-owned, not caller-authored.

## State Invariants

- Record version is `1`; unknown versions and impossible combinations produce explicit unsupported-schema or malformed-record findings.
- Initial state is `active` at revision `0`. Terminal state is exactly `completed`, `blocked`, or `interrupted`, and terminal records reject further mutation.
- Each phase accepts at most one implementation checkpoint followed by at most one validator checkpoint. Duplicate or out-of-order evidence is rejected.
- A phase implementation checkpoint requires every declared dependency to have validator `PASS`. A phase validator checkpoint requires that phase's implementation evidence.
- Validator `PASS` marks the phase passed. Validator `BLOCKED` records the blocking evidence and permits no further phase or integration checkpoint; only `finish: blocked` may follow.
- Integration validation is accepted once, only after every phase has validator `PASS`. Integration `BLOCKED` permits only `finish: blocked`; integration `PASS` permits `finish: completed`.
- `finish: completed` requires every phase PASS, integration PASS, and an unchanged source snapshot. `finish: blocked` requires prior validator BLOCKED evidence or a concrete external blocker outside validator edit authority. `finish: interrupted` requires a concrete interruption reason and remains valid during clean shutdown.
- Terminal state, terminal evidence, and terminal timestamp are written in the same record revision. Lease release occurs only after record/manifest agreement for that terminal revision.

## Edge Cases

- Source files changing, disappearing, appearing, becoming symbolic links, or changing type after start never update the immutable descriptor. Checkpoints reject drift; completed finish rejects it; blocked/interrupted finish records the observed drift and leaves the source untouched.
- Changed paths are canonical project-relative paths. Reject absolute paths, traversal, symbolic-link traversal, directories, special files, foreign paths, source-plan paths, and the execution record's own directory. A missing final component is recorded as deleted only when all existing ancestors are safe.
- For a present changed file, verify a stable regular-file identity across read and post-read stat, then store canonical path, `present`, digest, and byte count. Retry an unstable observation or reject it; never trust caller-supplied hashes.
- A manifest mismatch found by a mutating action is repaired from the parsed authoritative record under the owned lease without changing revision. List and doctor remain read-only and report the mismatch instead.
- If manifest replacement succeeds but record replacement fails, return failure and retain the lease; the next owned mutation first restores the manifest from the authoritative record. Never return success until record and manifest parse to the same revision and state.
- Failed start cleanup removes only files and directories whose recorded identity still proves ownership. Foreign or uncertain entries remain and are reported.
- Reload and process start parse or diagnose records only. They never acquire an execution lease, launch provider work, or continue orchestration.

## Implementation Steps

1. Create `sprint-planner/execution-records.ts` with `EXECUTION_RECORD_VERSION = 1`. Define and parse the immutable source descriptor, frozen orchestration snapshot, exact model contract, phase ledger, changed-file observations, integration evidence, optimistic revision, timestamps, and `active | completed | blocked | interrupted` state. Validate every read and reject unknown versions, duplicate evidence, mutable source fields, and impossible state combinations.
2. Define the layout as `execution/record.json` and root `manifest.md`. The record stores the canonical project root and source path, optional source planning-run id, aggregate source digest, every source file's relative path/digest/bytes, validated ledger and waves, exact tuples, phase evidence, integration evidence, source-drift evidence, revision, and terminal outcome. Render the manifest with canonical `Directive`, `Stages`, `Artifacts`, `Implementation Evidence`, `Final Validation`, and `Outcome` headings; identify the source as authoritative and mark planning external/not performed in this execution record.
3. Implement start with phase-03 primitives. Canonicalize the project, sprint root, and source; reject traversal, links, foreign ownership, execution sources, and aliases. Run structured plan inspection, snapshot the accepted bytes, derive the aggregate digest, and verify the same file set and bytes again. Allocate or validate an `exec-...` id, reserve its direct-child directory without replacement, acquire an execution lease, write the initial manifest and authoritative record, verify their agreement, and return id plus revision. On failure, release and roll back only identity-proven owned entries.
4. Implement typed checkpoint and finish transitions with optimistic `expectedRevision`. Checkpoint variants are `implementation`, `phase_validation`, and `integration_validation`; finish variants are `completed`, `blocked`, and `interrupted`. Validate phase identity, evidence ordering, exact agent tuple, bounded report, verdict vocabulary, dependency PASS barriers, integration gating, and terminal preconditions. Persistence records evidence only and never schedules or coordinates workers.
5. For each checkpoint and finish carrying changed paths, accept only the declared path set and observe repository state in code. Resolve paths from the frozen canonical project root, apply phase-03 path and no-symlink checks, exclude source and execution-record trees, and store stable `present` or `deleted` observations. Present regular files receive code-computed SHA-256 and byte count; reject directories, special files, unstable reads, and supplied digest authority.
6. Render `manifest.md` only from a successfully parsed record. Under the per-record mutation lock and live lease, reconcile any old mismatch from current record state, derive the next record and manifest, atomically replace the manifest and then the authoritative record, parse both, and return success only when revision and state agree. A partial failure retains the lease and is recoverable by the next explicit owned action; list and doctor never repair it.
7. Register `sprint_execution_record` in `sprint-planner/index.ts` using strict, discriminated TypeBox schemas for `start`, `checkpoint`, and `finish`, including bounded strings and arrays. Keep calls sequential per record and retain exactly one lease handle per execution record in extension runtime state. On `session_shutdown`, apply the same serialized transition path to mark each owned unfinished record interrupted, bring its manifest into agreement, then release; terminal `finish` releases only after a valid terminal write and agreement check.
8. Export the execution parser, finding conversion, and manifest consistency check for the phase-03 list/doctor composition point, wiring it only through declared phase-04 targets. Doctor must inspect valid, malformed, unsupported, active, blocked, interrupted, completed, leased, uncertain, and record/manifest-mismatch states without writing, acquiring, releasing, or stealing a lease. Reloaded completed evidence remains inspectable and no lifecycle hook starts provider work.
9. Extend `sprint-planner/test/core.test.ts` with temporary stores and injected filesystem failures. Cover external and planning-run sources, generated and explicit id collisions, source/execution aliasing, unknown versions, immutable source descriptors, source drift and unchanged source bytes, stale revisions, duplicate and out-of-order checkpoints, dependency barriers, tuple drift, phase and integration PASS/BLOCKED paths, external blockers, changed/deleted/unstable files, traversal and symlink attacks, partial manifest/record writes, reload inspection, clean interruption, lease retention/release, doctor findings, and absence of automatic work.

## Required Guides

- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- Pi `docs/extensions.md`

## Technical Guidance

Use revision-checked whole-record atomic replacement rather than an append framework. Keep the transition flow direct: dependency PASS → implementation evidence → validator PASS/BLOCKED; all phase PASS → integration PASS/BLOCKED; then finish. Recompute the exact source entry set and hashes before accepted checkpoints and finish, preserve the original descriptor on drift, and never infer orchestration intent from report prose. Reuse phase-03 canonicalization, ownership, discovery, and lease functions instead of wrapping them in execution-specific equivalents.

## Validation

- Run `npm --prefix sprint-planner test`.
- Start records from a valid external plan and a planning run's canonical `planning/` directory; verify frozen ledger, waves, tuples, source id, entry hashes, aggregate digest, and revision `0`.
- Snapshot source names, regular-file types, bytes, digests, and non-content identity metadata before tool actions; confirm the persistence code never writes there. Mutate a source externally and verify checkpoint/completion rejection without descriptor rewriting.
- Exercise every legal transition and reject stale revisions, unknown phases, duplicate evidence, premature dependents, premature integration, tuple drift, invalid verdicts, source/execution aliasing, traversal, links, and unsafe changed paths.
- Inject failure before each manifest and record replacement and before lease release; verify no false success, deterministic reconciliation, retained authority, and eventual valid terminal release.
- Reload the extension and inspect active and completed evidence without provider or child work. Confirm clean shutdown writes interrupted evidence before releasing its owned lease.
- Confirm doctor is byte-for-byte read-only and reports valid active, blocked, interrupted, completed, malformed, unsupported, leased, uncertain, and manifest-mismatch execution records.

## Exit Criteria

- `sprint_execution_record` exposes only strict `start`, `checkpoint`, and `finish` persistence actions and never coordinates workers.
- Every record has a supported version, immutable source and orchestration identity, exact model tuples, deterministic revision, and parse-valid state.
- Dependency, phase-validator, integration, and terminal barriers are enforced in code; stale or invalid transitions cannot overwrite evidence.
- Changed-file evidence is derived from safe observed repository state, and source plan bytes are never changed by execution persistence.
- Record and canonical manifest agree before success, survive reload, and remain inspectable through read-only list/doctor behavior.
- Clean shutdown terminalizes and releases only execution records owned by the current runtime; uncertain ownership remains conservative.
- Sprint-planner still launches no implementation workers, and reload or process start performs no automatic orchestration continuation.
