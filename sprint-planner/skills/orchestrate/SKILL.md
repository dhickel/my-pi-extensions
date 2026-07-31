---
name: orchestrate
description: Execute complex workflows, raw task directives, checklists, or phased plan files with dependency-aware sequential or safe parallel subagents. Uses DeepSeek Pro V4 at max for implementation and GPT-5.6 Terra at max to validate every phase. Use when the user asks to orchestrate, execute, or implement a multi-phase or long-running workflow.
compatibility: Requires Pi with subagent_spawn, subagent_poll, subagent_status, and subagent_cancel; configured deepseek/deepseek-v4-pro max and openai-codex/gpt-5.6-terra high model tuples; sprint_validate_plan and sprint_execution_record tools.
metadata:
  version: "4.1.0"
---

# Orchestrate

Interpret and execute an authoritative workflow supplied by the user. The input may be prose, a checklist, pasted plan content, one or more plan files, or a generated plan directory. Support long-running dependency chains and safe parallel phases without changing accepted scope.

## Fixed model contract

Use exactly these tuples for delegated work:

- Implementation — DeepSeek Pro V4:
  - `provider`: `deepseek`
  - `model`: `deepseek-v4-pro`
  - `thinkingLevel`: `max`
- Post-phase review-and-repair and final integration — GPT-5.6 Terra:
  - `provider`: `openai-codex`
  - `model`: `gpt-5.6-terra`
  - `thinkingLevel`: `high`

Never inherit, omit, downgrade, clamp, or substitute either tuple. If a required model, authentication, or thinking level is unavailable, stop before implementation and report the exact failure. In particular, do not replace GPT-5.6 Terra with another GPT version or a different thinking level.

Implementation self-reports, root inspection, and test output do not replace independent GPT-5.6 Terra max phase validation.

## Global estimate prohibition

Every root report and every delegated report — including implementer, phase-validator, and final-integration reports — must not introduce human time estimates, including duration, effort, ETA, or calendar scheduling estimates. Operational dependency and wave scheduling language remains valid. Technical machine timing (timeout, TTL, backoff, retry, polling, cache retention, lease) remains allowed.

## Tool delegation contract

The subagent implementation validates every spawn batch atomically before any child initializes. If any requested tool is unregistered, forbidden, duplicated, or fingerprint-mismatched, the complete batch is rejected and no child starts. A registered tool does not need to be active in the caller: naming it in an exact allowlist enables it for the child. The fixed sets below use only APIs registered in the standard coding harness; edit-authorized workers perform search and listing through `bash` instead of requesting separate `grep`, `find`, or `ls` APIs.

Every agent receives exact tool sets:

- **Preflight agents** (both tuples):
  ```json
  "tools": []
  ```
- **DeepSeek implementers**:
  ```json
  "tools": ["read", "bash", "edit", "write"]
  ```
- **GPT-5.6 Terra phase/integration validators**:
  ```json
  "tools": ["read", "bash", "edit", "write"]
  ```
- **Senior advisors** (advisory):
  ```json
  "tools": ["read"]
  ```
- **Senior advisors** (edit-authorized):
  ```json
  "tools": ["read", "bash", "edit", "write"]
  ```
- **Image viewing**: `"tools": ["read"]`

No child receives subagent, sprint validation, sprint execution, user-questioning, or other root-only tools. Excluded tool definitions and guidance never enter child context.

## Preflight

Run this preflight only after authoritative input resolution, successful generated-plan validation when applicable, and accepted execution-record `start`. Before any implementation edit or other provider work, launch one atomic `subagent_spawn` batch containing two uniquely named no-op agents:

```json
{
  "agents": [
    {
      "name": "preflight-deepseek-<unique>",
      "task": "Return READY without reading or modifying the project.",
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "thinkingLevel": "max",
      "tools": []
    },
    {
      "name": "preflight-gpt-<unique>",
      "task": "Return READY without reading or modifying the project.",
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "thinkingLevel": "high",
      "tools": []
    }
  ]
}
```

Poll until both reach a terminal state. Confirm the reported provider, model, and thinking level exactly. Because a spawn batch is validated atomically, a rejected tuple or tool set prevents either preflight task from starting.

Do not proceed when either preflight fails.

## Authoritative execution principle

An accepted plan is an immutable contract defined by senior management. The orchestrator's sole role is to execute every phase, feature, criterion, and validation exactly as defined — no more, no less. This means:

- **Never override, reduce, simplify, or reinterpret the plan.** If the plan says 10 phases with 5 features each, deliver exactly that.
- **Never defer, scaffold, or silently drop work.** A phase that compiles but is not fully wired, sealed, validated, and proven against its acceptance criteria is not complete.
- **Never concern yourself with plan size, phase count, token budget, session length, or elapsed time.** These are not your concern. Your concern is completing the work as defined.
- **Never decide something is "too large" or "too complex" to complete.** Use subagents, senior escalation, and parallel waves as designed. The orchestration system exists to handle large plans.
- **If you hit a genuine blocker,** report it concretely with evidence and continue unaffected work. Never use a blocker as an excuse to scaffold or defer unaffected phases.

## Interpret the directive

Treat the complete user input as prompt text, not as a filename. Inspect any referenced project paths with root tools.

### Generated plan directory input

When the user supplies a generated plan directory, resolve it to a canonical project-relative directory path and call `sprint_validate_plan` with that path. Do not pass an absolute path. This tool returns a versioned structured result with `valid`, `metadata`, and categorized `findings`.

- If `valid` is `false`, stop before any provider work. Record the `findings` in the root report and do not create an execution record or launch agents.
- If the result version is unsupported, stop immediately — treat it as a permanent plan defect.
- Only proceed when `valid` is `true`.

Do not re-validate the plan directory structure with root tools. The deterministic `sprint_validate_plan` tool owns all plan-shape, cross-consistency, dependency, target-overlap, model-contract, and wave-completeness checks. Retain only policy interpretation that code cannot decide: resolving raw or pasted non-authoritative input, preserving accepted scope, and surfacing genuine authority conflicts.

### Other input forms

For a single phase file, follow its dependencies and shared concepts when present. For raw prose or a checklist, derive only the minimum executable phases needed; do not invent features.

### General pre-scheduling steps

1. Read applicable project instructions, accepted specifications, and explicitly required guides.
2. Preserve the user's scope, decisions, phase boundaries, exclusions, and completion criteria.
3. Resolve discoverable questions from the repository. Ask the user only when missing intent or authority prevents safe execution.

## Start the execution record

After resolving authoritative input and validating a generated plan, call `sprint_execution_record` with `action: "start"` to persist the execution identity and freeze the source plan. `sourcePlanPath` must be the same canonical project-relative directory accepted by `sprint_validate_plan`:

```json
{
  "action": "start",
  "sourcePlanPath": ".internal-dev/plans/<plan-id>",
  "sourcePlanningRunId": "<plan-id>"
}
```

- `sourcePlanningRunId` is optional provenance, not a path. For `.internal-dev/plans/<plan-id>`, use exactly `<plan-id>`; for `.internal-dev/sprints/<planning-run-id>/planning`, use exactly `<planning-run-id>`; omit it for any other source layout. Never put `/`, a trailing slash, an absolute path, or a directory prefix in this field.
- Use an execution identifier distinct from every source plan or planning-run identifier. Never alias a source identity.
- Record the returned immutable source reference, source hashes, and initial revision.
- Keep the source plan and planning-run bytes unchanged. Never write runtime material into their directories; all revisioned execution state belongs to the distinct execution record.
- Pass the latest returned revision to every subsequent `checkpoint` and `finish` call.
- Treat stale-revision rejection as a blocker — do not retry from guessed state or bypass the tool.

The root owns all sprint tool calls. Do not delegate `sprint_validate_plan` or `sprint_execution_record` to children.

## One phase = one validation unit

A phase is the atomic dependency and validation unit. An unsplit phase maps to one DeepSeek Pro V4 `max` implementation-agent session. When the phase plan explicitly contains contiguous lettered subphases (A, B, C, and so on), each subphase maps to one sequential implementation-agent session. Use the planner's practical sizing judgment; do not calculate or enforce token counts during execution. Complete every subphase in letter order before launching the single phase-level validator. Ordinary steps, aspects, and bullets that are not explicit lettered subphases remain instructions within one delegation and must not be split into extra agents.

## Schedule work

### Authoritative plan scheduling

Follow the generated plan's declared execution waves exactly. Each safe declared wave executes in parallel subject to the four-agent active cap. If a declared wave has more than four phases, partition its implementation agents into sequential batches with up to four members running concurrently.

Run every implementation batch to a terminal state before starting any validator for that logical wave; then run the required validators in batches of up to four, serializing any overlapping validator write sets as specified below.

The logical wave remains incomplete until every phase has `VERDICT: PASS`, and no dependent starts before that full-wave barrier. A dependency becomes complete only after its independent validator returns a checkpointed `VERDICT: PASS`.

If a declared parallel wave cannot be confirmed safe — overlapping write targets, unknown write sets, shared mutable state, or any uncertainty — block the wave and report the defect as a plan error. Do not silently reschedule a generated-plan wave or invent an alternative topology.

### Non-authoritative input scheduling

For raw prose, checklists, single phase files, or legacy non-authoritative inputs, default to sequential execution when safety cannot be confirmed. Parallelize only when every candidate phase in the wave:

- has all dependencies validated as passed;
- has a known write set from the orchestration ledger;
- has no overlapping file or directory target with a sibling;
- shares no generated artifact, migration, schema, lockfile, or mutable global state with a sibling;
- can be implemented and validated independently.

An empty or uncertain write set is not evidence of safety — fall back to sequential scheduling.

Limit each implementation or validation wave to four active agents.

## Delegate implementation

Spawn one DeepSeek Pro V4 `max` agent for each ready unsplit phase, or one at a time for each explicit lettered subphase of a ready phase. Subphases execute sequentially in letter order and share the parent phase's scope, dependencies, and validation gate. Children receive no caller transcript, so every task must be self-contained and include:

- the user objective and settled constraints;
- the exact assigned phase, source paths, scope, and criteria;
- relevant shared concepts and required guides;
- `orchestration.md` metadata — dependencies, ledger, wave, model contract, and gate rules — so the agent understands its place in the scheduling topology;
- completed dependencies;
- declared write targets;
- required validation commands or expectations;
- unrelated edits that must be preserved;
- authority to edit only the assigned scope.

Example spawn:

```json
{
  "agents": [
    {
      "name": "impl-<phase-id>",
      "task": "<self-contained phase brief>",
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "thinkingLevel": "max",
      "tools": ["read", "bash", "edit", "write"]
    }
  ]
}
```

Require each implementer to:

1. Inspect assigned files and guides before editing.
2. Confirm required toolchain executables before substantial edits.
3. Implement the complete assigned phase or lettered subphase without placeholders, stubs, fake behavior, or speculative scope.
4. Stay within declared write targets unless an unavoidable adjacent change is explained.
5. Run focused validation, including relevant failures and edge cases.
6. Return `Summary`, `Files Changed`, `Validation`, `Criteria`, `Remaining Risks`, and `Blockers` sections. Respect the global estimate prohibition: no human time estimates, duration, effort, ETA, or calendar scheduling estimates; operational dependency and wave language remains valid.

A missing executable must be reported with the dependency and exact user action; validation must never be faked.

## Poll every agent

After spawning agents, call `subagent_poll` repeatedly until every launched agent reaches a terminal state. A poll timeout is only a status update; continue polling. Never abandon active or undelivered agents, and never start dependent work while a prior wave awaits validation.

If an implementation agent fails after possible edits, stop downstream scheduling and still validate the actual repository state for that phase.

### Oversized result reconstruction

Continue `subagent_poll` until every launched agent is terminal. When a visible result is truncated, use `subagent_status` with `includeResults: true`. Follow the returned stable result identity and cursor chain:

1. Collect UTF-8-safe page bytes in cursor order.
2. Concatenate pages byte-for-byte, never by string slicing.
3. Verify the final digest matches the complete-result digest.
4. Verify the reconstructed byte count matches the complete-result byte count.
5. Confirm completion metadata and terminal identity are consistent before consuming the reconstructed report.

Invalid or stale cursors, digest mismatch, or byte-count mismatch block that evidence path. Do not infer missing text or repoll it as a new result. Polling and delivery lifetime remain unchanged — paging supplements truncated delivery without replacing any poll or result-lifecycle semantics.

## Validate every phase with review-and-repair

After an unsplit phase's implementation attempt, or after every lettered subphase of a split phase has completed, launch one GPT-5.6 Terra `max` review-and-repair agent for the parent phase with full edit authority. Never launch independent validation between a phase's lettered subphases. Before launching editing validators concurrently, compare the actual files changed by each implementation plus the validator-authorized repair areas and any newly discovered shared artifacts or state. Parallelize only when the write sets remain disjoint after this check; otherwise serialize validators within the same wave. Validators may not start until all implementation agents in that wave have stopped. Do not start dependents until every member of the wave passes.

Spawn each phase validator:

```json
{
  "agents": [
    {
      "name": "validate-<phase-id>-<unique>",
      "task": "<phase contract, implementation report, concept and orchestration context, and full validation brief>",
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "thinkingLevel": "high",
      "tools": ["read", "bash", "edit", "write"]
    }
  ]
}
```

Each validation brief must include the phase contract, every implementation report for that phase (including all lettered subphase reports), `orchestration.md` scheduling context, and `concepts.md`. Require the validator to:

1. Inspect the actual repository state independently.
2. Check every phase criterion and applicable project instruction.
3. Review changed files against the phase scope and integration boundaries.
4. **Edit every in-scope bug, regression, missing criterion, or alignment defect itself.** Do not delegate repair to another agent.
5. Run the required tests, typecheck, lint, or build checks against the actual repository state, and rerun every affected check after edits.
6. Check failure cases, regressions, placeholders, unrelated edits, and accidental API growth.
7. Return exactly one of the following verdicts:

   - `VERDICT: PASS` — every criterion has been checked and every discovered defect resolved by the validator; no unresolved issue remains.
   - `VERDICT: BLOCKED` — a genuine blocker outside the validator's edit authority prevents PASS. Include concrete evidence.

   Also return `Criteria Checked`, `Commands and Results`, `Findings`, `Edits Made`, and `Remaining Risks` sections. Respect the global estimate prohibition.

### Validator owns repair

There is no `VERDICT: REPAIR` and no separate DeepSeek repair handoff. The GPT validator inspects, edits, and re-validates until every in-scope defect is resolved. A malformed or missing verdict is not a pass; retry once with a fresh uniquely named GPT-5.6 Terra max validator inspecting actual state. If the retry is also malformed, record the concrete protocol failure and stop without opening the dependency barrier — a malformed response never becomes PASS, BLOCKED evidence by itself, or a DeepSeek repair request.

### BLOCKED handling

`BLOCKED` means a concrete condition outside validator edit authority prevents PASS. It is durable validation-attempt evidence, not an automatic terminal latch. On BLOCKED:

1. Durably checkpoint the BLOCKED verdict and its evidence through `sprint_execution_record` with `action: "checkpoint"`.
2. Start no dependents of the blocked phase while its latest validation verdict is BLOCKED.
3. Continue disjoint active siblings; cancel only sibling work that newly discovered write overlap makes unsafe.
4. Poll every launched or cancelled agent to terminal.
5. If the blocker becomes resolvable within accepted authority, launch a fresh GPT-5.6 Terra max validator, checkpoint its next numbered attempt, and repeat until the latest verdict is PASS or the blocker remains unresolved. Never erase or replace earlier BLOCKED attempts.
6. If the blocker remains unresolved, finish the record truthfully as blocked; never mark completed without durable latest phase and integration PASS evidence.

### Senior escalation from validation

When a phase validator has already made one full correction pass and the phase still does not pass, or when the validator identifies a complex issue that exceeds its ability to repair in a single editing pass, do not loop validators indefinitely. Instead:

1. Collect the validator's concrete findings, the specific criteria still failing, and the repository state after its repair edits.
2. Compose a targeted handoff for a senior agent (edit-authorized) that includes the phase contract, the validator's evidence, and the exact remaining defects.
3. Launch one senior agent with `openai-codex/gpt-5.6-sol` at `xhigh` to resolve the complex issue.
4. After the senior agent completes, launch a fresh GPT-5.6 Terra validator against the resulting state.
5. If that validator returns PASS, checkpoint and proceed normally. If it returns BLOCKED again, report the concrete evidence and escalate to the user.

This prevents validator loops on problems that need deeper architectural reasoning while keeping the validation gate intact.

## Checkpoint changed files and verdicts

After each validator terminates, observe the actual changed paths from repository state — not only child self-reports. Combine canonical present/deleted path observations and available digest/byte metadata with the validator's authorized repair boundary. Always submit every truthful changed path, including paths outside declared plan targets; never omit evidence to satisfy an incomplete plan.

An accepted checkpoint may return a structured `outside-declared-targets` warning. Treat it as plan drift, not checkpoint failure: retain the immutable frozen targets as the original scheduling contract, widen only the root's observed write set, and reassess overlap before starting validators or later phases. Serialize validators when newly discovered changed or repair write sets overlap. If drift makes a future authoritative implementation wave unsafe, block that wave as a plan defect rather than silently changing its topology; non-authoritative work falls back to sequential execution.

Before marking any PASS or opening a dependent barrier, checkpoint through `sprint_execution_record` with `action: "checkpoint"`:

1. The terminal implementation evidence (phase identity, report, observed changed files).
2. The validator verdict (PASS/BLOCKED) and its evidence report.
3. The observed changed-file set for that phase (canonical paths, present/deleted status, digest/byte metadata).

Pass the latest returned revision to every checkpoint call. If revision rejection occurs, do not bypass — treat it as a blocker.

## PASS-before-dependent barriers

No dependent phase starts before every dependency's latest checkpointed verdict is `VERDICT: PASS` with its observed changed-file evidence. If a phase is `BLOCKED`, pause dependent scheduling but do not cancel active siblings whose declared plus newly observed targets are disjoint. A later validation attempt for that same phase may replace BLOCKED as the derived latest status only by checkpointing PASS; all earlier attempts remain durable. If a phase remains `BLOCKED`, start no later dependency wave, and report the concrete user action or external decision required.

### Malformed verdict retry

A validator response with no recognizable `VERDICT: PASS` or `VERDICT: BLOCKED` is malformed. Retry once with a fresh, uniquely named GPT-5.6 Terra max validator using the same exact editing tool set and authority. A malformed response never becomes PASS, BLOCKED evidence by itself, or a DeepSeek repair request. If the retry is malformed, checkpoint the protocol failure and stop without opening the dependency barrier.

## Final integration gate

After every phase has a checkpointed `VERDICT: PASS`, launch one GPT-5.6 Terra `max` integration review-and-repair agent with full edit authority:

```json
{
  "agents": [
    {
      "name": "integration-<unique>",
      "task": "<integration contract, all phase verdicts, concepts.md, and user directive>",
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "thinkingLevel": "high",
      "tools": ["read", "bash", "edit", "write"]
    }
  ]
}
```

It must inspect cross-phase behavior, run applicable broader checks, edit any remaining integration defect itself, and verify the final criteria from `concepts.md` and the user directive.

The integration validator returns exactly `VERDICT: PASS` or `VERDICT: BLOCKED` with the same evidence sections as a phase validator and respects the global estimate prohibition. If BLOCKED, follow the same BLOCKED handling as for phases.

After the integration validator terminates, observe repository changes again, including its in-scope repairs. After integration PASS, checkpoint the integration verdict, observed changed-file set, and evidence through `sprint_execution_record` with `action: "checkpoint"`.

## Finish the execution record

After integration PASS is checkpointed, call `sprint_execution_record` with `action: "finish"` and `type: "completed"`. Pass the latest revision. Never mark completed without durable integration PASS.

For non-success outcomes (unresolved BLOCKED, interrupted, or cancelled), cancel active children when required and poll every launched or cancelled child to a terminal state. Then checkpoint available evidence and all terminal child outcomes before finishing with the truthful non-success terminal state. `finish: blocked` is valid while the latest verdict for a phase or integration remains BLOCKED. Always pass the latest revision. Stale-revision rejection is a blocker.

## Phase closeout — changelog and git commit

After each phase validation `PASS` is checkpointed and BEFORE opening the dependent barrier, the root orchestrator must:

1. **Create or update a changelog entry** under `.internal-dev/changelogs/` using the `internal_dev` tool with `kind: "changelog"`. Include:
   - Phase name and goal
   - Changed files (from the checkpoint evidence)
   - Behavioral impact summary
   - Specification impact (or "none" with one-sentence justification)
   - Risks and follow-up items
2. **Stage all changed files** (`git add -A`) and **commit** with a descriptive message:
   ```
   feat: <phase-name> — <concise summary>
   ```
3. Push only when the integration gate also passes.

Delegated agents (implementers and validators) do not commit or write changelogs. The root orchestrator owns all version-control side effects so it can batch or correct them without replaying agent work.

## Branch workflow for multi-phase plans

Before the first implementation agent of a multi-phase plan starts, the root orchestrator must:

1. Create a dedicated Git branch from the current HEAD:
   ```bash
   git checkout -b sprint/<plan-id>
   ```
2. Work all phases on that branch. Commit after each phase validation `PASS` as described above.
3. After final integration `PASS` and all closeout steps, merge back to master:
   ```bash
   git checkout master
   git merge --no-ff sprint/<plan-id> -m "feat: <plan-title>"
   ```
   The `--no-ff` flag preserves the branch topology for easy rollback.
4. Delete the branch locally (and remotely if pushed) after a successful merge.

This keeps master linear for small fixes while allowing full sprint rollback via `git revert` of the merge commit or `git reset` to pre-sprint master.

For single-phase or trivial work, committing directly to master after each phase closeout is acceptable.

## Completion

1. Confirm every phase and final integration have independent checkpointed `VERDICT: PASS`.
2. Review the final diff or changed-file set for scope and accidental edits.
3. Complete the project's required specification, knowledge, review, plan, and changelog workflow.
4. Report the persisted execution record identity, source plan identity, completed phases, parallel waves, exact model tuples, files changed, validation commands, edits made by validators, and any genuine blocker.

Do not claim extension-owned background execution or automatic resume. Report only checkpoints accepted by the deterministic execution record. This skill is root-session orchestration: before a root-directed interruption, cancellation, or terminal finish, cancel when required and poll every launched child to terminal; an external process termination may still prevent further orchestration.
