# Extension Ecosystem Hardening

## Date

2026-07-20

## Git Commit

Not applicable — no Git repository was detected at the project root.

## Change Summary

Reconciled the sprint-planner, subagents, and internal-dev living contracts and public documentation with the hardened implementation. This validator corrected the sprint-planner README's public tool count and added the exact child tool routes. The required isolated provider-backed acceptance pipeline remains unverified, so this record does not claim phase completion.

## Files

Phase-09 source targets inspected or changed:

- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/changelogs/extension-ecosystem-hardening.md`
- `sprint-planner/package.json`
- `subagents/package.json`
- `internal-dev/package.json`
- `user-questioning/package.json`
- `sprint-planner/README.md`
- `sprint-planner.md`
- `subagents/README.md`
- `subagents.md`

A separately dated changelog created before validation exists at `.internal-dev/changelogs/2026-07-20-extension-ecosystem-hardening.md`; it is outside this phase's exact write target and was not rewritten.

## Behavioral Impact

No runtime code changed in phase 09. Package manifests expose their extension and skill resources and declare the imported Pi packages at the consuming boundaries. Public documentation now describes the five sprint-planner tools, four subagent tools, flat root-owned subagent pool, read-only discovery and diagnosis, immutable source plans, durable execution-only evidence, explicit recovery, and exact orchestrate model and tool routes.

## Specification Impact

Updated `.internal-dev/specifications/sprint-planner-suite.md` and `.internal-dev/specifications/decisions.md` to cover run leases, structured plan validation, execution-only evidence, exact child permissions, bounded detachment, and validator-owned repair. Updated `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` with confirmed reusable runtime facts.

## Validation Evidence

- `npm --prefix sprint-planner test` — PASS, 199 tests.
- `npm --prefix subagents test` — PASS, 70 tests.
- `npm --prefix internal-dev test` — PASS, 66 tests.
- `npm --prefix user-questioning test` — PASS, 12 tests.
- Pi RPC `get_commands` with the package extension and skill — PASS: extension commands are `sprint`, `brainstorm`, `ironout`, and `advanceplan`; `skill:orchestrate` resolves to the package skill; no extension `/orchestrate` is exposed.
- `npm pack --dry-run --json` in all four package directories — PASS.
- Package manifest/keyword and module-aware import-to-peer-dependency audits — PASS.
- Current-source searches found no actionable nested-agent support, inherited child-tool policy, validator repair handoff, stale GPT-5.5 route, or automatic-resume claim.
- The isolated provider-backed acceptance pipeline was not completed; this validation therefore remains BLOCKED despite passing deterministic checks.

## Risks

- The workspace has no Git repository, so no Git HEAD exists; the Git Commit section records that fact.
- The phase-required isolated eight-worker brainstorm → ironout → advance-plan → orchestrate acceptance pipeline has no preserved evidence and was not runnable through the validator's available tools.
- No durable phase-08 PASS record was found in the inspected plan or sprint records.
- A separate final integration gate remains correctly ordered after phase 09 and has not run.

## Follow-up Items

- Run and preserve the isolated eight-worker provider-backed acceptance pipeline, including source-plan before/after hashes, reload inspection, phase PASS evidence, and final integration PASS evidence.
- Supply a repository-backed Git baseline if the workspace is intended to satisfy the phase's explicit full-HEAD requirement.
- Record phase-08 PASS before retrying phase-09 completion validation.
