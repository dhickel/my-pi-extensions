# Advanced Plan Corrective Review Summary

## Scope

### concepts.md

Reviewed the supplied `concepts.md` against the authoritative extension-hardening handoff, focusing on ownership boundaries, cross-phase dependencies, settled constraints, and acceptance evidence. The review treats the following phase set as fixed and does not assess unprovided phase contents:

- `phase-01-deterministic-planning-contracts.md`
- `phase-02-planning-engine-reliability.md`
- `phase-03-run-leases-list-and-doctor.md`
- `phase-04-durable-execution-records.md`
- `phase-05-exact-subagent-tool-policy.md`
- `phase-06-subagent-results-and-shutdown.md`
- `phase-07-internal-dev-content-and-init.md`
- `phase-08-skill-policy-integration.md`
- `phase-09-specifications-docs-and-integration.md`

### orchestration.md

Reviewed the fixed nine-phase orchestration against the authoritative handoff and corrected concepts, covering scope classification, phase budget, ledger completeness, dependencies, write targets, waves, model routes, phase validation, and final integration.

### phase-01-deterministic-planning-contracts.md

Reviewed `phase-01-deterministic-planning-contracts.md` against the corrected concepts, authoritative orchestration ledger and wave, current sprint-planner code, the living sprint-planner specification, runtime knowledge, and Pi extension/tool contracts. The review covers scope, dependencies, one-agent ownership, implementation ordering, validation, and exit criteria only for phase 01.

### phase-02-planning-engine-reliability.md

Reviewed only `phase-02-planning-engine-reliability.md` against the corrected concepts and orchestration, including its Phase 01 dependency, wave-02 placement, declared write targets, one-agent ownership, ordered implementation guidance, validation, and completion conditions.

### phase-03-run-leases-list-and-doctor.md

Corrective review of `phase-03-run-leases-list-and-doctor.md` only against corrected `concepts.md`, authoritative `orchestration.md`, the current sprint-planner implementation, and required guides. The review covers boundaries, dependencies, single-agent ownership, orchestration consistency, implementation guidance, validation, and exit criteria.

### phase-04-durable-execution-records.md

Reviewed only `phase-04-durable-execution-records.md` against the corrected concepts and authoritative orchestration. The phase remains correctly assigned to wave-04, depends only on phase 03, preserves the declared write targets, and is cohesive enough for exactly one implementation agent.

### phase-05-exact-subagent-tool-policy.md

Reviewed only `phase-05-exact-subagent-tool-policy.md` against the corrected concepts and authoritative orchestration. The review covered its four declared write targets, dependency placement, wave compatibility, one-agent execution boundary, exact tool-policy semantics, implementation order, validation, and completion gate. No phase-file addition, removal, split, merge, rename, or target change is warranted.

### phase-06-subagent-results-and-shutdown.md

Reviewed only `phase-06-subagent-results-and-shutdown.md` against the corrected shared concepts, the authoritative orchestration, the current `subagents` implementation and tests, and Pi extension/SDK lifecycle contracts. The phase remains a cohesive one-agent change confined to `subagents/core.ts`, `subagents/index.ts`, and `subagents/test/core.test.ts`.

### phase-07-internal-dev-content-and-init.md

Reviewed only `phase-07-internal-dev-content-and-init.md` against the corrected shared concepts, authoritative orchestration, current `internal-dev` implementation and tests, the maintained internal-dev contract, and Pi extension lifecycle/tool-mutation guidance. The phase remains a dependency-free wave-01 unit with write targets disjoint from phases 01 and 05 and is cohesive for exactly one implementation agent.

### phase-08-skill-policy-integration.md

Corrective review of `phase-08-skill-policy-integration.md` only, against the corrected concepts, authoritative phase ledger and waves, applicable Pi skill/extension guidance, current skill contracts, and the dependent execution-record, exact-tool-policy, result-paging, and internal-dev boundaries.

### phase-09-specifications-docs-and-integration.md

Reviewed only `phase-09-specifications-docs-and-integration.md` against `concepts.md` and `orchestration.md`. The review covered scope, dependency closure, single-agent executability, orchestration order, implementation guidance, validation, exit criteria, ordered edit steps, invariants, and edge cases.

## Findings

### concepts.md

- **High — path and record security was incomplete.** The original constraints mentioned no-symlink checks but did not carry forward the complete handoff contract for traversal, absolute escapes, foreign ownership, no-replace creation, record-name collisions, and source/execution identifier aliasing. The corrected concepts make these shared invariants explicit.
- **High — exact subagent policy was underspecified.** Atomic validation covered model/tool tuples but omitted exact thinking levels, duplicates, unavailable tools, root-only or forbidden tools, fingerprints, child-context filtering, and the no-project-tools preflight rule. It also needed to preserve editing authority for implementers and validators. The corrected concepts state the full fail-closed batch boundary.
- **Medium — the execution-record boundary could imply extension-owned orchestration.** Clean-shutdown handling and state transitions needed clearer separation between a narrow persistence tool and skill-owned coordination. The corrected architecture states that record operations never launch provider work or decide orchestration topology.
- **Medium — cross-phase guidance did not anchor the fixed phase set.** The original sequencing was conceptually sound but did not identify which fixed phase owns each contract or prevent later phases from duplicating parsers and policy. The corrected guidance maps dependencies across the nine immutable phase files without changing the set.
- **Medium — final validation omitted several handoff gates.** Missing or weakly represented checks included package type/resource/manifest validation, atomic preflight rejection, invalid cursor handling, unchanged poll semantics, path and ownership attacks, explicit initialization behavior, post-normalization internal-dev validation, status/resume behavior, reset boundaries, and final-diff inspection. These are now included.
- **Low — one assumption overcommitted the metadata encoding.** Requiring new exact lines inside particular phase headings was more prescriptive than the handoff. The corrected assumption requires deterministic agreement through the existing phase sections and orchestration schema without inventing a second metadata format.
- **Low — acceptance wording needed stronger persistence ordering.** PASS and terminal completion must become visible only after their evidence is durably recorded. The corrected concepts apply this rule to phase, integration, and execution completion.

### orchestration.md

- `large` is the correct classification: nine phases satisfy the large-plan budget of six through ten phases.
- The phase set is complete, contiguous, and unchanged.
- The dependency graph is acyclic and correctly converges all three independent branches through phase 08 before phase 09. Every dependency is assigned to an earlier wave.
- The declared parallel waves are safe from target overlap: phases 01, 05, and 07 have disjoint package areas, as do phases 02 and 06. Later waves are sequential.
- The original ledger understated phase 01 and assigned decomposition correction and immediate lifecycle behavior to later phase goals, conflicting with the corrected concepts. Phase 01 also omitted `sprint-planner/engine.ts` and `sprint-planner/pi-runner.ts`, although synthesis coverage, decomposition freeze, and collision-resistant worker session identifiers require those implementation areas.
- The original phase 09 goal included package-manifest reconciliation while its target set omitted the consuming package manifests named by the handoff and final validation criteria.
- The implementation tuple, validation tuple, exactly-one-implementer rule, mandatory validator-owned review-and-repair PASS gate, dependency barrier, and final integration line already match the exact machine-readable contract.

### phase-01-deterministic-planning-contracts.md

- **Critical — scope drift:** The phase write-target line omits `sprint-planner/engine.ts` and `sprint-planner/pi-runner.ts`, although both are canonical phase-01 targets in `orchestration.md`. This also prevents the phase from owning the required pre-freeze decomposition gate and complete worker-session identifier path.
- **Critical — missing corrected concepts:** The phase does not implement the stable observable `starting` state or the decomposition correction gate that may change the phase set before it freezes. Both are explicit phase-01 contracts and prerequisites for phase 02.
- **High — acceptance authority ambiguity:** Calling `validatePlanDirectory` the sole authority conflicts with the required structured inspection API and direct tool use. The structured inspector must be authoritative; throwing compatibility APIs must delegate to it.
- **High — incomplete path/security guidance:** Root-only `lstat` is insufficient. The tool and directory inspector must reject absolute or escaping paths, symlinks in every traversed component and direct child, foreign ownership, non-direct-child entries, and unsafe names without writing.
- **High — decomposition retry boundary:** Applying full cross-consistency validation to the planner’s first draft would reject correctable decomposition defects before the correction gate. The draft needs only safe submission-shape checks; full acceptance must occur inside the medium decomposition gate before phase names freeze.
- **Medium — synthesis caller defect remains underspecified:** Current persisted and standalone callers validate only findings paths even though synthesis receives findings and cross-reviews. The expected Source set must be exact and include both report classes.
- **Medium — validation gaps:** The original tests omit decomposition changes before freeze, post-freeze file-set preservation, immediate start/resume status, ancestor symlinks, ownership rejection, exact Source entries, and structured result stability.
- **Pass — dependency and wave placement:** `depends: none` is correct. Phase 01 has no target overlap with phases 05 or 07 in wave 01 and remains executable by one implementation agent after the target corrections.
- **Pass — route invariant:** Correcting `ThinkingLevel` to contain `xhigh` once is required by current code, while every `MODEL_ROUTES` tuple must remain unchanged. The already-correct subagents thinking-level list and absent prose scanner remain verification-only invariants outside this phase’s edits.

### phase-02-planning-engine-reliability.md

- The phase is correctly placed after Phase 01 and can run beside Phase 06 because their write targets are disjoint.
- The original decomposition-review work conflicts with the corrected ownership split: Phase 01 establishes the pre-freeze decomposition correction gate and frozen phase index; Phase 02 must consume that contract rather than add another decomposition prompt or gate.
- Retry accounting needs an explicit attempt disposition from the runner. Inferring cancellation or chargeability from error text or only from an aborted root signal cannot distinguish provider completion, setup failure, root interruption, and sibling-scope cancellation reliably.
- Exact retry feedback requires a persisted failure category and message. The current combined submission-validation/artifact-write callback would otherwise blur typed, semantic, and operational failures.
- The fan-out guidance needs to cover synchronous factory failure, root-to-scope signal forwarding, first-cause retention, deterministic result ordering, complete settlement, and listener cleanup.
- Runner settlement must track calls before child creation and include adviser children. Tracking only already-created sessions leaves a cancellation race, while disposing from `abortAll` can invalidate unresolved `run` calls.
- Blanket failed-step attempt reset on resume violates the corrected durable-budget contract. Phase 01's deliberate reset after completed-artifact semantic invalidation remains distinct and must be preserved.
- The ironout reduction must remove raw report bodies and raw-report context injection while retaining source-path references and stored evidence.
- The validation list over-allocates decomposition correction tests to this phase and under-specifies disposition, mixed cancellation, synchronous rejection, and runner-creation race coverage.

### phase-03-run-leases-list-and-doctor.md

- **Dependency topology is valid.** Phase 03 depends on phase 02, is alone in `wave-03`, and precedes phase 04, which consumes its shared run-record primitives. Targets match the ledger.
- **The original duplicated phase 01 scope.** Immediate `starting` state belongs to phase 01. Phase 03 should preserve it as a regression invariant while adding lease-aware `ActiveJob` behavior.
- **Lease lifecycle guidance was incomplete.** It omitted safe rollback when a new directory loses the lease race and did not distinguish durable clean finalization from a crash or failed final save. Release must follow a durable final owned transition; otherwise the lease remains for conservative diagnosis.
- **Path and ownership authority needed precision.** Discovery, selected-run resolution, state claims, lease binding, symlink rejection, and direct-child checks must share one implementation. A state claiming another run id, project root, or run directory is a foreign claim.
- **Doctor overclaimed phase 04 semantics.** Phase 03 can identify execution-only markers and diagnose shared path, lease, manifest, malformed, and unsupported-schema conditions. It must not invent execution-ledger or terminal-transition parsing.
- **Read-only boundaries were underspecified.** List and doctor must not acquire, release, refresh, clear, normalize, repair, create, or invoke providers. Diagnosis should aggregate independent findings after malformed artifacts.
- **Command and reset edge cases needed precision.** `list` accepts no id; `doctor` accepts zero or one. Literal `--` remains authoritative. Confirmed reset is the sole destructive override, not doctor repair or stale-lease cleanup.
- **Dead-API removal is conditional.** Remove `atomicWriteJson`, `RunArtifactStore.replaceFlatDirectory`, and `ArtifactSink` only after module-aware proof of no live consumers; never rewrite backups.
- **One-agent execution remains coherent.** Shared primitives, engine integration, commands, diagnostics, and tests form one sprint-planner run-record boundary.

### phase-04-durable-execution-records.md

- The ownership boundary is sound: `execution-records.ts` persists evidence while the orchestrate skill retains worker coordination.
- The original phase conflated `checkpoint` with terminal blocked/interrupted transitions even though the public contract defines `start`, `checkpoint`, and `finish`. The corrected phase makes checkpoints record implementation and validator evidence and reserves terminal sealing for `finish`; validator `BLOCKED` immediately closes downstream checkpoint eligibility.
- The record state machine lacked complete invariants for revisions, duplicate evidence, dependency barriers, integration gating, model tuples, and legal terminal outcomes. These are now explicit.
- “Write record and manifest atomically” is not achievable as one filesystem atomic operation across two files. The corrected phase defines the record as authority, a deterministic manifest reconciliation rule, ordered per-file atomic replacement, lease retention on partial failure, and success only after both parse to the same revision and state.
- Source immutability checks were strongest at start and finish but underspecified during checkpoints. The corrected phase verifies the frozen source entry set and bytes before accepted checkpoints, rejects completion on drift, and permits blocked/interrupted closeout to preserve observed drift without rewriting the source descriptor.
- Changed-file evidence did not identify the observation root or exclude runtime/source artifacts. The corrected phase anchors observations to the canonical project root, rejects unsafe or special-file paths and execution/source record paths, and records stable present/deleted observations from repository state rather than supplied hashes.
- Start failure cleanup, lease ownership, shutdown behavior, and stale-revision handling needed ordering precise enough to prevent replacement or unowned rollback. The corrected steps now require no-replace reservation, ownership-checked cleanup, one runtime lease handle, and revision increments only for accepted record transitions.
- Doctor integration was ambiguous because phase 04 may not edit phase-03-owned files. The corrected phase uses the parser-composition point delivered by phase 03 through the declared targets and treats its absence as a dependency defect rather than duplicating discovery or widening write scope.
- Validation omitted partial record/manifest write failures and source drift after start. Focused fault-injection and drift cases are now included.

### phase-05-exact-subagent-tool-policy.md

- The phase boundary is correct and cohesive for one implementation agent: schema/API changes, pure validation, child-session construction, package metadata, and focused tests all belong to the `subagents` package. Result retention, pagination, and terminal shutdown remain correctly deferred to phase 06; skill policy remains correctly deferred to phase 08.
- `depends: none` and wave 01 placement are consistent. Its targets do not overlap the sprint-planner or internal-dev phases in that wave. Phase 06 correctly depends on it, and phase 08 reaches it through phase 06. The later phase-09 package reconciliation is ordered after those dependencies and does not create concurrent target contention.
- The original ordered steps cover the required behavior, but step 5 is technically ambiguous: `spec.expectedTools.map(name)` is not valid for fingerprint objects, and comparing fingerprints against `session.getAllTools()` would include configured but inactive tools. The implementation must compare the child’s exact active-name sequence/set and fingerprint only those active definitions from `getAllTools()`.
- Preflight atomicity needs a sharper side-effect boundary. Schema/runtime failures for omitted, malformed, duplicate, unknown, inactive, forbidden, or unreproducible tools must occur before records, lifetime-name reservations, adapter initialization, or task starts. A post-bind child fingerprint drift is necessarily an initialization failure; it must dispose all initialized siblings and start no delegated task, but it is distinct from preflight rejection.
- Fingerprints should be trusted values computed from the root tool catalog, not caller-supplied fields. They must cover the reproducible definition inputs available through `ToolInfo`: name, description, parameters, prompt guidelines, and source metadata, with deterministic object-key ordering and array-order preservation.
- Exact active tools are necessary but not sufficient to state the context invariant clearly. After extension binding, excluded tools must be absent from the active definitions and from active-only prompt snippets/guidelines. Tests should use sentinel metadata to prove absence rather than merely proving calls are blocked.
- The original tests omit an explicit omitted-`tools` case and do not distinguish preflight rejection from initialization drift. Both are required to prove the corrected contract.
- The package metadata step correctly belongs here because all four named Pi core packages are directly imported by `subagents/index.ts`, and Pi package guidance requires `"*"` peer dependencies for them.

### phase-06-subagent-results-and-shutdown.md

- Scope and dependency placement are correct. Phase 06 depends only on phase 05, its targets do not overlap phase 02 in authoritative wave 02, and phase 08 correctly waits for its PASS.
- The result-page contract was underspecified. Encoding only result identity and offset cannot deterministically reject a modified but otherwise valid offset. The corrected phase requires authenticated, versioned, manager-local cursors.
- UTF-8 paging lacked a progress rule when the requested byte cap is smaller than the next code point. The corrected phase gives `maxBytes` an integer minimum of four bytes and requires every start/end offset to be a UTF-8 code-point boundary.
- The phase did not fully prevent oversized output from escaping the manager snapshot. Current tool `details.payload` retains the complete result even when model-visible content is capped. The corrected phase requires oversized poll/status responses and details to carry only a bounded preview plus page metadata; complete bytes remain only in the manager snapshot.
- Initializing children need an explicit detachment race. Current batch initialization uses `Promise.allSettled` and can block forever before a handle exists. The corrected phase requires shutdown/cancel to terminalize starting records without awaiting initialization, while observing late initialization and boundedly disposing any late handle without starting it.
- Late-settlement suppression must cover `onTurn` as well as final result fields. Otherwise detached children can still mutate turns, usage, reminders, or root notifications. The corrected phase makes every child callback validate the same generation token.
- A shared terminalization primitive must preserve the initiating outcome: turn-limit remains `turn_limit`, explicit cancel/shutdown remains `cancelled`, and initialization failure remains `failed`. It must also settle `done`, active accounting, reminders, and notifications once.
- Validation needed explicit coverage for synchronous throws, independently non-settling initialize/run/abort/dispose paths, zero-byte results, too-small page requests, non-boundary/tampered cursors, and unchanged poll consumption.

### phase-07-internal-dev-content-and-init.md

- **Changelog normalization needed a stricter ordered contract.** The existing `ensureChangelogCommit` appends a missing `Git Commit` section, which would violate canonical order. The phase must require pre-validation of all user-owned sections, permit only an absent or unfilled `Git Commit` section, reject a present section in the wrong position, insert a missing section between `Date` and `Change Summary`, and validate the complete normalized result.
- **Heading parsing was materially underspecified.** “Ignores fenced and indented code” did not define fence state, literal heading syntax, or diagnostics. A line-oriented parser must handle backtick and tilde fences, indentation, exact literal H2 names, wrong heading levels, duplicates, and relative required-heading order without mistaking blockquotes, list items, or code for canonical sections.
- **The validation boundary did not explicitly cover the initialization changelog.** It is generated and written through a separate path, so validating only `artifactTemplate` and `createArtifact` would leave a code-generated typed artifact outside the new invariant.
- **Side-effect ordering required sharper guidance.** Content rejection must occur after safe path resolution supplies artifact-kind/path evidence but before nested parent creation or any artifact write. Existing traversal, symlink, queue, and exclusive-write behavior must remain intact.
- **Startup validation needed an executable test strategy.** Source-text assertions are insufficient for the lifecycle contract. Tests should register the extension against a fake API/context, invoke captured `session_start` handlers for missing, partial, and ready stores, and prove no confirmation or mutation occurs.
- **Generated/maintained guide changes were too discretionary.** The corrected phase now identifies the required clarification: explicit initialization and the distinction between temporary planning checkpoints and durable execution-only sprint evidence, while preserving routing and destructive-reset rules and exact `ROOT_AGENTS_CONTENT` parity.
- **Orchestration consistency is sound.** The phase has no prerequisites, its targets match the ledger exactly, it can run in wave 01 without write overlap, and phase 08 correctly waits for its explicit-initialization and concise-injection behavior.

### phase-08-skill-policy-integration.md

- **High — terminal persistence was incomplete.** The phase required `finish` only after integration PASS, leaving genuine BLOCKED or interrupted orchestration without a terminal execution-record transition. The corrected phase requires evidence to be checkpointed first, then `finish` with the truthful terminal outcome; only integration PASS may produce completed success.
- **High — optimistic revisions and source/execution separation were underspecified.** The original flow did not require callers to chain returned revisions, reject stale checkpoints, keep execution identifiers distinct from source identifiers, or keep runtime material outside source directories. These are necessary Phase 04 dependencies and are now explicit.
- **High — exact specialist permissions were ambiguous.** “Inspection tools” did not define an exact senior advisory set. The corrected phase fixes advisory senior agents to `read`, `grep`, `find`, and `ls`; edit-authorized senior agents use those plus `bash`, `edit`, and `write`. Preflight, implementer, validator, integration, and image-viewing sets are likewise literal and exact.
- **Medium — result recovery lacked page-contract detail.** The original phase named result pages and digest verification but did not require stable result identity, cursor chaining, UTF-8-safe reconstruction, byte-count verification, or terminal metadata. The corrected step does, while preserving poll delivery semantics.
- **Medium — changed-file evidence could be mistaken for child self-report.** Execution evidence must represent observed repository state. The corrected phase requires the root to canonicalize and observe present/deleted paths and metadata, use those observations for validator overlap checks, and checkpoint them before opening a dependency barrier.
- **Medium — deterministic validation needed a precise input boundary.** `sprint_validate_plan` applies to a generated plan directory, not arbitrary prose or pasted non-authoritative input. The corrected phase calls it exactly once for that input form and retains only policy-level interpretation for other forms.
- **Medium — the fake trace criterion overstated executable skill behavior.** Markdown skills are policy, not a runtime engine. The corrected validation makes this a contract-level trace over tool actions and recorded revisions rather than implying that the test suite executes the skill itself.
- Scope, dependencies, wave placement, write targets, and the ten-step order are otherwise consistent. The phase remains cohesive and executable by one implementation agent after these corrections.

### phase-09-specifications-docs-and-integration.md

- **Scope defect:** The phase’s declared write targets omitted `sprint-planner/package.json`, `subagents/package.json`, `internal-dev/package.json`, and `user-questioning/package.json`, although orchestration assigns those files to phase 09 and step 8 edits them. The corrected phase adds all four without adding any target outside the authoritative ledger.
- **Dependency and wave consistency:** Depending directly on phase 08 is sufficient because phase 08 transitively depends on phases 04, 06, and 07, which close over phases 01–05. Phase 09 remains the sole phase in wave 06, so its targets do not overlap a concurrent phase.
- **Single-agent executability:** One phase implementation agent can perform the ordered documentation, specification, manifest, and validation work. The eight-worker pipeline is a product-level acceptance exercise initiated by that agent, not a second phase implementer. It must use an isolated acceptance workspace and must not orchestrate the active nine-phase plan recursively.
- **Orchestration-order ambiguity:** The original phase described the manual pipeline as “full integration validation,” while orchestration reserves final integration for after every phase has PASS. The corrected phase distinguishes the phase-level isolated end-to-end acceptance run from the later orchestration-owned final integration gate.
- **Repair-boundary ambiguity:** “Further code architecture changes unless validation exposes an in-scope defect” could be read as permission to edit code outside the phase ledger. The corrected phase limits repairs to declared targets. A code or skill defect outside those targets is a concrete blocker for phase 09 rather than authority for scope expansion.
- **Validation side effects:** Manual planning and orchestration create run records. The original scope did not distinguish those generated records from source edit targets. The corrected phase requires them to live in an isolated acceptance workspace, preserves source bytes, and treats them as validation evidence rather than repository edits.
- **Implementation quality:** The eleven ordered steps are substantively sound and aligned with the corrected concepts. They retain accurate distinctions among schema versions, planning versus execution ownership, root detachment versus provider termination, read-only diagnosis, exact child policies, and current-schema versus legacy plans.
- **Changelog edge case:** Exclusive creation must not overwrite an existing artifact. The corrected phase requires inspection and deliberate reconciliation if the named changelog already exists, and limits recorded evidence to checks actually completed when it is written.

## Risk Assessment

### concepts.md

The corrected architecture remains within the handoff’s settled boundaries. The principal implementation risks are duplicated path-security logic, stale execution checkpoints bypassing revision checks, partial child initialization before policy validation, and lifecycle code allowing detached children to alter root-visible state. These risks are addressed through shared parsers, optimistic revisions plus leases, atomic spawn validation, immutable result snapshots, and terminal late-settlement suppression.

No model route, plan shape, phase-budget rule, publication guarantee, worker-pool topology, or recovery scope is changed. The two module names remain an implementation organization choice rather than new public API surface.

### orchestration.md

Without correction, phase 01 could leave cross-consistency and lifecycle contracts split across later phases, weakening phase ownership and making phase-level PASS evidence ambiguous. Omitting package manifests from phase 09's declared write set could also force undeclared edits or leave dependency declarations unreconciled. The dependency and wave topology itself presents no unresolved ordering or parallel-write conflict.

### phase-01-deterministic-planning-contracts.md

The uncorrected phase could publish plans whose component reviewers are bound to an invalid decomposition, report no stable status during initialization, and expose a validation tool that diverges from planner acceptance or follows unsafe paths. These defects would propagate into phase 02 retry semantics and phase 08 orchestration integration. The corrected scope is cohesive: all edits belong to deterministic planning contracts and can be completed by one agent without crossing package boundaries.

### phase-02-planning-engine-reliability.md

Risk is high if implemented as written. Duplicate decomposition ownership could change the fixed phase set after Phase 01, attempt resets could bypass the bounded retry contract, and incomplete runner settlement could leak or prematurely dispose children. Misclassified local cancellation could also pause the entire sprint or consume retries. The corrected scope remains cohesive for one implementation agent because all changes are confined to the sprint-planner execution path and its focused tests.

### phase-03-run-leases-list-and-doctor.md

- **High:** Release after an unsuccessful final save can expose an inconsistent or active record to another mutator.
- **High:** Divergent path or schema logic across list, doctor, reset, resume, and phase 04 can permit traversal, symlink, foreign-claim, or run-kind inconsistencies.
- **High:** Session-start rewriting without a retained lease can corrupt another process's work.
- **Medium:** PID liveness can misclassify ownership after reuse or across hosts.
- **Medium:** Premature execution diagnosis creates a competing schema before phase 04.
- **Medium:** Unproven API deletion can break non-obvious consumers.

### phase-04-durable-execution-records.md

- **High if uncorrected:** terminal evidence could be accepted out of order, stale callers could overwrite newer evidence, or a manifest could claim a state not represented by the machine record.
- **High if uncorrected:** source or runtime paths could be admitted as changed-file evidence, weakening the no-source-mutation boundary.
- **Medium:** clean shutdown can leave an interrupted record or lease inconsistent unless terminal write, manifest agreement, and release are strictly ordered.
- **Low after correction:** scope and orchestration alignment are clear; the work remains localized to one package and one agent, with phase 08 consuming the resulting tool contract only after PASS.

### phase-05-exact-subagent-tool-policy.md

The highest risk is accidental additive behavior: validating requested names but still creating the child from the caller’s full active set. The next risk is a false fingerprint mismatch caused by comparing requested active tools with every configured inactive child tool. Other material risks are leaked prompt guidance from excluded tools, partial batch side effects before validation completes, accepting inactive or duplicate names, and treating caller-provided fingerprints as authoritative. The corrected phase contains explicit invariants and focused tests for each risk.

### phase-06-subagent-results-and-shutdown.md

Risk is high if implemented from the original phase: unauthenticated cursors could accept tampering, full oversized results could remain persisted in tool details, and shutdown could still hang during initialization or disposal. The corrected phase reduces these risks by defining one immutable snapshot, one authenticated paging contract, and one token-guarded terminalization path. The work remains suitable for exactly one implementation agent because all lifecycle and paging changes share the same manager state and public tool boundary.

### phase-07-internal-dev-content-and-init.md

- **High:** An imprecise parser could accept malformed artifacts or reject valid body content, undermining exclusive typed creation.
- **High:** Incorrect changelog insertion could produce a file that contains a commit hash but violates canonical heading order.
- **Medium:** Missing validation on initialization changelogs would create two inconsistent creation paths.
- **Medium:** Removing startup prompting without lifecycle-level tests could leave another implicit initialization path unnoticed.
- **Low:** Contract wording changes could drift from the maintained guide; byte-exact parity tests contain this risk.

### phase-08-skill-policy-integration.md

Without the corrections, orchestration could report a blocker while retaining an apparently active record, accept stale evidence ordering, leak unintended tools into specialist children, or trust incomplete/truncated child output. Static prose checks alone could also pass while source immutability, PASS barriers, and evidence-before-completion ordering remain ambiguous. The corrected phase reduces these risks without moving parsing, persistence, pagination, leases, or worker coordination into the wrong package.

### phase-09-specifications-docs-and-integration.md

- **High:** Running the manual pipeline against the active hardening plan could recurse into phase 09, mutate unrelated files, or make the phase impossible to close.
- **High:** Leaving package manifests outside declared write targets would violate the authoritative orchestration ledger and obscure review ownership.
- **Medium:** Repairing code discovered by final checks from within this documentation phase would create unplanned target overlap and bypass the relevant phase gate.
- **Medium:** Documentation can overstate guarantees if it conflates bounded root accounting with remote provider termination, or optimistic revisions with crash-atomic multi-path publication.
- **Low:** Changelog baseline wording can be misleading in a dirty worktree unless the full current `HEAD` is explicitly described as the baseline commit.

## Recommendations

### concepts.md

- Use the corrected `concepts.md` as the shared architecture contract for all nine phases.
- Keep deterministic parsing, path validation, lease handling, and schema-version checks centralized and reusable by commands, tools, and doctor.
- Require persisted evidence before exposing PASS, integration completion, interruption, or terminal execution state.
- Enforce child policy by constructing and validating the complete batch before creating any child, then remove excluded definitions and guidance from child context.
- Treat SDK evidence that contradicts bounded detachment or late-result suppression as a contract conflict rather than weakening the acceptance claim.
- Keep phase 09 responsible for reconciling living specifications, durable decisions, package declarations, public documents, and final integration evidence with the implemented behavior.

### orchestration.md

Use the corrected orchestration below. Keep the declared waves authoritative, require each logical wave to reach the full PASS barrier, and reject execution if actual write sets reveal shared mutable state not represented in the ledger.

### phase-01-deterministic-planning-contracts.md

- Match the phase metadata exactly to the orchestration ledger.
- Add one `openai-codex/gpt-5.6-sol:medium` decomposition review before deriving the immutable phase-name index; permit file-set correction only there.
- Make one versioned structured inspector the source of truth for in-memory and directory validation, with throwing wrappers retained for compatibility.
- Establish transient `starting` progress synchronously before the first asynchronous initialization boundary.
- Define exact Source-list, path, ownership, result-shape, and cross-file metadata invariants and test each stable category.

### phase-02-planning-engine-reliability.md

- Remove decomposition prompt and gate implementation from Phase 02; treat Phase 01's corrected plan and frozen phase index as inputs.
- Add explicit worker-attempt dispositions and structured retry-failure state, then separate typed validation, semantic validation, and artifact commit boundaries.
- Track runner operations from invocation through final disposal, and make `abortAll` abort then await settlement without disposing active sessions itself.
- Apply one scope-local fan-out primitive to persisted and standalone findings, cross-reviews, and phase reviews; preserve deterministic publication order.
- Preserve charged attempts across ordinary resume while leaving Phase 01's completed-component drift invalidation behavior intact.
- Replace raw ironout report embedding with authoritative synthesis/red-team content and report path references.

### phase-03-run-leases-list-and-doctor.md

- Make `run-records.ts` the sole owner of direct-child resolution, discovery, common classification, strict version parsing, ownership findings, and lease operations.
- Bind leases to version, run id, run kind, opaque owner id, process/host evidence, and acquisition timestamp; retain file identity and content evidence in memory.
- Finalize owned state before ownership-checked release. Preserve leases after failed finalization, ownership drift, or crash.
- Keep phase 01's immediate `starting` behavior unchanged and regression-test it.
- Limit phase 03 execution diagnosis to common evidence; require phase 04 to consume those primitives.
- Prove read-only behavior with complete before/after tree snapshots and provider-call counters.

### phase-04-durable-execution-records.md

- Implement the corrected nine steps in order and use phase-03 path, ownership, discovery, and lease primitives without local variants.
- Keep the execution record authoritative, revisioned, and fully parsed on every read; render the manifest only from parsed record state.
- Keep tool schemas discriminated and strict, with persistence-owned timestamps and observed file metadata.
- Add injected filesystem-failure tests around both atomic replacements and lease release before accepting the phase.

### phase-05-exact-subagent-tool-policy.md

Use the corrected phase as the complete implementation contract. Preserve its nine-step order. Keep catalog construction and spawn validation pure, carry resolved fingerprints into initialization, and verify the post-bind active set before any child task starts. Do not add a sandboxing framework, role-policy registry, wildcard policy, fallback tool set, or new public fingerprint input.

### phase-06-subagent-results-and-shutdown.md

Use the corrected phase as the implementation contract. Preserve the numbered edit order. Treat forced detachment as root-accounting finality rather than proof that provider work stopped, and expose that distinction in terminal metadata or error text. Keep bounds injectable and tests model-free. Do not broaden this phase into persistence, tool-policy changes, nested workers, or generic supervision.

### phase-07-internal-dev-content-and-init.md

- Implement one data-driven heading contract and one parser/validator used by templates, supplied content, and generated initialization changelogs.
- Keep changelog pre-normalization exceptional only for `Git Commit`; do not repair, reorder, or synthesize user-owned sections.
- Validate before filesystem mutation, then retain the existing path-security checks immediately around directory creation and the queued exclusive write.
- Remove the unsolicited `session_start` initialization path rather than replacing it with another startup interaction.
- Test behavior through captured extension handlers and tool/command registrations, not only source regexes.

### phase-08-skill-policy-integration.md

Implement the corrected phase as written. Keep deterministic behavior in the Phase 04–06 TypeScript tools, keep the skills limited to exact calls and policy, and make mutation tests reject contradictory executable guidance rather than harmless historical negation. Treat execution-record acceptance—not a child report—as the point at which PASS or terminal completion becomes durable.

### phase-09-specifications-docs-and-integration.md

- Use the corrected target list exactly and preserve the existing eleven-step order.
- Run the eight-worker acceptance path in an isolated disposable Git workspace with a newly generated current-schema plan; hash source plan bytes before and after and inspect records after reload.
- Keep phase-level acceptance distinct from the orchestration-owned final integration that begins only after phase 09 receives validator PASS.
- Restrict corrective edits to phase 09 targets. Report implementation mismatches outside those targets as `BLOCKED` with exact evidence.
- Keep all public claims tied to observed behavior and all schema/version names distinct.
- Create the changelog exclusively, record only completed evidence, and verify its full `HEAD` and specification-impact sections after creation.

## Follow-ups

### concepts.md

- Phase authors must preserve the exact nine-file set and the dependency ownership stated in the corrected cross-phase guidance.
- Validate the Pi abort, disposal, detachment, and tool-context APIs before finalizing lifecycle and policy internals.
- Confirm every final acceptance item with focused regression evidence and the applicable broader package checks.
- No additional concept-level design decision remains open.

### orchestration.md

During phase review, verify that phase 01 contains the pre-freeze decomposition and immediate `starting` contracts, while phases 02 and 03 consume rather than redefine them. Validate the complete plan with the deterministic plan parser before orchestration and durably record each phase PASS and the final integration PASS.

### phase-01-deterministic-planning-contracts.md

- Phase 02 must consume the frozen decomposition, structured semantic failures, and progress contracts without redefining them.
- Phase 03 must reuse or centralize the path and ownership primitives without weakening `sprint_validate_plan` read-only behavior.
- Phase 08 must call `sprint_validate_plan` rather than reproduce plan parsing in skill prose.
- No phase file is added, removed, split, merged, or renamed by this correction.

### phase-02-planning-engine-reliability.md

Phase 03 should consume the resulting stable planning-state and settlement behavior without reopening retry or fan-out semantics. Phase 08 and Phase 09 should document only the final implemented contracts. No phase file-set change is required.

### phase-03-run-leases-list-and-doctor.md

- Phase 04 must consume exported path, ownership, lease, and baseline diagnosis primitives without adding variants.
- Phase 08 must present deterministic behavior without reproducing parsers in skill prose.
- Phase 09 must reconcile command documentation and living specifications with the implemented contract.

### phase-04-durable-execution-records.md

- Phase 08 should call only the finalized `start`, `checkpoint`, and `finish` shapes and persist each validator PASS/BLOCKED result before scheduling decisions.
- Phase 09 should document the final schema version, manifest authority rule, action payloads, and read-only doctor behavior after implementation PASS.

### phase-05-exact-subagent-tool-policy.md

Phase 06 may rely on `ResolvedAgentSpec` carrying an exact immutable tool snapshot but must not revise tool-policy semantics while adding result and shutdown behavior. Phase 08 must request explicit role-appropriate sets, including `tools: []` for preflight and editing tools for implementers and validators, without restating validation logic in skill prose. Phase 09 should reconcile public documentation and package metadata with the implemented API.

### phase-06-subagent-results-and-shutdown.md

Phase 08 should consume the resulting paging and terminal shutdown behavior without reproducing it in skill prose. Phase 09 should document the final public page schema and bounded oversized-result representation after implementation. No phase-file set, dependency, wave, or target change is required.

### phase-07-internal-dev-content-and-init.md

- Phase 08 should consume the resulting explicit-init and concise-guidance behavior without reproducing validation or routing logic in skill prose.
- Phase 09 should reconcile living specifications, decisions, package documentation, and integration evidence with the implemented contract.
- No phase-file additions, removals, renames, dependency changes, wave changes, or edits outside phase 07 are warranted.

### phase-08-skill-policy-integration.md

Phase 09 should reconcile the living specification and public tool documentation with the implemented exact tool arrays, terminal blocked/interrupted outcomes, paged result contract, and execution revision flow. No other phase file should be changed by this corrective review.

### phase-09-specifications-docs-and-integration.md

- No other phase file should be edited as part of this correction.
- After phase 09’s GPT-5.6 Sol `medium` validator records PASS, run the separate final integration gate required by `orchestration.md` and durably record its verdict.
