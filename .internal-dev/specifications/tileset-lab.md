# Tileset Lab

Status: accepted implementation contract for the hybrid package and additional native painting visual-validation requirement. Ownership: `.internal-dev/specifications/tileset-lab.md` in `/home/dhickel/AI/Workspaces/Pi-extensions`. Implementation and actual artwork approvals are evidenced separately; this specification does not claim completion.

## Purpose

Provide a reusable Pi package containing deterministic Python tileset algorithms, a progressively loaded authoring skill, and a thin TypeScript bridge. Deliver inspect, guarded build, native render, and validation operations for independently authored consumer projects. Usable terrain requires independently reviewed source artwork, correct incremental native painting, exact native pixels, and independent visual confirmation.

## Intended Contract

The following ownership, profile, inventory, art-review, generation, native-painting, publication, and Pi boundaries define the accepted package. The four ordinary phase files under `plans/tileset-lab/` refine accepted prose; they are not a generated advanced-planning bundle.

## Ownership

- Package code and distributable synthetic CC0 fixtures: `tileset-lab/` beneath the extension repository. Installation paths locate scripts and resources, never consumer artwork or catalogs.
- Consumer data: an explicit canonical `--project-root` owns its manifest, original sources, license records, source inventories, catalogs, frozen artwork references, approvals, scene data, candidates, evidence, and approved-output selector.
- Living specification and index: this class and `.internal-dev/specifications/index.md`, maintained by the root using the actual trusted target's `internal_dev` workflow for new records.
- Durable tradeoffs: append only the owned new entry to `.internal-dev/specifications/decisions.md`; preserve its unrelated dirty hunks.
- The existing `/home/dhickel/Assets/tilesets` consumer remains read-only. Do not replace its maps, TSX files, original art, catalogs, inventories, or asset manifests.

## Supported source profile

The initial backend explicitly declares `quarter-corner-v1`: finite orthogonal maps with square 16px or 32px cells and unchanged half-cell source quarters. This is a supported conversion profile, not an atlas classifier. Tiled supports corner, edge, and mixed terrain sets, including reduced blob sets; those capabilities do not expand this backend's accepted scope.

Every terrain family declares its source, cell size, materials, opaque/alpha mode, and all 14 full-source role coordinates. Coordinates are absolute source-cell `[x,y]` values, not origin-relative guesses:

1. `background`, `solid`;
2. `convex-NW`, `convex-NE`, `convex-SE`, `convex-SW`;
3. `edge-N`, `edge-E`, `edge-S`, `edge-W`;
4. `concave-NW`, `concave-NE`, `concave-SE`, `concave-SW`.

Require exact role coverage, valid integer coordinates, bounds, and independent approval. Repeated identical artwork is allowed when explicitly reviewed. Never infer the existing consumer's 5x7 geometry, three packs, 54 original files, 22 PNGs, or family counts. No quarter trimming, scaling, flipping, rotation, palette segmentation, or synthetic transparency is allowed.

Use shared-vertex mask bits `NW=1, NE=2, SE=4, SW=8`. Output quarter sampling follows the verified opposite-phase/inward source-quarter geometry; masks 0 and 15 retain complete original background and solid tiles. Record original source rectangles and destination rectangles for every generated quarter. Components declare complete pixel `[x,y,width,height]` rectangles rather than flattened cliff fragments.

Opaque terrain uses explicit Wang colors 1/2 and seeded material layers. Background repaint selects color 2 and never clears cells to null. Alpha terrain uses authored alpha, colors 1/0, and null for mask 0. Include no all-zero artwork candidate; every nonzero terrain candidate must contain visible authored artwork. Sparse alpha foregrounds are valid and must not be rejected by a solid-fill heuristic. Directional transformations are disabled. Each supported nonempty mask has exactly one candidate.

## Constraints

Preserve originals and prior approved outputs. Use explicit consumer-local data and supported geometry only, with independent source and native visual gates. The detailed constraints and failure criteria below remain mandatory; difficulty does not permit deferred behavior or a weaker proof.

## Manifest, inventory, and animation

Use a versioned, closed manifest with explicit profile, cell size, packs, source files, catalogs, inventories, licenses, frozen references, review locations, scene inputs, owned output root, Python executable, and existing Tiled runtime location. Reject unknown fields, unsafe identifiers, path escapes, symlink traversal, malformed geometry, ambiguous roles, duplicate identities, and unsupported profiles before generation.

Original source inventories are closed records of relative paths, byte sizes, SHA-256 digests, PNG dimensions, and associated license records. Include non-PNG originals and help/license files where declared. Unexpected, missing, renamed, or changed originals fail validation. Inventory initialization is an explicit inspect/authoring step, never automatic rebaselining during build or validation. Protect catalogs, frozen art, approvals, and originals from output-path aliasing and concurrent replacement.

Register source atlases and complete sprite frames in external TSX files. Frame geometry may be nonsquare and independent of terrain cell geometry. Require explicit ordered nonempty frame slots, valid complete-frame rectangles, positive integer durations, and validated aliases to registered nonempty frames. Empty authored-alpha slots remain excluded. Materialize 100ms as an explicit authoring default, not a claimed source frame rate. Preserve supplied variable timings and non-row-major frame order. Support inventory/playback galleries and exact native animation checks at elapsed-time boundaries: Tiled 1.12.2 advances only when `elapsed > current_duration`.

## Independent source-art gate

Inspection creates an **UNAPPROVED** source packet containing original full sheets, full-cell role crops, coordinates, material context, license references, and original/frozen/catalog/tool hashes. It must not create an approval or mark source selection correct.

An independent image-capable reviewer inspects all 14 roles for every family. The review binds each full-source crop to its original and frozen visible RGBA pixels, source-cell coordinates, source digest, catalog digest, packet/page digests, tool digest, reviewer identity, semantic observations, and verdict. Canonicalize hidden RGB only where alpha is zero for visible-pixel comparison; retain file hashes for byte identity. The reviewer distinguishes islands, edges, concave holes, materials, density, and sparse authored alpha in full-source context.

Build checks approval completeness and freshness, verifies the original/frozen correspondence, and compares full role artwork before normalization. Missing, stale, duplicate, partial, negative, or author-fabricated approval is **BLOCKED**. Do not refresh frozen art from current recipes. A source/catalog/tool change invalidates affected approval. Production guard tests may use clearly identified test trust records; those records never count as actual independent source review.

## Generation and editable outputs

Produce a root `.tiled-project`, relative-reference external TSX files, source/frame registrations, normalized terrain atlases, complete component stamps, provenance traces, and finite editable TMX maps. Include source inventory/playback, terrain-pattern, and complete-parts galleries plus consumer-authored scene demonstrations.

Scenes are finite vertex-field and placement data, not a scene-authoring framework. Validate field dimensions, material assignments, component/frame identities, complete geometry, draw order, effective visibility, nonempty original alpha, and final non-occlusion. A serialized but hidden or fully covered required entity does not satisfy gallery or scene coverage.

## Native painting proof

Use the already installed Tiled 1.12.2 AppRun on the proven Linux x86_64/xcb/display route. Never download or install a runtime. Preserve caller `XDG_CACHE_HOME` so runtime lookup remains valid; isolate run configuration and data in owned locations, remove incompatible host Qt plugin overrides, and require an authorized existing display. Hash runtime content and record platform, tool, and dependency identities, not only a version string or launcher path.

Each family/mode executes actual `TileLayer.wangEdit`, `setCorner`, and `apply` on a finite 12x12 tile canvas with shared vertices 0 through 12 inclusive. Critical incremental tests set `correctionsEnabled=true` and `erasingEnabled=true`, matching stock brush defaults. Opaque B is color 2; alpha B is color 0. Expected vertex fields are computed from independent gesture intent, not native tile IDs or generated atlas data.

All case groups, orientation/width expansions, meaningful saved gesture stages, boundary clipping, and inverse-stroke behavior in `phase-02-native-draw-validation.md` are mandatory. Keep all 16 masks, all 512 3x3 vertex neighborhoods per mode, all 81 partial corner constraints per mode, exact source geometry, and negative controls. Dense full-field assignment is supplemental, not a substitute for incremental painting.

Save and read back each meaningful intermediate native TMX and its actual tile IDs, tileset identities, flags, external references, layer state, and expected vertex field. Check both visibility and pixels. A failed native match that preserves an old tile is failure, not success because the cell is nonempty. Native scripting can throw and exit zero: scan the complete log for errors anywhere, require one unique terminal run-specific PASS sentinel, and read back the complete expected artifact inventory.

## Four proof layers and review coverage

1. **Intent:** independent semantic field schematics and ordered stroke recipes.
2. **Source:** reviewed full-source roles and independently frozen original artwork.
3. **Native:** actual serialized native results and exact native RGBA against independent reconstruction from frozen original roles, never generated tiles as the expected oracle.
4. **Visual:** another reviewer actually opens every required case/stage image and prescribed crop, compares intent and source evidence, and records semantic findings.

Pixel composition must reproduce Qt's exact uint8 premultiplication, rounding, SourceOver, and visible RGBA semantics without tolerance. Retain native unannotated PNGs separately from schematic/expected/source pages. Paginate stage galleries to at most 2000 pixels in either dimension, with nearest-neighbor integer zoom and checkerboard plus ground context for alpha. A single montage is insufficient. Bind static components, animated frames/playback, source galleries, and editable scenes into visual coverage as well as draw stages.

Every actual visual-review entry identifies consumer/family/mode/case/stage or gallery context, exact viewed PNG and crop/page SHA-256 values, source approval, expected field, stroke recipe, tool/dependency/runtime content hashes, TSX/atlas/native TMX/log hashes, reviewer identity, observations, and PASS/BLOCKED verdict. The expected inventory comes from the independent case/gallery declaration, not the entries supplied by a reviewer. Require exactly one current entry per expected item. Missing images, unavailable vision, stale/missing/negative/duplicate entries, or forged partial coverage block approval. JSON validates coverage and provenance; it does not prove a person or agent viewed artwork. No backend may auto-generate a visual PASS.

## Candidate lifecycle and publication

The lifecycle is guarded source build, stable candidate, native render/validation, independent visual review, and exact-bundle publication without rebuilding. Keep the candidate at a stable consumer-local path; review the same relative-reference payload that will be selected. Freeze its payload/evidence hash inventory before visual review. Store reviewer records and a selector receipt outside the inventory's self-referential hash boundary.

The receipt binds the complete output inventory, source approval, source/catalog/tool/runtime/dependency content identities, every required review entry, and validation evidence. Rehash protected inputs and candidate outputs immediately before publication. Publication only updates an approved selector to the exact immutable bundle; it never regenerates or edits reviewed pixels. Keep original inputs, previous approved outputs, and their selector unchanged on missing proof, mismatch, cancellation, process failure, partial staging, or rejected review. Report ownership uncertainty instead of deleting foreign files. Do not claim crash-atomic mutation across arbitrary paths.

Serialize complete multi-file inspect/build/render/validate/publication mutations per canonical consumer root with cross-process ownership. A process-local per-file SDK mutation queue is not this transaction. Validate realpath/symlink boundaries and write ownership both before and during mutation. Caching, if used, is limited to immutable results keyed by complete content identities and current approvals; mtimes do not establish trust.

## Pi bridge and authoring skill

Register exactly `tileset_inspect`, `tileset_build`, `tileset_render`, and `tileset_validate`. Define the Python CLI arguments/report once after native proof and map TypeBox parameters to that contract. Use real installed SDK APIs, `outputSchema`, matching `structuredContent`, bounded model-facing `content`, artifact/log paths in `details`, and correct `isError`. Validation and inspection may write evidence and therefore must not advertise themselves as universally read-only.

The bridge invokes non-detached Python without a shell. Python establishes its own process group before it can spawn descendants; no unsafe post-spawn race is acceptable. Cancellation handles already-aborted signals, initialization races, TERM/grace/KILL escalation, pipe drainage, descendant termination, and awaited exit before returning. Do not depend on arbitrary child `session_shutdown` hooks or repair upstream issue #2. Stream logs to size-bounded owned files, enforce bounded JSON report size/shape, and return genuine failure data without publication.

Manifest resources are `pi.extensions: ["./index.ts"]` and `pi.skills: ["./skills"]`. Imported host-provided `@earendil-works/*` packages and `typebox` belong in `peerDependencies` with `"*"`; do not bundle duplicate SDKs. Declare Python dependencies separately: Pillow >=10.1 and NumPy >=1.26. Never auto-install Python, npm, system, or Tiled dependencies.

A kickoff command resolves the actual `skill:tileset-authoring` identity and source through `pi.getCommands()` and sends it using `pi.sendUserMessage(..., {expandPromptTemplates:true})`. Command context does not have tool-context `executeTool`. Missing or conflicting discovery is failure, not silent dispatch to another skill.

The skill owns iterative source authoring and draw/art review gates, using existing scoped Subagents rather than a second manager. Check actual image capability and image access; a missing capability is BLOCKED unless the user explicitly approves another route. No detached jobs, browser, GUI automation, custom TUI, global configuration dependency, or new worker framework is required.

## Model and execution policy

This hand-authored plan implements the accepted prose proposal; it is not an autonomous Sprint Planner planning run. Structural validation does not turn it into a configuration-resolved advanced-plan input. Root uses other-input-forms orchestration with this explicit user routing override and persists independent phase evidence in reviews, without claiming a frozen Sprint execution record. All four phases are unsplit; numbered implementation groups do not create lettered subphases. The explicit **USER OVERRIDE** fixes every used implementer, validator, art reviewer, integration reviewer, and senior escalation to caller `openai-codex/gpt-6.1-sol:max`. Do not resolve routing from fallback configuration or silently change model/thinking. Verify the effective inherited tuple. These are user-directed inheritance values, not configuration-resolved or plan-owned tuples. Formal six-file advanced-plan drafts remain temporary and are not the published execution contract.

All four ordinary phases run sequentially, with one inherited implementation session per unsplit phase. No unused basic profile is activated. Every phase receives independent full-edit review-and-repair and actual `VERDICT: PASS` before a dependent starts. If a repairing validator changes artwork it authored or selected, another inherited reviewer must approve that changed art. Final integration has the same repair-and-PASS gate, followed by root confirmation.

## Validation and distribution acceptance

Run Python unittest, strict TypeScript NodeNext typecheck/check, node:test, focused failure/edge controls, actual installed-SDK discovery/registration/calls for all four tools, and complete native/visual proof. Two independently authored consumer fixtures cover 16px and 32px cells, opaque and sparse authored-alpha families, shuffled role coordinates, two nonsquare sprite geometries, true empty slots, non-row-major frames, aliases, variable 70/130/40ms timings, and materialized default 100ms timings. Production guards stay active without mocks.

Verify relocation, unrelated cwd, protected-input preservation, prior approved output preservation, cancellation/no-worker-leak controls, malformed/oversized reports, publication failures, original changes, honest-hash wrong geometry/native/alpha negatives, and complete review rejection controls. Inspect a real package archive for code and synthetic CC0 fixtures only. Distribute no RPGW original, derived, frozen, crop, or contact-sheet artwork.

An optional focused RPGW regression uses consumer-owned `/tmp` copies and dedicated outputs only. Preserve all 54 original hashes and the existing 28 TSX/280 TMX inventory; those are regression observations, never portable defaults. Complete README procedures, sample manifest, review examples, reproduction commands, dependency/runtime checks, painting semantics, and native capability limitations are required.

User-scope local-path Pi installation may occur only in the later authorized implementation, using the Pi CLI and preserving other settings. No install is authorized during drafting. Branch/commit/merge actions likewise belong only to later implementation: use `sprint/tileset-lab` from supplied baseline `dd12f850427e19bab948a1c558abad4bc8264c72`, preserve eight modified and three untracked existing paths, and commit only owned paths/new hunks after each PASS. No blanket staging or push before full integration.

## Decisions

Append a durable decision selecting the hybrid skill/Python/thin-TypeScript boundary. The skill supplies pack-local authoring judgment; Python preserves proven pixel and native-validation behavior; the bridge supplies bounded typed invocation and cancellation. Reject a TypeScript pixel rewrite and a skill-only interface for this accepted scope. Caveats are explicit finite corner support, consumer-local licensed art, independent source and draw visual gates, invocation-owned processes, and the proven Tiled platform. Link this specification, the new plan, and the completed research assessment. Review when supported profiles, publication, runtime ownership, or distribution boundaries change. This decision does not amend Sprint Planner model configuration.

## Validation

Complete the validation and distribution acceptance above and every criterion in the four ordinary phase files, including full production-guard fixture builds, native every-stroke rendering, independent image-based approval, all rejection/lifecycle controls, strict TypeScript and Python suites, actual Pi SDK calls, relocation, packaging, and final integration review-and-repair. Root records actual evidence and never infers visual approval from this specification.

## Open Questions

No unresolved intent or architecture decision remains. Runtime/image access and actual source/native artwork approval are execution gates; report a concrete blocker if any is unavailable, without silently changing routing or acceptance.
