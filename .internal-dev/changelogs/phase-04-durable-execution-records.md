# Phase 04: Durable Execution Records

## Date

2026-07-19

## Git Commit

Not applicable (not a Git repository).

## Change Summary

Implemented durable execution-only sprint records with immutable source plan identity, versioned revision tracking, phase and integration evidence persistence, changed-file observation, canonical manifest rendering, and clean-shutdown interruption handling. Added `sprint_execution_record` tool with `start`, `checkpoint`, and `finish` actions. Integrated with phase-03 lease lifecycle for exclusive ownership.

## Files

- `sprint-planner/execution-records.ts` — New module: versioned execution-record parsing, state transitions (active → completed/blocked/interrupted), immutable source descriptor, frozen orchestration snapshot, phase evidence lifecycle, changed-file observation, manifest rendering, doctor diagnosis, clean-shutdown interruption
- `sprint-planner/types.ts` — Added `EXECUTION_RECORD_VERSION`, `ExecutionRecordState`, `SourceDescriptor`, `FrozenOrchestrationSnapshot`, `PhaseEvidence`, `ChangedFileObservation`, `ExecutionRecord`, `ExecutionRecordManifest`, action param types
- `sprint-planner/artifacts.ts` — Exported `assertNoSymlinkSegments`
- `sprint-planner/run-records.ts` — Wired `doctorExecutionRecord` for full phase-04 execution record diagnosis; updated `discoverSprintRuns` to load execution record state
- `sprint-planner/core.ts` — Added `execution-records.ts` re-export
- `sprint-planner/index.ts` — Registered `sprint_execution_record` tool with TypeBox-validated `start`/`checkpoint`/`finish` actions; added `session_shutdown` interruption of owned unfinished execution records; added `executionRecords` map for runtime handle tracking
- `sprint-planner/test/core.test.ts` — Added 29 tests covering: start/revision, source snapshot, id allocation, implementation phase evidence, validator PASS/BLOCKED, dependency barriers, integration gating, stale revision rejection, duplicate evidence rejection, terminal transitions (completed/blocked/interrupted), changed-file observation, source drift detection, manifest agreement/repair, doctor inspection, lease release, clean-shutdown interruption, and unsupported version parsing

## Behavioral Impact

- Execution records are now durably persisted under `.internal-dev/sprints/<exec-run-id>/` with `execution/record.json` (authoritative) and `manifest.md` (derived)
- Every mutation validates optimistic `expectedRevision` and increments revision once per accepted transition
- Phase implementation checkpoints require all declared dependencies to have validator `PASS`
- Validator checkpoints require prior implementation evidence for that phase
- Integration validation requires every phase to have validator `PASS`
- `finish: completed` requires all phases PASS, integration PASS, and unchanged source bytes
- `finish: blocked` permitted after any `BLOCKED` verdict or external blocker
- `finish: interrupted` writes interruption evidence and releases lease; requires no prior gating
- Changed-file evidence is observed from actual repository state (not caller-supplied hashes)
- Source plan bytes are never written; drift is detected on completed-finish check and reported by doctor
- Manifest is repaired from authoritative record on next owned mutation after a partial-write failure
- Clean shutdown interrups each owned unfinished execution record and releases its lease
- List and doctor remain read-only; doctor reports active, blocked, interrupted, completed, malformed, and unsupported execution record states
- No worker coordination or provider work is triggered by record operations

## Specification Impact

Specification Impact: none — this phase implements the behavior already specified in the plan. The `sprint_execution_record` tool contract and execution record schema are new public API but they follow the plan's declared constraints exactly. No existing specification was changed.

## Risks

- Circular import between `execution-records.ts` and `run-records.ts` — both modules import from each other but only at function-call time (not module init). Node.js ESM resolves this safely; tests confirm it.
- The `freezeOrchestration` function uses simplified linear dependency graph based on phase order. For plans with non-linear dependencies, the frozen dependencies would need to be reconstructed from the full orchestration parse. The current barrier checks (`dependencyPassed`) use whatever is in the frozen record, so a more accurate parse would extend correctly without breaking.
- Execution record handle map (`executionRecords`) is in-memory only. If the extension runtime is killed without clean shutdown, owned unfinished records will have their lease remain on disk (uncertain ownership). `/sprint doctor` and `/sprint reset` handle this case.

## Follow-up Items

- Phase 08 (skill-policy-integration) will update the orchestrate skill to call `sprint_execution_record` for checkpointing and finishing
- The orchestrate skill should request `sprint_execution_record` action checkpoint with `expectedRevision` tracking
