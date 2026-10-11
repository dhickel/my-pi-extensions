# Phase 02: Native Draw Validation

## Context

Phase 01 supplies portable source-approved candidates and independent original-art references. Its pure mask proofs do not establish stock native incremental painting or visual terrain correctness. This phase adds those required gates and a publication path that never rebuilds reviewed output.

The Tileset Lab specification and the case inventory below are the acceptance contract. All used workers, including independent image reviewers and senior escalation, inherit `openai-codex/gpt-6.1-sol:max` under the USER OVERRIDE. No configured fallback or unused-basic worker is permitted.

## Goal

Prove incremental native painting and publish only independently visually approved immutable bundles

## In Scope

**Write Targets**: tileset-lab/python/tileset_lab, tileset-lab/test/python, tileset-lab/test/fixtures, .internal-dev/specifications/tileset-lab.md

Implement `drawcases.py`, `native.py`, `review.py`, `validate.py`, packaged native JavaScript resources, real CLI `render`/`validate` and build-publication behavior, independent reconstruction, four-layer proof, complete review records, failure controls, and whole-consumer cross-process staging/serialization. Repair earlier package modules only where these criteria require it.

## Out of Scope

No native GUI pointer automation, actual editor undo, diagonal-drag claim, unsupported runtime platform, download/install behavior, public background-job API, image classifier, or source-art rebaseline. No issue #2 shutdown-hook repair. Do not reduce the matrix to dense assignment, one final state, one montage, label checks, or generated-atlas expected pixels.

## Dependencies

phase-01-portable-core.md

## Constraints

- Use existing authorized Tiled 1.12.2 AppRun on Linux x86_64 with xcb and an existing display. Preserve `XDG_CACHE_HOME`; isolate config/data under run ownership and remove incompatible host Qt plugin overrides.
- Native finite layer APIs can retain out-of-range cells. Explicit workflow clipping is required and must be visible in evidence; do not claim the API supplies it.
- Critical incremental cases always use `correctionsEnabled=true` and `erasingEnabled=true`, both opaque and alpha. Opaque background is Wang color 2 and actual artwork; alpha background is color 0 and null terrain over unchanged ground.
- No review producer may fabricate image viewing or PASS. Every meaningful stage has independent intent, original-source evidence, actual native result, and independent semantic visual observations.
- Code, source, recipe, approval, dependency, runtime, and evidence changes invalidate the appropriate proof. Exact payload publication must preserve prior approved output on every failure.

## Implementation Steps

### 1. Independent intent and exhaustive gesture inventory

1. Define a declarative drawcase format in `drawcases.py`: fixture/family/mode/group/variant/stage identity, initial field, ordered vertex requests, captured prior values, finite clipping policy, expected post-stage field, semantic intent, and required crops/pages. The Python intent interpreter updates fields from recipes only; it must not read native IDs or generated atlas pixels.

2. Use a 12x12 tile canvas and 13x13 shared-vertex field. Legal vertex coordinates are 0..12 inclusive; legal tile cells are 0..11. Define width as one or two **vertex rows/columns**, not an unstated pixel or tile width. Central variants use vertices within 2..9, with junction/hole center near `(6,6)`, leaving room for all rotations.

3. Expand the following required groups for every declared terrain family in opaque and alpha modes, at both 16px and 32px fixture sizes. Record an initial seed stage and every meaningful click, drag segment, arm addition/withdrawal, perimeter/hole change, clear, and resume. Never substitute only final screenshots.

| Group | Required variants | Ordered saved behavior |
|:---|:---|:---|
| 01 Point/island | Interior point and neighbor in each N/E/S/W direction | Paint point; repeat the identical click; grow to neighbor; inverse neighbor using its captured prior value; clear point; resume |
| 02 Rectangle | Row growth in both directions; horizontal and vertical growth orientation | Start short row; append row strokes until a filled vertex rectangle exists; shrink each perimeter side as separate stages; fully clear; resume |
| 03 Corridors | H and V, widths 1 and 2 vertices | Extend one segment at a time; shorten; widen 1 to 2; narrow 2 to 1; clear. The width-2 variant is also built directly and compared only where fields are equivalent |
| 04 Junctions | All four L orientations, all four T orientations, cross; each with 1- and 2-vertex-wide arms | Add each arm separately; complete junction; withdraw each arm separately; restore captured prior values; clear. Distinguish corners, junction centers, and arm tips in crops |
| 05 Holes/notches | Filled rectangle with hole; notch opened toward N/E/S/W | Fill rectangle by incremental rows; erase one interior vertex; grow a rectangular hole; extend hole to perimeter as an open notch; close notch; refill hole; clear |
| 06 Nested forms | Outer fill/hole/inner island, with mirrored placement | Form outer fill; hollow it; add isolated inner island incrementally; grow/shrink island without bridging; cut/refill outer boundary. Assert intended gaps at every stage |
| 07 Diagonal saddles | Masks 5 and 10; both chain slopes; checkerboard with both parities | Create saddles using individual diagonal clicks; extend chain click by click; build checkerboard incrementally; withdraw/restore clicks. No diagonal-drag coverage claim |
| 08 Finite boundaries | All four sides and four corners; H/V crossings of each boundary; entry from outside; wholly outside strokes | Paint boundary points/segments; cross boundary; enter from outside; issue wholly outside requests; inverse/clear/restore. Keep actual finite dimensions and no outside/wrapped interior leakage |
| 09 Bridges | H/V, widths 1 and 2 vertices | Build two separated regions; join by incremental bridge; cut bridge; restore captured prior values; withdraw bridge; rejoin. Assert connectivity and separation intent |
| 10 Repaint/erase | Opaque and alpha on previously painted point, edge, junction, and filled region | Opaque: repaint B to actual color-2 candidates, never null. Alpha: erase B to null while ground stays byte-identical. Fully clear after dense and shaped states, then resume paint |
| 11 Equivalent requests | H/V straight paths, segmented Manhattan paths, both path orders; 1/2-width where applicable; full-tile four-corner requests | Execute clicks, segmented drag, and Shift-line-equivalent Manhattan requests toward equivalent fields; execute Ctrl-full-tile equivalents as all four corners of a cell; repeat strokes; inverse with prior values; restore |

4. For equivalent-request variants, specify exact vertex lists and stage grouping before execution. Path-order invariance applies only when final fields and complete unique-candidate conditions are equivalent. Do not assert identical intermediate fields for different paths or claim GUI modifier handling. For inverse strokes restore each captured prior value, not always zero and not editor undo.

5. Materialize a complete expected case/stage/crop/page inventory from this declaration before native work. Identifiers must be unique; declared orientation and width expansions cannot be inferred from whatever outputs happened to be produced. Bind inventory and stroke-recipe hashes into every proof record.

6. Retain exhaustive independent 16-mask checks, all 512 3x3 vertex neighborhoods per mode, all 81 partial corner constraints per mode, and full-source geometry tests. Supplement with native all-mask and partial-request proofs; complete constraints require the unique exact candidate, and partial constraints require a real matching allowed assignment rather than nonempty old tiles.

### 2. Actual native edits, clipping, serialization, and render

1. Add `resources/native_draw.js` under the Python package. It reads real external TSX through a TMX bootstrap, preserving external tileset identity. Verify one candidate per supported mask, mode/color counts, all parsed Wang IDs, and zero transformation flags. Do not reconstruct native success from expected labels or Python-generated tile maps.

2. Initialize each independent case once to reviewed opaque B tiles or alpha null, with a declared ground layer where relevant. Keep its native layer persistent across that case's gesture stages. For every meaningful stage, create/use real `wangEdit`, set stock-default correction/erase flags, issue the declared `setCorner` requests, and `apply`. Do not clear/reseed the layer between ordinary strokes.

3. Implement explicit finite request and result clipping. Record raw requests and accepted vertices; constrain serialized map/layer cells to 0..11 without replacing or re-solving the actual in-bounds native result. Native correction may create outside cells near a boundary: record/prune only outside cells and verify retained inside IDs/flags are unchanged by clipping. A wholly outside request is a no-op on the finite interior. Include a separate raw-API control showing that out-of-range state is possible, so clipping is not falsely attributed to Tiled.

4. After every stage verify actual IDs, tile/tileset identities, Wang values, flags, layer state, finite extent, and null/non-null semantics against independent fields. For tile `(x,y)`, expected mask is `v[y][x] + 2*v[y][x+1] + 4*v[y+1][x+1] + 8*v[y+1][x]`. Opaque mask 0 must be background art; alpha mask 0 must be null. Never accept an unmatched request merely because Tiled retained a prior tile.

5. Save each native TMX, reopen/read back it, and verify complete cells, external TSX references, flags, layers, and stage identity. Record content hashes. Export each actual native map as an unannotated PNG at exact native dimensions. These files remain separate from expected or annotated pages.

6. Add `resources/native_render.js` and implement native source/component/frame/gallery/scene rendering as well as draw stages. Check complete geometry, effective visibility, nonempty original art, and final non-occlusion. Render animation at elapsed boundary probes for ordered 70/130/40ms and materialized 100ms timings, including wrap; compare strictly to Tiled's elapsed-greater-than rule.

7. Hash Tiled runtime content, including the launcher and relevant installed binary/library payload identity, and record actual dependencies/platform/display route. A path or version label is insufficient. Do not mutate or install the runtime.

8. Drain and examine complete stdout/stderr for native errors before accepting success. `--evaluate` may exit zero after a thrown error. Require normal exit, no error anywhere including after an apparent PASS, one exact unique terminal run-specific PASS sentinel, and readback of the complete expected native artifact inventory. Truncated logs, missing stages, duplicate sentinels, or partial result JSON are failures.

### 3. Independent original-art reconstruction and four-layer evidence

1. Build expected terrain pixels from the independent field and reviewed frozen original full-source roles. Use a separate expectation path from atlas generation; never sample generated terrain tiles, native output, or saved native IDs as the expected image. Validate source/frozen/approval identity before reconstruction.

2. Reconstruct complete frame/component/scene pixels from original registered rectangles and placements. Use exact Qt uint8 premultiplied SourceOver, materialized ordered animation timing, draw order, and visible-RGBA semantics. Check native RGBA exactly without a tolerance escape.

3. Produce independent intent schematics, full-source role pages, expected reconstruction, actual native PNGs, and focused crops for islands/concaves/edges/junctions/saddles/gaps/bridges/boundaries/erase. Keep sources and native images available separately; explanatory captions must not obscure the art.

4. Paginate stage/gallery pages to <=2000px in both dimensions with nearest-neighbor integer zoom. Show alpha on checkerboard and unchanged ground context. Ensure crop coverage is itself an independently declared inventory; never truncate away failed stages or requested orientations. Link actual unannotated PNGs and original source evidence from each stage page.

5. Provide computational topology and pixel verdicts distinctly from visual approval. A correct label, exact render equality, or generated gallery does not emit a visual PASS.

### 4. Independent visual review and exact immutable publication

1. Implement a closed review schema in `review.py`, validating expected inventory coverage rather than trusting reviewer-reported totals. Each required item has exactly one current record for its consumer/family/mode/case/stage or source/component/frame/gallery/scene context.

2. Require exact viewed PNG/crop/page hashes, source approval digest, expected-field and stroke-recipe digests, complete tool/dependency/runtime content hashes, TSX/atlas/native TMX/log digests, reviewer identity, specific semantic observations, and PASS/BLOCKED verdict. Source/background/material continuity, corner orientation, contour/density, gap/bridge intent, repaint/erase, and animation/component context are review concerns.

3. The independent inherited image-capable validator/reviewer must actually open every required image/page and focused crop. It reads intent and original-source evidence, then evaluates the native result. Missing image access/capability is BLOCKED unless the user explicitly authorizes another route. No automated test or backend may write its actual PASS review on the reviewer's behalf.

4. Stage a guarded candidate at a stable consumer-local path. Once native generation and all computational checks settle, freeze the complete payload and evidence inventory. Store final reviewer records outside that hash boundary, and bind them in an approval receipt without self-referential digests.

5. Implement whole-consumer cross-process serialization, safe staging, and ownership-aware cleanup. Lock by canonical project root across processes, not individual files. Do not steal uncertain locks or recursively remove foreign entries. A new attempt must not mutate an already frozen candidate.

6. Final validation requires fresh source approval, full computational PASS, every current independent visual PASS, and a recheck of protected-input and complete candidate output hashes. Build publication consumes a candidate ID and validated receipt and updates only the approved selector to that exact immutable bundle. It does not rebuild, relocate into broken references, or edit reviewed output.

7. Missing/stale/negative review, changed original/tool/runtime/dependency, partial output, cancelled run, native error, or write failure preserves the old approved selector/output and original inputs. Report truthful ownership limits; do not claim crash-atomic replacement of arbitrary multi-file paths.

8. Finalize one explicit CLI contract for `inspect`, candidate `build`, `render`, `validate`, and the mutually exclusive build publication action. Include required `--project-root`/manifest, candidate/receipt/review arguments, bounded reports, statuses, and ownership paths. Phase 03 consumes this contract rather than inventing a second argument schema.

### 5. Honest-hash controls and real phase proof

1. Build isolated controls whose own file hashes and declared metadata are honest. A simple stale hash is not sufficient evidence for geometry/native/visibility rejection.

2. Reject wrong concave/island role or directional source selection even when a self-render shares it; missing native candidates and unmatched requests preserving old tiles; hidden/empty/fully occluded required art; wrong boundary orientation or wrap; a previous stage frozen into current output; opaque-null repaint or alpha erase changing ground; and wrong alpha/compositing.

3. Separately reject stale/missing/negative/duplicate actual review, forged partial coverage, changed original art, malformed/partial readback inventory, duplicate/missing sentinel, and a real exit-zero native script error before or after apparent success. A negative visual observation stays BLOCKED even when metadata and pixels match the wrong recipe.

4. Exercise failures/cancellation during staging, rendering, review validation, and selector publication. Assert unchanged originals/old approved bundle/selector, no accidentally selected partial output, settled ownership, and no consumer-root lock theft.

5. Run the complete matrix and every gallery/frame/component/scene context for both fixture sizes and all families/modes, not a sample. Complete actual independent image review and retain the full evidence bundle. Repairs invalidate stale downstream approvals and receive fresh independent art review when required.

## Required Guides

Read the target project/store/specification guides, Tileset Lab specification, ordinary phase contracts, Phase 01 evidence, accepted source assessment, and relevant source native/pixel validation code. Inspect actual Tiled scripting and Qt behavior locally; use senior escalation rather than change accepted criteria when native results contradict assumptions. Root exclusively publishes persistent review/knowledge records in the trusted target context.

## Technical Guidance

- Separately hash raw original files and canonical visible RGBA, so hidden RGB does not manufacture geometry mismatches while byte preservation remains testable.
- Candidate uniqueness and disabled transformations make fully equivalent final fields deterministic; partial constraints alone do not justify arbitrary path-order claims.
- Hold exact stage identities through native save/readback/export. A loop that repeats one final output under many names must fail field/hash/stage validation and independent semantic review.
- Native no-match controls must include both a blank and a seeded old tile, showing why nonempty output is not a success criterion.
- Keep the raw native outside-state control distinct from the clipped workflow. Finite maps are an adapter contract, not a claim about the storage API.
- Use immutable input snapshots and content-addressed evidence if useful, but introduce no generalized cache or orchestration framework. Approval invalidation is mandatory whether or not caching exists.

## Validation

1. Run the full Python suite including all 16 masks, 512 neighborhoods/mode, 81 partial constraints/mode, exact source geometry, pixel arithmetic, frame timing, visibility, path safety, inventories, locks, and review/publication controls.

2. Execute real Tiled stock-default incremental cases for every declared orientation/width/stage in groups 01..11, both sizes and modes. Retain native TMX/IDs/flags/references, outside clipping evidence, exact PNGs, full logs, and complete expected inventory readback. Run real native unmatched/exit-zero-error controls.

3. Compare all native images and boundary-time animation outputs against independent frozen-original reconstruction with exact Qt pixels. Reject incorrect alpha and hidden/empty/occluded required entities independently of XML/render equality.

4. Actually inspect all case/stage/crop/gallery/component/frame/source/scene images with an independent inherited reviewer. Retain reviewer identity, viewed hashes, semantic observations, and complete coverage; missing/stale/negative proof remains BLOCKED.

5. Demonstrate stable-path build -> render -> validate -> independent review -> publication without regeneration. Rehash the complete exact published payload and show previous outputs and originals survive each rejected publication/failure/cancellation.

6. The full-edit phase validator owns in-scope repair and reruns required checks before actual `VERDICT: PASS`. Art it selects or changes needs another independent reviewer. Report commands, hashes, negative outcomes, review evidence, repairs, changed paths, and limits without claiming GUI painting or editor undo.

## Exit Criteria

Every required stage and coverage item has actual native and independent visual proof, all honest-hash and lifecycle controls reject their intended defect, and exact immutable publication is functional. No altered original, old output, source-assets file, or unrelated dirty path exists. The finalized CLI/report contract is ready for a thin bridge.

Root persists the implementation report, actual independent phase PASS, and truthful changed paths in reviews, then commits owned changes. No generated-plan Sprint execution record is claimed. Phase 03 remains blocked until this complete gate passes; no coverage reduction or automatic visual approval is permitted.
