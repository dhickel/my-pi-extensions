# Phase 03: Pi Skill and Tools

## Context

Phase 02 must have complete native/visual proof, exact-bundle publication, and a finalized CLI/report contract before this phase begins. The bridge wraps that behavior rather than reimplementing pixels, geometry, review decisions, or build transactions.

All package implementation, validation, review, and preflight workers inherit `openai-codex/gpt-6.1-sol:max` under the USER OVERRIDE. The package skill reuses existing Subagents with scoped grants; it does not consult Sprint Planner fallback routes or create a second manager.

## Goal

Deliver the complete thin Pi tool bridge and iterative authoring skill with owned cancellable runtime

## In Scope

**Write Targets**: tileset-lab/index.ts, tileset-lab/runtime.ts, tileset-lab/package.json, tileset-lab/tsconfig.json, tileset-lab/README.md, tileset-lab/skills, tileset-lab/test, tileset-lab/python, .internal-dev/specifications/tileset-lab.md

Implement the real four-tool bridge, invocation-owned subprocess lifecycle, bounded logging/reports, kickoff command, progressively loaded authoring/review skill references, package metadata, strict TypeScript/Python tests, and actual installed-SDK registration/discovery/tool-call smoke tests. Necessary repairs of the earlier Python boundary are in scope.

## Out of Scope

No new worker manager, detached jobs, run/poll/cancel product API, browser UI, required custom TUI, source classifier, dependency installer, TypeScript pixel duplication, or issue #2 repair. Do not call `ctx.executeTool` from command context or use a mock extension object as the only SDK acceptance evidence. Do not invent CLI argument names before inspecting the completed Phase 02 contract.

## Dependencies

phase-02-native-draw-validation.md

## Constraints

- Keep all code writes under the extension repository's declared paths and all consumer artifacts under an explicit canonical project root. Protect original/source/catalog/license/frozen/review data and previous approved output.
- Every operation that writes packets/evidence is honestly mutating. Do not advertise `validate` or `inspect` as read-only merely because their name sounds observational.
- Node spawns Python non-detached without shell interpolation. Python creates its own process group before descendants. Cancellation must await all owned work; no early return race is permitted.
- Reports/logs have documented byte bounds and owned paths. Bound disk output as well as model context, and fail closed on truncation that would lose required proof.
- Package root discovers scripts only. Consumer paths, per-root serialization, multi-file staging, review freshness, and publication checks stay in the Python production boundary.

## Implementation Steps

### 1. Exact CLI mapping and package registration

1. Read Phase 02's final CLI help/schema/report code and actual installed Pi exported declarations. Establish one operation mapping in `runtime.ts`; derive TypeBox argument constraints and tests from that completed contract. Do not create an independently drifting TS CLI schema or add unused operations.

2. Register exactly `tileset_inspect`, `tileset_build`, `tileset_render`, and `tileset_validate` in `index.ts`. Build supports guarded candidate generation and exact reviewed-candidate publication as mutually exclusive actions from the established CLI. Render produces real native artifacts; validate checks current source, native, pixel, coverage, and review evidence. No handler is a stub or a fake success report.

3. Require explicit project-root and manifest inputs. Map only validated arguments into Python argv arrays; reject unknown fields, shell metacharacter interpretation, unsafe paths, candidate/report traversal, unsupported operations, and ambiguous publication inputs. Resolve the Python entrypoint from the installed package and data from the consumer root.

4. Use TypeBox object parameter schemas with `additionalProperties:false`. If discriminated unions are needed, retain an explicit object root so providers receive a valid root schema. Define a bounded operation-result `outputSchema` covering successful and data-bearing failed results.

5. Return matching `structuredContent`, concise model-facing `content`, and artifact/log/inventory paths plus bounded status evidence in `details`. Failures carrying structured data use `isError:true`; do not report success because Python exited or returned a parseable object. Check abort/failure/approval status as well as exit code.

6. Create a private ESM package with `pi.extensions:["./index.ts"]` and `pi.skills:["./skills"]`. Imported host-provided `@earendil-works/*` and `typebox` belong in wildcard `peerDependencies`, never bundled runtime duplicates. Declare only imports actually used. Python requirements remain separate, with Pillow >=10.1 and NumPy >=1.26 and no automatic setup hook.

7. Add strict NodeNext/noEmit TypeScript configuration and package scripts for typecheck, node:test, Python unittest, and the combined check. Follow existing Node 24 source-test conventions where applicable; avoid unsupported strip-types syntax such as parameter properties. Missing tools/dependencies are explicit prerequisites, not install side effects.

### 2. Invocation ownership, process-group handshake, and bounded reports

1. Implement an internal invocation-owned startup path in Python before any native or helper descendant can start. Python creates a separate process group itself and reports its PID/PGID through a bounded readiness control channel. It waits for the parent to release execution before spawning descendants.

2. Node verifies readiness, stores the owned group identity, checks cancellation, then releases the worker. This prevents a ready/abort race from spawning untracked descendants. If aborted before readiness/release, terminate the Python process, continue reading any late readiness information, and await exit; do not assume an unresolved spawn has disappeared.

3. Once released, abort/timeout sends TERM to the owned group, allows a bounded cleanup grace, escalates to KILL when needed, and awaits Python exit, pipe closure, and descendant cleanup before returning. Handle already-aborted signals, spawn failure, handshake failure, abort during initialization, abort just after completion, repeated cancellation, and exceptions during cleanup. Do not use Node `detached:true` or rely on arbitrary `session_shutdown` hooks.

4. Keep Python descendants in that group. Capture actual owned PIDs/group evidence in tests and assert no surviving worker after completion, cancellation, failure, and forced escalation. If group ownership cannot be established or safely terminated, block rather than signal an unrelated process group or return success.

5. Stream stdout/stderr to invocation-owned log files, capped at 16MiB per stream. Bound retained progress updates to 4KiB and model-facing result text to 16KiB. Separate final JSON and readiness control records from ordinary logs. Report paths/overflow and progress through `onUpdate`; required native error evidence must never be silently dropped.

6. Cap the final JSON report at 256KiB before allocation/parsing. Validate its closed version/operation/identity/status/digest/inventory/path shape; bound arrays to 128 entries and paths to 4096 characters. Store complete case/output inventories in hashed owned files rather than unbounded inline arrays. Reject malformed, oversized, duplicate/extra or missing reports, wrong identity, and fake success. Log overflow that prevents complete native error inspection blocks proof/publication.

7. The Python boundary acquires whole-consumer cross-process serialization for multi-file mutations. Prove competing bridge/CLI calls cannot interleave packets, candidates, native output, reviews, or selector updates. Same-root symlink aliases cannot bypass locking; independent roots may proceed without shared package-local data.

8. Do not return cancellation or validation success while a worker can still publish. Failed/cancelled invocation paths preserve originals, the prior approved bundle, and selector. Cleanup removes only owned staging/log paths proven safe; retained failed evidence is reported truthfully.

### 3. Iterative authoring skill and exact kickoff discovery

1. Create `skills/tileset-authoring/SKILL.md` with portable matching name/frontmatter and a concise routing description for tileset conversion, Tiled terrain authoring, and source/native/art validation. Bundle progressive references for manifest/profile/source selection, role review, frame/components/scenes, native draw proof, review receipts/publication, runtime prerequisites, and reproducible commands.

2. The workflow explicitly stages inspect -> author catalog -> independent full-source approval -> guarded candidate build -> native render/validate -> independent every-stage visual review -> exact-bundle publication. Local affected-family iteration is allowed, but final full integration and complete coverage remain required. Never interpret a test trust record or topology PASS as actual art approval.

3. Reuse existing `subagent_spawn`/poll/status/cancel tools. Give each child a self-contained brief, exact input/evidence hashes, bounded domain, and complete ordinary-tool allowlist. Inherit caller model/thinking/cwd and verify the effective tuple; for this job it is the USER OVERRIDE max tuple. Poll all workers to terminal state, respect the existing eight-agent tree cap, and grant one nested layer only for a justified senior escalation.

4. Do not allocate a second `SubagentManager`, persist pretend resumable workers, or dispatch autonomous configured planning. Missing tools or exact inherited capability are BLOCKED. Senior assistance follows the loaded escalation workflow while honoring this explicit model/thinking override.

5. Check actual image input support and availability of the exact source/native images before review. Do not infer vision from a model name or a terminal PNG renderer. Missing capability/access blocks the gate unless the user explicitly authorizes another route. Reviewer records contain actual observations and viewed hashes, never automatically synthesized PASS.

6. Register one `/tileset-lab` kickoff command. Resolve `skill:tileset-authoring` using `pi.getCommands()` and verify the discovered source path belongs to this installed package. Dispatch that exact command plus user arguments with `pi.sendUserMessage(...,{expandPromptTemplates:true})`; choose valid queuing behavior when streaming. Missing skill, disabled discovery, collision, or wrong provenance yields a concrete error.

7. The command must not assume `ExtensionCommandContext` has `executeTool`. Any nested tool calls belong to tool context and eligible registered tools. Keep all behavior functional without a browser or custom TUI; text artifact paths are sufficient. Guard optional UI notifications by actual mode/capability.

8. Write complete README setup/usage for existing dependencies, explicit consumer roots, the supported profile, four tools, skill kickoff, source/visual approval, failure recovery, and native capability limits. No automated dependency install instructions run as package hooks.

### 4. Runtime and failure acceptance

1. Add node:test tests for argument mapping, schema bounds/object roots, `structuredContent`/content/details agreement, `isError`, path/provenance checks, logs/report overflow, serialization, native failure, approval rejection, and exact publication arguments. Add Python unittest tests for handshake/group ownership and production boundary behavior.

2. Use harmless PID-tracked Python dummy workers to prove early abort, pre-ready abort, release/abort race, TERM-resistant descendants requiring KILL, late report, malformed/oversized JSON, full pipes, abnormal exit, timeout, and no worker leak. Dummy workers test lifecycle only; they are not substitutes for the real backend/native production smoke.

3. Load the real package through the installed SDK's `DefaultResourceLoader`/actual extension runtime in an isolated trusted consumer context. Inspect actual registered tool schemas and source identities, discover the actual skill command, and invoke each of the four real registered tools through installed SDK dispatch/tool context. Capture hooks/results, not only calls to exported helper functions or a fake `registerTool` object.

4. Exercise real inspect/build/render/validate using the independently reviewed production fixture and existing native runtime. Validate exact `outputSchema` and results, correct error delivery, cancellation, and no failed publication. Reuse approved evidence only when complete content identities remain current; code changes may require actual fresh review.

5. Test actual `/tileset-lab` command discovery/expansion and source provenance. Verify untrusted/missing/colliding resources fail without hidden initialization or execution. Confirm SDK noninteractive behavior does not require TUI/browser capability.

6. Run strict NodeNext typecheck, node:test, the complete Python suite, and combined package check. The independent full-edit phase validator owns repair, reruns actual SDK and production checks, and returns actual PASS/BLOCKED with command/results, PID settlement, native/review hashes, changed paths, and limits.

## Required Guides

Read the target project/specification guides, Tileset Lab specification and completed Phase 02 CLI/evidence, relevant resource-discovery and child-session knowledge, and actual installed Pi docs for extensions, SDK, skills, packages, configuration/settings, and mode behavior. Read the matching checked SDK/extension examples and exported declarations before using exact runtime APIs. Follow related documentation paths under the installed Pi directory, not the repository cwd. Do not modify Sprint Planner or Subagents to accommodate this package.

## Technical Guidance

- `pi.exec` buffers and awaits completion; it is not streaming or detached ownership. Use an owned subprocess boundary where process-group cancellation and bounded streaming are required.
- Startup readiness is a lifecycle protocol, not a second worker system. Do not make it a speculative public API.
- Bind tool results to the actual consumer/candidate operation and revalidate output paths. A syntactically valid report from an unrelated directory is failure.
- Expose review/validation state honestly. Computational PASS and publishable visual approval are distinct values; no wrapper may collapse them into unconditional success.
- Preserve host-provided module identity and local-path package semantics. Do not rely on another package's undeclared dependency tree or install packages to make the smoke appear successful.

## Validation

The complete acceptance set is strict TypeScript NodeNext typecheck/check, node:test, Python unittest, malformed/oversized report and full-abort/no-worker-leak controls, production per-root cross-process serialization, real native failure/publication preservation, actual installed-SDK calls of all four tools, and actual skill discovery/kickoff expansion. All reviewed proof invalidated by phase repairs must be rerun before PASS.

The phase validator has full edit authority over in-scope code and owns repairs. Its `VERDICT: PASS` requires functioning behavior and actual runtime evidence, not compilation, fake registrations, or test-only approvals. If it authors changed art or output recipes, another inherited image reviewer approves those changes.

## Exit Criteria

All four tools perform their real operations, all owned process paths settle without publication races or leaks, report/log bounds and errors are correct, the actual installed SDK discovers/calls the package, and the skill enforces independent source/draw/art approval. No automatic installs, worker framework, unsupported UI requirement, source-assets edits, or unrelated dirty changes exist.

Root persists the implementation report, actual independent phase PASS, and truthful changed paths in reviews, then commits only owned files. No generated-plan Sprint execution record is claimed. Phase 04 cannot start before this gate.
