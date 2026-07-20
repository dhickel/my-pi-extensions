# Phase 01 Repair Revalidation

## Scope

Independent read-only revalidation of repaired Phase 01 in `sprint-planner/` against the supplied full phase contract and the accepted `advanced-planning-amortization` Phase 01 records. Inspected prompts, validation, engine/state handling, publication helpers, tests, applicable specifications, and runtime-contract knowledge. No source files were edited.

## Findings

1. **REPAIR — corrected orchestration becomes a completed poisoned checkpoint.** In the persisted sprint path, `planning-review-orchestration` writes artifacts and is marked completed before corrected scope-marker and budget validation runs (`engine.ts:500-518`). A malformed correction therefore receives one call, leaves the step `completed`, pauses the sprint, and is skipped on resume. An adversarial resume with a runner capable of returning a valid correction made zero orchestration-review calls and paused on the same artifact. This directly violates malformed/retryable step semantics.
2. **REPAIR — path normalization does not reach engine assembly.** `validatePlanFiles` validates normalized copies, while `planNames`, `find`, and `filesByPath` continue using raw submitted paths. A standalone plan with whitespace-padded canonical names passes validation and then throws `TypeError: Cannot read properties of undefined (reading 'path')`. Correction submissions have the same raw-map hazard.
3. **REPAIR — deterministic estimate rejection is too narrow.** The validator allowed `Time: 2 days`, `Duration: two weeks`, `Estimated effort: 3 engineer-days`, `Estimate: 2-3 days`, `Schedule: next sprint`, and `Target date: 2026-08-01`, while correctly allowing Timeout/TTL/backoff examples. The prohibition is therefore not deterministically enforced for common labeled human estimates and scheduling fields.
4. **REPAIR — exact scope marker parsing remains permissive.** The parser accepts case/spacing variants such as `**SIZE**: SMALL` and `**Size**:small`, and accepts markers inside tilde-fenced or indented Markdown code blocks. This is weaker than the exact own-line marker contract.
5. **REPAIR — post-publication failure is not plan-atomic and cleanup is not ownership-checked.** `runStandaloneAdvancePlan` publishes the plan, then performs a fallible directory validation; its catch removes only the review. A validation/race failure after rename can therefore return failure while leaving a published plan directory. Review cleanup uses unconditional path deletion and can remove a replacement created after ownership was lost. Ordinary pre-existing review and plan collisions behaved correctly, and a direct two-publisher race produced one winner and one rejection.
6. **REPAIR — stale exported corrective prompt.** `advancedReviewPrompt` is unused but exported via `core.ts`; it omits the time/scheduling prohibition and allows phase-set changes, conflicting with the fixed corrective sequence. Remove the accidental API or align it with the active contract.

The repository suite passed 33/33. Success-path full sprint/standalone assembly, arbitrary input file ordering, component summaries, exact prompt tuples, phase context isolation, and ordinary collision handling passed.

## Risk Assessment

High risk for persisted sprint recovery: malformed corrected orchestration cannot self-repair or recover by resume. Medium risk for model-produced whitespace paths and common estimate syntax because deterministic validation can pass invalid output or crash with an imprecise TypeError. Medium-low but explicit transactional risk remains around post-rename validation and cleanup ownership. The accepted Phase 01 plan defers living specification and README updates to Phase 03; those files still describe state v2 and omit `orchestration.md` from the bundle.

## Recommendations

- Put semantic corrected-orchestration validation inside the orchestration step/call validation boundary before artifact writes and completion; classify contract violations as malformed so the same session retries. Apply component-specific estimate validation at concepts/orchestration/phase boundaries and retain final bundle validation as defense in depth.
- Canonicalize submitted file paths once at the typed submission boundary and return/use only canonical paths throughout maps, sorting, persistence, and publication. Preserve precise offending-path diagnostics.
- Expand estimate checks around narrowly anchored human-planning labels and common ranges/word-number formats while retaining explicit technical timeout/TTL/backoff exceptions.
- Parse exact literal marker lines while tracking both backtick and tilde fences and rejecting indented code.
- Ensure all fallible plan validation occurs before publication, or roll back the owned plan directory after verifying ownership/contents; ownership-check review cleanup.
- Remove or repair `advancedReviewPrompt` and add adversarial engine-level regressions, not validator-only tests.

## Follow-ups

After repair, rerun `npm --prefix sprint-planner test` plus persisted malformed-orchestration retry/resume, padded-path full/standalone assembly, estimate bypass, exact-marker code-fence, review collision, plan collision, concurrent publisher, and post-publication rollback checks. Complete the separately planned Phase 03 specification/README update for state v3 and the three-part plan bundle.
