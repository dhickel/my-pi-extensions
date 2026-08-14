# Pi Sprint Planner Suite

An installable Pi package (v0.3.0) containing a deterministic planning extension and the separate `orchestrate` skill.

The extension registers four slash commands (`/sprint`, `/brainstorm`, `/ironout`, `/advanceplan`), three agent-callable planning tools (`sprint_brainstorm`, `sprint_ironout`, `sprint_advanceplan`), and two additional agent-callable tools for validation and execution evidence (`sprint_validate_plan`, `sprint_execution_record`). It does not implement plans and does not register `/orchestrate`.

## Install

From this repository's root, register the coordinated packages in Pi's user settings:

```sh
pi install ./internal-dev
pi install ./user-questioning
pi install ./sprint-planner
pi list
```

Use `-l` on each install for project-local registration. Local-path packages remain linked to their source directories. The `sprint-planner` package manifest installs both `index.ts` and `skills/orchestrate/SKILL.md`.

If older manually copied versions of `internal-dev` or `user-questioning` still exist under `~/.pi/agent/extensions/`, remove or archive those copies first. Interactive ironout requires the current `user-questioning` package.

The `orchestrate` skill requires Pi's `subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel` tools. Ensure the subagent extension or equivalent tool provider is installed separately.

After installation or source updates, run `/reload` or restart Pi.

## Extension commands

- `/sprint [--name <slug>] [--agents 2..8] <prompt>` runs brainstorm → ironout → corrected advanced planning, then stops.
- `/sprint status|pause|resume|reset|list|doctor [run-id]` manages a persisted planning run:
  - `status` — show the current sprint state and progress.
  - `pause` — interrupt at a durable checkpoint without losing work.
  - `resume` — explicitly resume a paused or previously-interrupted sprint from its first incomplete checkpoint.
  - `reset` — confirm and permanently delete the selected sprint directory; never reverts repository edits.
  - `list` — discover every planning and execution record under `.internal-dev/sprints/` with kind, state, markers, and lease ownership.
  - `doctor` — read-only diagnosis of a selected sprint record with severity-graded findings. Performs no writes, releases, clearing, or takeover.
- `/brainstorm [--agents 2..8] <prompt>` runs findings → same-session all-to-all cross-review → synthesis → red team. Supports `status` and `cancel`.
- `/ironout [--interactive|--auto] <prompt>` runs standalone handoff authoring and corrective review. Interactive mode uses up to 3 rounds of at most 3 choice questions. Supports `status` and `cancel`.
- `/advanceplan <prompt>` runs advanced planning with concept, orchestration, and per-phase corrective reviews. Plans use practical one-session sizing (roughly 200,000–300,000 tokens maximum) and divide cohesive phases that may exceed one agent session's context into ordered lettered subphases, with validation only after all subphases complete. Supports `status` and `cancel`.

Bare start commands open Pi's editor. Input may be a plain request, pasted material, a path, or natural language referring to paths. The command layer preserves it as prompt text; planning agents interpret references with read-only project tools.

Standalone commands support `status` and `cancel`, use in-memory child sessions, and publish only after all planning model work succeeds. Commands run in the background so the main agent remains interactive.

## Agent-callable planning tools

- `sprint_brainstorm` — accepts an authoritative prompt and optional worker count (2–8), starts the mandatory same-session findings and all-to-all cross-review lifecycle in the background, and returns its run id immediately.
- `sprint_ironout` — accepts a brainstorm directory or other input artifact path, starts autonomous authoring and corrective review via engine-owned model routes in the background, and returns its run id immediately.
- `sprint_advanceplan` — accepts a corrected handoff path, starts concept review → orchestration review → per-phase reviews via engine-owned model routes in the background, and returns its run id immediately.
- `sprint_poll` — waits for background planning completion, consumes terminal results, and reports remaining workflows. It wakes early for queued user input so the main agent can answer, then a hidden turn-end reminder directs it back to polling until no workflow or undelivered result remains.

Together with `sprint_validate_plan` and `sprint_execution_record`, these are the extension's six agent-callable tools. The three planning start tools are non-blocking: after starting one, the root calls `sprint_poll` repeatedly until it receives the terminal output. Poll timeouts continue through automatic follow-up turns; queued user messages take priority without cancelling the workflow, and polling resumes afterward. `sprint_ironout` and `sprint_advanceplan` expose no model parameters: the engine supplies fixed routes, with advanced-plan agents resolved from the loaded default configuration. Relative input paths resolve from Pi's current working directory; a leading `@` is accepted for parity.

## Agent model configuration

Every sprint-planner agent assignment lives in `configs/`. `configs/default.ts` is the current configuration and must conform to `SprintPlannerAgentConfiguration` in `types.ts` — covering every planning stage plus the basic implementer, advanced implementer, phase validator, integration validator, and senior agent. `configs/index.ts` registers installed configurations and fixes `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION` to `default`.

When Pi loads `sprintPlannerExtension()`, the extension resolves that fixed default into `currentAgentConfiguration`. Every `SprintPlannerEngine` created by the extension receives this same configuration snapshot and uses it for every pipeline stage. Resolved tuples, not configuration names, remain in persisted state. There is no runtime setting, command option, or tool parameter to select another configuration yet.

A future configuration must be added as a schema-conforming file in `configs/`, registered in `configs/index.ts`, and paired with an explicitly approved configuration-selection contract. Do not alter the default loader or expose a caller-selected model as a shortcut.

## Validation and execution-evidence tools

### `sprint_validate_plan`

Read-only structured validation of a sprint-planner-generated plan directory. Returns a versioned `PlanValidationResult` with `valid`, `metadata` (phase count, scope, waves), and categorized `findings` across shape, budget, dependency, wave, target, model-route, gate, integration, and symbolic-link categories. Model-route validation requires distinct basic and advanced profiles, one ordered `basic`/`advanced` assignment per phase, and final-integration agreement with the plan-owned validation tuple. Never creates, normalizes, touches, or rewrites any plan file. Rejects symlink traversal, foreign ownership, and non-canonical paths.

### `sprint_execution_record`

Versioned execution-evidence persistence with three actions:

- **`start`** — creates a distinct execution-only directory (`exec-*`), freezes the source plan with immutable hashes, captures the orchestration snapshot, acquires an exclusive lease, and returns the immutable `runId`, initial revision, and persisted source descriptor (canonical source path, aggregate digest, and per-file hashes and byte counts).
- **`checkpoint`** — appends implementation, phase-validation, or integration-validation evidence. Requires `expectedRevision`; stale revisions are rejected deterministically. Each accepted checkpoint increments the revision. Changed paths outside declared targets are persisted in `outsideDeclaredTargets` and returned as structured plan-drift warnings rather than rejected.
- **`finish`** — transitions the record to a terminal state (`completed`, `blocked`, `interrupted`). Releases the lease on clean transitions. Completion requires every phase's latest validation and the latest integration validation to be `PASS`.

New execution records use schema version 2. Phase and integration validation histories retain numbered attempts; `BLOCKED` remains durable but keeps the record active and retryable, disjoint sibling evidence remains accepted, and dependents wait until each dependency's latest verdict is `PASS`. Version-1 records remain available for strict read-only parsing and diagnosis.

Checkpoint phase names accept both `phase-NN-slug` and `phase-NN-slug.md`; the canonical filename with `.md` is always used internally. Unknown names report the valid canonical phase list.

`start.sourcePlanPath` is always canonical and project-relative. `start.sourcePlanningRunId` is optional provenance: use exactly `<id>` for `.internal-dev/plans/<id>` or `.internal-dev/sprints/<id>/planning`, and omit it for other layouts. It is never a path. Valid branching plans may list phases in wave traversal order that differs from phase-ledger order; the frozen record normalizes its maps to phase-ledger order without changing wave assignments.

This tool persists evidence only — it never launches provider work, spawns subagents, or coordinates workers. The orchestrate skill owns those responsibilities.

Execution records live at `.internal-dev/sprints/<execution-run-id>/execution/record.json` with a companion `manifest.md`. Source plan bytes and hashes are immutable after `start`. Execution records never write into source plan or planning-run directories, and their identifiers never alias source identities.

## Orchestrate skill

Invoke the separate skill explicitly or ask Pi to execute a complex workflow or plan:

```text
/skill:orchestrate Implement .internal-dev/plans/my-plan
```

The skill executes validated generated plans. Raw prose, checklists, single phase files, and legacy plans without validated model assignments must go through advanced planning first. Structured `orchestration.md` is authoritative: unsafe or uncertain declared waves block rather than being silently rescheduled. A wave larger than the four-agent cap runs bounded implementation batches to terminal before bounded validation batches, without weakening its logical PASS barrier.

The skill calls `sprint_validate_plan` for generated plans before starting, then `sprint_execution_record start` to freeze the source plan. It checkpoints phase and integration evidence through `sprint_execution_record checkpoint` with exact revision tracking, and finishes with `sprint_execution_record finish`. Unexpected changed paths are always recorded truthfully and treated as plan drift: the skill widens its observed write set, reassesses overlap before validators and later phases, and serializes validators whose discovered write sets overlap without mutating the frozen target contract. It uses the subagent tools (`subagent_spawn`, `subagent_poll`, `subagent_status`, `subagent_cancel`) for all delegated work.

Advanced planning resolves the loaded config and hard-codes the model contract into each plan. The active `default` configuration supplies:

- basic implementation: `deepseek/deepseek-v4-flash:max` for documentation, writing, closeout, routine edits, straightforward scripts, and simple non-logic-heavy programming;
- advanced implementation: `deepseek/deepseek-v4-pro:max` for logic-heavy code, vertical slices, advanced programming, and difficult algorithms or mathematics;
- independent review-and-repair validation of every phase and final integration: `openai-codex/gpt-5.6-luna` at `xhigh`.

The orchestrate skill consumes the plan-owned model contract: it reads each validated per-phase `basic` or `advanced` assignment from `orchestration.md`, confirms the execution record freezes the same tuple, and explicitly supplies it to every implementation spawn. Only when the input carries no validated model assignments does it fall back to the active configuration's `basicImplementer`, `advancedImplementer`, and `phaseValidator` tuples. It preflights every distinct assigned implementation tuple plus the plan-owned validation tuple before edits. Preflight children receive exactly `tools: []`; implementers and phase/integration validators receive exactly `tools: ["read", "bash", "edit", "write"]`. Only optional senior escalation resolves `seniorAgent` directly from configuration. Each validator fixes in-scope defects itself, reruns checks, and returns only `VERDICT: PASS` or `VERDICT: BLOCKED`; dependents wait for PASS.

Plans and root or delegated reports contain no human time, duration, effort, ETA, or calendar-schedule estimates. Operational wave language and technical machine timing remain allowed. Ironout and every advanced-planning/review prompt instruct agents to use the exploration skill for broad codebase investigation and to summarize architecture/behavior maps, important signatures, flows, invariants, and integration boundaries. These prompts enforce the full requested scope without feature creep: production quality means fully implementing and validating requested behavior, not adding speculative, adjacent, optional, or otherwise unrequested features to make the codebase seem feature-complete or production-ready. They also reject mocks, stubs, placeholders, deferred work, partial implementations, or bare-minimum shortcuts as acceptable endpoints unless the user directive itself asks for them. Never-defer applies to user-directive work and decided-on features: all such work must be completed fully. In full sprints the ironout author receives the user's original directive (or the handoff provided to brainstorming) as the authoritative scope contract alongside the brainstorm synthesis and red-team material, which supply implementation approaches only. Brainstorming may suggest some quality-of-life and supporting features that genuinely serve the directive, but it must tighten and refine the request rather than balloon or expand scope.

The skill is root-session only and does not claim background persistence, automatic resume, or `/sprint resume` behavior. Before a root-directed interruption, cancellation, or terminal finish, it cancels when required and polls every launched child to terminal; an external process termination may prevent further orchestration.

## Brainstorm lifecycle

The engine waits for every `findings.md`, continues each original worker session with every other finding, waits for every `cross-review.md`, and only then starts synthesis. A missing or failed cross-review stops the workflow; no partial standalone brainstorm is published.

Root agents call `sprint_brainstorm` for the same engine-owned lifecycle. Generic manual subagent coordination is not equivalent to this mandatory cross-review barrier.

## Planning and structural gates

Advanced-plan correction runs in order: one decomposition review, one concepts review, one orchestration review, then one independent corrective review per phase. All four review roles use the loaded default configuration's `openai-codex/gpt-5.6-luna:xhigh` assignment. Each phase reviewer receives corrected `concepts.md`, corrected `orchestration.md`, exactly one phase, and the phase-name index. Component semantics are checked inside their retry boundaries and rechecked on resume before completed checkpoints are trusted.

The published plan contains only `concepts.md`, exact structured `orchestration.md`, and flat contiguous `phase-NN-*.md` files; component reviews remain outside `planning/`. Scope is small (2–3 phases), medium (3–5), large (6–10), or extra-large (11–20); most sprints should normally land around 5–10 phases, with lettered subphases and plans up to 20 phases supported when the work genuinely requires them. Planning makes complete plans and does not trim work to save tokens. `orchestration.md` owns the complete phase ledger, dependencies, write targets, contiguous execution waves, exact model assignments, PASS gate, and final integration metadata.

Each cohesive unsplit phase is executable by exactly one implementation agent; when a cohesive phase is likely to exceed one agent session's context or focused edit capacity, its ordered lettered subphases each map to their own sequential implementation agent before one shared phase validator runs. Phases provide exact targets, ordered edits, invariants, edge cases, and concise necessary code or pseudocode examples without context bloat. Authoring and review prompts instruct models to cover the full requested scope with feature-complete, production-quality outcomes, reject mocks/stubs/placeholders/deferred or partial work as satisfying acceptance unless the user directive asks for them, and omit human time, duration, effort, ETA, target-date, and calendar-schedule estimates while allowing technical machine timing, complexity notation, and operational wave language.

Deterministic gates verify required headings, synthesis source coverage, corrected handoff structure, exact orchestration semantics, and plan directory shape. They do not scan output wording for time estimates or durations. Structural contract failures identify the defect and stop publication.

## Storage and recovery

Trusted projects must have a ready `.internal-dev` store. Planning runs live under `.internal-dev/sprints/<run-id>/`; `planning/` contains only corrected `concepts.md`, `orchestration.md`, and phase files. `.state.json` and `.sessions/` exist only while incomplete and are removed after successful plan publication.

State version 3 reflects the plan artifact contract (concepts + orchestration + phases); older incomplete state requires reset. Version-1 runs from the former implementation pipeline cannot be resumed with this package version; `/sprint reset [run-id]` remains available for cleanup and does not revert repository edits.

Reload, shutdown, or crash marks running work interrupted and never launches model calls automatically. `/sprint resume` revalidates planning artifact hashes and semantics, resets the first invalid component's attempts, invalidates downstream planning work, reopens recorded planning sessions, and continues explicitly. Reload inspects any previously-bound sprint read-only and never auto-resumes.

Execution records live alongside planning runs under `.internal-dev/sprints/` with distinct `exec-*` identifiers. Their source plan bytes and hashes are immutable after creation. Clean shutdown interrupts owned unfinished execution records and releases their leases. A crash leaves the record on disk with uncertain lease ownership; `/sprint list` and `/sprint doctor` report it read-only.

Publication never replaces conflicting output. It uses staging, exclusive target reservation, no-replace materialization, and identity/content ownership checks; unsafe rollback is stopped and reported. Recovery can recognize byte-exact completed output. This is collision-safe and reported-failure-safe, not a claim of cross-path crash atomicity.

### Leases

Mutable sprint directories are protected by versioned exclusive leases carrying owner identity (runtime id, pid, hostname), run kind, and acquisition timestamp. `/sprint list` and `/sprint doctor` report lease ownership read-only — `owned-by-this-runtime`, `unleased`, `held-by-other`, or `uncertain`. An uncertain lease is never stolen, cleared, or released by list or doctor. Only `/sprint reset` (after explicit user confirmation) may delete a leased directory alongside its workers.

## Test

```sh
npm --prefix sprint-planner test
```
