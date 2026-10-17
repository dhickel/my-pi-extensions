# Tileset Lab proof bindings and publication safety audit

## Summary

Independent Phase02 audit63 is BLOCKED despite82 passing tests. It reproduced deterministic coverage-order failure, selector cancellation/content/ownership defects, early lock release, malformed-report protocol escape and boolean proof acceptance. Additional receipt/crop/topology/boundary/fault-harness gaps were directly audited. No phase PASS or genuine publication exists.

## Scope

Uncommitted Tileset Lab Phase02: `python/tileset_lab/{native,validate,review,manifest,__main__,drawcases}.py` and focused regressions/real-guard scratch acceptance controls. Do not alter source artwork/catalogs/scenes/frozen references, source inventories, accepted scope, unrelated dirty work or upstream issue2.

## Reproduction

Read `/tmp/tileset-lab-evidence/phase-02-independent-validation/{validation-report.md,senior-escalation-request.md}`. Exact isolated reproductions: `reproduce-safety-boundaries.py`, `safety-reproductions/results.json`, `boolean-readback-controls.json`. New consumer paths are required; existing exclusive evidence may not be overwritten.

Both fresh current `computational_validation()` attempts reject all2931 review bindings per consumer at `validate.py:730`; saved `_compute()`/pixels match before that check. In-memory stdout/stderr log dictionaries become different `.values()` array order after sorted JSON serialization/reload.

## Expected

Canonical exact immutable bindings must round-trip. Receipt and publication must use current complete reviewed proof; controlled errors/cancellation preserve the prior selector and bundle. Staging/selected bytes and inode ownership must be exact. Root locking must span cancellation-safe descendant settlement. Untrusted JSON and nested numeric values must satisfy closed strict schemas. Every required side/axis/stage/width/topology/crop and fault position must be independently proven.

## Actual

Verified failures:
1. All coverage bindings differ by log array order, blocking before the actual native review parser; earlier BLOCKED outputs cannot prove missing-review rejection.
2. SIGTERM after real selector rename but before commit-flag assignment returns cancellation with new bytes still selected.
3. Same-inode staging byte edits reach finalization with unintended selected content.
4. Foreign same-byte selector inode is overwritten during rollback.
5. Cancellation during terminal settlement permits a TERM-resistant owned descendant to acquire the root lock (`UNSAFE_UNLOCKED`) before settlement completes.
6. Candidate report `[]` yields AttributeError, traceback, exit1 and no bounded failure JSON.
7. Direct parser accepts booleans for raw/accepted/prior numeric proof; helper also accepted layer ID True as1.

Directly audited gaps, not claimed reproduced late races: final receipt complete-candidate/runtime freshness; recovery parent-directory fsync before commit; four mislabeled boundary side/axis variants; width-two arm-tip crops excluding support; missing distinct production nested-gap/bridge topology assertions/verdict; real post-review fault harness can succeed on an earlier guard without injection-hit/position/PGID/lock proof. Minor inverse label misdescribes an emptied shape.

Native comparison is exact Qt premultiplied-buffer equality, not necessarily identical nonzero-alpha straight RGB bytes. This is a wording/intent clarification against inherited native validators, not an observed pixel error. Preserve strict original/frozen RGBA and no tolerance.

## Evidence

- GitHub mirror: https://github.com/dhickel/my-pi-extensions/issues/5
- 2026-10-17 user-authorized WIP integration: initial full suite passed 102/102; post-commit full rerun failed 1 of 102 at `test_real_rename_then_int_term_cancellation_restores_existing_or_absent_selector:138`, unexpected non-`Cancelled:` error text after real selector rename. A focused rerun passed. The failed assertion prevents later rollback assertions from establishing selector recovery for that invocation. Cause remains unestablished; do not label this harmless flakiness or claim final all-green validation. Logs: `/tmp/pi-extensions-tileset-{merge-test,final-test,cancellation-recheck}.log`. No product code or test repair was made under this Git-only authorization.
- Independent report/request and reproduction paths above.
- `coverage-binding-discrepancies.json`, `both-current-guards.json`, helper audit summaries/logs.
- Both full current guards BLOCKED before review, with all85818 frozen v6 files unchanged.
-82 tests passed; retained5712-stage/534273280 exact native-buffer pixel reconstruction rechecked, not a new native run.
- Actual visual review incomplete: two native point pages opened by audit root;12 source pages by helper; zero of2926 prepared member sheets opened. No native approval/receipt/publication was fabricated.
- `preservation-closeout.json`:2740 source/369 protected source/5406 prior evidence/80 fixture/102 package/13 changed-path hashes/204 consumer bindings and unrelated bytes/decision prefix preserved.

## Impact

Phase02 cannot validate or safely publish. Phase03 remains blocked. Existing production-v6 source reviews and frozen artifacts remain history; code repairs require new tool-bound source review, complete native generation and separate actual native semantic approval. Never patch old hashes or reduce coverage.

## Status

OPEN pending independent full-phase/native-visual/genuine publication acceptance. Senior67 completed all13 repair targets plus the inverse label at inherited `openai-codex/gpt-6.1-sol:max`; root independently passed102 tests and369 protected source records. Fresh source-v8 approval and both real complete native/computational roundtrips passed; actual UNAPPROVED native review parsers were reached and correctly rejected drafts. No native PASS/receipt/publication exists. Current tool SHA `db009db3fe85a349ae8df131761a87d70007a5de58c3088f27ddade84c58836d`; v6/v7 preserved/stale. See `../../reviews/tileset-lab-phase-02-proof-safety-repair.md` and complete external handoff. Root owns durable records/Git; no fallback or scope change.

## Next Action

Independently re-audit every repaired target and actually view all5862 current native items/required member images, then execute `post-review-publication-controls-v8.py` with real complete visual PASS. Require final-fresh receipts, actual intended fault hits/positions, full group settlement/root locking and exact immutable publication for both sizes. Close/archive only after independent full-phase PASS and root confirmation.
