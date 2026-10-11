# Phase 01: Portable Core

## Context

The reusable package does not yet exist. Existing source scripts contain useful algorithms but resolve a consumer root from `__file__`, use fixed pack/count assumptions, and depend on licensed RPGW recipes. Extract behavior, not those assumptions. The accepted living Tileset Lab specification governs source/art preservation and the finite `quarter-corner-v1` boundary.

Implementation and validation use caller `openai-codex/gpt-6.1-sol:max` under the explicit USER OVERRIDE. No fallback configuration, unused-basic worker, autonomous planner route, or model substitution is allowed. Root publishes records and owns the specification/index/decision changes.

## Goal

Deliver the portable source-guarded core and editable Tiled outputs without consumer assumptions

## In Scope

**Write Targets**: tileset-lab/python/tileset_lab/__init__.py, tileset-lab/python/tileset_lab/manifest.py, tileset-lab/python/tileset_lab/sources.py, tileset-lab/python/tileset_lab/terrain.py, tileset-lab/python/tileset_lab/pixels.py, tileset-lab/python/tileset_lab/maps.py, tileset-lab/python/tileset_lab/source_geometry.py, tileset-lab/python/tileset_lab/__main__.py, tileset-lab/python/requirements.txt, tileset-lab/test/python, tileset-lab/test/fixtures, .internal-dev/specifications/tileset-lab.md, .internal-dev/specifications/index.md, .internal-dev/specifications/decisions.md

Deliver manifest/source validation, explicit inventories/licenses, source packet and independent 14-role guard, normalization, Qt pixel arithmetic, complete frames/components, source/terrain/parts/playback galleries, finite editable scenes, external TSX and a root Tiled project. Include independently authored synthetic CC0 fixtures and active-guard tests.

## Out of Scope

Do not implement a classifier, edge/mixed/blob conversion, auto-cliff system, scene framework, engine importer, collision system, synthetic alpha, transformed art, detached workers, or a TypeScript pixel rewrite. Native incremental proof and final publication arrive in Phase 02; no temporary success bypass or placeholder native method is allowed. Do not copy RPGW artwork or frozen/contact assets into the package. No source-assets writes, dependency installs, network activity, or upstream lifecycle repair.

## Dependencies

none

## Constraints

- All code writes remain in declared canonical extension-repository paths. Consumer outputs for tests and actual review live in owned temporary projects, never the source-assets project.
- Read-only extraction inputs may include `/home/dhickel/Assets/tilesets/tools/{import_sources,build_project,source_geometry,validate_project,validate_showcases}.py` and its accepted assessment. Do not edit them or import their installation-root globals into portable code.
- Manifest paths resolve only from the explicit consumer root. Reject output overlap with original/source/catalog/license/frozen/review inputs, path traversal, symlink components, unknown fields, bad identifiers, and unsupported profile/cell geometry.
- Preserve the supplied eight modified and three untracked paths. Root alone appends the new decision hunk and indexes the new specification. No wholesale rewrite of existing records or model configuration.
- This is one unsplit phase. Its numbered implementation groups share one implementation session and one independent full-edit review-and-repair gate.

## Implementation Steps

### 1. Manifest and protected source records

1. Create the package Python namespace and explicit CLI entrypoint. Implement `inspect` and guarded candidate `build` behavior fully for this phase; do not register future `render`/`validate` stubs. Use argument arrays and an explicit required project root and manifest.

2. Define a closed versioned manifest for profile/cell size, consumer packs and sources, license records, source inventory, catalogs, frame registrations, frozen/reference/review paths, scene data, owned outputs, Python identity, and existing Tiled AppRun identity. Relative data paths must be canonical and consumer-local. Runtime executables are explicit external capabilities, not consumer-art discovery paths.

3. Implement canonical root/path handling with lstat/realpath containment and no symlink traversal. Validate absent future-output parents as well as existing entries. Reject same-path, ancestor/descendant, or symlink aliases between protected inputs and outputs. Record precisely which directories/files a run owns.

4. Inventory every declared original with relative path, size, SHA-256, PNG dimensions when applicable, and license association. Validate the closed declared source scope, including non-PNG originals/help/licenses. Reject unexpected/missing/renamed/changed source files. `inspect` can create an initial UNAPPROVED snapshot only by explicit authoring request; existing snapshots are never silently replaced or refreshed.

5. Load/hash run inputs once and recheck content before finishing a candidate. Keep the original bytes intact and report inventory differences, rather than inventing a replacement baseline.

### 2. Terrain and exact pixel algorithms

1. Implement the explicit 14-role schema in `terrain.py`/`source_geometry.py`, using full-cell absolute coordinates for `background`, `solid`, four convex, four named edges, and four concave roles. Validate exact coverage, material identity, full source bounds, and 16px/32px cell size. No origin-relative defaults or 5x7 inference.

2. Parameterize half-cell source sampling while retaining the original opposite-phase/inward geometry. For each mask use NW/NE/SE/SW bit order 1/2/4/8 and generate precise provenance rectangles. Preserve masks 0 and 15 as original whole background/solid tiles. Never trim, scale, rotate, flip, or alter alpha/RGB to infer terrain.

3. Opaque mode requires wholly opaque source roles and all 16 candidates; seed backgrounds using color 2. Alpha mode requires an authored-empty background, preserves sparse positive-alpha foregrounds, uses 15 nonempty candidates, and represents mask 0 as null. No empty-art terrain candidate or all-zero Wang artwork entry. Disable TSX transformations and maintain one candidate per nonempty mask.

4. Implement Qt-compatible uint8 premultiplication, inverse representation where required, and integer SourceOver in `pixels.py`. Use exact arithmetic with sufficient intermediate width and the verified rounding operations, not Pillow compositing tolerance. Canonicalize hidden RGB only for visible-RGBA comparisons and retain raw source-file digests separately.

5. Implement ordered animation timing with positive integer durations and strict Tiled `elapsed > duration` advancement. Do not divide elapsed time by a fixed period; variable durations and exact boundaries must work.

### 3. Source inspection packet and independent guard

1. Generate an UNAPPROVED packet with original full-sheet context, all full-cell roles, coordinates, materials, frozen candidate crops, diagnostic provenance, original/catalog/tool digests, license references, and bounded pages. The producer never emits a source-art PASS.

2. Define a source-review record that covers every role of every family exactly once and binds original/frozen pixels and coordinates, source/catalog/tool/packet hashes, reviewer identity, semantic observations, and verdict. Reject partial, duplicate, stale, missing, or negative records. Comparison uses original full-source cells and frozen artwork, never generated quarters or native images as the reference.

3. Implement the production guard before normalization. Verify approval identity and coverage, frozen-file integrity, original/frozen correspondence, independently approved coordinates/materials, and full visible-RGBA equality for all 14 roles. Refuse auto-rebaselining. Include mismatched convex/concave and swapped-direction controls rather than rely only on label/grid checks.

4. Author initial fixture catalogs and packets without approving them. Unit tests may construct explicit test-only trust records, using the same production parser and guard with no patching or mocks. Identify those records as synthetic test data; they do not certify actual visual inspection.

5. The phase validator, independent of the fixture role author, must actually read every source packet image and full-source context, record observations for all roles, and issue real approval only after correcting defects. If it selects or changes artwork, a different inherited image-capable reviewer approves the changed selection. Missing image support is BLOCKED; do not fake human review or redirect models.

### 4. Complete registrations, editable maps, and fixtures

1. Register source atlases and complete animation frames into external TSX with relative image paths. Support at least two explicitly declared nonsquare sprite geometries, truly empty authored-alpha slots, non-row-major ordered frame slots, validated aliases, and variable positive durations. Materialize the 100ms authoring default in data; never infer a source frame rate.

2. Build full pixel-rectangle components, including tall/multirow complete stamps, with appropriate object anchoring and full-source provenance. Keep component geometry separate from terrain cells and animation frame dimensions.

3. Emit source inventory/playback, all-mask terrain-pattern, and complete-parts galleries, plus consumer-authored scenes from finite vertex fields and placement data. Validate references, layer/object visibility, nonempty original alpha, full geometry, draw order, and final non-occlusion. Do not mistake XML presence for visible coverage.

4. Emit a root `.tiled-project`, normalized atlases, relative-reference external TSX, finite editable TMX scenes, provenance, source/frame inventory, and bounded gallery pages. Source data and recipes remain consumer-local, not package constants.

5. Independently author CC0 fixtures for 16px and 32px consumers, each with opaque and sparse-alpha terrain and shuffled absolute role placement. Include two nonsquare frame geometries, true empty slots, aliases, default-timed and ordered 70/130/40ms animation, complete components, and different finite scenes. Declare fixture authorship/license explicitly. Do not crop, recolor, trace, or freeze RPGW artwork into distributable fixtures.

6. Complete `inspect` reports and source-guarded candidate build reports with explicit status, input/output hashes, complete inventories, owned paths, and useful failure evidence. Candidates remain unselected until Phase 02 implements all native/visual publication gates.

## Required Guides

Read the target `.internal-dev/AGENTS.md`, specification guide/index, new Tileset Lab specification, the four ordinary phase contracts, and relevant source assessment. Inspect critical source geometry/pixel/animation code directly before extraction. Use filename-targeted knowledge lookup when evidence contradicts an assumption. Root uses actual `internal_dev` for new persistent records; never initialize or write source-consumer records automatically.

## Technical Guidance

- Use small pure transformations for manifests, geometry, masks, frames, and pixel operations. Contain filesystem effects in the CLI/build boundary; avoid a service/repository framework.
- Explicit integer validation rejects booleans masquerading as integers, negative/zero dimensions, incomplete frame rectangles, duplicate slots/IDs, invalid aliases, and out-of-bounds roles/components. Terrain-grid requirements do not impose square geometry on sprites.
- Tiled Wang vectors use `[edge-N, corner-NE, edge-E, corner-SE, edge-S, corner-SW, edge-W, corner-NW]`. For corner-only fields emit `[0, NE, 0, SE, 0, SW, 0, NW]` with A=1 and mode-specific B. Keep an explicit mask-to-candidate-ID registry: alpha mask 0 is null, not an assumed atlas base offset.
- Equality of repeated full-source art may be valid; equality of generated atlas tiles does not establish role correctness. Source approval must remain independent of the chosen recipe.
- Keep fixture expectations independently declared. Tests calling production guards are required; a mock return from `check_source_geometry` would invalidate the transferable-consumer claim.
- Declare Pillow >=10.1 and NumPy >=1.26 in `python/requirements.txt`. Missing dependencies return a concrete BLOCKED prerequisite, not an auto-install instruction executed by the backend.

## Validation

1. Run Python unittest discovery from the package with `PYTHONPATH` pointing to its `python` directory. Cover complete fixture generation and closed schema validation, path/symlink/output-overlap failures, malformed inventories/licenses, changed/missing/unexpected originals, and preservation of originals/previous outputs.

2. Exercise the real source guard for all roles and both sizes/modes. Reject a full-source convex-island role substituted for concave art, directional swaps, wrong original/frozen crops, stale catalog/tool hashes, duplicate/partial/negative approvals, and frozen-art rebaselining attempts. Distinguish test trust records from the validator's actual source-image review.

3. Check exact 16 masks in opaque mode and null plus 15 nonempty alpha masks, candidate uniqueness, disabled transforms, shared-vertex bit ordering, provenance rectangles, no source pixel changes, and sparse authored-alpha support. Check all 512 3x3 vertex neighborhoods per mode and 81 partial corner constraints per mode using independently declared expectations.

4. Check exact pixel edge cases at alpha 0/1/127/128/254/255, intermediate rounding, stacked alpha, visible hidden-RGB semantics, and wrong-alpha/compositing controls. Test elapsed times immediately before, at, and after each boundary of 70/130/40ms and default 100ms animations, including wrap and aliases.

5. Check nonsquare complete-frame geometry, empty-slot exclusion, non-row-major order, duration materialization, tall component geometry, effective visibility/non-occlusion, source/terrain/parts/playback/scene coverage, and external TSX/TMX/root-project references.

6. Run both fixtures from an unrelated cwd and a relocated package path, using explicit consumer roots and production guards. Assert no inferred three-pack or 54/22 counts and no write under the source-assets project.

7. The independent full-edit phase validator opens all fixture source packets, owns code repair, records actual role review with image hashes/observations, and reruns the complete Python suite plus real guarded candidate builds after approval. It returns actual `VERDICT: PASS` or `VERDICT: BLOCKED` with commands, hashes, review identity, findings, repairs, and changed paths.

## Exit Criteria

**Completion evidence — 2026-10-11:** actual independent Phase01 PASS and root confirmation are recorded in [the phase gate](../../reviews/tileset-lab-phase-01-independent-validation.md). The unsplit four-phase plan remains active until all dependent phases finish; this status does not waive native/Pi/publication work.


All four implementation groups are complete, both fixture consumers build usable editable outputs through active production source guards, and every stated failure control is proven. All 14 roles per family have actual independent source approval; test trust fixtures are not represented as human review. No source-assets, unrelated dirty, or licensed distribution changes exist.

Root persists the implementation report and actual independent phase PASS in reviews, then commits only owned phase paths/new specification/decision hunks. This hand-authored refinement of accepted prose is not a generated advanced-planning run and claims no frozen Sprint execution record. Phase 02 may start only after this PASS. No native/visual publication success is claimed before its own gate exists.
