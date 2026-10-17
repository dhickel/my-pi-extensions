# Phase 04: Integration and Visual Proof

## Context

Phases 01..03 deliver the core, complete native/visual publication gate, and real Pi integration. Passing their focused tests is necessary but not sufficient for portability, independent artwork, distribution safety, or final installation acceptance.

Run full production end-to-end proof for two independently authored consumers, then a separate integration review-and-repair after this phase PASS. All used agents inherit `openai-codex/gpt-6.1-sol:max` under the USER OVERRIDE; no unused-basic, configured fallback, alternate vision route, or weaker integration model is allowed.

## Goal

Validate two independent consumers and the installed package with final visual proof and integration repair

## In Scope

**Write Targets**: tileset-lab, .internal-dev/specifications/tileset-lab.md, .internal-dev/specifications/index.md, .internal-dev/knowledge/tileset-lab.md

Own consumer fixtures, complete proof and documentation, package/runtime/install validation, and any in-scope package repairs needed to satisfy the whole accepted contract. Root exclusively creates persistent knowledge/review/changelog records and preserves existing dirt. Optional RPGW regression outputs are isolated in consumer-owned `/tmp` projects, never the existing source-assets outputs.

## Out of Scope

No additional terrain profiles/features, UI framework, lifecycle issue #2 repair, dependency provisioning, licensed artwork redistribution, original-art or old consumer-output mutation, system-wide software installation, push before integration, or unrelated dirty cleanup. Do not treat historical RPGW evidence as the new consumers' proof or accept test trust fixtures as actual image review.

## Dependencies

phase-03-pi-skill-and-tools.md

## Constraints

- Every criterion applies to actual production runtime with guards enabled and without mock source approval, native solver, render, review coverage, SDK dispatch, or publication.
- Two independently authored consumers cover 16px and 32px terrain cells, each with opaque and sparse authored-alpha families. Authors may reuse schema, not pack-specific source-role placement or a generated atlas as expected art.
- Actual source and draw/art reviewers are other inherited agents, independent of role/fixture selection. A validator who changes art cannot approve its own changed selection.
- Output candidates/evidence remain consumer-owned and immutable after approval. Keep original inputs, previous approved selectors/bundles, caller cache settings, and source-assets files unchanged across rejected operations.
- User-scope local-path installation is a later authorized implementation action, not a drafting action. Use Pi CLI only, preserve all unrelated settings, and do not install Python, npm, Tiled, or system dependencies implicitly.

## Implementation Steps

### 1. Independent consumers through the full workflow

1. Confirm the two consumers are independently authored synthetic CC0 art/data, not copied RPGW role coordinates, derived pixels, or a repackaging of one atlas at a different scale. Use different role placement, material texture/contours, source inventories/licenses, frame geometry, components, and finite scene data. Record fixture authorship and hashes.

2. Each consumer contains a full 14-role opaque family and full 14-role sparse-alpha family with shuffled absolute source-cell coordinates, complete pixel components, complete source/parts/terrain/playback galleries, and editable finite vertex-field scenes. Across the pair cover two nonsquare sprite geometries, true empty slots, non-row-major frame order, nonempty aliases, ordered 70/130/40ms durations, and materialized 100ms defaults.

3. Start from unapproved manifests/inventories/catalogs. Run actual inspect to create UNAPPROVED packets. A different inherited image-capable reviewer reads every full-source role/context and issues actual source approval with identity, observations, and viewed-image hashes. Test trust records must remain explicitly test-only and unusable as a claim of actual review.

4. Run real guarded build, native render/validate, every drawcase orientation/width/stage, all topology/partial/source checks, animation-boundary probes, and source/component/frame/gallery/scene contexts. No mock or guard exemption. Compute expected art independently from reviewed frozen originals.

5. A different inherited reviewer actually opens every required native stage/page/crop and gallery/playback/source context, compares independent intent and original source, and records semantic findings. Missing vision/images or negative/stale/partial review is BLOCKED, even with exact generated/native equality.

6. Publish only the exact frozen candidate through the production receipt/selector path, without rebuilding. Verify complete payload/evidence hashes before and after selection and confirm external relative references still load from the selected stable bundle.

### 2. Relocation, protected state, and end-to-end negatives

1. Relocate the installed package and each consumer independently; invoke from an unrelated cwd. Assert explicit-root data discovery, package-relative script lookup only, valid TSX/TMX/root-project references, preserved frozen/source approvals under content identity, and no fallback to the source-assets root or package directory as data.

2. Compare pre/post complete protected original/source/license/catalog/frozen/review inventories and old approved output/selector. Test missing/unexpected/changed originals, unsafe output roots, symlink alias/escape, relocated unsafe references, and concurrent cross-process same-root operations. Fail without rebaselining or damaging prior approved state.

3. Repeat honest-hash geometry/native/visibility/boundary/stage/repaint/erase/alpha controls through the public tools. Include concave/island confusion that label/self-render checks cannot catch; missing candidate preserving old tiles; hidden/empty/occluded required art; boundary orientation/wrap; stale previous-stage substitution; opaque-null repaint; alpha erase affecting ground; and actual zero-exit native errors anywhere in the log.

4. Reject missing/stale/negative/duplicate review, a forged partial-coverage ledger, missing image, missing/duplicate final sentinel, incomplete native inventory readback, malformed/oversized reports, log overflow losing required proof, changed tool/dependency/runtime identity, and changed original art. Verify rejection is for the intended semantic/coverage failure, not an incidental dishonest digest.

5. Force partial staging/write failure, review refusal, cancelled render/validate/build/publication, already-aborted startup, group-readiness race, TERM-resistant dummy descendants, and KILL cleanup. Prove awaited owned exit, no worker leak, no late successful publication, unchanged prior selector/bundle, and no lock theft. Dummy tests complement actual runtime cancellation; they do not replace production native proof.

6. Keep required matrix inventories complete after repairs. Any repaired executable/source recipe/art invalidates its affected source/native/visual/receipt proof; regenerate and independently re-review the final changed identities.

### 3. Actual SDK, archive, and installation acceptance

1. Run strict TypeScript NodeNext typecheck, node:test, Python unittest, combined package check, and actual installed-SDK smoke using isolated trusted consumer contexts. Load through real package discovery, inspect registered schemas/provenance, bind the actual runtime, and call all four registered tools. Validate `outputSchema`, `structuredContent`, content/details paths, correct `isError`, actual native results, and cancellation/failure publication handling.

2. Discover `skill:tileset-authoring` with authoritative installed SDK/RPC command provenance and test `/tileset-lab` dispatch of that exact identity with prompt expansion. Verify command context does not execute tools directly and that noninteractive tools work without a browser or custom TUI. Test missing/colliding/untrusted resources explicitly.

3. Create and inspect an actual local package archive using the existing package tooling without network, lifecycle hooks, or dependency installation. Check its complete contents and metadata. Include package code, Python/native resources, skill references, documentation, and independently authored synthetic CC0 fixtures only. Exclude node_modules, caches, proof outputs, credentials, `.internal-dev`, RPGW originals/derived/frozen/contact assets, and consumer-local private data.

4. Validate the archive/local-path package resource discovery and runtime from a relocated package location, not just the repository source. Verify host-provided dependencies remain wildcard peers and no duplicate SDK/typebox copy is bundled. Verify declared Python requirements and the existing native runtime prerequisite fail clearly when absent without installation.

5. After full package/integration acceptance and the later implementation authorization, root installs the target local path with user-scope `pi install /home/dhickel/AI/Workspaces/Pi-extensions/tileset-lab`. Do not add `--local` when the requirement is user scope, and do not install Pi or other global/system software. Use the actual CLI, retain/compare unrelated settings, and prove the only intended user configuration change is this package declaration. Fresh discovery must show the four tools and exact skill source.

6. No installation runs during drafting. If the authorized implementation lacks the required user-scope access, report the concrete installation blocker rather than mark complete or substitute temporary SDK loading for installed acceptance.

### 4. Documentation, records, and optional original-consumer regression

1. Complete README procedures for source/licensing inventory, explicit manifest and project root, supported profile and role coordinates, 16px/32px geometry, source packet/review, frame slots/aliases/timing, components/scenes, four tools/CLI, skill kickoff, native draw/visual review, receipt publication, cancellation, reproduction, and failure diagnosis.

2. Provide a complete sample manifest and clearly labeled example review records with semantic observations and provenance fields. Examples must never masquerade as actual reviewer PASS for a user's art. Include exact working reproduction commands validated against the final CLI, report/log bounds, Python dependency checks, existing AppRun selection, `XDG_CACHE_HOME` preservation, isolated config/data, xcb/display requirement, and image capability gate.

3. Document that native proof covers scripting/API requests and exact rendered art, not GUI pointer gestures or editor undo. Explain one/two-vertex widths, stock-default correction/erase behavior, opaque background repaint versus alpha null erase, Manhattan line equivalents, click saddles, and explicit finite clipping.

4. Root updates the living spec/index for the delivered boundary, publishes completed reviews/changelog through actual `internal_dev`, and records reusable source/Qt/animation/native/lifecycle/publication lessons in domain-named `knowledge/tileset-lab.md`. Preserve all unrelated existing records. A finalized changelog includes the actual current HEAD at writing; do not invent a future commit hash.

5. If a focused RPGW regression is performed, use read-only sources and consumer-owned `/tmp` copies with dedicated new preview/output roots. Hash all 54 originals and the existing source consumer's full output inventory before/after. Its 28 TSX and 280 TMX counts must remain unchanged. Never rebuild the current maps, TSX, asset manifests, or approval references in place. This regression is optional and cannot replace the required two-consumer proof.

6. Review the final owned diff for scope, accidental API expansion, placeholders, fake approvals, licensed assets, and unrelated changes. Root verifies phase commits contain only owned paths/hunks. No `git add -A`, push, stash/reset of unrelated dirt, or surprise configuration/model changes.

## Required Guides

Read target project/specification guides, Tileset Lab spec, all four phase contracts, actual phase evidence, resource-discovery/child-session knowledge, installed Pi package/SDK/extension/skill docs and matching examples, and relevant source research. Persistent records and new class/index ownership follow actual `internal_dev` trust and exclusive creation. Use senior-agent under the explicit inheritance override for failed repair or unresolved technical contradictions.

## Technical Guidance

- Freeze complete final evidence only after code and runtime identities settle. Do not preserve an old source/visual approval by silently editing its tool hash to match new code.
- Archive inspection checks actual bytes/entries, not an optimistic `files` list or dry-run alone. Distribution rights of commercial artwork are not assumed from historical local use.
- Independent reviewers may share the caller model but not authorship of the recipe they approve. Bind identities and observations, not only a tuple string or generated PASS ledger.
- Final repair scope is the complete accepted package contract, not adjacent repository defects. Root protects the dirty decisions hunk and all unrelated baseline edits.

## Validation

The phase validator has full edit authority and owns in-scope repair. It independently checks actual repository/runtime state, both production consumers, all case/stage/art review coverage, every negative and failure path, packaging contents, actual SDK discovery/calls, documentation commands, and original/previous-output preservation. It reruns focused and full applicable suites after repairs and returns actual `VERDICT: PASS` or `VERDICT: BLOCKED` with evidence, viewed hashes, reviewer identities, repairs, and changed paths.

After this phase PASS, launch a separate independent full-edit **final integration** validator at the same inherited max tuple. It reviews the entire workflow, repairs in-scope defects, obtains independent review for any art it changes, reruns all affected/full checks, and returns actual PASS/BLOCKED. Root independently confirms its findings, final hashes, complete review inventory, runtime ownership, suite outcomes, archive contents, and user-scope installation evidence before reporting completion.

Only after final integration PASS does root perform the safe standard branch merge and allowed final installation/confirmation order. Verify that eight preexisting modified and three untracked paths remain intact; stage only owned paths/new hunks. An unsafe merge or unavailable required installation is a genuine blocker, not permission to discard dirty state. No push precedes full integration.

## Exit Criteria

Two independent consumers complete every real source/native/pixel/visual/publication guard, all specified negatives reject correctly, all four tools and the actual skill work in installed SDK/runtime contexts, the archive contains no commercial artwork, and final documentation/records are complete. Originals and old outputs remain protected, lifecycle ownership settles, and unrelated dirt survives.

Root persists the implementation report and actual independent phase PASS in reviews, then commits only owned changes. No generated-plan Sprint execution record is claimed. Final completion additionally requires the separate integration repair/PASS, root confirmation, authorized user-scope local-path installation and fresh discovery, and safe branch merge. No success claim is allowed while any required proof, repair, installation, or ownership check remains unfinished.
