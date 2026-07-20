## Context

Phase 01 establishes immediate `starting` progress and deterministic command behavior; phase 02 stabilizes planning execution and resume semantics. This phase adds the shared run-record boundary that prevents concurrent mutation and safely inspects planning or execution-only direct children. Phase 04 consumes these primitives for execution persistence rather than defining another path, ownership, or lease implementation.

## Goal

Centralize safe run discovery, canonical paths, ownership checks, versioned exclusive leases, deterministic list output, and read-only doctor behavior for sprint records.

## In Scope

**Write Targets**: `sprint-planner/artifacts.ts`, `sprint-planner/run-records.ts`, `sprint-planner/commands.ts`, `sprint-planner/engine.ts`, `sprint-planner/index.ts`, `sprint-planner/core.ts`, `sprint-planner/types.ts`, `sprint-planner/test/core.test.ts`

- Shared direct-child resolution, discovery, classification, ownership checks, and strict schema parsing.
- Versioned planning and execution lease acquisition, inspection, and ownership-checked release.
- Planning lease integration for create, resume, pause, interruption, handled failure, completion, and clean shutdown.
- `/sprint list` and `/sprint doctor [run-id]`.
- Read-only baseline diagnosis for planning, execution-only, malformed, missing, completed, interrupted, leased, and uncertain records.
- Regression preservation of phase 01's immediate `starting` state and no-automatic-provider-work rule.
- Removal of proven-unused live artifact APIs after module-aware reference checks.

## Out of Scope

- Execution-ledger schemas, revisions, evidence checkpoints, or terminal execution transitions.
- Automatic lease expiry, stealing, release, clearing, or stale-owner inference.
- Automatic planning resume or provider work during discovery, diagnosis, reload, or process start.
- Doctor repairs, normalization, record creation, or destructive cleanup.
- Changes to other phase files, historical backups, or unrelated artifact history.

## Dependencies

`phase-02-planning-engine-reliability.md`

Phase 01 contracts, including immediate `starting` progress and literal `--` handling, remain authoritative and are regression-tested rather than reimplemented.

## Constraints

- Preserve the orchestration ledger's exact write targets and one-agent phase boundary.
- Use version constants for lease and diagnostic schemas; unknown versions produce explicit unsupported-schema findings.
- Keep lease files at the direct-child run root, outside published `planning/` and future `execution/` evidence.
- Centralize path canonicalization, direct-child validation, no-symlink checks, embedded ownership checks, and lease parsing in `run-records.ts`.
- List and doctor are strictly read-only and never launch provider work.
- Preserve explicit confirmed reset as the only destructive store operation.
- Do not remove a live API without repository-wide, module-aware proof that no package consumes it.

## Invariants

- Every planning mutation occurs while the runtime retains the matching in-memory planning lease handle.
- A lease is bound to one canonical run id and `planning | execution` kind. Mismatched, malformed, unknown-version, transplanted, replaced, or drifted leases never prove ownership.
- Only a retained handle plus matching path identity and bytes establishes `owned-by-this-runtime`; PID, hostname, timestamps, or readable content alone cannot.
- Clean finalization durably saves its final owned transition before release. Failed persistence or ownership verification fails closed.
- A crash leaves the lease. Reload and process start never launch providers or rewrite a record without a retained lease.
- List, doctor, and plan validation never acquire, refresh, release, clear, rename, normalize, or rewrite a lease or record.
- All run consumers share the same store-root, direct-child, no-symlink, schema-version, and ownership checks.
- Confirmed reset never reverts repository edits.

## Edge Cases

- A run-id availability check races another creator; exclusive directory or lease creation decides the winner.
- A newly reserved directory gains a foreign lease. Roll it back only when retained identity still matches and it remains empty; otherwise preserve it and report the conflict.
- A lease is replaced or edited before release. Refuse unlink on device, inode, byte-count, or digest drift.
- State claims another run id, project root, run directory, or kind. Report foreign ownership and do not mutate.
- A direct child, lease, state, manifest, planning entry, or execution marker is a symlink or changes type during inspection. Never follow it.
- Planning and execution markers coexist, are absent, or disagree with lease kind. Report ambiguous or malformed instead of guessing.
- Completed planning has a canonical manifest and no runtime state; a completion in progress can retain the current lease until cleanup finishes.
- Execution-only can be recognized by safe `execution/record.json` presence before phase 04. Diagnose common evidence only; do not infer transitions.
- PID reuse, host changes, inaccessible process tables, malformed owner evidence, and old timestamps remain `uncertain`.
- Doctor without an id uses the bound run when available; an explicit missing id returns a stable missing-record finding. List has no bound-run special case.

## Implementation Steps

1. Add `sprint-planner/run-records.ts` and export only required primitives through `sprint-planner/core.ts`. Define version constants and strict types for `RunLeaseRecord`, `RunLeaseHandle`, discovery summaries, lease inspection, and doctor findings. Centralize canonical `.internal-dev/sprints` validation, one-segment run-id resolution, direct-child enumeration, no-symlink checks, common marker classification, embedded ownership checks, and unsupported-schema findings. Reuse or move path helpers so artifacts, commands, engine, list, doctor, reset, and phase 04 have one authority.

2. Implement exclusive `.lease.json` creation with the existing no-replace owned-file primitive. Serialize at least `{ version, runId, runKind, ownerId, pid, hostname, acquiredAt }`, with unpredictable `ownerId`. Return a handle containing canonical path, expected bytes, digest, byte count, device, and inode. On collision, parse read-only and return sanitized owner/run-kind evidence with doctor guidance. Release only after identity and content checks match the retained handle; replacement or drift is an explicit failure. Unknown lease versions remain held but unsupported.

3. Integrate planning leases in `sprint-planner/engine.ts`. For new work, exclusively reserve the direct-child directory, acquire its planning lease before writing `input.md` or `.state.json`, and remove only an unchanged empty reservation if acquisition fails. For resume, resolve and acquire before loading, revalidating, or mutating workflow state. Hold through provider work and publication. Route pause, clean interruption, handled failure, and completion through one finalization path: stop workers, persist final state or completion cleanup, then release. If persistence or release verification fails, preserve the lease and surface the failure. A crash performs no cleanup.

4. Update `sprint-planner/index.ts` to preserve phase 01's existing `ActiveJob` with observable `starting` progress before asynchronous initialization. Attach engine promises and lease-aware failures without another lifecycle state. Same-process duplicates fail immediately; cross-process conflict performs no planning write and presents lease kind, owner/acquisition evidence, and `/sprint doctor <run-id>` guidance. Never report a conflicting start as successful.

5. Extend `sprint-planner/commands.ts`, usage, and completions with exact `list` and `doctor [run-id]` forms. `list` rejects arguments; `doctor` accepts zero or one id; neither applies to standalone workflows. Preserve status, pause, resume, reset, start-option parsing, and literal `--` behavior. Test extra arguments, traversal-shaped ids, and prompts whose first literal token is `list` or `doctor` after `--`.

6. Implement `/sprint list` in `sprint-planner/index.ts` using only shared discovery. Enumerate lstat-confirmed regular direct-child directories, classify planning, execution, ambiguous, malformed, and unknown without arbitrary descent, and sort by run id. Present id, kind, coarse state, safe marker presence, and lease state. Do not invoke providers, create stores, repair records, or infer ownership from PID. Report skipped unsafe children without following them.

7. Implement baseline doctor in `sprint-planner/run-records.ts` and presentation in `index.ts`. Return stable codes, severity, path-scoped evidence, and safe action while aggregating findings. For planning, inspect strict state shape/version, embedded ownership, artifact hashes, phase 01's structured plan-validation result, runtime/terminal consistency, and canonical manifest headings. For all records, inspect direct-child safety, marker conflicts, lease schema/binding/certainty, and manifest presence. Recognize execution-only and malformed or unsupported execution markers without inventing phase 04 ledger semantics; phase 04 composes its parser with these findings. Doctor writes nothing for malformed, leased, unsupported, missing, or recoverable records.

8. Replace session-start mutation with lease-aware handling in `sprint-planner/index.ts`. Clean shutdown checkpointing and release occur through engine finalization. If a bound record still says `running`, inspect read-only; never mark it interrupted unless this runtime retained the matching lease during clean shutdown. Reload and process start report uncertain or foreign ownership with doctor guidance and never auto-resume. For confirmed reset, show lease evidence in confirmation; settle and release current-runtime work before deletion while preserving reset as the sole explicit destructive override for malformed or uncertain records.

9. Search module-aware live imports, re-exports, type implementations, mocks, and calls for `atomicWriteJson`, `RunArtifactStore.replaceFlatDirectory`, and `ArtifactSink`. Remove from `artifacts.ts` or `types.ts` only when no live consumer remains and no broader public replacement is introduced. Repeat searches after deletion. Do not edit `backups/`, archives, the absent prose scanner, or already-correct unrelated invariants.

10. Extend `sprint-planner/test/core.test.ts` with temporary-store and fake-runner coverage for acquisition, create races, competing owners, run-kind separation, unknown versions, clean release, failed-final-save retention, replacement drift, crash uncertainty, foreign claims, traversal/symlink attacks, list ordering, unsafe entries, every supported doctor class, execution-only baseline findings, and complete no-write snapshots. Prove a second engine makes no mutable write; release follows durable finalization; reload/start makes no provider call or rewrite; reset remains confirmed; and immediate status remains `starting`.

## Required Guides

- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/AGENTS.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- Pi `docs/extensions.md`, including session lifecycle and shutdown guidance

## Technical Guidance

Use deterministic lease JSON so retained digest and byte count are stable. Present exactly `owned-by-this-runtime`, `unleased`, `held-by-other`, or `uncertain`; only a retained handle yields the first.

Discovery should lstat immediately before each read and reject type or identity changes conservatively. List never recurses. Doctor inspects only named, schema-authorized paths under a validated direct child and continues after artifact failures.

Keep planning-state semantics in the existing versioned parser or move them behind shared inspection without weakening `SprintStateStore.load()`. Unknown state, lease, plan-validation, or future execution versions are unsupported, never coerced.

```text
acquire owned lease
perform owned reads/writes and provider work
durably finalize state or completion cleanup
release only when retained identity and bytes still match
on failed finalization, retain the lease for doctor
```

List and doctor only inspect; they never execute this lifecycle.

## Validation

- Run `npm --prefix sprint-planner test`.
- Start or resume one run from two engines; assert the loser performs no state, input, artifact, manifest, or provider mutation.
- Exercise pause, interruption, handled failure, and completion; assert final persistence precedes release. Simulate final-save failure and crash; assert the lease remains diagnosable.
- Replace and edit a held lease before release; assert release refuses unlink.
- Run list over planning, execution-only, ambiguous, malformed, unknown-version, symlinked, and unsafe entries; assert deterministic output and no traversal.
- Run doctor against valid, completed, interrupted, malformed, foreign-claim, hash-drift, invalid-plan, execution-only, missing, symlinked, held, unsupported, and uncertain records. Compare complete before/after trees and bytes and assert zero provider calls.
- Exercise reload and process start with `running` plus foreign or uncertain lease; assert no rewrite and no automatic resume.
- Query status immediately after start and assert inherited `starting` remains observable.
- Test exact command parsing, completion, extra-argument rejection, and literal `--` behavior.
- Search live references before and after conditional deletion; confirm backups are unchanged and the prose scanner remains absent.

## Exit Criteria

- Every planning mutation, including create and resume, is protected by the matching retained lease.
- Clean finalization persists before release; crash, failed persistence, replacement, and uncertain ownership fail closed with actionable evidence.
- Commands, engine, reset, list, doctor, and phase 04 share one direct-child, path, ownership, schema, and lease implementation.
- List deterministically describes safe direct-child records without traversal or mutation.
- Doctor aggregates stable findings for all supported classes without writes, lease changes, provider work, or execution-schema invention.
- Reload and process start do not rewrite uncertain records or auto-start providers; immediate `starting` remains intact.
- Confirmed reset remains the only destructive store operation and never reverts repository edits.
- Unused live APIs are removed only after proof, with backups, archives, unrelated edits, and correct invariants unchanged.
- The focused suite passes, including contention, lifecycle, read-only snapshot, path-attack, and regression cases.
