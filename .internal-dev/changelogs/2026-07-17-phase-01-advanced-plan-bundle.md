# Phase 01 — Advanced Plan Bundle and Correction Pipeline

## Date

2025-07-16

## Git Commit

N/A — repository is not a Git repository.

## Change Summary

Implemented the complete advanced-plan artifact contract for the sprint-planner extension: scope-driven phase budgets, deterministic `orchestration.md` artifact, dedicated xhigh orchestration corrective review between concepts review and per-phase review, strengthened planner prompts with head-down implementation guidance, updated full-sprint and standalone assembly, and bumped the sprint state version to safely reject incompatible checkpoints.

## Files

| File | Change |
|------|--------|
| `sprint-planner/types.ts` | Bumped `SPRINT_STATE_VERSION` from 2 to 3. Added `ScopeSize` type, `PHASE_BUDGETS` constant (small 2–3, medium 3–5, large 6–10), and `ORCHESTRATION_HEADINGS` constant. |
| `sprint-planner/validation.ts` | Added `parseScopeSize()` to extract the `**Size**: small|medium|large` marker from orchestration. Updated `validatePlanFiles()` to require exactly one `orchestration.md` with required headings, enforce 2–10 contiguous phases, and validate phase count against the declared scope budget. Updated `validatePlanDirectory()` to permit `orchestration.md`. |
| `sprint-planner/prompts.ts` | Rewrote `advancedPlanPrompt()` with scope classification criteria, cohesive one-agent phase design guidance, head-down edit instructions, `orchestration.md` heading contract, and 4–12 file submission range. Added `advancedOrchestrationReviewPrompt()` for the new dedicated xhigh corrective review. Updated `advancedPhaseReviewPrompt()` to receive corrected orchestration and check one-agent executability and schedule consistency. Updated `advancedReviewPrompt()` to include orchestration in the generic correction path. |
| `sprint-planner/engine.ts` | Added `advancedOrchestrationReviewPrompt` import and `ORCHESTRATION_HEADINGS` import. Updated `planNames()` to sort `orchestration.md` after `concepts.md`. Updated `#sprintPlan()`: added orchestration corrective review step (`planning-review-orchestration`) between concepts review and per-phase reviews; corrected phase reviewers now receive concepts + orchestration + their phase (3 context paths); author now has `minFiles: 4, maxFiles: 12` expectation; review summary includes `orchestration.md` component. Updated `#writeManifest()` to count phases explicitly and mention orchestration. Updated `runStandaloneAdvancePlan()` with the same orchestration review flow and corrected phase-review context. |
| `sprint-planner/test/core.test.ts` | Updated `FakeRunner` to return `orchestration.md` in plan submissions and handle the `advanced orchestration reviewer` role. Updated 6 existing tests to expect orchestration in directory listings, context paths (3 instead of 2), manifest text, and validation errors. Added 11 new focused regression tests covering: `parseScopeSize` extraction, scope-size phase budgets at boundaries (small/medium/large), missing orchestration in directory validation, orchestration reviewer context, phase-reviewer context with orchestration, review summary inclusion, standalone orchestration review, state version bump to 3, prompt contract language (4–12 files, all 6 orchestration headings, model tuples), and scope classification criteria in prompts. |

## Behavioral Impact

- **Breaking**: `SPRINT_STATE_VERSION` bumped from 2 to 3. Existing version-2 sprint checkpoints will refuse to resume with a clear "unsupported sprint state version" error.
- Every advanced plan now publishes exactly `concepts.md`, `orchestration.md`, and 2–10 contiguous `phase-NN-*.md` files. The old 1-phase minimum is removed; plans always have at least 2 phases.
- `orchestration.md` carries a parseable scope-size marker, phase ledger with dependencies, execution waves, model assignments (`deepseek/deepseek-v4-pro:max` / `openai-codex/gpt-5.6-sol:xhigh`), and a mandatory post-phase review-repair PASS gate.
- A dedicated xhigh orchestration corrective review runs between concepts review and per-phase reviews in both full-sprint and standalone advance-plan flows.
- Phase reviewers now receive corrected concepts + corrected orchestration + exactly their phase, and must check one-agent executability and schedule consistency.
- The planner prompt guides scope classification (small/medium/large), cohesive one-agent phase grouping, head-down edit detail, and context discipline.

## Specification Impact

Updated `sprint-planner-suite.md` Advanced Plan Contract section: plans are no longer allowed to have a single phase; every plan must carry `orchestration.md` with the prescribed headings and a parseable scope-size declaration. The planning pipeline now includes a dedicated orchestration corrective review step. These changes are captured in the implementation but the spec file itself is out of scope for Phase 01 (deferred to Phase 03).

## Risks

- Low: The state version bump is a clean break. No migration path for in-progress version-2 runs; a `/sprint reset` is required before replanning.
- Low: The `advancedOrchestrationReviewPrompt` is a new prompt; real model behavior may need tuning, but the structural contract is testable through FakeRunner validation.

## Follow-up Items

- Phase 02: Update the independently installed `orchestrate` skill to consume `orchestration.md` as authoritative scheduling metadata.
- Phase 03: Update living specifications, README, and related documentation.
