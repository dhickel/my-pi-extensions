# Resilient Pi Sprint Planner Suite

## Purpose

Define the installable `sprint-planner` Pi package. The package combines:

1. a deterministic planning extension for brainstorming, requirements ironing, advanced phased planning, persistence, and recovery;
2. read-only run-record discovery, structured plan validation, and versioned lease management;
3. durable execution-only orchestration evidence persistence with immutable source references; and
4. a progressively disclosed `orchestrate` skill for executing user workflows or plan files with delegated implementation and independent phase validation.

Orchestration is not part of the extension engine. Durable execution evidence belongs to the deterministic planner but remains a narrow persistence boundary: the skill decides when to spawn, poll, validate, checkpoint, and stop.

## Installed Resources

The package manifest loads `index.ts` as an extension and `skills/orchestrate/SKILL.md` as a skill.

The extension registers:

- `/sprint [--name <slug>] [--agents 2..8] <prompt>` for brainstorm → ironout → corrected advanced planning.
- `/sprint status|pause|resume|reset|list|doctor [run-id]` for persisted planning-run management and read-only discovery.
- `/brainstorm [--agents 2..8] <prompt>` for a stateless brainstorm.
- `/ironout [--interactive|--auto] <prompt>` for a stateless handoff.
- `/advanceplan <prompt>` for a stateless corrected plan.
- `sprint_brainstorm` as the agent-callable equivalent of `/brainstorm`.
- `sprint_ironout` as the agent-callable equivalent of `/ironout`.
- `sprint_advanceplan` as the agent-callable equivalent of `/advanceplan`.
- `sprint_validate_plan` as a read-only structured plan validator returning versioned diagnostics.
- `sprint_execution_record` as a versioned execution-evidence persistence tool with `start`, `checkpoint`, and `finish` actions.

All five agent-callable tools are sequential long-running tools. `sprint_ironout` and `sprint_advanceplan` expose no model parameters: the engine supplies `MODEL_ROUTES.ironoutAuthor`, `ironoutReviewer`, `advancedPlanner`, `advancedAdvisor`, and `advancedReviewer`. Relative input paths resolve from Pi's current working directory; a leading `@` is accepted for parity with built-in path tools.

The extension does not register `/orchestrate`, expose a standalone orchestration engine method, launch implementation workers, or perform repository implementation/final validation. Pi exposes the skill as `/skill:orchestrate` when skill commands are enabled.

Workflow input is preserved as user prompt text. It may contain plain instructions, pasted material, paths, or natural-language instructions around paths. Command handlers do not probe or expand paths; assigned planning agents interpret references with read-only tools.

Bare start commands open Pi's multiline editor. Standalone management is limited to `status` and `cancel`. `/sprint` supports the full management set above.

## Extension Ownership

The extension engine owns planning stage sequencing, exact planning model tuples, brainstorming concurrency, typed planning handoffs, structural gates, retries, state transitions, cleanup, repeatable run-record discovery, versioned lease management, read-only diagnosis, structured plan validation, and execution-record persistence. Slash-command work starts in the background so the root session remains usable; the five agent-callable planning tools wait for the same engine-owned standalone result.

All extension model tuples are exact:

| Responsibility | Provider/model | Thinking |
| --- | --- | --- |
| Brainstorm role routing | `openai-codex/gpt-5.6-sol` | `high` |
| Brainstorm and cross-review workers | `deepseek/deepseek-v4-pro` | `max` |
| Brainstorm synthesis and red team | `openai-codex/gpt-5.6-sol` | `high` |
| Ironout author / corrective reviewer | `openai-codex/gpt-5.6-sol` | `high` / `medium` |
| Advanced planner / adviser / corrective reviewers | `openai-codex/gpt-5.6-sol` | `high` / `max` / `medium` |

Unavailable models, authentication, or thinking capabilities are errors; the runner does not substitute or clamp them. Every extension child receives planning-mode read-only project tools. Advanced planners retain a bounded advisory tool; no child receives coding tools or a toolchain-blocker tool.

## Brainstorm Contract

Role routing produces complementary broad lenses. The default is four workers; the accepted range is two through eight. Each worker submits `findings.md`, then the same session reviews every other worker report and submits `cross-review.md`. Synthesis cannot start until every finding and cross-review exists. The red-team prompt contains only the synthesis.

The cross-review barrier is unconditional for `/brainstorm`, `/sprint`, and `sprint_brainstorm`. Generic subagent calls are not equivalent to this engine-owned lifecycle.

## Ironout Contract

The author produces a high-level handoff covering context, objective, targets, features, settled decisions, constraints, scope, assumptions, direction, validation, open questions, and sign-off. One `medium` corrective reviewer returns a complete corrected handoff plus its review. Full sprint ironout is autonomous; standalone interactive ironout uses the root-context `user-questioning` service for at most three rounds of at most three choice questions.

## Advanced Plan Contract

The planner may make at most two `max` adviser calls for genuinely advanced or blocked planning areas. It submits exactly one `concepts.md`, one `orchestration.md`, and a scope-budgeted set of contiguous flat `phase-NN-<slug>.md` files — small 2–3, medium 3–5, large 6–10 phases. A plan contains no review or runtime entries.

Each unsplit phase groups cohesive edits by targets, domain, or vertical logic and should reasonably fit within one implementation-agent session under the planner's practical assumption of roughly 200,000–300,000 tokens maximum; this is a judgment call, not a formal calculation or printed estimate. When cohesive work would make a phase overly large, its Implementation Steps use contiguous lettered subphases (A, B, C, and so on). Each subphase is a granular one-session implementation unit, while the parent phase remains the dependency and validation unit: subphases execute in letter order and phase validation happens only after all of them complete. Ordinary steps and aspects remain instructions within one delegation rather than additional workers. Every phase provides head-down guidance: exact targets, ordered edits, invariants, edge cases, and only concise code or pseudocode examples that materially reduce ambiguity. It omits obvious background, repetition, speculative detail, and other context bloat.

`orchestration.md` owns the complete phase ledger in phase order, dependencies, canonical write targets, goals, contiguous sequential or parallel waves, exact implementation and validation tuples, the post-phase review-and-repair PASS gate, and final-integration metadata. Every phase appears exactly once in the ledger and waves; dependencies run in earlier waves, and parallel members have non-overlapping targets.

Corrective review runs in the fixed sequence concepts → orchestration → each phase, using one `medium` call per component. A phase reviewer receives corrected concepts, corrected orchestration, its phase, and the phase-name index. Reviewers return complete replacements and do not add, remove, split, or merge phase files. Semantic validation occurs inside each component's retry boundary before checkpoint completion; resume semantically revalidates hash-valid completed planning components and invalidates the first bad component plus downstream work.

Authoring and corrective-review prompts instruct models not to include human implementation time, duration, effort, ETA, target-date, or calendar-schedule estimates because plans describe what to do, not how long it takes. This guidance is instruction-only: deterministic validators do not scan output wording or reject durations. Technical machine timing such as timeout, TTL, retry, backoff, polling, cache retention, and lease values remains valid, as do complexity notation and operational wave language.

Deterministic gates verify brainstorm headings, synthesis source coverage, handoff headings, exact orchestration semantics, and plan directory shape. A plan directory may contain only regular flat `concepts.md`, `orchestration.md`, and contiguous `phase-NN-*.md` files; nested, symbolic-link, review, and runtime entries are rejected.

Corrected plan publication is the terminal extension stage.

## Orchestrate Skill Contract

The `orchestrate` skill interprets an authoritative user workflow, raw task, checklist, pasted plan, plan file, or phased plan directory while preserving accepted scope. Raw and other non-authoritative input defaults to sequential execution unless dependency readiness, known non-overlapping write areas, and absence of shared mutable artifacts make parallel work safe.

A generated plan's validated `orchestration.md` is authoritative. The skill follows its waves exactly and blocks an unsafe or uncertain declared parallel wave rather than silently serializing, rescheduling, or inventing another topology. The four-agent cap may split a declared wave into bounded implementation and validation batches; all implementation batches settle before validation begins, the logical wave remains incomplete until every phase passes, and no dependent starts across that barrier.

The skill requires Pi's subagent spawn, poll, status, and cancel tools. It must use exactly:

| Responsibility | Provider/model | Thinking |
| --- | --- | --- |
| Phase implementation | `deepseek/deepseek-v4-pro` (DeepSeek Pro V4) | `max` |
| Independent validation of every phase | `openai-codex/gpt-5.6-sol` | `medium` |
| Final integration validation | `openai-codex/gpt-5.6-sol` | `medium` |

Before edits, one atomic spawn batch preflights both tuples with no-op agents. Missing models, authentication, tools, or thinking support stop execution; the skill never substitutes another tuple. One unsplit phase maps to one DeepSeek `max` implementation-agent session. A phase with explicit lettered subphases maps each subphase to one sequential DeepSeek `max` session in letter order; no runtime token calculation or enforcement is performed.

Every implementation wave fully settles before validation. Every phase receives one independent GPT-5.6 Sol `medium` review-and-repair agent with full edit authority only after its unsplit implementation or all of its lettered subphases complete. The validator inspects actual repository state, checks every criterion, repairs in-scope defects itself, reruns required checks, and returns exactly `VERDICT: PASS` or `VERDICT: BLOCKED` with evidence sections. There is no read-only validation mode, `VERDICT: REPAIR`, or separate DeepSeek repair handoff. A malformed or missing verdict is retried once, then blocks. A valid `BLOCKED` verdict is a durable retryable attempt: disjoint siblings may continue, the same phase may receive later validation attempts, and dependents wait until every dependency's latest verdict is `PASS`. After all phases pass, one GPT-5.6 Sol `medium` integration validator performs the same review-and-repair gate across the complete workflow.

Changed-file evidence is truthful rather than target-authorized. Unexpected canonical safe paths are persisted and returned as structured plan-drift warnings; the frozen target map remains immutable. The skill widens only its observed write sets, reassesses overlap before validators or later phases, serializes validators when discovered write sets overlap, and blocks future unsafe authoritative implementation waves rather than silently changing their topology.

Plans and root, implementer, phase-validator, and integration-validator reports prohibit human time, duration, effort, ETA, and calendar-schedule estimates. Operational wave language and technical machine timing remain allowed.

The skill owns no extension state machine, background job, `.state.json`, child-session persistence, or `/sprint resume` behavior. It must poll every spawned agent to a terminal state during the root session and report genuine blockers without claiming completion.

## Artifact Layout

Standalone planning publications are:

- `.internal-dev/brainstorm/<effort>/` for findings, cross-reviews, synthesis, and red team.
- `.internal-dev/handoffs/<id>.md` for the corrected signed handoff.
- `.internal-dev/plans/<plan-id>/` for corrected concepts, orchestration, and flat phases, with review in `.internal-dev/reviews/`.

Standalone model outputs are staged in memory and published only after successful completion. They do not create workflow state files.

Publication never replaces a conflicting target. New files and directories use no-replace creation, complete staging, exclusive final-directory reservation, and ownership checks; rollback removes only entries whose identity and content still prove ownership, and any inability to prove safe rollback is reported. Recovery may accept an already-complete byte-exact publication. These safeguards are collision-safe and reported-failure-safe but do not claim impossible crash atomicity across multiple paths.

A persisted `/sprint` planning run lives at `.internal-dev/sprints/<run-id>/`. It retains original input, brainstorm reports, ironout draft and handoff, plan drafts and component reviews, published planning files, and `manifest.md`. Its `planning/` directory contains only corrected `concepts.md`, `orchestration.md`, and phases. Manifest implementation and final-validation sections state that those responsibilities belong to the separately invoked skill.

## Persistence and Recovery

Incomplete planning runs use state version 3 in atomically replaced `.state.json` plus private `.sessions/`. State records planning step status, attempts, exact model tuple, artifact hashes, child-session path, errors, and timestamps.

All older incomplete state versions are intentionally incompatible with resume and require confirmed reset; this includes version-1 runs from the former implementation pipeline and version-2 runs from the pre-orchestration plan schema. Transient provider failures and malformed typed submissions receive at most two retries after the first attempt using the same planning session.

Reload, shutdown, crash, or pause interrupts active work and never automatically restarts model calls. `/sprint resume` validates completed planning artifact hashes and component semantics, resets attempts for the first invalid planning component, invalidates it and downstream planning work, reopens recorded child sessions, and continues explicitly. Successful plan publication writes the manifest and removes runtime files.

## Reset and Security

`/sprint reset [run-id]` confirms, aborts matching workers, deletes exactly the selected direct child under `.internal-dev/sprints/`, records a reset tombstone, and never reverts repository edits. It works even when state is malformed and refuses symbolic-link or escaping targets.

All artifact paths, run ids, state references, session paths, and publication paths reject traversal, absolute escapes, and symbolic-link traversal.

## Run Records, Leases, and Discovery

Planning and execution runs live under `.internal-dev/sprints/<run-id>/`. Each mutable direct-child record is protected by a versioned exclusive lease carrying owner identity (runtime id, pid, hostname), run kind (planning or execution), and acquisition timestamp. List and doctor are read-only consumers of the same discovery, schema, path, ownership, and lease parsers.

### `/sprint list`

Discovers every direct-child planning and execution record. Returns canonical `runId`, run kind (`planning`, `execution-only`, `ambiguous`, `malformed`, `unknown`), state, marker presence (`.state.json`, `manifest.md`, execution record), and lease ownership (`owned-by-this-runtime`, `unleased`, `held-by-other`, `uncertain`). Does not create, modify, delete, or release any file.

### `/sprint doctor [run-id]`

Read-only diagnosis of a selected record. Inspects schema version, lease ownership, state consistency, marker alignment, and JSON integrity. Reports severity-graded findings (info, warning, error, critical) with actionable guidance. Performs no writes, releases, clearing, or takeover. An uncertain lease is reported but never stolen.

### Lease Lifecycle

Version 1 leases carry the `runId`, `runKind`, `ownerId`, `pid`, `hostname`, and `acquiredAt`. Acquisition is exclusive; a competing owner is rejected. Clean shutdown releases the lease and removes the runtime file. A crash leaves the file on disk with uncertain ownership — list and doctor report it but do not clear or rewrite it. `/sprint reset` confirms, aborts workers, and deletes the entire run directory; it never reverts repository edits.

## Execution Records

Execution records persist versioned orchestration evidence in a distinct execution-only sprint record (`exec-<id>` or a user-supplied id). They never modify, reuse, or place runtime material in their source plan directory or source planning-run directory. Their identifiers differ from and never alias source identities.

### Record Shape

New records use version 2. Version-1 records remain strictly parseable for read-only discovery and diagnosis but cannot accept checkpoints, manifest repair, finish, or interruption mutations.

- **Immutable source descriptor**: `sourcePlanPath`, optional `sourcePlanningRunId`, an aggregate digest, and per-file hashes. Bytes and hashes are frozen at `start` and never change.
- **Frozen orchestration snapshot**: scope size, canonical phase filenames, dependencies, waves, goals, write targets, and exact implementation/validation model tuples captured at record creation. Targets are scheduling evidence only and never mutate after start.
- **Revisioned phase ledger**: each phase tracks one optional implementation entry and an ordered `validations` array. Every validation contains a contiguous attempt number and verdict (`PASS`/`BLOCKED`); phase status is derived from the latest attempt.
- **Integration validation history**: integration uses the same ordered attempt model. Integration cannot begin until every phase's latest verdict is `PASS`.
- **Changed-file evidence**: every entry carries canonical present/deleted observations and digest/byte metadata when present. Safe paths outside frozen targets are retained in `outsideDeclaredTargets`; unsafe, source-plan, and execution-record paths remain rejected.
- **Terminal state**: `active`, `completed`, `blocked`, or `interrupted`. A checkpointed `BLOCKED` verdict does not change `active` state. `finish: blocked` records terminal blocker evidence; `finish: completed` requires latest `PASS` for every phase and integration.

### `sprint_execution_record` Tool

The tool exposes three actions:

- **`start`**: Creates the execution directory, freezes the source plan with immutable hashes, captures the orchestration snapshot, acquires an exclusive lease, and returns the immutable `runId`, initial revision, and persisted source descriptor (canonical source path, aggregate digest, and per-file hashes and byte counts).
- **`checkpoint`**: Accepts `expectedRevision` and atomically appends implementation, phase-validation, or integration-validation evidence. Stale revisions are rejected deterministically. Each accepted checkpoint increments the revision and returns structured warnings for accepted out-of-target paths.
- **`finish`**: Transitions the record to a terminal state (`completed`, `blocked`, `interrupted`). Releases the lease on clean state transitions.

Phase-bearing checkpoint variants accept `phase-NN-slug` or `phase-NN-slug.md`, normalize to the canonical `.md` filename, and list every valid canonical phase when lookup fails.

`start.sourcePlanPath` is a canonical project-relative directory. Optional `sourcePlanningRunId` provenance is accepted only when it exactly matches `<id>` in either canonical planner publication layout: `.internal-dev/plans/<id>` or `.internal-dev/sprints/<id>/planning`. Both layouts share one typed source-identity parser (`standalone-plan`, `sprint-planning`, or `other`). Frozen orchestration maps retain phase-ledger key order even when valid wave traversal order differs; wave numbers remain authoritative and unchanged.

No action launches provider work, spawns subagents, or coordinates workers. The orchestrate skill owns those responsibilities.

## Plan Validation

### `sprint_validate_plan` Tool

Read-only structured validation of a sprint-planner-generated plan directory. Returns a versioned `PlanValidationResult` with:

- `valid`: overall pass/fail.
- `metadata`: phase count, scope size, phase paths, and wave count.
- `findings`: categorized diagnostics across `root`, `shape`, `phase-budget`, `phase-metadata`, `dependency`, `wave`, `target`, `model-route`, `gate`, `integration`, and `symbolic-link` categories.

The tool never creates, normalizes, touches, or rewrites any plan file. It rejects symbolic-link traversal, foreign ownership, and non-canonical paths. A pre-freeze decomposition correction gate ensures phase filenames, goals, dependencies, write targets, the orchestration ledger, and waves agree before a plan is considered valid.

## Failure-Safe Fan-Outs and Retry Accounting

Brainstorm cross-reviews and corrective planning stages use scope-local fan-out primitives:

- A failed sibling cancels and settles only its own fan-out, not unrelated workers.
- Interruption does not consume the retry budget; only completed failures count against the attempt limit (max 3 attempts per step).
- Exact semantic retry feedback (provider, typed, or semantic failure category) is stored in step state and included in the next attempt's prompt.
- Resume revalidates completed planning artifacts by hash; the first invalid artifact invalidates itself and all downstream planning work.

## Validation

The package test suite uses fake runners and incurs no model cost. It covers raw prompt preservation, exact planning routes, all-to-all same-session cross-review, structural barriers, exact orchestration semantics, phase budgets, instruction-only estimate guidance, validator acceptance of duration wording, ordered per-component correction, semantic retry/resume, flat no-replace publication and ownership-safe failure handling, planning-only completion, pause/resume, cleanup, reset and symlink protection, skill packaging, absence of the extension `/orchestrate` command, the skill's exact implementation/validation model contract, run-record discovery, lease acquisition and inspection, list and read-only doctor outputs, structured plan validation with categorized findings, execution-record lifecycle (start/checkpoint/finish with revision gating), and immutable source identity preservation.

Resource validation uses Pi RPC `get_commands`: extension commands must omit `orchestrate`, while `skill:orchestrate` must resolve to the package skill path. `get_commands` must also resolve `sprint_validate_plan` and `sprint_execution_record` as registered tools.
