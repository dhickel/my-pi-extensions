# Extension Ecosystem Hardening Handoff

## Context

The baseline source is `.internal-dev/handoffs/2026-07-19-extension-hardening-handoff.md`. This corrected handoff resolves that document’s open alternatives and supersedes it as implementation-planning authority once accepted.

Focused repository inspection confirms strong happy-path planning behavior alongside material reliability and contract gaps. Current evidence includes truncation-only worker session identifiers in `sprint-planner/commands.ts`, unscoped parallel worker fan-outs in `sprint-planner/engine.ts`, incomplete synthesis coverage checks, generic retry prompts, no persisted-run lease, a contradictory repair section in `sprint-planner/skills/orchestrate/SKILL.md`, memory-only orchestration outcomes, unrestricted inherited child tools, shutdown paths that can wait indefinitely for a non-cooperative child, and unvalidated user-supplied `.internal-dev` artifact content.

Some baseline cleanup observations are already satisfied. `sprint-planner/validation.ts` contains no prose forecast scanner, and `subagents/core.ts` already lists `xhigh` exactly once in `THINKING_LEVELS`. Treat these as regression invariants: verify them and change code only if implementation work introduces or discovers drift.

The living sprint-planner specification establishes exact model routes, a flat plan format, planning/implementation separation, editing GPT validators, and prompt-only delivery-forecast guidance. It is stale where it lists only one planning tool and denies durable orchestration evidence. Hardening must preserve settled contracts while correcting those statements.

## Objective

Make the sprint-planner, orchestrate, subagents, internal-dev, senior-agent, image-viewing, and supporting package surface reliable under concurrency, interruption, malformed output, oversized output, and process reload. Move deterministic parsing, validation, ownership, locking, result retrieval, and checkpoint records into code. Keep skills concise and policy-focused.

Resolve every confirmed P0–P2 finding and the named cleanup items without changing model assignments, plan layout, phase-budget rules, or the planning/implementation ownership boundary. Verification-only items must not create unnecessary edits.

## Targets

- `sprint-planner/commands.ts`, `engine.ts`, `pi-runner.ts`, `validation.ts`, `types.ts`, `artifacts.ts`, `index.ts`, `prompts.ts`, package metadata, tests, and README.
- `sprint-planner/skills/orchestrate/SKILL.md` and its contract tests.
- `subagents/core.ts`, `index.ts`, package metadata, tests, and README.
- `internal-dev/core.ts`, `index.ts`, `contract.ts`, tests, and README.
- Living specifications and durable decisions under `.internal-dev/specifications/`, especially `sprint-planner-suite.md` and `decisions.md`.
- Public root documents, including `sprint-planner.md` and `subagents.md`, where they conflict with implemented behavior.
- `skills/senior-agent/SKILL.md` and `skills/image-viewing/SKILL.md` only where tool policy or public-surface documentation must be aligned; their fixed routes remain unchanged.
- Package dependency declarations at the package boundaries that directly consume the Pi SDK, TUI, schema, user-questioning, or subagent APIs.

## Features

- Collision-resistant worker session identifiers with a readable safe prefix and deterministic hash suffix derived from the complete source identifier, always within the provider’s key limit.
- Failure-safe parallel fan-outs with scope-local cancellation, complete sibling settlement, preserved primary failure evidence, and no active-worker leak when the parent returns.
- Retry accounting that does not charge an interrupted call. Completed provider failures and malformed or semantically invalid submissions remain bounded and survive resume.
- Retry prompts containing the exact prior semantic validation failure for persisted and standalone planning calls.
- Synthesis validation requiring references to every finding and every cross-review path.
- A decomposition correction gate before the plan file set freezes, followed by deterministic cross-validation of phase identities, dependencies, goals, write areas, and orchestration metadata.
- A persisted-run lease preventing concurrent mutation of one planning or execution record across processes.
- `/sprint list` for safe record discovery and `/sprint doctor [run-id]` for read-only diagnosis of schema version, artifacts, hashes, semantics, leases, manifests, and recoverability.
- Immediate status reporting with a stable `starting` state established before background initialization can race status inspection.
- `--` option termination so prompt text beginning with option-like content is preserved verbatim.
- A read-only `sprint_validate_plan` tool backed directly by the TypeScript plan-directory parser and returning a versioned structured result.
- Durable orchestration execution records with immutable source references, a phase ledger, implementation outcomes, validator verdicts, integration verdict, changed-file evidence, and terminal state.
- Exact per-agent tool policies in `subagent_spawn`, validated atomically with model and thinking tuples before any child starts.
- Recoverable oversized subagent output through stable paginated `subagent_status` retrieval with reconstruction and integrity metadata and UTF-8-safe boundaries.
- Bounded cancellation and shutdown escalation so a non-cooperative child cannot indefinitely block root lifecycle completion or create double completion.
- Kind-specific validation of user-supplied `internal_dev` artifact content before exclusive creation.
- Explicit internal-dev initialization with no unsolicited creation prompt during ordinary session start.
- Concise injected internal-dev state guidance that points to the generated `AGENTS.md` contract instead of duplicating it.
- Removal of `atomicWriteJson`, `replaceFlatDirectory`, and `ArtifactSink` only after repository-wide reference checks prove them unused.
- Verification that `ThinkingLevel` includes `xhigh` exactly once; no edit is required while that invariant already holds.
- Complete documentation of all public tools.
- Reduced redundant brainstorm context transfer and concurrent phase corrective reviews only after corrected concepts and orchestration are available, while preserving all-to-all review and deterministic publication barriers.

## Settled Decisions

- Keep prose delivery-forecast guidance in prompts only. Structural and semantic validators must not infer intent by scanning wording. The removed scanner must remain absent.
- Preserve the GPT validator-owned repair contract. Delete the orchestrate skill’s separate DeepSeek repair section and tests that permit that loop. `BLOCKED` is reserved for a concrete condition outside validator edit authority.
- Validators are not read-only. Implementers and validators receive the inspection, editing, and command tools required by their assignments. Preflight agents receive no project tools. Image-viewing remains inspection-only. Senior-agent tools follow the authority granted in its escalation brief.
- Tool policies are exact, not additive. Each agent specification carries the complete requested tool-name set. Runtime construction intersects role requirements with currently available non-root, non-subagent tools; any unknown, unavailable, duplicate, root-only, or forbidden name rejects the complete batch before child initialization. Excluded tool definitions and their prompt guidance are removed from child context.
- `sprint_validate_plan` is an agent-callable read-only tool exposed by the sprint-planner extension. It is not a separate CLI and the orchestrate skill must not duplicate the parser in prose.
- Durable orchestration records live in a distinct `.internal-dev/sprints/<execution-run-id>/` direct child. Each execution record has its own unique identifier, immutable source reference, `execution/` subtree, and canonical `manifest.md`. It must not reuse, modify, or place runtime material inside the source plan directory or source planning run.
- An execution-only manifest marks planning as external or not performed in that record and identifies the authoritative input. Execution records survive reload and make completed verdicts inspectable. Automatic continuation and a dedicated orchestration recovery skill remain outside scope.
- Oversized subagent output uses pagination rather than a persistent cross-session result store. Pages come from one immutable completed-result snapshot and return an opaque cursor, next cursor, stable result identity, total byte count, content digest, and completion metadata. Existing poll delivery semantics and root-session result lifetime remain unchanged.
- `/sprint doctor` diagnoses and recommends safe action but never mutates artifacts, clears uncertain ownership, steals a lease, or bypasses confirmed reset.
- A lease is acquired exclusively before mutable work begins in a direct-child run record. It records owner identity and run kind, is released on clean termination, and is treated conservatively whenever ownership cannot be disproved. A planning run and an execution run never share a lease file because they never share a run directory. Concurrent start or resume fails with actionable evidence.
- Interruption never consumes a retry. A completed provider failure or invalid submission consumes the configured budget, and resume preserves those genuine failures.
- Plan decomposition may change only at the pre-freeze correction gate. Once frozen, component reviewers preserve the file set.
- Standalone planning commands remain stateless in their publication contract. Durable orchestration records address implementation evidence; they do not add standalone brainstorm, ironout, or advance-plan recovery state.
- Keep the flat plan set exactly `concepts.md`, `orchestration.md`, and contiguous `phase-NN-*.md` files. Reviews and execution records remain outside plan directories.
- Retain exact routes: DeepSeek Pro V4 at `max` for implementation, GPT-5.6 Sol at `medium` for phase and integration validation, and all existing sprint-planner authoring routes unchanged. No fallback, clamping, inheritance, or substitution is permitted.
- Mark the nesting request in `subagents.md` as superseded. Nested subagents remain unsupported; the extension exposes a flat root-owned pool.
- Remove dead APIs only after reference checks prove they are not consumed. Do not replace them with speculative abstractions.
- Already-correct invariants are acceptance checks, not reasons to rewrite code.

## Constraints

- Preserve existing commands and agent-callable tools except for verified dead internal surfaces. Additions must remain compatible with current callers.
- The sprint-planner engine owns planning. The orchestrate skill owns implementation and validation. Persistence of execution evidence must not move implementation into the planning engine.
- Do not change provider, model, or thinking assignments.
- Do not change plan-directory shape, phase-budget rules, no-replace publication, or identity-checked best-effort rollback semantics.
- Keep resume explicit. Reload or process start must not launch provider work automatically.
- Preserve unrelated edits, untracked files, and existing artifact history.
- Deterministic failures must include actionable evidence suitable for retry prompts, doctor output, and tests.
- Persistence, lease, and pagination formats must be versioned and parsed by code rather than inferred from prose.
- New paths must reject traversal, symbolic-link traversal, foreign ownership, existing-record replacement, and source/execution identifier aliasing.
- Tool-policy enforcement must remove disallowed tool definitions and prompt guidance, not merely hide invocation names.
- Existing suites must remain green, and every repaired failure mode must receive focused regression coverage.
- Documentation, living specifications, and durable decisions must match code at sign-off. Conflicts may not remain as unexplained history.
- Do not introduce placeholders, fake persistence, silent recovery, or unsupported lifecycle claims.

## Scope

### In Scope

- Both critical defects: worker identifier collisions and orphaned parallel siblings.
- Planning reliability gaps: retry accounting, semantic retry feedback, cross-review synthesis coverage, run leases, decomposition correction, plan cross-consistency, immediate status, option termination, context duplication, and safe corrective-review concurrency.
- Recovery and observability: list, doctor, plan-validation tool, and durable execution records.
- Orchestrate policy correction, deterministic plan validation, checkpoint recording, exact tool policies, and preservation of PASS-before-dependent barriers.
- Subagent paginated results, cancellation escalation, exact child tool policies, package metadata, tests, and documentation.
- Internal-dev content validation, explicit initialization behavior, contract deduplication, tests, and documentation.
- Specification, decision, README, legacy-document, public-tool, dependency, type, and dead-code cleanup required by confirmed findings.
- Verification-only checks for the absent prose scanner and already-correct thinking-level union.

### Out of Scope

- A new orchestration recovery skill or automatic orchestration continuation.
- New model routes or changed reasoning assignments.
- Nested subagents.
- A new `.internal-dev/executions/` store.
- Mutation of source plan directories or reuse of a source planning-run directory as an execution record.
- Rewriting publication ownership into a stronger transaction claim.
- Changing phase budgets or nesting plans.
- Broad redesigns of Pi session management, generic workflow frameworks, or unrelated extension behavior.

## Assumptions

- `.internal-dev/sprints/` can represent an execution-only run when a canonical manifest marks planning as external or not performed and references the authoritative source.
- The current TypeScript plan parser remains the sole source of truth for generated-plan acceptance; the new tool wraps it without reimplementing it.
- Root-session result pagination is sufficient because cross-session subagent result persistence is not required.
- Exact tool-name sets can be constructed from active Pi tool definitions and verified with the existing fingerprint mechanism.
- Pi lifecycle APIs permit abort, disposal, terminal detachment, and late-completion suppression without corrupting root accounting. If inspection disproves this, escalate the lifecycle contract conflict before implementing a weaker claim.
- Existing authoritative plan waves remain binding. Hardening may reject unsafe metadata but may not silently invent replacement topology.
- The stricter sprint handoff schema and generic internal-dev handoff template are separate contracts. Internal-dev validates each artifact kind against its canonical required headings; sprint-planner retains its fuller handoff requirements.
- Distinct execution identifiers can be allocated with no-replace creation while preserving readable source references.

## Recommended Direction

- Begin with focused baseline tests that distinguish confirmed defects from already-satisfied invariants.
- Establish small deterministic primitives for hashed identifiers, scoped fan-out settlement, structured validation results, leases, versioned execution records, and result-page reconstruction. Keep policy prose outside these primitives.
- Make state transitions explicit and persist evidence before exposing completion. A phase completes only after its validator PASS is durably recorded; an execution completes only after integration PASS is recorded.
- Use a versioned execution schema beneath `execution/` for source metadata, phase ledger, implementation evidence, validator evidence, integration evidence, and terminal state. Keep `manifest.md` canonical and human-readable.
- Reuse `validatePlanDirectory` through `sprint_validate_plan`, and reduce the orchestrate skill to input interpretation, exact tool calls, authoritative wave coordination, checkpoint writes, and evidence reporting.
- Make child permissions role-driven and fail closed. Validate exact model tuples, thinking levels, requested tool-name sets, and tool fingerprints in one atomic batch boundary.
- Keep recovery conservative: list discovers, doctor diagnoses, leases reject competing ownership, and reset remains the only destructive run-store operation.
- Parallelize only independent work with scope-local cancellation and complete settlement. Preserve deterministic ordering wherever outputs establish shared plan structure.
- Validate user-supplied internal-dev content before commit insertion and exclusive creation, then validate the final normalized content again where kind-specific normalization applies.
- Update specifications, durable decisions, public documentation, and contract tests together with behavior. Replace stale persistence and public-tool statements rather than leaving contradictory caveats.
- Prefer deletion and direct code over replacement abstractions during cleanup. Avoid code churn where an acceptance invariant already passes.

## Validation

- Run all current tests for `sprint-planner`, `subagents`, `internal-dev`, and `user-questioning`, plus applicable package type, resource, and manifest checks.
- Add collision tests using distinct maximum-length worker identifiers with identical safe prefixes; verify valid, stable, distinct outputs and provider-limit compliance.
- Add fan-out failure tests proving every started sibling is cancelled, settled, and removed from active-worker tracking before the parent returns, while the primary failure remains identifiable.
- Verify interruption and resume within the retry budget, preservation of completed failed-attempt counts, and inclusion of the exact prior semantic error in the next child prompt.
- Verify synthesis rejects omission of any finding or cross-review path.
- Verify decomposition correction can adjust the file set before freeze, later component review cannot, and final validation rejects phase/orchestration drift.
- Exercise exclusive lease acquisition, competing-process rejection, clean release, uncertain-owner diagnosis, run-kind separation, record-name collisions, and symlink or ownership attacks.
- Verify `/sprint list`, `/sprint doctor`, immediate `/sprint status`, and `--` prompt preservation for valid, completed, interrupted, malformed, leased, execution-only, and missing records.
- Verify doctor performs no writes and never clears or steals a lease.
- Verify `sprint_validate_plan` accepts a valid flat plan and returns stable structured failures for shape, budget, dependency, wave, target, route, gate, and symbolic-link defects.
- Reconstruct a multibyte oversized subagent result exactly through multiple pages; verify digest, byte count, cursor stability, terminal metadata, invalid-cursor handling, and unchanged poll delivery semantics.
- Simulate a child that ignores abort and prove cancel, reload, and shutdown reach terminal root accounting without double completion, leaked active counts, or unsafe late-result delivery.
- Verify each spawn uses the complete requested tool-name set, disallowed tool records and guidance are absent, invalid policies reject the whole batch before initialization, and implementer and validator policies retain required edit authority.
- Verify preflight agents receive no project tools and still validate the exact model and thinking tuples.
- Verify user-supplied internal-dev artifacts missing canonical headings are rejected before creation, duplicate or malformed required headings fail deterministically, valid artifacts remain exclusive, and changelog commit insertion still produces valid final content.
- Verify ordinary session start no longer requests internal-dev initialization and injected guidance points to, rather than duplicates, the generated contract.
- Confirm the orchestrate skill contains no separate repair loop and retains exact routes, validator edit authority, PASS/BLOCKED verdicts, authoritative wave barriers, and final integration gating.
- Create an execution-only sprint record from an external plan; verify its identifier differs from the source record, the source remains byte-identical, the manifest marks planning correctly, completed verdicts survive reload, and no automatic provider work begins.
- Complete a manual brainstorm → ironout → advance-plan → orchestrate pipeline with eight brainstorm workers, durable execution evidence, and final integration PASS.
- Search the repository to confirm `atomicWriteJson`, `replaceFlatDirectory`, and `ArtifactSink` have no remaining consumers before removal; confirm the prose scanner remains absent and `THINKING_LEVELS` contains `xhigh` exactly once without forcing an edit.
- Confirm package dependencies are declared at the consuming boundaries and public documentation lists `sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`, `sprint_validate_plan`, `subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel`.
- Review the final diff for unrelated edits, accidental API growth, placeholders, stale specifications, unsupported recovery claims, and changes made only to restate passing invariants.

## Open Questions

None. Record location, tool form, validator authority, tool-policy semantics, and oversized-result retrieval are settled above. Any implementation evidence that invalidates an assumption is a contract conflict and must be presented before scope, architecture, public behavior, or store layout changes.

## Sign-off

Approved as the complete corrected handoff for implementation planning. It supersedes the cited baseline handoff, preserves settled model and ownership contracts, distinguishes confirmed defects from verification-only invariants, and defines objective acceptance evidence. Explicit sign-off: ready for implementation planning.
