# Extension Ecosystem Hardening

## Date

2026-07-20

## Git Commit

462622124ae7ac3c5539423621ba3dfe0c453412

## Change Summary

Completed the deterministic final integration review across sprint-planner, subagents, internal-dev, and user-questioning. Repaired the execution-record start response so callers receive the persisted immutable source descriptor required by the orchestrate contract, corrected public fingerprint documentation, and fixed two start-path defects found against a validated standalone advanced plan: standalone planning provenance ids were rejected, and valid branching wave order could fail frozen-record parsing. Clarified the orchestrate skill's exact path, provenance-id, and finish payload contracts. The required isolated provider-backed acceptance pipeline still has no repository evidence, so the overall integration verdict remains blocked rather than claiming completion.

## Files

Final-integration edits:

- `sprint-planner/execution-records.ts`
- `sprint-planner/index.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `subagents/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/changelogs/extension-ecosystem-hardening.md`
- `.internal-dev/changelogs/2026-07-20-extension-ecosystem-hardening.md`
- `.internal-dev/reviews/2026-07-20-extension-ecosystem-final-integration-review.md`

## Behavioral Impact

`sprint_execution_record start` now returns `source` alongside `runId` and `revision`. The source value is a detached copy of the persisted immutable descriptor containing the canonical source path, aggregate digest, and per-file hashes and byte counts. This makes the public tool response coherent with the orchestrate skill's requirement to retain returned source identity and hashes.

Standalone plan publications at `.internal-dev/plans/<id>` now accept `<id>` as `sourcePlanningRunId`, matching persisted sprint-plan provenance at `.internal-dev/sprints/<id>/planning`. Frozen wave assignments are normalized to phase-ledger key order, so a validator-approved branching topology no longer fails because JavaScript object insertion order followed wave traversal order.

The orchestrate skill now requires canonical project-relative plan paths, documents the exact optional provenance-id forms, and uses the tool schema's `type: "completed"` finish discriminator instead of the nonexistent `terminalState` field.

Subagent documentation now accurately states that fingerprints include prompt guidance and source metadata in addition to name, description, and parameter schema.

## Specification Impact

Updated `.internal-dev/specifications/sprint-planner-suite.md` to specify the complete execution-record start response, both canonical planning provenance layouts, and phase-ledger-order normalization for frozen wave maps.

## Validation Evidence

- `npm --prefix sprint-planner test` — PASS, 202 tests, including returned-source, standalone provenance-id, mismatched-id rejection, and branching-wave freeze regressions.
- Exact Magenta plan `.internal-dev/plans/20260720-004112-home-dhickel-code-java-magenta-internal-dev-ha` — PASS through `startExecutionRecord` in an isolated temporary execution store: revision 0, 10 frozen phases, 8 preserved wave assignments, and the standalone planning id persisted.
- `npm --prefix subagents test` — PASS, 70 tests.
- `npm --prefix internal-dev test` — PASS, 66 tests.
- `npm --prefix user-questioning test` — PASS, 12 tests.
- `npm pack --dry-run --json` in all four package directories — PASS.
- Pi RPC `get_commands` with the sprint-planner extension and explicit orchestrate skill — PASS: four extension commands, `skill:orchestrate` present, no extension `/orchestrate`.
- Module import-to-peer-dependency audit — PASS.
- Public command/tool, stale-route, dead-API, nested-agent, repair-loop, version-constant, and diff checks — PASS after repairs.
- Structured validation of the accepted hardening source plan — expected legacy incompatibility: current version-1 validation reports phase goal, dependency, and write-target cross-consistency findings; historical plan bytes were preserved as required by phase 09.
- Isolated eight-worker brainstorm → ironout → advance-plan → orchestrate acceptance pipeline — NOT VERIFIED; no preserved execution records or equivalent evidence exist under `.internal-dev/sprints/` or the review/changelog stores.

## Risks

- The concepts and phase-09 exit criteria require provider-backed acceptance evidence, byte-identical source-plan checks, reload inspection, durable phase PASS checkpoints, and a durable acceptance-run integration PASS. Those artifacts are absent, and the available validation tool surface cannot run the required complete provider pipeline.
- The source baseline is the dirty-worktree Git `HEAD` shown above; the final-integration repairs are not represented by that commit.
- A Pi runtime that loaded the extension before these source edits must run `/reload` or restart before `sprint_execution_record` uses the repaired implementation.

## Follow-up Items

- Run and preserve the isolated eight-worker provider-backed acceptance pipeline required by `concepts.md` and phase 09.
- Re-run final integration after that evidence exists; do not record terminal PASS before the criterion is satisfied.
