# Phase 01 Round 2 Repairs

## Date
2026-07-17

## Git Commit
Not available (non-Git workspace).

## Change Summary
Second and final automatic repair round for Phase 01. Addresses all six findings from the GPT-5.6 Sol xhigh validator report: poisoned orchestration checkpoint, incomplete path repair, narrow estimate validation, non-exact marker validation, publication rollback gap, and accidental stale `advancedReviewPrompt` export. Adds 9 regression tests.

## Files
- `sprint-planner/prompts.ts` — Removed dead `advancedReviewPrompt` function
- `sprint-planner/validation.ts` — Hardened `parseScopeSize` (tilde fences, indented code, exact casing); expanded `rejectTimeEstimates` (word-numbers, ranges, engineer-days, Schedule/Timeline, Target/Due/Completion/Deadline labels while retaining technical exceptions); canonicalized paths in `validateSubmission` and `validatePlanFiles`
- `sprint-planner/engine.ts` — Moved orchestration semantic validation into `#step` consume callback (prevents poisoned checkpoints); added optional semantic validation callback to `#standaloneCall`; canonicalized `planNames`; reordered publication (validate → publish → write review); reset failed steps on resume; expanded `malformed` classification regex; removed unused `rm` import
- `sprint-planner/test/core.test.ts` — Added 9 regression tests: retryable orchestration failure (persistent), retryable orchestration failure (standalone), padded-path engine normalization, tilde-fenced/indented/case marker hardening, expanded human-scheduling detection, technical exception verification, `advancedReviewPrompt` removal, poisoned orchestration resume, publication order verification

## Behavioral Impact
- **Retry boundaries**: Semantic contract failures (scope budget, missing headings, time estimates) now classified as `malformed` and retried inside both `#step` (persistent) and `#standaloneCall` (standalone). Failed steps reset to pending on resume.
- **Path canonicalization**: `validateSubmission` canonicalizes all submitted and expected file paths once at the submission boundary. `validatePlanFiles` canonicalizes in place. `planNames` always uses canonical paths. Padded/whitespace paths no longer cause TypeError.
- **Scope marker**: Requires exact literal `**Size**: small|medium|large` on its own line. Tilde-fenced, indented, and backtick-fenced code is stripped before parsing. Case-insensitive matching removed.
- **Estimate rejection**: Expanded to catch `Time:`, `Schedule:`, `Timeline:`, `Target:`, `Due:`, `Completion:`, `Deadline:` labels, word-number durations, numeric ranges, engineer-days, and dev-days. Technical labels (timeout, TTL, backoff, retry, polling, cache, retention, lease, keepalive, debounce, expiry) are explicitly allowed.
- **Publication order**: Standalone advance plan now validates in memory, publishes atomically, then writes the review. A plan is never published before validation, and a review is never written before the plan is committed.
- **Dead API**: `advancedReviewPrompt` removed — no internal or external caller existed.

## Specification Impact
None — these are bugfixes and hardening within existing specification contracts.

## Risks
- The `malformed` classification regex in `#step` is broader than before. A truly fatal error whose message happens to contain a matching keyword could be retried instead of immediately failing. The risk is bounded by `MAX_STEP_ATTEMPTS=3`.
- `markdownSection` trimming was preserved for other callers; `parseScopeSize` now extracts raw section content to preserve indentation for code-stripping.

## Follow-up Items
- None required — all six validator findings addressed with regression coverage.
