## Architecture

The hardening preserves three explicit ownership boundaries:

- `sprint-planner` remains the deterministic planning and run-record package. It owns plan parsing, planning checkpoints, leases, record discovery, diagnosis, and versioned execution-evidence persistence. It does not launch implementation workers, choose implementation topology, or start provider work while loading records.
- `subagents` remains the flat, root-owned worker pool. It owns atomic model/thinking/tool-policy validation, child lifecycle, result delivery, pagination, cancellation, terminal detachment, and root-visible accounting. Nested subagents remain unsupported.
- `internal-dev` remains the trusted artifact-store initializer and exclusive artifact creator. It validates artifact content by kind and injects concise routing guidance that points to the generated project contract.

Add two focused sprint-planner modules rather than expanding the planning engine monolith:

- `sprint-planner/run-records.ts` owns versioned lease parsing and lifecycle, safe direct-child discovery, shared path and ownership checks, and read-only diagnosis for planning and execution records.
- `sprint-planner/execution-records.ts` owns versioned execution-only records, immutable source metadata, optimistic revisions, evidence checkpoints, and terminal state transitions.

Expose the existing plan parser through the read-only `sprint_validate_plan` tool. Expose execution persistence through one `sprint_execution_record` tool with typed `start`, `checkpoint`, and `finish` actions. The persistence tool validates state transitions and evidence but never coordinates workers. The orchestrate skill remains responsible for spawning, polling, authoritative-wave coordination, validation gates, and stopping on a genuine blocker.

## Conceptual Approach

1. Establish deterministic planning inputs and outputs: collision-resistant session identifiers, literal option termination, immediate `starting` state, structured plan-validation results, complete synthesis coverage, a pre-freeze decomposition correction gate, and cross-consistent phase metadata.
2. Repair planning execution semantics around a scope-local fan-out primitive. A failed sibling cancels and settles only its fan-out, interruption does not consume retry budget, completed failures remain counted across resume, and exact semantic failures become retry context.
3. Put every mutable direct-child sprint record behind a versioned exclusive lease. Make list and doctor read-only consumers of the same discovery, schema, path, ownership, and lease parsers.
4. Persist orchestration evidence in a distinct execution-only sprint record with immutable source identity and hashes, a revisioned phase ledger, changed-file evidence, validator verdicts, integration evidence, and terminal state.
5. Make subagent permissions exact per agent and reject the complete spawn batch before child initialization when any model, thinking level, tool name, availability rule, or fingerprint is invalid.
6. Keep each completed subagent result in one immutable in-memory snapshot. Retrieve oversized output through UTF-8-safe pages carrying stable identity, cursors, byte count, digest, and completion metadata without changing poll delivery semantics.
7. Make cancellation and shutdown terminal and bounded even when abort, child execution, or disposal is non-cooperative. Detach safely, settle root accounting once, and suppress late completion or result delivery.
8. Validate internal-dev content before exclusive creation, apply kind-specific normalization such as changelog commit evidence, validate the final normalized content, and keep initialization explicit.
9. Reduce skills to policy and exact tool calls. Deterministic parsing, path checks, ownership, leases, persistence, pagination, and validation remain in TypeScript; specifications and public documents must describe the implemented contract.

## Features

- Provider-limit-compliant worker session identifiers with a readable safe prefix and a deterministic hash derived from the complete source identifier.
- `--` option termination and an observable `starting` state established before background initialization can race status inspection.
- Synthesis coverage of every finding and every cross-review path.
- A pre-freeze decomposition correction gate followed by deterministic agreement among phase filenames, goals, dependencies, write targets, the orchestration ledger, and waves.
- Failure-safe fan-outs, exact semantic retry feedback, interruption-neutral retry accounting, reduced brainstorm context duplication, and concurrent disjoint phase correction only after corrected shared inputs exist.
- Versioned `sprint_validate_plan` results, `/sprint list`, and read-only `/sprint doctor [run-id]`.
- Versioned leases carrying owner identity and run kind, with conservative treatment of ownership that cannot be disproved.
- Durable execution-only records containing immutable source references and hashes, a phase ledger, implementation evidence, validator verdicts, changed-file evidence, integration verdict, terminal state, optimistic revision, and canonical manifest.
- Exact per-agent tool sets, atomic spawn validation, filtered child context, immutable result snapshots, paginated retrieval, and bounded terminal shutdown.
- Kind-specific internal-dev heading validation, explicit initialization, normalized-content revalidation, exclusive creation, and concise contract injection.
- Orchestrate PASS/BLOCKED policy with validator-owned in-scope repair and no separate DeepSeek repair loop.
- Complete public tool documentation, package dependency declarations, living specification updates, durable decisions, and a compliant changelog.

## Constraints

- Preserve every exact provider, model, and thinking route. Do not clamp, inherit, substitute, or add fallback routes.
- Preserve the flat plan directory, scope budgets, planning/implementation ownership boundary, no-replace publication, and ownership-checked rollback semantics.
- The phase file set remains exactly:
  - `phase-01-deterministic-planning-contracts.md`
  - `phase-02-planning-engine-reliability.md`
  - `phase-03-run-leases-list-and-doctor.md`
  - `phase-04-durable-execution-records.md`
  - `phase-05-exact-subagent-tool-policy.md`
  - `phase-06-subagent-results-and-shutdown.md`
  - `phase-07-internal-dev-content-and-init.md`
  - `phase-08-skill-policy-integration.md`
  - `phase-09-specifications-docs-and-integration.md`
- Plans, handoffs, skills, delegated reports, and closeout records describe actions and evidence rather than human delivery forecasts. Deterministic validators do not infer intent from prose. Technical timeout, TTL, retry, backoff, polling, cache, retention, lease, and complexity semantics remain valid.
- Generated-plan waves are authoritative. Reject unsafe or uncertain declared parallelism instead of silently serializing, rescheduling, or inventing replacement topology. Cap-driven batching must preserve the declared logical wave and its full PASS barrier.
- A phase is complete only after a GPT-5.6 Sol `medium` editing validator has repaired in-scope defects as needed and its PASS evidence has been durably recorded. `BLOCKED` requires a concrete condition outside validator edit authority.
- Execution records never modify, reuse, or place runtime material in their source plan directory or source planning-run directory. Their identifiers must differ from and not alias source identifiers.
- List, doctor, and plan validation are read-only. Doctor never steals, releases, clears, or rewrites a lease.
- Reload and process start never launch provider work automatically. Explicit planning resume remains supported; dedicated orchestration recovery remains out of scope.
- Every new or referenced path rejects traversal, absolute escape, symbolic-link traversal, foreign ownership, unsafe direct-child names, existing-record replacement, and source/execution aliasing.
- Result pages live only for the root session and derive from one immutable completed-result snapshot. Existing poll delivery and result-lifetime semantics remain unchanged.
- Tool policy is exact rather than additive. Unknown, unavailable, duplicate, root-only, forbidden, or fingerprint-mismatched tools reject the entire spawn batch before any child starts. Excluded tool definitions and prompt guidance never enter child context.
- Implementers and validators retain the inspection, editing, and command tools required by their assignments. Preflight agents receive no project tools; image viewing remains inspection-only; senior-agent tools remain bounded by the escalation brief.
- Preserve unrelated edits, historical backups, untracked files, and artifact history. Do not edit verification-only invariants while they remain correct.
- Remove dead APIs only after repository-wide, module-aware reference checks prove that live consumers do not exist. Do not replace them with speculative abstractions.

## Assumptions

- A new execution record may use `.internal-dev/sprints/<execution-run-id>/execution/record.json` with a canonical `manifest.md` that marks planning external or not performed and identifies the authoritative input.
- `sprint_execution_record` is a narrow persistence boundary. The skill decides when to spawn, poll, validate, checkpoint, and stop; record operations do not become an orchestration engine.
- The persistence layer retains a lease handle only for an execution record owned by the current extension runtime. Clean shutdown may mark that owned unfinished record interrupted and release its lease without launching work. A crash leaves ownership uncertain for doctor and confirmed-reset handling.
- Existing `validatePlanDirectory` remains the throwing compatibility wrapper over a new structured inspection result.
- Phase cross-consistency can be validated from the existing phase sections plus exact orchestration metadata without changing the flat directory shape or creating a second metadata language.
- Historical files under `backups/` do not consume live package exports. Live dead-API removal must be proven with module-aware searches and must not rewrite backups.
- Pi abort and disposal APIs can be wrapped with bounded terminal detachment and late-settlement suppression. If repository or SDK evidence disproves this, implementation must surface the contract conflict rather than claim weaker behavior as complete.
- Exact requested tool-name sets and fingerprints can be built from active Pi tool definitions before child initialization.

## Cross-phase Guidance

- Phase 01 establishes versioned validation contracts, session identifiers, option handling, starting-state behavior, synthesis coverage, decomposition freeze, and deterministic cross-consistency consumed by later phases.
- Phase 02 uses those contracts to implement scope-local fan-out settlement, causal-error preservation, interruption-neutral retry accounting, exact retry feedback, resume revalidation, context reduction, and safe corrective-review concurrency.
- Phase 03 centralizes run discovery, canonical paths, ownership checks, schema parsing, lease handling, list, and read-only doctor. Phase 04 must consume these primitives rather than create execution-specific variants.
- Phase 04 defines immutable source metadata, record revisions, phase and integration evidence, changed-file observations, canonical manifests, and terminal execution transitions. It persists evidence before exposing completion.
- Phase 05 establishes exact atomic child policy, role-specific tool sets, fingerprints, preflight restrictions, and child-context filtering. Phase 08 consumes this public behavior without reproducing it in skill prose.
- Phase 06 owns immutable completed-result snapshots, UTF-8-safe pagination, cursor validation, digest reconstruction, bounded cancellation, terminal detachment, and single-settlement root accounting.
- Phase 07 owns kind-specific internal-dev validation, normalization order, explicit initialization, exclusive creation, and concise contract injection.
- Phase 08 updates orchestrate and related skill policy to call deterministic tools, request exact tool sets, preserve authoritative waves and PASS barriers, checkpoint evidence, and omit the retired repair loop.
- Phase 09 reconciles package manifests, public documents, living specifications, durable decisions, legacy contradictions, changelog evidence, and complete integration validation with the implemented behavior.
- Do not add, remove, split, merge, or rename phase files. Preserve non-overlapping write targets for declared parallel phases; block if their safety cannot be established.
- Use version constants for plan-validation results, lease files, and execution records. Parse unknown versions into explicit unsupported-schema findings.
- Centralize path canonicalization, direct-child validation, and no-symlink checks. Commands, tools, list, doctor, and execution records use the same implementation.
- Preserve the first causal fan-out failure. Append sibling cancellation and settlement evidence without replacing the primary error.
- Persist state, evidence, revisions, and verdicts before emitting success or allowing dependent work.
- Keep source identifiers and hashes immutable after execution-record creation. Combine exclusive leases with optimistic revision checks so stale checkpoint calls fail deterministically.
- Tie tool fingerprints to the exact requested tool-name set. Excluded definitions and guidance never reach the child session.
- Treat changed-file evidence as observed repository state: canonical path, present or deleted status, and digest and byte metadata when present.
- Use fake runners, fake child handles, injectable cancellation bounds, and temporary stores in tests. Package unit suites must not invoke paid models.
- Update contract tests and documentation in the same implementation path whenever a public tool or schema changes.
- Before deleting `atomicWriteJson`, `replaceFlatDirectory`, or `ArtifactSink`, prove that no live package consumes it. Verify the absent prose scanner and the already-correct `subagents/core.ts` thinking-level list without churn.

## Final Validation Criteria

- All sprint-planner, subagents, internal-dev, and user-questioning suites pass, together with applicable package type, resource, manifest, and dependency checks.
- Focused planning tests cover identifier collisions and provider limits, option termination, immediate status, complete synthesis coverage, decomposition freeze, plan cross-consistency, fan-out cancellation and settlement, causal-error preservation, retry/resume accounting, and exact retry feedback.
- `sprint_validate_plan` returns stable versioned success and categorized shape, budget, dependency, wave, target, route, gate, and symbolic-link failures without mutating the plan.
- Lease tests cover exclusive acquisition, competing-owner rejection, clean release, uncertain ownership, run-kind separation, record-name collision, traversal, symlink, foreign ownership, no-replace behavior, and source/execution aliasing.
- `/sprint list` safely discovers direct-child planning and execution records. `/sprint doctor` performs no writes and reports actionable findings for planning, execution-only, malformed, completed, interrupted, leased, uncertain, and missing records.
- Planning pause, explicit resume, reload, and process start preserve the no-automatic-provider-work rule. Immediate status and literal prompt preservation remain stable.
- Execution records preserve immutable source identity and bytes, reject stale revisions, keep planning external in the canonical manifest, and retain implementation, validator, changed-file, integration, interruption, and terminal evidence across extension reload.
- Atomic spawn tests prove that invalid model, thinking, duplicate tool, unavailable tool, forbidden tool, root-only tool, or fingerprint input rejects the complete batch before child initialization. Valid role policies preserve required edit authority, while preflight receives no project tools.
- A multibyte oversized result reconstructs byte-for-byte across pages with matching digest, byte count, stable identity, stable cursors, terminal metadata, deterministic invalid-cursor handling, and unchanged poll delivery semantics.
- Cancellation, reload, and shutdown reach terminal root accounting for cooperative and non-cooperative children without duplicate completion, active-count leaks, unsafe late result delivery, or root-state mutation after detachment.
- Internal-dev rejects missing, duplicate, malformed, or code-fenced required headings before exclusive creation; normalization such as changelog commit insertion is followed by final validation; valid artifacts remain exclusive.
- Ordinary session start does not request internal-dev initialization, and injected guidance points to the generated `AGENTS.md` contract instead of duplicating it.
- The orchestrate skill calls deterministic tools, requests exact child tool sets, retains implementer and validator edit authority, contains no separate repair loop, preserves authoritative waves and PASS-before-dependent barriers, and records phase and integration evidence before reporting completion.
- Package manifests declare every consumed Pi SDK, AI, TUI, schema, user-questioning, and subagent dependency at the consuming boundary.
- Public documentation lists every planning, validation, execution-record, and subagent tool, including `sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`, `sprint_validate_plan`, `subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel`, and explicitly supersedes nested-subagent behavior.
- Repository-wide searches prove that `atomicWriteJson`, `replaceFlatDirectory`, and `ArtifactSink` have no live consumers before removal, while the absent prose scanner and single correct `xhigh` thinking-level entry remain unchanged unless drift is found.
- Final review finds no unrelated edits, accidental public API growth, placeholders, stale specification statements, unsupported recovery claims, or changes made only to restate passing invariants.
- A manual eight-worker brainstorm → ironout → advance-plan → orchestrate pipeline completes with durable execution evidence, source bytes unchanged, every phase durably PASS, and final integration durably PASS.
