# Durable Decisions

Record accepted decisions, justification, alternatives, caveats, affected specifications, source, and review timing.

## 2026-07-15 — Sprint planner model routing is code-owned and exact

- Decision: every deterministic extension planning responsibility uses the provider, model, and thinking tuple in `sprint-planner/types.ts`; DeepSeek brainstorming workers require `max`, and GPT-5.6 Sol planning roles use their specified `high`, `xhigh`, or `max` level.
- Justification: deterministic routing prevents root-model drift and makes cost, capability, and validation behavior testable.
- Alternative: inherit the root model or clamp unsupported levels. Rejected because it silently changes the intended workflow.
- Caveat: a missing model, authentication, or exact thinking capability pauses the workflow rather than substituting a model.
- Affected specification: `sprint-planner-suite.md`.
- Source: Resilient Pi Sprint Planner Suite implementation brief.
- Review timing: when extension planning model ids or supported thinking metadata change.

## 2026-07-15 — Standalone planning workflows are stateless and full planning runs are resumable

- Decision: standalone child sessions use in-memory session managers and publish only after successful model work; only `/sprint` writes `.state.json` and private child-session checkpoints.
- Justification: standalone commands remain easy to rerun, while long, costly planning pipelines survive interruption with prior context.
- Alternative: persist every command. Rejected because it creates recovery and stale-run complexity for small workflows.
- Caveat: incomplete standalone planning output is not published.
- Affected specification: `sprint-planner-suite.md`.
- Source: Resilient Pi Sprint Planner Suite implementation brief.
- Review timing: if standalone resume becomes a product requirement.

## 2026-07-15 — Published advanced plans are flat and reviews stay outside them (superseded in part 2026-07-17)

- Decision (historical): a plan directory contains exactly one `concepts.md` and contiguous flat `phase-NN-*.md` files. Corrective reviews are stored separately.
- Superseded portion: the flat set now also requires exact structured `orchestration.md`; the no-review and no-nesting portions remain in force. See the 2026-07-17 decision below.
- Justification: each implementer can receive the common concepts plus exactly its own phase without accidental context from other phases.
- Alternative: nested phases or review files inside the plan. Rejected because it weakens deterministic discovery and context isolation.
- Caveat: full sprint planning drafts may exist elsewhere in the run record, never in `planning/`.
- Affected specification: `sprint-planner-suite.md`.
- Source: Resilient Pi Sprint Planner Suite implementation brief.
- Review timing: if Pi gains a typed plan-bundle primitive.

## 2026-07-15 — Recovery is explicit and begins with artifact revalidation

- Decision: shutdown, reload, or crash interrupts running work without automatic provider calls. `/sprint resume` validates artifact hashes, invalidates downstream checkpoints after the first invalid artifact, reopens recorded child sessions, and continues explicitly.
- Justification: model calls can be costly or side-effecting; silent restart is unsafe, while hash validation prevents stale handoffs from contaminating later stages.
- Alternative: automatically resume at extension load. Rejected due to surprise cost and stale-session risk.
- Caveat: provider-side work completed after a hard process crash may need a retry if its artifact transition was not committed.
- Affected specification: `sprint-planner-suite.md`.
- Source: Resilient Pi Sprint Planner Suite implementation brief.
- Review timing: when Pi provides transactional provider-call checkpoints.

## 2026-07-15 — Confirmed sprint reset is the sole destructive store exception

- Decision: `/sprint reset` may delete a selected sprint directory even when its state is malformed, but only after confirmation and worker abortion; it never attempts to revert repository edits.
- Justification: malformed recovery metadata must not make a run undeletable, and pretending to roll back arbitrary implementation edits would be unsafe.
- Alternative: archive or parse state before deletion. Rejected because malformed state is the case reset must reliably handle.
- Caveat: path and symlink protection still applies, and no other `.internal-dev` artifact workflow gains destructive deletion.
- Affected specification: `sprint-planner-suite.md` and the root `.internal-dev/AGENTS.md` contract.
- Source: Resilient Pi Sprint Planner Suite implementation brief.
- Review timing: before broadening reset beyond one selected run directory.

## 2026-07-15 — Capture-specific stores are excluded from the internal-dev contract

- Decision: the internal-dev extension does not scaffold or create capture or headless-capture-test artifacts, and generated workflow guidance does not advertise those stores.
- Justification: the workflow does not need dedicated visual-capture stores; validation evidence can remain with the artifact that owns the work.
- Alternative: keep optional capture artifact kinds while omitting them from initialization. Rejected because hidden artifact kinds would preserve an unsupported workflow surface.
- Caveat: existing project directories and historical records are not migrated or deleted automatically.
- Affected specification: the generated root `.internal-dev/AGENTS.md` contract and internal-dev extension artifact API.
- Source: user direction on 2026-07-15.
- Review timing: if a future renderer-validation workflow requires a dedicated persistent store.

## 2026-07-15 — Workflow input remains an agent-interpreted prompt

- Decision: slash-command handlers preserve workflow input as prompt text and never probe, classify, read, or expand it as a filesystem path. A prompt may contain pasted material, a path, multiple paths, or natural-language instructions around paths; planning and implementation agents use their existing scoped tools to interpret and inspect those references.
- Justification: path-or-directive guessing duplicated agent capabilities, rejected valid long and mixed prompts through filesystem filename limits, and could not correctly represent the range of user handoffs.
- Alternative: heuristically detect path-shaped strings and catch filesystem errors. Rejected because it retains unnecessary command-layer interpretation and still mishandles mixed path-plus-instruction prompts.
- Caveat: agents must return safe project-relative source references through typed intake contracts before implementation context is selected.
- Affected specification: `sprint-planner-suite.md`.
- Source: user direction on 2026-07-15 after reproducing the long-input failure.
- Review timing: if Pi adds a native typed attachment/reference primitive that preserves raw prompt semantics.

## 2026-07-16 — Artifact routing follows output semantics, not agent topology

- Decision: ordinary informational answers create no persistent artifact unless requested or required; completed repository-history, architecture or codebase assessments, audits, and analytical assessments route to reviews when persistence is useful; brainstorm folders are reserved for explicit ideation with unaccepted alternatives.
- Justification: subagent participation is an execution method, not an artifact class. Treating every multi-agent effort as brainstorming creates unnecessary records and misclassifies completed assessments as provisional ideas.
- Alternative: preserve a brainstorm folder for every effort that uses multiple agents. Rejected because it over-applies source-retention guidance and makes the store noisier without improving intended-truth routing.
- Caveat: actual brainstorming still retains each participating agent's or source's findings separately and keeps synthesis distinct from accepted decisions.
- Affected specification: generated root `.internal-dev/AGENTS.md` contract and the internal-dev extension's injected/tool guidance.
- Source: user correction and `.internal-dev/reviews/2026-07-16-internal-dev-brainstorm-routing-review.md` in the Vulkan engine project.
- Review timing: if artifact routing or review/brainstorm store semantics change.

## 2026-07-16 — Agent-initiated sprint brainstorms route through the engine

- Decision: expose `sprint_brainstorm` as the agent-callable counterpart to `/brainstorm`, with command and tool guidance stating that same-session all-to-all cross-review is unconditional and must complete before synthesis. Generic `subagent_spawn` coordination is not an equivalent sprint-planner run.
- Justification: slash commands are not model tools, so a root agent could previously imitate only the findings round with generic subagents and synthesize outside the engine's already-enforced cross-review barrier.
- Alternative: infer and police arbitrary `subagent_spawn` task text. Rejected because the sprint-planner extension cannot safely identify a complete external workflow or continue generic workers' disposed sessions.
- Caveat: an agent can still ignore the dedicated tool and conduct unrelated manual ideation; only `/brainstorm`, `/sprint`, and `sprint_brainstorm` provide hard engine sequencing. Explicitly manual sprint-planner coordination remains contractually required to complete cross-review before synthesis.
- Affected specification: `sprint-planner-suite.md`.
- Source: user-reported manual sprint brainstorm omission on 2026-07-16.
- Review timing: if Pi makes slash commands directly callable by agents or generic subagents gain persistent continuation handles.

## 2026-07-16 — Advanced-plan correction is per artifact and per phase (superseded in part 2026-07-17)

- Decision (historical): replace the monolithic `xhigh` plan rewrite with one `xhigh` concepts correction and one `xhigh` correction per phase. Each phase call sees corrected concepts and exactly one phase; the engine assembles component findings into the existing summary-review artifact and preserves the published plan shape.
- Superseded portion: correction now runs concepts → orchestration → each phase, with a dedicated `xhigh` orchestration correction between concepts and phases. The per-component and per-phase boundary remains in force. See the 2026-07-17 decision below.
- Justification: phase files are individually large, and a single all-plan correction caused excessive turns and input-token rereading while reducing focus.
- Alternative: retain one reviewer and allow it to spawn optional phase subreviews. Rejected because the engine would no longer own a deterministic per-phase cost and completeness boundary.
- Caveat: corrective reviewers preserve the planner's phase file set rather than splitting or merging phases; cross-phase architecture is corrected in the concepts pass.
- Affected specification: `sprint-planner-suite.md`.
- Source: engine-alpha sprint-run friction review on 2026-07-16.
- Review timing: if Pi adds a typed map/reduce review primitive or plan phases become small enough that monolithic correction is cheaper.

## 2026-07-16 — Stage boundaries have deterministic structural validators

- Decision: validate required Markdown headings, synthesis source-path coverage, and the real published plan-directory shape between stages without additional LLM calls.
- Justification: typed submission checks alone did not make stage-to-stage drift visible at the boundary, while structural checks can fail early with exact missing paths or headings at negligible cost.
- Alternative: ask another model to review every artifact between stages. Rejected because these gates are structural rather than semantic and should not add model cost.
- Caveat: path references prove structural source coverage, not semantic correctness or complete defect resolution; semantic review remains with the existing corrective and validation stages.
- Affected specification: `sprint-planner-suite.md`.
- Source: engine-alpha sprint-run friction review on 2026-07-16.
- Review timing: when artifact schemas or required headings change.

## 2026-07-16 — Missing toolchains pause through a typed user-action gate (superseded)

- Decision: implementation children report missing required executables through a typed blocker containing dependency, user command, and details. Full sprints checkpoint the escalation and keep the work unit pending without consuming a retry; standalone orchestration publishes an escalation but remains rerun-only.
- Justification: implementation children cannot prompt the root user, and retrying sibling workers against the same missing environment wastes calls without making progress.
- Alternative: let workers return prose failures or have the engine infer `command not found` from arbitrary output. Rejected because prose is ambiguous and inference cannot reliably supply a safe, exact user-action command.
- Caveat: the engine records and displays the worker-supplied command but never executes it. Standalone resume remains out of scope under the stateless-workflow decision.
- Affected specification: `sprint-planner-suite.md`.
- Source: engine-alpha sprint-run friction review on 2026-07-16.
- Review timing: superseded on 2026-07-16 when implementation orchestration moved out of the extension.

## 2026-07-16 — Sprint planning and implementation orchestration are separate installed resources (validator path superseded in part 2026-07-17)

- Decision: the `sprint-planner` extension ends after corrected plan publication and does not register `/orchestrate` or retain implementation code paths. The same Pi package installs an `orchestrate` skill that interprets raw workflows or plan files and coordinates implementation through generic subagent tools.
- Justification: embedding orchestration in the deterministic extension exposed too many overlapping workflow concepts to the model and made the capability difficult to reuse elsewhere. Progressive disclosure keeps planning deterministic while making execution reusable and explicit.
- Alternative: keep `/orchestrate` and add a second skill wrapper. Rejected because duplicate entrypoints and ownership would preserve the model confusion.
- Caveat (historical): the skill is root-session prompt orchestration, not an engine state machine; it has no background persistence or `/sprint resume`. It requires exact `deepseek/deepseek-v4-pro:max` implementation and `openai-codex/gpt-5.6-sol:xhigh` per-phase validation tuples and stops if either is unavailable. The original validator path used a read-only verdict followed by separate DeepSeek repair.
- Superseded portion: GPT-5.6 Sol validation now has in-scope edit authority, self-repairs, and returns PASS/BLOCKED only; the root-session and exact-tuple portions remain in force. See the 2026-07-17 decision below.
- Affected specification: `sprint-planner-suite.md` and the internal-dev sprint-record wording.
- Source: user direction on 2026-07-16.
- Review timing: if Pi gains a reusable persisted skill-workflow primitive or the required model ids change.

## 2026-07-17 — Advanced plans carry exact execution metadata and editing validators own repair

- Decision: every published advanced plan is the flat set `concepts.md`, exact structured `orchestration.md`, and contiguous budgeted phases. `orchestration.md` owns the complete phase ledger, dependencies, write targets, contiguous waves, exact model tuples, PASS-before-dependent gate, and final-integration metadata. Correction runs concepts → orchestration → each phase. Each cohesive phase maps to exactly one DeepSeek max implementer and provides concise head-down targets, ordered edits, invariants, edge cases, and only necessary examples. Plans and root or delegated reports prohibit human scheduling estimates. Generated waves block when unsafe or uncertain; raw input may default sequential, and cap-driven batching preserves the logical wave. GPT-5.6 Sol xhigh validators repair in-scope defects themselves and return only PASS or BLOCKED; there is no read-only validator, VERDICT: REPAIR, or separate DeepSeek repair loop.
- Justification: exact metadata and dense phase guidance amortize architecture and scheduling reasoning once, while an editing validator removes a repair round trip and can verify its own fixes against actual state.
- Alternative and tradeoff: re-derive schedules at execution time and retain read-only validators with a separate DeepSeek repair agent. Rejected because topology drift can make parallel work unsafe and the extra repair handoff adds cost and context loss. The stricter plan schema rejects ambiguous plans instead of guessing.
- Caveat: validator edit authority is bounded to assigned defects and criteria; it must not expand scope or rewrite unrelated code. Operational wave language, technical machine timing, and complexity notation remain allowed. A generated unsafe wave blocks rather than receiving a convenient fallback topology.
- Affected specification: `sprint-planner-suite.md`.
- Source: Phase 01–03 advanced-planning amortization implementation and validation directive.
- Review timing: if plan schema, concurrency cap, validator edit primitives, or exact model tuples change.

## 2026-07-17 — Publication is no-replace and rollback is ownership-bounded

- Decision: plan publication stages complete output, reserves absent final targets exclusively, materializes without replacement, and removes only output whose identity and content still prove ownership. Conflicts and unsafe rollback are reported; byte-exact completed output may be recognized during recovery.
- Justification: publication races must not overwrite another actor's output, and cleanup must not delete foreign or subsequently modified data.
- Alternative and tradeoff: rename a staged nonempty directory directly into place or promise transaction-like rollback across all output paths. Portable Node/POSIX APIs do not provide the required no-replace directory rename, and a multi-path crash-atomicity claim would be false; reservation plus hard-link materialization exposes partial output after a crash but preserves collision and ownership safety.
- Caveat: the guarantee is no-replace and reported-failure-safe, not crash-atomic across multiple paths. An ownership mismatch intentionally leaves uncertain output for inspection.
- Affected specification: `sprint-planner-suite.md`.
- Source: Phase 01–03 publication hardening implementation and validation directive.
- Review timing: if the runtime gains a portable no-replace directory transaction primitive or publication layout changes.

## 2026-07-18 — Validation uses GPT-5.6 Sol at medium reasoning

- Decision: use the exact `openai-codex/gpt-5.6-sol:medium` tuple for sprint-planner corrective reviews, orchestrated post-phase review-and-repair, and final integration validation. Authoring and advisory routes remain unchanged.
- Justification: the user explicitly reduced validation reasoning from `xhigh` to `medium` while retaining GPT-5.6 Sol and the existing validation/repair gates.
- Alternative and tradeoff: retain `xhigh` validation. Rejected because it no longer matches the requested cost/capability balance.
- Caveat: validators still have the same criteria, edit authority, PASS/BLOCKED contract, and exact-tuple failure behavior; only thinking level changes.
- Affected specification: `sprint-planner-suite.md`.
- Source: user direction on 2026-07-18.
- Review timing: if validation quality or model availability requires revisiting the reasoning level.

## 2026-07-19 — Time-estimate guidance is prompt-only

- Decision: remove regex-based time-estimate detection from sprint-planner handoff and plan validators. Authoring and corrective-review prompts continue to instruct models not to include time, duration, effort, ETA, or calendar scheduling estimates because plans describe what to do, not how long it takes.
- Justification: wording scans reject valid technical content such as token expiry and cache TTL values, produce opaque retries, and can block the ironout pipeline. Structural validators should validate artifact shape and orchestration semantics rather than infer prose intent.
- Alternative and tradeoff: retain or broaden the regex exception list. Rejected because any heuristic wording classifier remains brittle and adds validation friction; prompt-only guidance is not a deterministic guarantee that generated prose will comply.
- Caveat: technical machine timing remains valid, and all heading, submission, plan-shape, orchestration, and persistence validation remains unchanged.
- Affected specification: `sprint-planner-suite.md`.
- Source: user direction on 2026-07-19.
- Review timing: only if a non-regex semantic review mechanism is explicitly requested.

## 2026-07-19 — Run leases are conservative and doctor is read-only

- Decision: mutable sprint run directories are protected by versioned exclusive leases keyed on owner identity (runtime id, pid, hostname). `/sprint list` and `/sprint doctor` are read-only consumers of the same lease discovery and never release, clear, rewrite, or steal a lease.
- Justification: a runtime crash can leave a lease file on disk with no living writer. Determining whether the original owner is truly gone is inherently race-prone. Conservatively reporting uncertain ownership rather than safety-guessing prevents accidental dual-writer corruption.
- Alternative and tradeoff: implement PID-liveness probes or TTL-based auto-clearance. Rejected because PID reuse and wall-clock skew make both unreliable; doctor can report the stale PID but the user must confirm `reset`.
- Caveat: an uncertain lease is reported but never acted upon. A stale lease held by a long-defunct process that reused the same pid is indistinguishable from a live one; the user decides.
- Affected specification: `sprint-planner-suite.md`.
- Source: phase-03 implementation and validation directive.
- Review timing: if Pi provides a durable restartable session handle or transactional lease primitive.

## 2026-07-19 — Execution records are distinct from planning runs

- Decision: orchestration evidence persists in a separate execution-only sprint record with an identifier that never aliases the source plan or planning-run id. The record contains immutable source hashes, a frozen orchestration snapshot, and a revisioned phase ledger. It never modifies or writes into the source plan directory.
- Justification: planning output and execution evidence have different lifecycles, update cadences, and integrity requirements. Source immutability enables post-hoc audit without risking plan corruption from implementation-side writes.
- Alternative and tradeoff: embed execution evidence inside the planning run or plan directory. Rejected because it couples clean plan output with inevitably revisioned runtime state and makes byte-level source auditing fragile.
- Caveat: the execution record is a narrow persistence boundary. The orchestrate skill owns sibling coordination, polling, checkpoint timing, and finish decisions. Record operations validate state transitions and revisions but do not launch provider work.
- Affected specification: `sprint-planner-suite.md`.
- Source: phase-04 implementation and validation directive.
- Review timing: if execution evidence needs to reference a plan version that postdates the original freeze.

## 2026-07-19 — Subagent tool policy is exact and atomically validated

- Decision: every subagent receives a complete exact array of case-sensitive tool API names. The spawn batch is validated atomically before any child initializes. Unknown, unavailable, duplicate, forbidden, root-only, or fingerprint-mismatched tools reject the entire batch with a concrete error.
- Justification: additive or inherited tool policies let a model silently work around intended restrictions by reasoning about absent tool descriptions. Exact arrays plus atomic rejection make tool-gate failures visible and deterministic.
- Alternative and tradeoff: inherit root tools by default with opt-out exclusions, or validate per-agent after children start. Rejected because exclusion lists drift across Pi versions and post-start validation leaks a head-start to already-started children.
- Caveat: the model may still not use all granted tools; exact policy controls what is possible, not what the model chooses. Excluded tool definitions and prompt guidance never enter child context.
- Affected specification: `sprint-planner-suite.md` and the subagents README.
- Source: phase-05 implementation and validation directive.
- Review timing: if Pi adds a dynamic tool grant/revoke primitive during a live session.

## 2026-07-19 — Subagent results are session-local immutable snapshots with paginated retrieval

- Decision: each completed subagent result is stored in one immutable in-memory snapshot. Oversized results are retrieved through UTF-8-safe pages carrying stable identity, cursors, byte count, digest, and completion metadata. Pages reconstruct byte-for-byte from stable cursors and match the complete-result digest. Late results from detached children are suppressed; root accounting settles once at detachment.
- Justification: mutating a completed result after delivery corrupts poll deduplication and makes the agent's downstream reasoning untrustworthy. Pagination makes multibyte UTF-8 safe without buffering all output in model-visible tool results, while matching digests prove reconstruction integrity.
- Alternative and tradeoff: buffer all output inline in tool results and rely solely on model truncation. Rejected because large implementer reports exceed context limits and cannot be inlined without permanent loss.
- Caveat: page cursors are session-scoped and invalid after root session end. Poll delivery and result-lifetime semantics are unchanged — pagination supplements truncated delivery without replacing poll or lifecycle guarantees.
- Affected specification: `sprint-planner-suite.md` and the subagents README.
- Source: phase-06 implementation and validation directive.
- Review timing: if Pi adds a durable cross-session result store for subagent output.

## 2026-07-19 — Subagent cancellation and shutdown are bounded and terminal

- Decision: cancellation and shutdown abort all active children, dispose their sessions, and settle root accounting once. A configurable grace period (default 5 seconds) allows cooperative cleanup; after the grace period, non-cooperative children are force-detached. Detached children cannot deliver late results or mutate root state.
- Justification: the root session cannot block indefinitely on a runaway model call or an unresponsive provider. Root-accounted detachment acknowledges that the child was terminated by the root but does not assert the remote provider stopped processing.
- Alternative and tradeoff: wait indefinitely for child termination or implement OS-level process killing. Rejected because provider-side work may outlive local process boundaries; the only guarantee is bounded local accounting without a false claim of remote termination.
- Caveat: documentation must say "root accounting detached" rather than "provider terminated." A detached non-cooperative child settles root accounting once and cannot deliver a late result or mutate root state.
- Affected specification: `sprint-planner-suite.md` and the subagents README.
- Source: phase-06 implementation and validation directive.
- Review timing: if Pi exposes an OS-level child-process handle or provider-call cancellation API.

## 2026-07-19 — Internal-dev initialization and artifact creation are explicit

- Decision: `.internal-dev` initialization is never triggered automatically at session start. The `internal_dev` tool and `/internal-dev init` command request explicit user confirmation. Artifact creation validates content by kind, normalizes changelog commit evidence, and validates the final normalized content before exclusive creation.
- Justification: implicit initialization on untrusted or unready projects creates unrequested scaffolding and can bypass project-trust decisions. Kind-specific normalization ensures changelogs always carry a deterministic Git baseline.
- Alternative and tradeoff: auto-initialize when the store is missing. Rejected because it removes user consent from a one-time side effect and may create a store the user never wanted.
- Caveat: the `internal_dev` create action with an interactive UI may offer initialization when the store is missing; it still requires user approval.
- Affected specification: the generated root `.internal-dev/AGENTS.md` contract.
- Source: phase-07 implementation and validation directive.
- Review timing: if Pi gains a project-template primitive that pre-seeds `.internal-dev`.

## 2026-07-19 — Validator owns repair; no separate repair loop

- Decision: the orchestrate skill's GPT-5.6 Sol `medium` phase and integration validators have full in-scope edit authority, repair discovered defects themselves, rerun required checks, and return only `VERDICT: PASS` or `VERDICT: BLOCKED`. There is no read-only validation mode, `VERDICT: REPAIR`, or separate DeepSeek repair handoff.
- Justification: an editing validator eliminates a repair round trip, can verify its own fixes against live repository state, and removes context loss and cost from a separate repair agent. The stricter verdict surface (PASS/BLOCKED only) makes the dependency barrier unambiguous.
- Alternative and tradeoff: retain a read-only validator plus a separate DeepSeek repair agent. Rejected because the extra handoff adds cost, loses context, and the two-step dance can loop when repair introduces new defects.
- Caveat: validator edit authority is bounded to assigned defects and criteria. A `BLOCKED` verdict requires a concrete condition outside validator authority, not an unvalidated suspicion. A malformed or missing verdict is retried once with a fresh validator before blocking.
- Affected specification: `sprint-planner-suite.md` and the orchestrate skill.
- Source: phase-08 implementation and validation directive.
- Review timing: if Pi adds an edit-boundary enforcement primitive that can constrain validator scope mechanically.

## 2026-07-19 — Generated-plan decomposition gate is pre-freeze

- Decision: before a generated plan is published, deterministic validators check that phase filenames, goals, dependencies, write targets, the orchestration ledger, and waves are cross-consistent. The freeze is atomic — no partial fixup or later silent correction.
- Justification: decomposition drift between orchestration metadata and phase files creates silent scheduling bugs at execution time. Catching it at plan-publication time makes the contract enforceable before any implementation work starts.
- Alternative and tradeoff: defer cross-consistency checks to the orchestrate skill at execution time. Rejected because the skill would either need to replicate validation logic or trust the plan blindly; validating at publication time makes the plan self-proving.
- Caveat: cross-consistency covers structural and metadata agreement, not semantic correctness of the assigned phase content.
- Affected specification: `sprint-planner-suite.md`.
- Source: phase-01 and phase-08 implementation and validation directives.
- Review timing: if plan phases become independently versioned or the plan format gains optional metadata fields.
