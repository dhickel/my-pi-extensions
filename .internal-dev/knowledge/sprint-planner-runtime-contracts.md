# Sprint Planner Runtime Contracts

## Topic

Reusable Pi SDK continuation, planning-stage validation, planning/implementation separation, and skill-routing lessons for sprint-planner.

## Source References

- `sprint-planner/pi-runner.ts`
- `sprint-planner/engine.ts`
- `sprint-planner/validation.ts`
- `sprint-planner/skills/orchestrate/SKILL.md`
- Pi `docs/sdk.md`, `docs/session-format.md`, `docs/skills.md`, and `docs/packages.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/reviews/2026-07-17-phase-01-round-2-final-validation.md`

## Key Takeaways

- A recreated `AgentSession` wrapper is not necessarily a fresh worker conversation. Reopening the same persistent `SessionManager` path, or reusing the same keyed in-memory manager, preserves the session tree and model context.
- Parallel brainstorm workers cannot initially contain reports that other workers have not produced. Same-session cross-review avoids rereading the worker's own finding, but every worker must ingest the other findings once.
- Node's `--experimental-strip-types` does not support TypeScript parameter properties. Declare class fields explicitly when tests execute source TypeScript directly.
- Structural stage validators should report exact paths and headings and remain distinct from semantic correctness review. A source-path reference proves structural coverage, not that every defect was correctly resolved.
- Planning and implementation orchestration are separate capabilities. The extension should expose only read-only planning children and finish at corrected plan publication; reusable implementation belongs in the progressively disclosed skill.
- A Pi package can install an extension and a skill together by declaring both `pi.extensions` and `pi.skills`. Verify the resulting command provenance with RPC `get_commands`, not a model's self-report.
- Skill-owned orchestration cannot claim extension state-machine guarantees. It must poll every launched subagent, treat reload/session replacement as interruption, and report that it has no durable resume.
- Human model labels must be translated to canonical Pi tuples where known: DeepSeek Pro V4 is `deepseek/deepseek-v4-pro`. Delegated model tuples are never inlined into skills: orchestration consumes the plan-owned `Model Assignments` (config-validated at plan time) and falls back to the active configuration's `basicImplementer`/`advancedImplementer`/`phaseValidator`/`seniorAgent` only when a plan carries none; jog resolves `basicImplementer`/`advancedImplementer` from the active configuration. Exact tuples still fail rather than silently substituting another model.
- Advanced-planning model assignments belong in schema-conforming files under `sprint-planner/configs/`, not in the engine. Extension initialization loads the fixed `default` configuration once and injects its snapshot into each engine; persisted run state stores resolved tuples rather than a configuration name. Future configuration selection requires an explicit contract.
- Generated component semantics must be checked inside the model call's retry/consume boundary before artifact writes or checkpoint completion. Corrective order is concepts → orchestration → each phase. State version 3 resume must re-run the same semantic checks on hash-valid completed artifacts, reset attempts for the first invalid component, and invalidate downstream components.
- Portable Node/POSIX APIs do not provide a no-replace rename for nonempty directories. Collision-safe publication stages content, reserves the final directory with exclusive `mkdir`, materializes with no-replace hard links, and rolls back only entries whose inode/hash ownership still matches. An ownership mismatch stops rollback and is reported; the workflow intentionally makes no crash-atomicity claim across multiple paths.
- Regex-based human-schedule detection creates opaque false positives and blocks valid technical duration content such as token expiry and cache TTL values. Keep no-estimate guidance in authoring and corrective-review prompts; deterministic validators should remain structural and must not scan plan or handoff wording for durations.
- Operational orchestration metadata must use exact parseable ledger, wave, model, gate, and integration lines. Deterministic validation must cover every phase exactly once, enforce dependency wave ordering and non-overlapping parallel targets, and reject tuple or PASS-gate drift.
- Every advanced plan includes a structured `orchestration.md` with scope-size classification, a complete phase ledger with dependencies and write targets, contiguous sequential/parallel execution waves, exact model tuples, and a mandatory post-phase review-and-repair PASS gate. The plan flat set is `concepts.md`, `orchestration.md`, plus contiguous phase files; the skill's structural validation rejects missing orchestration, extraneous files, numbering gaps, and ledger/wave completeness defects.
- The orchestrate skill maps one phase to exactly one DeepSeek implementer; phase steps and aspects are instructions within that delegation. The GPT-5.6 Sol medium validator has full edit authority, repairs in-scope defects itself, reruns checks, and returns only PASS or BLOCKED. There is no read-only validator, VERDICT: REPAIR, or separate DeepSeek repair loop. Dependents wait for PASS; a BLOCKED phase stops downstream work.
- A generated plan's waves are authoritative: unsafe or uncertain parallel waves block rather than silently reschedule. Raw and other non-authoritative input may default sequential. For an oversized authoritative wave, all bounded implementation batches settle before bounded validation batches begin; the original logical wave and its full PASS barrier remain intact.
- Prompts instruct plan and handoff authors and reviewers not to include human time estimates, duration, effort, ETA, calendar scheduling, or target dates anywhere. Plans describe what to do, not how long it takes. This is instruction-only guidance rather than regex enforcement; technical machine timing (timeout, TTL, backoff, retry, polling, cache retention, lease), operational wave language, and complexity notation remain valid.
- Plan phases amortize difficult reasoning for head-down executors: exact targets, ordered edits, invariants, edge cases, and concise code/pseudocode examples only where they reduce ambiguity. Phases avoid context bloat, obvious background, repetition, and speculative detail.
- When a run introduces a new plan schema, distinguish its already-accepted legacy source plan from output generated under the new contract. That source plan may correctly fail the new `validatePlanDirectory`; use focused phase criteria and estimate checks during the transition, do not rewrite source-plan history mid-run, and require future generated plan directories to satisfy the new schema.

### Run Records, Leases, and Execution Records

- `run-records.ts` provides a shared suite — `sprintsRoot`, `resolveRunDirectory`, `inspectLease`, `acquireLease`, `releaseLease`, `discoverSprintRuns`, `runDoctor` — consumed by commands, list, doctor, execution records, and the engine without duplication. Every tool and command that touches sprint directories must go through these helpers.
- Pi forwards TypeBox tool parameter schemas directly to providers. A root `Type.Union([...])` serializes as `anyOf` without a root type and can invalidate the entire tool catalog on OpenAI-compatible providers. For a strict discriminated function schema, pass `{ type: "object" }` as the union options and retain a regression assertion for the emitted root contract.
- `/sprint list` and `/sprint doctor` are read-only consumers. They share the same discovery (`discoverSprintRuns`), schema parsing, path resolution, and lease-inspection code path as the engine's startup inspection. Doctor never releases, clears, rewrites, or steals a lease held by another runtime.
- Lease inspection reports `uncertain` when the lease file exists but the current runtime cannot confirm or deny it owns it — e.g., the runtime id does not match and the original pid/hostname cannot be verified. An uncertain lease is never treated as stale, stealable, or clearable.
- Execution records in `execution-records.ts` reuse `run-records.ts` reservation, lease, and path helpers. The execution directory lives at `<run-directory>/execution/record.json` with an accompanying `manifest.md`. Start, checkpoint, and finish operations all go through the same optimistic-revision gate.
- Standalone advanced plans and persisted sprint plans have different canonical provenance layouts: `.internal-dev/plans/<id>` and `.internal-dev/sprints/<id>/planning`. `sourcePlanningRunId` is the exact `<id>`, never either path; callers omit it for other source layouts. Keep start validation and record parsing on one typed source-identity helper so layout support cannot drift between write and read paths.
- A valid dependency graph can produce wave traversal order that differs from numeric phase-ledger order. Freeze wave assignments first, then rebuild the persisted `waves` object in frozen phase-ledger order; otherwise object insertion order can make a validator-approved plan fail record parsing even though every phase and wave assignment is complete.
- Frozen targets are an immutable scheduling contract, not evidence authorization. Truthful canonical safe changed paths must be persisted even when a plan omitted them; classify them in `outsideDeclaredTargets`, return a structured warning, and let orchestration reassess overlap. Source-plan paths, execution-record paths, traversal, symlinks, and non-regular present entries remain hard failures.
- A validator `BLOCKED` verdict is durable attempt evidence, not a global terminal latch. Version-2 phase and integration histories use contiguous attempt arrays; status and dependency readiness derive from the latest verdict. This permits BLOCKED → BLOCKED → PASS, preserves sibling progress, and still prevents dependents until the dependency's latest verdict is PASS.
- Tool-boundary phase identifiers should normalize the ergonomic suffix-optional form to canonical `phase-NN-slug.md` before lookup. Schema descriptions and patterns prevent avoidable calls, while unknown canonical-looking names must report the complete valid phase list.
- Execution revision is a monotonically increasing integer that increments on every accepted start, checkpoint, and finish transition. A caller must supply the `expectedRevision` it last received; if the on-disk revision has advanced (stale), the call fails with a deterministic error. This prevents two concurrent orchestrate invocations from silently overwriting each other's evidence.

### Fan-Out, Retry, and Interruption Semantics

- Scope-local fan-out settlement means a failing brainstorm or correction worker cancels only its sibling group for that stage, not a later dependent stage. The first causal failure is preserved as the primary error; sibling cancellation evidence is appended but does not replace the root cause.
- Interruption (shutdown, pause, reload) consumes no retry budget. The engine records the step's `disposition` as `interrupted`; only completed failures with disposition `completed` count toward the attempt limit.
- Resume revalidates hash-valid completed planning components and invalidates the first bad component plus all downstream work. Attempts are reset only for the invalidated step, not unaffected earlier stages.

### Subagent Pagination and Late-Result Suppression

- Oversized subagent results over 50KB/2,000 lines are stored as complete immutable snapshots in the manager. The model-visible tool output is truncated; `subagent_status` with `resultPage` retrieves UTF-8-safe page segments.
- Page cursors carry a stable versioned identity, digest, total byte count, offset, and page length. The cursor chain reconstructs the complete result byte-for-byte from sorted cursor order; a final digest match plus byte-count match proves integrity.
- Cursor reconstruction uses `Buffer` manipulation against UTF-8 code-point boundaries — pages never split a multibyte character. String-level slicing is not used for reconstruction.
- Late-result suppression is bounded: after detachment (cancel timeout expiry or shutdown), the detached child handle is disposed and its result channel is drained. Any result that arrives after detachment is dropped; root accounting is settled once at detachment and never double-counted.
- Cancellation and shutdown use a configurable grace period (default 5 seconds, `DEFAULT_SHUTDOWN_GRACE_MS`). Cooperative children that complete within the grace period produce normal terminal results; non-cooperative children are force-detached. The root report uses "root accounting detached" rather than "provider terminated" — the local subagent session was disposed, but remote provider-side work may continue.

## Project Relevance

Use these rules when changing planning child-session continuation, package resource discovery, plan structural contracts, or the orchestration skill. They prevent accidental coding-tool exposure in planning sessions, duplicate orchestration entrypoints, false persistence claims, and silent model drift.

## Open Questions

Whether a future Pi primitive can provide persisted, reusable skill workflows while keeping implementation orchestration outside the sprint-planner extension.
