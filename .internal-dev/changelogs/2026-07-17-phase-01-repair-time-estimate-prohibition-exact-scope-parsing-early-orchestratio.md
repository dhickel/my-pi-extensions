# Phase 01 repair — time-estimate prohibition, exact scope parsing, early orchestration validation, failure-atomic publishing, path normalization

## Date

2026-07-17

## Git Commit

Not applicable (not a Git repository).

## Change Summary

Repaired five findings from an independent GPT-5.6 Sol xhigh review of Phase 01 (advanced-plan validation and publication):

1. **Time-estimate prohibition**: Added explicit prohibitions against effort, duration, and time estimates to all plan-generation and corrective-review prompts (`advancedPlanPrompt`, `advancedConceptReviewPrompt`, `advancedOrchestrationReviewPrompt`, `advancedPhaseReviewPrompt`, `ironoutPrompt`, `ironoutReviewPrompt`). Added `rejectTimeEstimates()` to `validation.ts` that deterministically rejects labeled planning estimates (Estimate:, Duration: with human timescale, ETA:, Effort: with label) while allowing technical timeout/TTL/backoff values in code blocks.

2. **Exact scope-marker parsing**: Rewrote `parseScopeSize()` to extract only the `## Scope Size` section, search for exactly one own-line `**Size**: small|medium|large` marker, and reject inline, misplaced, duplicate, or code-block markers.

3. **Early orchestration validation**: After orchestration corrective review in both `#sprintPlan` and `runStandaloneAdvancePlan`, the corrected orchestration is now immediately validated for headings, scope marker, and phase-budget consistency before any phase reviews are called.

4. **Failure-atomic standalone publication**: `runStandaloneAdvancePlan` now creates the review summary via `atomicCreateFile` before publishing the plan directory. If plan publication fails, the orphan review is cleaned up with `rm`.

5. **Path normalization**: `validatePlanFiles` now normalizes all submitted paths via `assertSafeRelativePath` at entry, building a normalized lookup map so whitespace-padded canonical names do not cause `TypeError` on lookups.

## Files

- `sprint-planner/prompts.ts` — 6 prompts updated with time-estimate prohibitions; orchestration review prompt now restates exact model tuples, one-implementer-per-phase constraint, and PASS gate.
- `sprint-planner/validation.ts` — Added `rejectTimeEstimates()` and exported it; rewrote `parseScopeSize()` for exact section-line matching; `validatePlanFiles` now normalizes paths at entry and calls `rejectTimeEstimates` on every file.
- `sprint-planner/engine.ts` — Imports `rm`, `rejectTimeEstimates`, `requiredHeadings`, `parseScopeSize`, `PHASE_BUDGETS`. Validates corrected orchestration (headings, scope marker, budget) after the orchestration review step in both sprint and standalone paths. Standalone advance-plan publication now writes the review summary before publishing the plan directory with rollback on failure.
- `sprint-planner/test/core.test.ts` — 6 new tests: `rejectTimeEstimates` behavior, exact `parseScopeSize` parsing, path normalization in `validatePlanFiles`, time-estimate rejection in plans, malformed orchestration caught before phase reviews, and failure-atomic standalone publication. Updated prompt-contract test to assert new prohibitions and tuple restatements. Removed unused `ReviewCollisionRunner` class.

## Behavioral Impact

- Plans containing labeled human estimates (`Estimate: 2 days`, `Duration: 3 hours`, `ETA: tomorrow`, `Effort: medium`) are now rejected by deterministic validation.
- Scope markers must be on their own line inside `## Scope Size`; duplicate or misplaced markers cause rejection.
- Malformed orchestration corrections are caught immediately, avoiding wasted phase-review calls.
- Standalone advance-plan publication no longer leaves an orphan plan directory when the review summary collisions.
- Whitespace-padded submitted file paths no longer cause `TypeError` on internal lookups.

## Specification Impact

None — these are validation and prompt hardening repairs within the existing phase contract. No API, type, or workflow contract changed.

## Risks

- `rejectTimeEstimates` patterns may need tuning if edge-case false positives or negatives emerge in practice. The patterns skip code blocks and inline code, and Duration is constrained to human timescale values to minimize overrejection.
- The `rm` cleanup on plan-publication failure is best-effort; a crash between review creation and plan publication could leave an orphan review file. This is strictly better than the prior behavior (orphan plan directory).

## Follow-up Items

- Monitor for false positives/negatives from `rejectTimeEstimates` in real plan outputs.
- Consider a dry-run validate-then-publish pattern in `publishDirectoryAtomically` if collision-only rollback proves insufficient.
