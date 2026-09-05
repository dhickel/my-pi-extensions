# Jog per-phase Git commits

## Date

2026-09-05

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

Updated the jog execution contract so every completed plan phase receives its own Git commit after focused checks and a PASS from the luna validation loop, before the next phase starts. The gate requires selective staging, staged-diff review, phase-identifying commits, full-hash reporting, and separate commits for later repairs or closeout work.

## Files

- `job-planner/skills/jog/SKILL.md`
- `job-planner/README.md`
- `job-planner/test/core.test.ts`
- `.internal-dev/specifications/job-planner-suite.md`
- `.internal-dev/changelogs/2026-09-05-jog-per-phase-git-commits.md`

## Behavioral Impact

Jog now treats an explicit plan phase, or a coherent validated implementation domain when the plan has no named phases, as incomplete until its dedicated Git commit succeeds. It preserves unrelated worktree changes, blocks the next phase when a safe commit cannot be created, and records phase commit hashes for tracking and phase-level rollback.

## Specification Impact

Updated `.internal-dev/specifications/job-planner-suite.md` to make per-phase Git commits part of the living Jog contract.

## Risks

Repositories without a usable Git identity, functioning hooks, or safely isolatable phase changes will block at the new commit gate rather than continue to later phases.

## Follow-up Items

None.
