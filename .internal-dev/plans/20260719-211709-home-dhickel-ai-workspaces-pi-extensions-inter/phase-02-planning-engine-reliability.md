## Context

Phase 01 establishes the corrected planning-component contracts, the pre-freeze decomposition correction gate, the frozen phase index, and semantic revalidation boundaries. The remaining planning engine still needs failure-local fan-outs, interruption-neutral retry accounting, exact retry feedback, reduced ironout context, concurrent disjoint phase reviews, and an explicit runner settlement boundary.

## Goal

Make planning-engine fan-outs, retry and resume accounting, context transfer, phase corrective reviews, and runner cleanup failure-safe without changing the frozen plan decomposition or existing model and retry routes.

## In Scope

**Write Targets**: `sprint-planner/engine.ts`, `sprint-planner/pi-runner.ts`, `sprint-planner/prompts.ts`, `sprint-planner/types.ts`, `sprint-planner/test/core.test.ts`

- Scope-local cancellation and complete settlement for persisted and standalone fan-outs.
- Explicit worker-attempt disposition, causal-error preservation, interruption-neutral retry accounting, and exact retry feedback.
- Preservation of charged failures across ordinary resume.
- Reduced brainstorm context transfer into ironout.
- Concurrent corrective review of frozen, disjoint phase files after corrected shared artifacts exist.
- Runner operation tracking, child settlement, and idempotent cleanup.

## Out of Scope

- Decomposition correction, phase-file-set freeze, and plan cross-consistency contracts owned by Phase 01.
- Cross-process run leases, list, and doctor behavior.
- Execution-only orchestration records.
- Subagent-extension lifecycle and permissions.
- Model-route, thinking-level, or retry-budget changes.

## Dependencies

`phase-01-deterministic-planning-contracts.md` must PASS. This phase consumes its corrected authored-plan decomposition, frozen phase index, structured plan validation, and completed-component semantic revalidation behavior.

## Constraints

- Preserve the first observed non-cancellation fan-out failure as the primary cause. Sibling cancellation and settlement details are secondary evidence and must not replace it.
- Root interruption and sibling-scope cancellation are explicit, distinct outcomes. Neither consumes an attempt; sibling cancellation must not become a user pause or stop unrelated scopes.
- A provider call that reaches a non-cancelled terminal result consumes one attempt, as do typed or semantic submission failures after that completion. Setup or preflight failure, root interruption, and scope cancellation do not consume an attempt.
- Preserve the existing bounded retry budget and provider failure classification. Do not infer chargeability, cancellation source, or retry category from error wording.
- Ordinary resume retains charged attempts and the exact latest retryable failure. Preserve Phase 01's deliberate attempt reset only when completed-component revalidation invalidates that component and downstream work.
- Phase names and count are already frozen by Phase 01. Phase reviewers may replace only their assigned phase file.
- Concepts correction precedes orchestration correction. Phase reviews may overlap only after both corrected shared artifacts exist and only because their output paths are disjoint.
- No fan-out may reject while a started sibling or runner operation remains unsettled.

## Implementation Steps

1. In `sprint-planner/types.ts`, add explicit internal attempt and retry-failure data instead of overloading error strings. Represent runner disposition as a small closed union such as `completed`, `interrupted`, and `not-started`; represent retry feedback with a category such as `provider`, `typed`, or `semantic` plus the exact message. Extend `WorkerResult` and persisted `StepState` as needed. Keep route tuples and `MAX_STEP_ATTEMPTS` unchanged, and make fake runners return deliberate dispositions.
2. Refactor `sprint-planner/pi-runner.ts` so every `run` invocation registers a tracked operation before its first asynchronous boundary. The operation owns an optional child session and a settlement promise resolved only after prompt completion, listener removal, disposal, active-set removal, and memory-session cleanup. Check the supplied signal before and immediately after child creation so cancellation during setup cannot start a prompt. Apply the same tracked settlement discipline to adviser children.
3. Change `abortAll` to request abort on every tracked operation and await all captured settlements. It must not dispose sessions from outside their owning `run` or adviser `finally` block. Make abort, disposal, removal, and settlement idempotent; after cancellation returns, assert that no operation or child remains active. Preserve the first real failure if abort or cleanup also reports secondary errors.
4. Add one engine-private fan-out helper in `sprint-planner/engine.ts`. It must create a local `AbortController`, forward root abort with an explicit root reason, invoke every factory even if one throws synchronously, record the first observed non-cancellation rejection, abort only the local scope, await every started promise with `Promise.allSettled`, remove root listeners, and return values in input order or throw one causal error with settlement evidence. A local cancellation reason must carry scope identity; do not recognize it by message matching.
5. Refactor persisted `#step` around explicit boundaries: runner completion, typed submission validation, semantic validation, and artifact commit. Mark a step running without incrementing its charged count. Increment and persist the count only when the runner reports a non-cancelled completed call, before validating its submission. Store the exact provider, typed, or semantic failure before retry. Treat artifact-store failures as operational failures rather than model-correction prompts. On root interruption mark the step interrupted; on sibling-scope cancellation restore it to pending with its prior charged count and do not alter sprint pause state.
6. Build the next persisted retry prompt from the stored failure category and exact message. Use the same child session and existing route. Remove generic text that asks for correction without identifying the defect. A valid completed result remains charged even though the step then completes successfully; a completed provider failure, malformed typed submission, or semantic rejection remains charged across checkpoint writes and ordinary resume.
7. Apply the same disposition, charging, cancellation, and exact-feedback rules to `#standaloneCall`, using local state rather than persisted step state. Its loop must be governed by charged completions, not invocation count, and must terminate immediately for fatal setup, root cancellation, or exhausted charged budget.
8. Replace the persisted and standalone findings and cross-review `Promise.all` calls with the scoped fan-out. Keep complete all-to-all coverage and same-session continuation. A failed sibling cancels and settles only its current fan-out; later stages do not begin after that fan-out fails.
9. In `sprint-planner/prompts.ts` and the full-sprint ironout call in `sprint-planner/engine.ts`, stop embedding raw findings and cross-review bodies after synthesis and red-team completion. Give ironout the authoritative synthesis and red-team content and concise source-path references to the retained reports. Remove raw report paths from injected context while leaving the reports unchanged in the run record. Keep standalone ironout behavior unchanged when it has no prior report set.
10. Consume Phase 01's frozen phase index in both full and standalone advance planning. Keep concepts and orchestration correction sequential. After both corrected files pass semantic validation, launch exactly one scoped corrective-review call per frozen phase. Each call receives corrected concepts, corrected orchestration, its own original phase, and the complete frozen phase-name index; accepts only `review.md` and that phase path; validates before commit; and writes only disjoint review and corrected-phase paths. Sort accepted results by frozen phase order before plan assembly, review summary generation, validation, and publication.
11. Update `resumeSprint` so running or interrupted steps become pending without changing charged attempts or the stored exact retry failure. A failed retryable step may resume only within its remaining charged budget; an exhausted step remains exhausted. Do not disturb Phase 01's separate invalidation path, which resets the first completed component found semantically stale and invalidates its downstream components.
12. Expand `sprint-planner/test/core.test.ts` with focused fake-runner and fake-child cases for synchronous factory rejection, one sibling failure while others block, first-cause preservation, root interruption racing sibling failure, scope cancellation without global pause, deterministic result order, and full sibling settlement. Cover runner cancellation before and during child creation, adviser settlement, idempotent cleanup, and zero active operations after `abortAll`. Cover every attempt disposition, exact provider/typed/semantic retry text, valid-completion charging, interruption-neutral accounting, retained failure counts across ordinary resume, and Phase 01 drift-reset preservation. Assert reduced ironout input, concepts/orchestration barriers, overlapping phase reviews only after those barriers, frozen file-set preservation, and phase-ordered publication. Use only fakes and temporary stores; tests must not invoke provider models.

## Required Guides

- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- Pi `docs/sdk.md`
- Pi `docs/session-format.md`

## Technical Guidance

Keep cancellation provenance and attempt disposition as typed data passed across the runner boundary. The scoped fan-out should wrap factory invocation so one synchronous throw cannot prevent later factories from starting, and should attach ordered settlement summaries without replacing the primary `cause`.

Use Pi prompt preflight and terminal session evidence only to set the runner's explicit disposition; the engine should consume that disposition rather than reconstructing lifecycle state. Register tracked runner operations before child creation, and resolve their settlement only from owner cleanup so `abortAll` cannot dispose a session beneath an unresolved `run`.

Separate semantic validation from artifact writes at `#step` call sites. This keeps exact model-correctable failures retryable while preventing storage errors from being mislabeled as malformed model output. For phase reviews, retain concurrency only at the model-call and disjoint-commit layer; assemble all outputs by the frozen index.

## Validation

- Run `npm --prefix sprint-planner test`.
- Prove each started fan-out sibling and runner operation is aborted when applicable, fully settled, disposed once, and absent from active tracking before the enclosing failure or cancellation returns.
- Verify synchronous failure still starts every declared sibling and that the first causal rejection remains the thrown cause after cancellation noise and cleanup evidence are added.
- Interrupt persisted and standalone calls at setup and in-flight boundaries and verify no attempt is charged; complete provider, typed, and semantic failures and verify each is charged exactly once.
- Resume with charged failures and assert the count and exact retry message survive. Separately invalidate a Phase 01 completed component and assert only that established drift path resets its attempt count and downstream checkpoints.
- Assert the next retry prompt includes the exact preceding message and correct category without generic substitution.
- Assert ironout receives synthesis, red-team output, and report path references but no embedded raw reports or raw-report context injection.
- Assert phase reviews overlap only after corrected concepts and orchestration exist, cannot change the frozen filenames, and are assembled and published in frozen phase order.

## Exit Criteria

- Every planning fan-out has scope-local cancellation, complete settlement, deterministic output order, and preserved primary-cause evidence.
- Root interruption and sibling cancellation consume no retry and are never conflated; completed provider, typed, and semantic outcomes consume the existing bounded budget exactly once.
- Charged failures and exact retry context survive ordinary resume, while Phase 01 semantic-drift invalidation retains its defined reset behavior.
- Runner cancellation returns only after all tracked planning and adviser operations have settled and owner cleanup has removed every active child.
- Ironout no longer re-embeds raw brainstorm reports after authoritative synthesis and red-team artifacts exist.
- Frozen disjoint phase reviews execute concurrently only after corrected shared inputs exist, cannot alter the file set, and preserve deterministic publication order.
- The focused sprint-planner suite passes without invoking paid models.
