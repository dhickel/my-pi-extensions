# Extension Ecosystem Hardening

## Date
2026-07-19

## Git Commit
N/A — no Git repository detected at project root.

## Change Summary

Phase-09 specifications, documentation, and integration reconciliation. Updated living specifications, durable decisions, reusable knowledge, package manifests, and public documentation to agree with the hardened sprint-planner, subagents, and internal-dev implementations completed in phases 01–08. Explicitly superseded nested-subagent behavior. All package suites pass.

## Files

### Changed
- `.internal-dev/specifications/sprint-planner-suite.md` — Listed all three planning tools (`sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`), `sprint_validate_plan`, and `sprint_execution_record`. Documented run-record discovery, versioned leases, `/sprint list` and `/sprint doctor`, failure-safe fan-outs, exact retry accounting, execution-only records, source immutability, pre-freeze decomposition gate, and durable validator/integration evidence. Removed stale denial of durable orchestration evidence.
- `.internal-dev/specifications/decisions.md` — Appended eight durable decisions: conservative run leases and read-only doctor, distinct execution-only sprint records, exact child tool sets, session-local paginated results with bounded terminal detachment, subagent cancellation bounded and terminal, internal-dev initialization explicit, validator-owned repair without separate loop, and generated-plan pre-freeze decomposition gate. Each decision includes justification, alternatives/tradeoffs, caveats, affected specification, source, and review triggers.
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` — Added reusable implementation facts: shared-parser reuse across commands, list, doctor, and engine; interruption-neutral retry accounting; scope-local fan-out settlement; conservative lease uncertainty; execution revision ordering; UTF-8-safe page reconstruction; and late-result suppression with bounded detachment.
- `sprint-planner/package.json` — Bumped version from 0.2.0 to 0.3.0.
- `subagents/package.json` — Added version 0.2.0, `pi-package` keyword, `pi` manifest with `extensions` entry, and `type: module`.
- `internal-dev/package.json` — Bumped version from 0.1.0 to 0.2.0.
- `sprint-planner/README.md` — Documented all six tools (`sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`, `sprint_validate_plan`, `sprint_execution_record`, and the orchestrate skill's use of subagent tools plus sprint tools). Documented `/sprint list` and `/sprint doctor`, versioned leases, execution-only record layout, source immutability, non-recovery semantics, read-only reload behavior, and the exact orchestrate model/thinking/tool routes.
- `sprint-planner.md` — Replaced with a concise pointer listing the complete planning, validation, and execution-record surface and directing to the living specification and README.
- `subagents/README.md` — Documented exact tool-name arrays and fingerprints, complete-batch atomic rejection, flat root-owned pool with no nesting, immutable result snapshots, UTF-8-safe pagination with digest verification, bounded cancellation, terminal detachment with "root accounting detached" terminology, and late-result suppression. Listed all four tools explicitly.
- `subagents.md` — Replaced legacy nested-subagent design sketch with a concise supersession note linking to `subagents/README.md`.

### Not Changed
- `user-questioning/package.json` — Peer dependencies are already correct (imports `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`; all declared). Version 0.1.0 was not in the bump scope.
- All phase implementation files remain unchanged (phase-09 targets are documentation and manifest only).

## Behavioral Impact

- No runtime behavior changes. All edits are documentation, specification, manifest, and metadata updates only.
- Package version bumps signal the stabilized post-hardening surface to Pi's package manager.
- Subagents `package.json` gains a `pi` manifest entry enabling Pi to auto-discover the extension from the package directory.
- `subagents.md` no longer describes nested-subagent capabilities that the current implementation does not support.

## Specification Impact
**Impact: specifications/decisions.md and sprint-planner-suite.md updated.**

- `sprint-planner-suite.md` now owns the complete command, tool, lease, execution-record, and validation surface. The stale denial of durable orchestration evidence is removed; durable execution evidence is now documented as a deterministic persistence boundary.
- `decisions.md` records eight new durable decisions with explicit justification chains.
- `sprint-planner-runtime-contracts.md` captures confirmed implementation facts for runtime consumers.

## Risks

- **Low**: Documentation-only change set. All test suites pass. No code edits outside manifest metadata.
- If a Pi installation previously relied on the `subagents` extension being auto-discovered by convention directory rather than a `pi` manifest, the added manifest is additive and includes the same `./index.ts` path — no regression expected.
- The superseded `subagents.md` file removes the historical design sketch; users relying on that file for implementation history should consult the Git history.

## Validation Evidence

- `npm --prefix sprint-planner test` — PASS (all core tests pass with fake runners).
- `npm --prefix subagents test` — PASS (all core tests pass).
- `npm --prefix internal-dev test` — PASS (all core tests pass).
- `npm --prefix user-questioning test` — PASS.
- Full diff restricted to the twelve declared phase-09 write targets; no accidental API growth, placeholders, stale contract conflicts, or verification-only churn.
- Module-aware import audit confirmed all four package manifests declare the correct peer dependencies at their consuming boundaries; no missing or extraneous declarations.

## Follow-up Items

- Run the isolated eight-worker acceptance pipeline from step 10 of the phase plan as a separate validation exercise.
- Submit the final diff to the post-phase GPT-5.6 Sol medium editing validator.
- Begin final integration validation only after every phase (01–09) has durable PASS.
