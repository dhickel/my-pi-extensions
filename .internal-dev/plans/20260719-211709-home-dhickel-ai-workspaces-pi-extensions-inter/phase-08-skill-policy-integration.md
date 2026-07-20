## Context

The orchestrate skill duplicates deterministic plan checks, permits a contradictory DeepSeek repair loop, keeps orchestration evidence in memory, omits exact child tool sets, and describes pre-pagination result recovery. Senior-agent and image-viewing also omit exact tool policy. Phases 04, 06, and 07 provide the persistence, result-lifecycle, and artifact-contract behavior this phase must consume rather than reproduce.

## Goal

Align orchestration and specialist skills with deterministic tools, exact permissions, authoritative waves, durable evidence, and validator-owned repair.

## In Scope

**Write Targets**: `sprint-planner/skills/orchestrate/SKILL.md`, `sprint-planner/test/core.test.ts`, `skills/senior-agent/SKILL.md`, `skills/image-viewing/SKILL.md`

- Deterministic generated-plan validation and execution-record calls.
- Exact role-specific subagent tool sets.
- Authoritative wave coordination, full implementation-wave settlement, and PASS barriers.
- Paged reconstruction of oversized immutable results without changing polling semantics.
- Removal of the separate repair path.
- Durable implementation, validator, changed-file, integration, blocker, and terminal evidence.
- Specialist skill permission alignment and contract/mutation tests.

## Out of Scope

- New model routes, thinking levels, worker topology, or public tools.
- Automatic orchestration recovery or provider work on reload/process start.
- Nested agents.
- Reimplementation of plan parsing, path checks, ownership, leases, execution schemas, result pagination, fingerprints, or artifact validation in skill prose.
- Changes to files outside the declared write targets.

## Dependencies

- `phase-04-durable-execution-records.md` supplies `sprint_execution_record` start/checkpoint/finish actions, immutable source metadata, optimistic revisions, changed-file evidence, and terminal transitions.
- `phase-06-subagent-results-and-shutdown.md` supplies immutable result snapshots, UTF-8-safe result pages, stable cursors/digests, and bounded terminal cancellation.
- `phase-07-internal-dev-content-and-init.md` supplies final normalized artifact validation and concise routing guidance.

All three dependencies must have recorded PASS before this phase starts. The phase belongs in `wave-05`; `phase-09-specifications-docs-and-integration.md` remains blocked until this phase records PASS.

## Constraints

- Preserve the exact implementation tuple `deepseek/deepseek-v4-pro:max`, phase/integration validator tuple `openai-codex/gpt-5.6-sol:medium`, senior tuple `openai-codex/gpt-5.6-sol:xhigh`, and image-viewing tuple `openai-codex/gpt-5.6-sol:medium`. Do not inherit, clamp, substitute, or add fallback routes.
- Preflight uses one atomic batch containing both no-op agents, each with `tools: []`.
- Implementers and phase/integration validators use exactly `tools: ["read", "grep", "find", "ls", "bash", "edit", "write"]`.
- Image-viewing uses exactly `tools: ["read"]`.
- Advisory senior agents use exactly `tools: ["read", "grep", "find", "ls"]`. A senior brief that explicitly grants implementation or repair authority uses exactly `tools: ["read", "grep", "find", "ls", "bash", "edit", "write"]`.
- No child receives subagent, sprint execution, sprint validation, user-questioning, root-only, or undeclared tools. Atomic spawn rejection blocks execution; never reduce a required set to make a spawn succeed.
- GPT validators inspect actual state, repair every in-scope defect themselves, rerun affected checks, and return only `VERDICT: PASS` or a genuine externally blocked `VERDICT: BLOCKED`. No `REPAIR` verdict, separate DeepSeek repair worker, repair cycle, or repair handoff remains.
- Generated-plan waves, exactly one implementer per phase, the four-active-agent cap, full implementation-wave settlement, validator write-set safety, and full-wave PASS-before-dependent barriers remain binding. Unsafe or uncertain authoritative parallelism blocks; it is never silently serialized or replaced.
- Root orchestration owns deterministic tool and execution-record calls. Source plan and planning-run bytes remain unchanged, execution identifiers never alias source identifiers, and runtime material never enters a source plan or planning-run directory.
- Every launched agent is polled to a terminal state. Paging supplements truncated delivery; it never replaces polling or changes delivery lifetime.
- Plans, skill instructions, delegated reports, and closeout evidence contain no human delivery forecasts. Operational waves and technical timeout, retry, polling, lease, and cancellation bounds remain valid.

## Implementation Steps

1. In `sprint-planner/skills/orchestrate/SKILL.md`, replace the generated plan-directory parser checklist with exactly one `sprint_validate_plan` call. Stop before provider work when its versioned result has `valid: false`, preserving categorized findings in the report. Retain only policy interpretation that code cannot decide: resolving raw or pasted non-authoritative input, preserving accepted scope, and surfacing genuine authority conflicts. Do not apply the directory tool to arbitrary prose.

2. Add the execution-record flow after authoritative input resolution and generated-plan validation but before any provider work or edit. Call `sprint_execution_record` with `start`; use an execution identifier distinct from every source identifier; retain the immutable source reference, source hashes, and returned revision. Pass the latest returned revision to every checkpoint/finish call and treat stale-revision rejection as a blocker rather than retrying from guessed state. Checkpoint evidence before exposing each state transition. On integration PASS, checkpoint integration evidence and then `finish` as completed. On a genuine blocker, interruption, or root cancellation, first checkpoint available evidence and terminal child outcomes, then `finish` with the truthful non-success terminal state. Never mark completed without durable integration PASS.

3. Add a literal `tools` array to every `subagent_spawn` example and role instruction. Use `[]` for both preflight agents; the exact seven-tool editing set for implementers and phase/integration validators; the four-tool advisory set or seven-tool edit-authorized set for senior-agent; and `read` only for image-viewing. State that tool names and fingerprints are validated atomically by the subagent implementation before any child initialization, and that unavailable or mismatched required tools block the complete batch.

4. Update oversized-result handling to continue `subagent_poll` until every launched agent is terminal, then use the Phase 06 `subagent_status` result-page contract when visible output is truncated. Follow the returned stable result identity and cursor chain, concatenate UTF-8-safe page bytes in order, and verify final digest, byte count, completion metadata, and terminal identity before consuming the reconstructed report. Invalid/stale cursors or verification mismatch block that evidence path; do not infer missing text or repoll it as a new result.

5. Delete the complete “Repair blocked phases” policy and every instruction that permits `REPAIR`, a separate DeepSeek repair worker, or repair→revalidate cycles. Define `BLOCKED` only as a concrete condition outside validator edit authority. On BLOCKED, durably checkpoint the verdict and evidence, start no dependent, cancel only active work that is unsafe to continue, and poll every launched or cancelled agent to terminal before recording the orchestration terminal outcome and required external action.

6. Retain one retry for a malformed or missing validator verdict using a fresh, uniquely named GPT-5.6 Sol medium validator with the same exact editing tool set and authority. A malformed response never becomes PASS, BLOCKED evidence by itself, or a DeepSeek repair request. If the retry is malformed, record the concrete protocol failure and stop without opening the dependency barrier.

7. Before concurrent validators, derive actual changed paths from observed repository state, not only child self-reports. Combine canonical present/deleted path observations and available digest/byte metadata with each validator-authorized repair boundary and newly discovered shared mutable state. Run validators concurrently only when those complete write areas remain disjoint; otherwise serialize validators within the declared logical wave. After each validator terminates, observe implementation and validator changes again and checkpoint the changed-file set plus verdict before marking PASS or opening any dependent barrier.

8. Update `skills/senior-agent/SKILL.md` so every spawn carries the exact advisory or edit-authorized tool array. The escalation brief must explicitly determine which array applies; ambiguous authority uses advisory tools and does not edit. Exclude subagent, sprint, user-questioning, and other root-only tools. Preserve the escalation trigger, one focused senior agent by default, fixed `openai-codex/gpt-5.6-sol:xhigh` route, self-contained brief, terminal polling, and caller-side verification.

9. Update `skills/image-viewing/SKILL.md` so its single spawn uses exactly `tools: ["read"]`. Preserve the known-no-image-capability trigger, explicit local image paths, required image reads, inspection-only boundary, fixed `openai-codex/gpt-5.6-sol:medium` route, terminal polling, and no fallback model.

10. Rewrite the skill contract and mutation tests in `sprint-planner/test/core.test.ts`. Parse every fenced spawn example and assert exact provider, model, thinking level, and tools. Require `sprint_validate_plan`, the revision-chained `sprint_execution_record` flow, source/execution separation, immutable source policy, observed changed-file checkpoints, terminal polling, verified result paging, authoritative waves, PASS barriers, and PASS/BLOCKED-only validation. Load and check both specialist skills. Remove assertions that permit the retired repair path and add negative mutations for omitted/extra tools, parser duplication, stale or omitted revision use, source mutation/aliasing, uncheckpointed PASS or completion, separate repair, dependency-before-PASS, paging without digest/byte verification, and nonterminal cancellation.

## Required Guides

- Pi `docs/skills.md`
- Pi `docs/extensions.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `sprint-planner/skills/orchestrate/SKILL.md`
- `skills/senior-agent/SKILL.md`
- `skills/image-viewing/SKILL.md`

Read the two Pi guides completely and follow only task-relevant cross-references needed to verify APIs used by these skills.

## Technical Guidance

Keep orchestrate procedural and concise: resolve authority, validate generated plans, start the execution record, preflight exact tuples/tools, coordinate authoritative waves, spawn/poll/page, run editing validators, checkpoint observed evidence, and finish terminally. Refer to deterministic tool results instead of restating their TypeScript rules.

The durable order is:

1. resolve authoritative input;
2. validate a generated plan directory;
3. start an execution record and retain its revision;
4. preflight exact tuples and empty tool sets;
5. settle every implementation in the logical wave and checkpoint each terminal outcome;
6. observe changed paths, run safe validators, and checkpoint each verdict and changed-file set;
7. open the next dependency barrier only after all required PASS checkpoints are accepted;
8. checkpoint integration verdict/evidence;
9. finish with the truthful terminal outcome;
10. report the persisted source identity, hashes, record identity, terminal revision, and verdict evidence.

A child report is evidence input, not authoritative repository state. The root observes changed files and owns all sprint tool calls. A validator may repair any file inside the phase's declared repair boundary, including a target not changed by the implementer, but must report it so the root can observe and checkpoint the resulting state. Do not add skill-owned state files, automatic recovery claims, parser logic, lease logic, paging logic, or fingerprint computation.

## Invariants

- No child starts until the complete requested spawn batch passes tuple, exact-tool-set, availability, and fingerprint validation.
- Exactly one DeepSeek implementer owns each complete phase; phase steps are never delegated separately.
- Every implementation in a declared logical wave reaches terminal state before any validator for that wave starts.
- No dependency is satisfied until the corresponding validator PASS and changed-file evidence are durably checkpointed.
- A completed execution record implies every phase PASS and integration PASS; BLOCKED, interrupted, or cancelled work is never represented as completed.
- Source references and hashes are immutable after start. Execution ids, paths, and records never alias or mutate source plan/planning-run material.
- Paged result bytes reconstruct one immutable completed-result snapshot and match its digest, byte count, stable identity, and terminal metadata.
- Validator repairs remain inside declared authority and are included in overlap analysis and changed-file evidence.
- Specialist children receive only their exact role tools; excluded definitions and prompt guidance never enter child context.

## Edge Cases

- `sprint_validate_plan` returns an unsupported result version or categorized invalid finding: stop without spawning providers or creating a misleading successful record.
- Execution `start`, checkpoint, or finish rejects path ownership, aliasing, lease, schema, or stale revision: do not bypass the tool or mutate source records.
- A preflight or later atomic spawn fails because one requested tool is inactive, unavailable, forbidden, duplicated, or fingerprint-mismatched: no member of that batch may start, and authority is not reduced.
- An implementer fails after editing: checkpoint its terminal outcome and observed files, then run the assigned editing validator after the full implementation-wave settlement.
- A validator changes an additional in-boundary target: include that observation before any sibling validator concurrency decision or dependency barrier.
- A malformed verdict retry also fails: checkpoint protocol evidence and terminate truthfully; do not invent a verdict.
- A result contains multibyte text and spans pages: reconstruct by the page contract, not string slicing, and verify digest and bytes before parsing the report.
- Cancellation or disposal is non-cooperative: use bounded terminal cancellation from Phase 06, poll terminal accounting, suppress late delivery, and persist the terminal evidence available to the root.
- A generated authoritative wave is unsafe or uncertain: record the plan defect and block; do not serialize or invent a replacement topology.
- Advisory senior authority is ambiguous: use the four inspection tools and prohibit edits rather than silently granting write access.

## Validation

- Run `npm --prefix sprint-planner test`.
- Parse every spawn example across all three skills and assert exact provider/model/thinking/tools fields, unique names where required, no duplicate tools, and no excluded root-only tools.
- Assert preflight agents have `tools: []`; implementers and validators have the exact seven editing tools; advisory and edit-authorized senior examples have the exact four- and seven-tool sets; image-viewing has only `read`.
- Assert the orchestrate contract names both deterministic sprint tools, uses returned revisions in order, keeps source and execution identities/paths separate, records observed changed-file evidence, and reaches terminal finish for completed and non-success outcomes.
- Assert pagination guidance preserves terminal polling and requires stable identity, cursor progression, UTF-8-safe reconstruction, digest, byte count, and terminal metadata verification.
- Mutate orchestrate to add `REPAIR`, a separate DeepSeek repair path, parser prose, source-plan writes, source/execution aliasing, stale revision use, omitted checkpoint/finish, omitted or extra tools, unverified paging, nonterminal cancellation, or dependency-before-PASS behavior; require contract rejection.
- Use a contract-level fake trace of tool actions and returned revisions to assert: validation → start → preflight → implementation terminal checkpoint → validator PASS plus observed changed-file checkpoint → dependent implementation → integration PASS checkpoint → completed finish. Add blocked and interrupted traces proving evidence precedes truthful non-success finish and no dependent starts.
- Confirm tests use fake runners/temporary stores and invoke no paid model.

## Exit Criteria

- All three skills use the required exact tool-policy schema and preserve every fixed model/thinking route.
- Orchestrate delegates generated-plan validation, execution persistence, fingerprint enforcement, and result paging to deterministic tools without duplicating their algorithms.
- Every launched agent is terminally accounted for; oversized reports are verified from one immutable result snapshot.
- Source plans remain byte-immutable and distinct from revisioned execution records.
- Implementation, validator, observed changed-file, blocker, integration, and terminal evidence are durably ordered before any PASS barrier or completion report.
- Validator-owned repair is unambiguous, malformed-verdict handling is bounded, and no separate repair path remains.
- Authoritative waves, one-agent-per-phase, exact permissions, PASS-before-dependent barriers, and final integration gating are enforced by contract and mutation tests.
- `npm --prefix sprint-planner test` passes without paid model calls.
