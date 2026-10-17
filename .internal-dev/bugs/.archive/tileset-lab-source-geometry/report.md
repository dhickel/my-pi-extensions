# Tileset Lab rejects declared complete opaque geometry

## Summary

The initial, uncommitted portable-core implementation imported alpha-specific completeness heuristics: it rejects complete opaque or border-touching sprite frames, and bounded opaque manual atlas stamps. This is an in-scope implementation defect under senior repair, not a released-package claim.

## Scope

`tileset-lab/python/tileset_lab/sources.py::load_sources` and `terrain.py::validate_complete_rectangle`, with focused and full Python acceptance tests. No RPGW source or unrelated extension repair.

## Reproduction

Use the newly authored CC0 probe at `/tmp/tileset-lab-evidence/phase-01/completeness-contract-probe.py`. Its real source loader receives declared complete 20x36 opaque sprite slots with genuine empty slots alongside them. Separately, pass `[16,16,32,32]` from an opaque 64x64 sheet to the real manual-rectangle validator. Neither probe mocks the production path.

## Expected

Explicit complete frame/rectangle geometry, source bounds, nonempty art, preservation, and independent visual review define the supported behavior. Complete opaque or legitimately border-touching art must not require transparent gutters or disconnected alpha. Retain genuine malformed/incomplete declared geometry, emptiness, visibility, provenance, and source-oracle rejection.

## Actual

The initial snapshot reports `incomplete sprite frame/gutter geometry` and `rectangle cuts connected original artwork`. Passing the authored-alpha fixtures does not prove opaque generality.

## Evidence

- GitHub mirror: https://github.com/dhickel/my-pi-extensions/issues/3
- `/tmp/tileset-lab-evidence/phase-01/completeness-contract-probe.json`
- `/tmp/tileset-lab-evidence/phase-01/senior-escalation-request.md`
- `/tmp/tileset-lab-evidence/phase-01/implementation-report.md`
- Initial Python tool digest: `00a02e452a5df3cd176ec815a3b5be5f8da80dc6bc30f3dd002cd15d48a2c63b`.
- Initial 36-test suite passed; valid-geometry probes exposed coverage missing from that suite. No independent visual PASS or native test had run.

## Impact

The reusable package would silently narrow its explicit frame/component contract to source-art alpha assumptions. Existing source assets remain unchanged; current candidates are unselected and actual source review remains blocked.

## Status

RESOLVED — 2026-10-11. Senior repair removed only the unsupported gutter/connectivity heuristics and added seven focused methods. Independent full-edit validation passed all seven Phase01 criteria, viewed all 56 source roles, and proved real approved/relocated builds. Root reran all 43 methods, both real production builds and preservation checks, and visually confirmed four-way source-role pages. GitHub issue #3 is CLOSED; this report is archived. No scope narrowing, classifier or source-art rebaseline was introduced.

## Next Action

No defect action remains. Keep the focused positive/negative regression controls; native/Pi/publication validation remains separate later phase work.
