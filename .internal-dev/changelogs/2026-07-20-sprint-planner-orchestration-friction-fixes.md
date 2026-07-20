# Sprint Planner Orchestration Friction Fixes

## Date

2026-07-20

## Git Commit

462622124ae7ac3c5539423621ba3dfe0c453412

## Change Summary

Implemented four orchestration-friction fixes in sprint-planner: canonical standalone/sprint provenance parity, truthful out-of-target changed-file evidence with structured drift warnings, retryable version-2 validation histories, and suffix-optional phase-name normalization.

## Files

- `sprint-planner/execution-records.ts`
- `sprint-planner/types.ts`
- `sprint-planner/index.ts`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/changelogs/2026-07-20-sprint-planner-orchestration-friction-fixes.md`

## Behavioral Impact

- One typed source-identity helper now classifies `standalone-plan`, `sprint-planning`, and `other` layouts for both start validation and record parsing.
- Safe canonical changed paths outside frozen targets are accepted, observed, persisted in `outsideDeclaredTargets`, and returned through structured `outside-declared-targets` warnings. Frozen targets remain immutable scheduling evidence.
- New execution records use schema version 2 with numbered phase and integration validation attempts. BLOCKED evidence remains active and retryable; disjoint siblings may continue, dependents require latest PASS, and completion requires latest phase and integration PASS.
- Version-1 execution records remain parseable and diagnosable but reject mutations.
- Phase checkpoints accept names with or without `.md`, store canonical filenames, expose a TypeBox pattern/description, and list valid canonical names on lookup failure.
- The orchestrate skill now treats unexpected paths as plan drift, reassesses write overlap, and serializes validators when discovered write sets overlap.

## Specification Impact

Updated `.internal-dev/specifications/sprint-planner-suite.md` to make execution-record version 2, retryable BLOCKED semantics, truthful changed-file evidence, source-layout parity, phase normalization, and orchestration drift handling part of the living contract.

## Risks

- Existing version-1 records are intentionally read-only; continuing execution requires starting a new version-2 record.
- A Pi runtime that loaded the extension before these edits must reload or restart to use the new schema and skill contract.

## Follow-up Items

None.
