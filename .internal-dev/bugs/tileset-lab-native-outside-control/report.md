# Tileset Lab native outside-state probe aborts the matrix

## Summary

The uncommitted Phase02 native script aborts before its first saved draw stage because its raw finite outside-state control observes no outside tiles. This is a work-in-progress verification defect, not proof that Tiled clips finite storage and not a released-code claim.

## Scope

`tileset-lab/python/tileset_lab/resources/native_draw.js`, native orchestration/readback, and focused test fixtures. Preserve the explicit finite adapter/clipping contract and complete matrix. No issue #2 lifecycle repair or source-art change.

## Reproduction

The retained real TEST-ONLY development run is described in `/tmp/tileset-lab-evidence/phase-02/root-senior-escalation.md`. It loads the actual opaque external TSX, seeds finite B, invokes stock `wangEdit` with corrections/erasing enabled, calls `setCorner(-1,-1,1)` and `apply()`, then checks actual outside storage. Runtime is the existing Tiled 1.12.2 AppRun/xcb display. Test-only source authority is development evidence only.

## Expected

A genuinely satisfiable raw-API positive control demonstrates possible out-of-range state separately from the workflow's explicit clipping. The workflow accepts finite vertices, prunes only actual outside cells, preserves in-bounds native IDs/flags and runs every required saved stroke. Unmatched requests retaining null/old tiles must not be misdiagnosed as automatic clipping.

## Actual

Tiled evaluate exits zero with `Error: Raw native API unexpectedly clips finite outside state`. The complete-log parser correctly rejects it. No saved native stage TMX/PNG, native review, seal/receipt or publication is produced. Cause remains under authoritative senior diagnosis; the empty observation alone does not establish clipping.

The new readback test class also fails setup before its eight methods because `TEST-ONLY-unit-current` violates the lowercase identifier grammar. Setup cleanup emits a ResourceWarning. This fixture must be corrected and all methods executed, not skipped.

## Evidence

- GitHub mirror: https://github.com/dhickel/my-pi-extensions/issues/4
- `/tmp/tileset-lab-evidence/phase-02/root-senior-escalation.md`
- `phase-02/development-saltworks.log` and consumer `outputs/candidates/matrix/native/native_draw.js.stderr.log`, owner/command records.
- `phase-02/native-readback.stderr.log`; eight methods unexecuted.
- Original 43 tests and 21 new unaffected methods passed; the final full-suite/native matrix remains required.
- Worker58 later terminated with provider `fetch failed`; root observed no matching Python/Tiled invocation processes before resuming. This is a point-in-time check, not an orphan-proof claim.

## Impact

The raw control blocks both complete native matrices and all downstream original-pixel/visual/publication proof. Phase03 stays blocked. Current declarative inventory has 92 cases/1428 stages per family, 2856 draw stages plus 75 context items per consumer; no filtered success may substitute.

## Status

Raw storage control and readback setup repaired by senior59 and subsequently exercised by independent audit63's82-test run. OPEN pending the report's full-phase acceptance gate. That independent audit found separate binding/publication safety defects tracked in https://github.com/dhickel/my-pi-extensions/issues/5 ; source-v6 approval was genuine, but no native visual approval or Phase02 PASS exists.

## Next Action

Preserve the repaired positive control and lowercase/cleanup fixture. Senior67 addresses the independently reproduced proof/selector/settlement defects under the separate safety report, with fresh bindings/native runs. Obtain complete actual native image/publication/full-edit PASS before closing/archiving this report and committing Phase02.
