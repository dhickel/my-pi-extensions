## Context

Living specifications and public documentation currently deny durable orchestration evidence, omit new tools, describe inherited subagent permissions, advertise unsolicited internal-dev initialization, and retain a superseded nested-subagent request. Package declarations, final validation, and a compliant changelog must agree with the stabilized implementation.

## Goal

Reconcile intended contracts, durable decisions, package manifests, reusable knowledge, and public documentation with implemented behavior; complete phase-level integration checks so orchestration can apply its post-phase PASS gate and subsequent final integration gate.

## In Scope

**Source Edit Targets**:

- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/changelogs/extension-ecosystem-hardening.md`
- `sprint-planner/package.json`
- `subagents/package.json`
- `internal-dev/package.json`
- `user-questioning/package.json`
- `sprint-planner/README.md`
- `sprint-planner.md`
- `subagents/README.md`
- `subagents.md`

The phase covers:

- Living sprint-planner contracts and durable decisions.
- Reusable runtime knowledge confirmed by implementation.
- Public tool, lifecycle, persistence, and package documentation.
- Supersession of nested-subagent behavior.
- Package, resource, manifest, and isolated end-to-end acceptance validation.
- A final changelog with specification impact and Git baseline.

Tool-generated planning and execution records in the isolated acceptance workspace are validation evidence, not additional source edit targets.

## Out of Scope

- A recovery skill, nested agents, new model routes, or replacement execution topology.
- Code or skill edits outside the declared source targets.
- Rewriting historical handoffs, backups, accepted source plans, or artifact history.
- Claims of crash-atomic multi-path publication, automatic recovery, or confirmed remote provider termination.
- Running the acceptance pipeline against the active nine-phase hardening plan or otherwise recursively invoking phase 09.

## Dependencies

`phase-08-skill-policy-integration.md` must have recorded PASS. Its dependency closure supplies the completed planner, run-record, execution-record, subagent, and internal-dev behavior documented and validated here.

## Constraints

- Code is logical truth, corrected shared concepts are planning authority, and living specifications state final intended behavior. Do not document around a code/specification conflict.
- Preserve the exact phase file set and orchestration ledger. Do not edit another phase.
- Restrict repairs to declared source targets. If validation finds a code or skill defect outside those targets, report `BLOCKED` with reproducible evidence rather than expanding scope.
- Document no-replace and ownership guarantees accurately; do not claim crash-atomic multi-path publication.
- Describe forced child detachment as bounded terminal root accounting, not proof that remote provider work stopped.
- Keep planning-run state, lease, plan-validation result, and execution-record versions distinct.
- Keep execution records separate from source plan and planning-run directories; source identifiers, hashes, and bytes remain immutable.
- Preserve exact provider, model, thinking, and tool routes. Do not introduce fallback, inheritance, clamping, or substitution language.
- Preserve prompt-only delivery-forecast guidance and valid technical timeout, TTL, retry, polling, lease, cache, retention, and complexity semantics.
- List and doctor remain read-only; reload and process start never launch provider work.
- Historical backups are not live package consumers. Do not rewrite them to satisfy searches.
- Do not churn the absent forecast prose scanner or the already-correct `xhigh` thinking-level entry unless evidence shows drift.

## Implementation Steps

1. Update `.internal-dev/specifications/sprint-planner-suite.md` to list `/sprint list`, `/sprint doctor`, `sprint_validate_plan`, and `sprint_execution_record`; describe versioned leases, structured validation, decomposition correction and freeze, failure-safe fan-outs, exact retry accounting, execution-only records, source immutability, and durable validator and integration evidence. Replace the stale denial of durable orchestration evidence while keeping worker coordination outside the planning engine.
2. Append focused durable decisions to `.internal-dev/specifications/decisions.md` for conservative run leases and read-only doctor, distinct execution-only sprint records, exact child tool sets, and session-local paginated results with bounded terminal detachment. For each decision include justification, rejected alternatives or tradeoffs, caveats, affected specification, source handoff, and review triggers.
3. Update `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` only with reusable implementation facts confirmed by code and tests: structured parser reuse, interruption-neutral retry accounting, scope-local fan-out settlement, conservative lease uncertainty, execution revision ordering, UTF-8-safe page reconstruction, and late-result suppression. Keep intended policy and durable tradeoffs in specifications rather than duplicating them here.
4. Update `sprint-planner/README.md` with every command and tool and its read/write behavior: `sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`, `sprint_validate_plan`, and `sprint_execution_record`; `/sprint list` and `/sprint doctor`; leases; execution-only layout; source immutability; explicit non-recovery semantics; and the exact orchestrate model, thinking, and tool routes.
5. Update root `sprint-planner.md` so its concise pointer names the complete public planning, validation, and execution-record surface and directs detailed behavior to the living specification and package README.
6. Update `subagents/README.md` to document required exact tool-name arrays and fingerprints, complete-batch atomic rejection, flat root-owned pooling with no nesting, immutable result snapshots, UTF-8-safe page reconstruction and integrity metadata, root-session result lifetime, unchanged poll delivery semantics, and bounded cancellation, detachment, and late-result suppression. Explicitly list `subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel`.
7. Replace the legacy request in `subagents.md` with a concise supersession note: nested subagents are unsupported, and the implemented contract is a flat root-owned pool with exact tool policies. Link to `subagents/README.md` for the public contract.
8. Audit `sprint-planner/package.json`, `subagents/package.json`, `internal-dev/package.json`, and `user-questioning/package.json` against actual external imports and Pi `docs/packages.md`. Correct only genuine missing declarations at the consuming package boundary; do not add transitive, duplicate, or unused dependencies. Keep edits within the four declared manifests.
9. Run all package suites and applicable resource, manifest, dependency, type, and command-discovery checks. Verify RPC discovery omits an extension `/orchestrate`, resolves `skill:orchestrate`, and exposes the documented commands and tools. Search live sources and current docs for stale model tuples, inherited-tool claims, separate repair loops, durability denials, forecast scanners, dead APIs, and duplicate or missing `xhigh` entries. Use module-aware searches before concluding that `atomicWriteJson`, `replaceFlatDirectory`, or `ArtifactSink` has no live consumer; exclude historical backups from live-consumer conclusions. If a failure requires an edit outside this phase’s targets, capture the exact command and evidence and stop as `BLOCKED`.
10. In an isolated disposable Git acceptance workspace, execute the manual eight-worker brainstorm → ironout → advance-plan → orchestrate pipeline using a newly generated current-schema plan, never the active hardening plan. Validate all-to-all cross-review, decomposition and plan validation, exact preflight and worker tool policies, durable execution checkpoints, phase PASS barriers, final integration PASS within that acceptance run, and no automatic provider work on reload. Hash the accepted source plan files before orchestration and verify byte identity afterward; reload the extension and confirm completed planning and execution evidence remains inspectable. Preserve the generated records as acceptance evidence without adding them to the source edit set.
11. Create `.internal-dev/changelogs/extension-ecosystem-hardening.md` through exclusive creation with all required headings. If the path already exists, do not overwrite it; inspect and deliberately reconcile the existing artifact under the internal-dev contract or stop on an unresolved ownership conflict. Record the declared changed files, behavioral impact, risks, validation evidence actually completed in steps 9–10, the current full Git `HEAD` as the dirty-worktree baseline when applicable, and the exact specification and decision impact. Review the final diff for unrelated edits, placeholders, accidental APIs, stale claims, verification-only churn, and unplanned generated files.

## Edge Cases

- An accepted legacy source plan may fail current schema validation. Report the incompatibility without rewriting history, and use a newly generated plan for acceptance.
- An uncertain lease is not stale merely because its owner cannot be confirmed. Doctor reports it and performs no write, release, clearing, or takeover.
- A stale execution revision fails deterministically; evidence and the revision advance before success is exposed.
- Deleted changed files retain canonical path and deleted status but no fabricated digest or byte metadata.
- Oversized multibyte results must reconstruct byte-for-byte from stable cursors with matching digest, byte count, identity, and terminal metadata.
- A detached non-cooperative child settles root accounting once and cannot deliver a late result or mutate root state; documentation must not infer provider termination.
- Cap-driven worker batching remains one declared logical wave and does not relax its full PASS barrier.
- A validation failure outside the declared targets is a concrete blocker, not permission to edit another phase’s implementation.

## Required Guides

- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/AGENTS.md`
- Pi `docs/packages.md`
- Pi `docs/extensions.md`
- Pi `docs/skills.md`

Read each applicable Pi guide completely and follow its relevant cross-references before changing package or public extension documentation.

## Technical Guidance

Keep every claim tied to code, tests, or recorded acceptance evidence. Prefer exact state and schema names over generalized “run” terminology. Use “root accounting detached” rather than “provider terminated.” Keep `sprint_execution_record` a persistence boundary: orchestration decides when to spawn, poll, validate, checkpoint, finish, or stop. Document generated-plan waves as authoritative; unsafe or uncertain declared parallelism is rejected rather than silently serialized or replaced. Do not add speculative APIs or prose algorithms that duplicate TypeScript validation.

## Validation

- Run `npm --prefix sprint-planner test`.
- Run `npm --prefix subagents test`.
- Run `npm --prefix internal-dev test`.
- Run `npm --prefix user-questioning test`.
- Run the repository’s applicable Pi RPC resource, command, manifest, dependency, type, and package checks.
- Complete the isolated eight-worker acceptance pipeline from step 10 and inspect its planning and execution records after reload.
- Search final current docs, specifications, and skills for stale routes, nested-agent support, inherited permissions, separate repair loops, source mutation, automatic resume, and denied durability.
- Verify the changelog’s full Git hash, changed-file list, completed validation evidence, and specification-impact sections against repository state.
- Review the final diff against the authoritative phase 09 target list.
- Submit phase 09 to the required GPT-5.6 Sol `medium` editing validator. The validator may repair only in-scope defects and must durably record PASS before the phase is complete; `BLOCKED` requires a concrete condition outside its edit authority.
- Only after every phase, including phase 09, has durable PASS may orchestration begin its separate final integration validation with GPT-5.6 Sol `medium`.

## Exit Criteria

- Intended contracts, durable decisions, reusable knowledge, public docs, package metadata, and implemented behavior agree.
- Every required public tool is documented with accurate mutation, lifecycle, schema, and ownership semantics.
- Nested subagents, inherited child permissions, and the separate DeepSeek repair loop are explicitly superseded.
- All package, resource, manifest, dependency, type, and command checks pass.
- The isolated manual acceptance pipeline passes with durable phase and integration evidence, byte-identical source plans, inspectable records after reload, and no automatic provider work.
- The final source diff is restricted to the authoritative targets, contains no placeholders, stale contract conflicts, accidental public APIs, historical rewrites, or verification-only churn, and includes a compliant changelog.
- The post-phase GPT-5.6 Sol `medium` validator has durably recorded PASS. The separate orchestration final integration gate remains ordered after all phase PASS records.
