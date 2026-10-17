# Tileset Lab Research Assessment

Completed research assessment and implementation-contract handoff. This supersedes the **acceptance status**, not the historical evidence, of the source consumer's pre-proposal assessment. The user accepted its hybrid recommendation and added independent visual validation of native incremental painting. This review is published exclusively under the target repository's reviews store.

## Scope

Target: `/home/dhickel/AI/Workspaces/Pi-extensions`, with a new package proposed at `tileset-lab/`. `/home/dhickel/Assets/tilesets` is read-only extraction evidence and an optional later isolated regression consumer, not the implementation repository.

Research inputs comprise the user-supplied verified findings, `/home/dhickel/Assets/tilesets/.internal-dev/reviews/tileset-authoring-pi-packaging-assessment.md`, critical source geometry/native/runtime code and source terrain specification, target guides/specification index and relevant runtime/resource knowledge, installed Pi docs/examples/declarations, and the actual Sprint Planner deterministic validator plus valid test fixtures.

This drafting session performed read-only inspection and a deterministic in-memory plan-shape check. It performed no package implementation, native render, GUI session, artwork/image review, dependency installation, network operation, or Git command. Source-art approval and native/visual execution remain required implementation evidence, not claims of this assessment.

## Findings

### Accepted boundary

The accepted package is a hybrid: Python retains deterministic art/geometry/pixel/native-validation work, the skill supplies pack-local authoring and independent review, and a thin TypeScript bridge supplies four bounded typed operations. Those operations are inspect, guarded build/publication, native render, and validation. This is accepted scope, no longer an unaccepted architectural alternative.

The initial profile is explicitly finite orthogonal square `quarter-corner-v1` at 16px/32px. Tiled 1.12.2 supports Corner16, Edge16, and Mixed256, including reduced 47-tile blob sets; the backend's selected profile does not imply those other Tiled capabilities are impossible. No atlas guessing, edge/mixed/blob importer, automatic cliff construction, collisions, or engine integration enters this plan. The terrain-manual claim is supplied verified research; this session made no network request to re-fetch it.

The source consumer's `tools/build_project.py` confirms unchanged opposite-phase/inward quarter sampling, whole background/solid masks, explicit 1/2 opaque materials, authored 1/0 alpha, null empty overlays, disabled transformations, and complete pixel-rectangle components. Its `ROOT` from `__file__`, fixed 32px cell size, inferred 5x7 samples, and three-pack/count assumptions are extraction hazards, not portable contracts.

The initial reusable recipes declare all 14 full-source roles at absolute cell coordinates. `tools/source_geometry.py:ROLE_ORDER` and its full-source guard establish background/solid, four convex roles, four edges, and four concaves as independent artwork evidence. Generated quarters, Wang labels, and self-render equality are not an independent oracle.

### Evidence standard raised by source-consumer defects

The prior completed assessment records 16 bad Cave/Mountains concaves despite passing labels/native/output equality, followed by three Mountains density repairs. Its cited frozen artwork covers 924 roles across 66 families. Those counts describe historical evidence, not new-package defaults or autonomous classification capability.

The same assessment documents required entities hidden or empty despite serialized XML, incorrect directional captions, context-sensitive cave faces, and runtime/cache mistakes. Consequently the new contract separately requires effective visibility, nonempty original alpha, final non-occlusion, full-source review, and native visual review. A topology or exact pixel proof can still share the author's incorrect recipe; neither grants visual approval.

Inspection must produce an UNAPPROVED source packet. A reviewer independent of role selection approves every role/family using original full-sheet context and frozen full-cell art. Build compares protected originals and frozen approved geometry before generation; it never updates references to match new output. Test trust fixtures exercise the production guard but do not certify actual image review.

### Native painting is a separate deliverable

The prior `tools/native_terrain_test.js` exercises real `wangEdit`/`setCorner`/`apply`, actual IDs/flags, external TSX identity, unmatched old-tile behavior, and persisted native records. It does not establish the new complete incremental stock-default matrix. Its mixed opaque/alpha erasing settings and dense-field stages are not copied as sufficient evidence for the accepted new requirement.

The new proof uses 12x12 native tile maps with vertices 0..12, correction and erasure enabled for both modes, opaque B=color2, alpha B=color0, and persistent native state between meaningful strokes. The Phase 02 contract includes all 11 requested case groups, all orientation/one-/two-vertex width expansions, every meaningful intermediate save, explicit finite clipping, equivalent request paths, captured-prior-value inverse strokes, and complete stage/image coverage. Diagonal saddles are incremental clicks; the plan claims neither diagonal-drag GUI handling nor actual editor undo.

Finite native layers can hold out-of-range state. Workflow request/result clipping is therefore explicit, recorded, and tested, including all boundaries, entry from outside, wholly outside requests, and no interior wrap. The API itself is not represented as enforcing canvas bounds.

Four proof layers remain distinct: independent intent, reviewed full-source roles, exact actual native render, and actual independent semantic image confirmation. Native unannotated PNGs remain available separately from expected/schematic/source pages. Pages stay within 2000px per dimension using integer nearest-neighbor zoom and alpha checkerboard/ground contexts. Source/component/frame/playback/scene galleries receive coverage as well as draw stages.

Each actual review binds image/page/crop hashes, source approval, independent field/stroke recipe, executable/dependency/runtime content identities, TSX/atlas/native TMX/log hashes, reviewer identity, observations, and verdict. The expected inventory is derived from declared cases/contexts, not self-reported review totals. Missing images, unavailable vision, stale/missing/duplicate/negative review, or forged partial coverage is BLOCKED. JSON proves record coverage, not that artwork was viewed.

### Pixel, animation, and runtime contracts

Verified source validation uses exact Qt uint8 premultiplied SourceOver rather than Pillow tolerance. The new expected oracle reconstructs from frozen original roles and source rectangles, not generated tiles. Animation ordering uses positive variable durations and strict `elapsed > duration`; 100ms is an explicit authoring default, not inferred metadata. Fixtures include nonsquare complete-frame geometry, truly empty slots, non-row-major order, aliases, and ordered 70/130/40ms plus default timings.

`tools/tiled_runtime.py` confirms the proven existing AppRun route and the relationship to `XDG_CACHE_HOME`. The package must not copy its download/install path. It preserves caller cache lookup, isolates owned config/data, removes incompatible host plugin overrides, and requires the existing authorized Linux x86_64/xcb/display environment. This does not prove unsupported platforms or displayless use.

Native evaluation can throw and exit zero. The source validation specification requires an exact final sentinel and script-error rejection. The new gate strengthens this to errors anywhere, a unique terminal run-specific sentinel, complete stdout/stderr examination, and full expected native artifact inventory readback. Honest-hash wrong geometry, preserved old tiles, hidden art, boundary/wrap/previous-stage errors, incorrect repaint/erase/alpha, review coverage failure, original changes, and exit-zero late errors all receive controls.

### Mutation and process ownership

The accepted publication path is guarded source build -> stable candidate -> native/pixel validation -> independent visual review -> selection of the exact immutable bundle without rebuilding. A receipt binds complete payload/evidence hashes and protected input/review/runtime/tool identities. Failed/cancelled/partial work preserves originals and previous approved output. Review records/receipts are outside their own self-referential hash inventory.

Installed Pi docs distinguish process-local per-file `withFileMutationQueue` from cross-process build transactions. The package therefore serializes the complete multi-file consumer operation by canonical root, guards symlinks/aliases, stages safely, and removes only proven owned entries. It does not claim impossible crash atomicity across arbitrary paths.

The prior assessment identifies missing arbitrary extension `session_shutdown` emission in inspected child teardown and links upstream issue #2. It establishes an omission, not an observed orphan process or a Pi SDK defect. This package does not repair that dependency: Python is invocation-owned and non-detached, establishes a group before descendants, and uses an acknowledged startup/cancellation protocol with TERM/KILL and awaited exit. Real cancellation plus harmless PID-tracked lifecycle controls must validate that ownership.

### Pi package integration

Installed package docs require package-relative resource paths and wildcard peers for imported host-provided `@earendil-works/*`/`typebox`, without bundled duplicate SDKs. Python requirements are separate: Pillow >=10.1 and NumPy >=1.26. Local-path packages load in place; no automatic setup is authorized.

Installed extension declarations confirm `outputSchema`/`structuredContent`, content/details, and `isError` semantics. `executeTool` belongs to tool context, not command context. The kickoff command discovers exact `skill:tileset-authoring` identity/source with `pi.getCommands()` and sends it with prompt expansion through `pi.sendUserMessage`. Actual SDK registration/calls and authoritative skill discovery are required, rather than a model's self-report or fake registration object.

Existing Subagents support caller inheritance, exact tool allowlists, an eight-agent tree cap, and one opt-in nested layer. Reuse them; no second manager or detached worker system is justified. Check actual image capability/access instead of model-name inference. For this job every used agent inherits `openai-codex/gpt-6.1-sol:max` by explicit USER OVERRIDE, including senior assistance. No route is config-resolved, changed in fallback configuration, or silently substituted.

### Temporary deterministic plan shape and artifact classification

Direct inspection covered:

- `sprint-planner/validation.ts`: required concepts/phase headings, exact six orchestration sections, ledger/dependency/target/wave cross-consistency, model parsing, optional configured-profile equality, and read-only directory inspection.
- `sprint-planner/test/core.test.ts:phaseMd`, `orchestrationFor`, the orchestration-semantics test, and the read-only inspector test: actual valid fixture syntax and successful arbitrary-tuple validation when no expected configured profiles are supplied.
- `sprint-planner/index.ts:sprint_validate_plan`: actual trusted cwd, canonical project-relative path checks, and `inspectPlanDirectory(resolved, projectRoot)` without configured expected profiles.
- `sprint-planner/execution-records.ts:snapshotSourcePlan` and `freezeOrchestration`: immutable source snapshot and plan-owned tuple freezing without fallback configuration.
- `sprint-planner/types.ts`: `PLAN_VALIDATION_RESULT_VERSION=1`, `EXECUTION_RECORD_VERSION=2`, four-phase-compatible medium scope budget, and exact orchestration headings.

The six planning drafts passed actual `validateDraftPlanShape`, `inspectPlan`, `validateOrchestration`, `validatePhase`, and `parsePlanModelAssignments` using the installed repository code. Inspector result: version 1, `valid=true`, four contiguous phases, four sequential waves, medium scope, no findings. Every phase assignment and validation is `openai-codex/gpt-6.1-sol:max`. The distinct basic high tuple is unused syntax only; no worker or preflight uses it.

The planning preflight assumed validator v2. Actual inspected code versions the validator result as 1 and durable execution records as 2; do not invent a validator-v2 tag. This is not a tuple-representation impasse: the public validator and execution snapshot support the hand-authored override. Autonomous configured planning would reject it when expected profiles are supplied and is not part of this workflow. This temporary deterministic result is not a live advanced-plan PASS and does not govern execution.

Root subsequently inspected `internal-dev/core.ts`: every generic plan artifact requires seven canonical H2 headings, while Sprint Planner requires exactly six different orchestration H2 headings. Publishing orchestration as a generic plan is the wrong classification. A senior advisory confirmed raw-input orchestration is permitted: publish only the four ordinary phase plans, the normalized new specification, and this review through actual internal_dev. Keep formal concepts/orchestration drafts temporary; do not alter either upstream contract, claim configuration resolution, or fabricate a frozen execution record. This mismatch alone does not establish a supported upstream product defect.

The actual target-bound registered-validator bootstrap was exercised only to its expected missing-directory rejection with zero model/network requests and awaited shutdown. No live advanced-plan acceptance or execution start occurred. Actual phase implementation and independent PASS evidence will be published in reviews.

### Preservation and distribution

The supplied baseline records HEAD `dd12f850427e19bab948a1c558abad4bc8264c72`, eight modified files, and three untracked changelogs. Read-only SHA checks confirmed all 11 baseline files and index bytes unchanged after drafting the plan. No Git command ran. Later branch/phase commit/final merge work must preserve these edits; the root may append/stage only its new accepted-decision hunk in the dirty decisions file.

The package distributes code and newly authored synthetic CC0 fixtures only. Commercial RPGW original, derived, frozen, crop, and contact-sheet art stays consumer-local. The supplied license assessment is not a new legal determination; excluding such art is the accepted packaging boundary.

Two independent consumers, production guards without mocks, actual source/draw/art reviews, relocation/unrelated cwd, complete negative controls, real SDK calls, and archive-content inspection establish new-package portability. Optional RPGW regression remains in consumer-owned `/tmp` outputs and preserves all 54 originals and existing 28 TSX/280 TMX counts. Those observations never become fixed package defaults.

## Risk Assessment

| Risk | Required control | Completion evidence |
|:---|:---|:---|
| Correct labels share an incorrect source recipe | Independent all-role original/frozen source approval | Actual viewed full-source hashes and semantic role observations |
| Dense solver proof hides incremental failures | Complete stock-default gesture matrix and intermediate persistence | Every expected stage's actual IDs/flags/TMX/PNG/log |
| Exact pixels still look semantically wrong | Independent intent/source/native visual comparison | Complete current case/stage/crop and gallery review coverage |
| Boundary edits escape finite canvas | Explicit request/result clipping and raw-API control | Finite extent, preserved inside native state, no outside/wrap leakage |
| Approval copied to changed inputs/tool/runtime | Content-bound review/receipt freshness | Protected-input and complete output rehash before selection |
| Cancellation returns while descendants can publish | Python-owned group startup, TERM/KILL, awaited settlement | Real and dummy PID/group tests with old selector unchanged |
| Package works only in the original consumer | Two independently authored 16px/32px consumers | Full production end-to-end proof without mocks plus relocation |
| Archive leaks licensed art/private data | Explicit file boundary and actual archive inspection | Complete entry/byte audit with synthetic CC0 fixture provenance |
| Executor silently uses configured models | Plan-owned explicit USER OVERRIDE and no autonomous route | Effective inherited tuple, readiness checks, and independent phase evidence |

## Recommendations

Execute the four contracts sequentially, with full-edit independent phase review-and-repair and actual PASS before every dependent. Preserve separate independent source/art approval when a repairing validator selects artwork. Perform a separate full-edit integration PASS and root confirmation before completion.

Root exclusively publishes the living specification, four ordinary phase plans, and completed assessment, updates the index, and appends the accepted hybrid tradeoff without changing Sprint Planner configs. It then uses the actual registered read-only validator in the actual trusted target cwd. The authoritative input is accepted prose rather than a generated advanced-plan directory: root follows other-input-forms orchestration, persists actual implementation and independent PASS evidence in reviews, and claims no frozen Sprint execution record. The deterministic draft check does not replace actual runtime trust/publication or later application proof.

No accepted feature is a stub, placeholder, postponed phase, or optional shortcut. Senior assistance uses the explicit inheritance override when failures or contradictions block progress. Report a concrete external blocker rather than weaken native/visual or ownership acceptance.

## Follow-ups

- Root publishes these temporary drafts using actual `internal_dev`, not ordinary writes to `.internal-dev`; then follows raw-input orchestration with four ordinary phase plans and begins authorized implementation.
- Implementers verify runtime/dependency/display/image capability and actual source coordinates through the specified workflow. These are execution facts, not unanswered user-intent questions or permission to auto-install.
- Root records reusable geometry/native/Qt/timing/process/discovery/publication lessons in target domain knowledge and maintains specification/index/decision/closeout records during implementation.
- After complete integration, root performs authorized user-scope local-path Pi installation, verifies fresh discovery, and completes safe owned branch/merge work without discarding existing dirt. No installation or Git action occurred in drafting.

No unresolved scope or architecture choice remains. Runtime capability/access and future source-art approval remain genuine execution gates. If the actual published-plan tool unexpectedly requires configured-profile equality or another route, return its exact diagnostic and block; do not fabricate metadata or modify fallback configuration.
