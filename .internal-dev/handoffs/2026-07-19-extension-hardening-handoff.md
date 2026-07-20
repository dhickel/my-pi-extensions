# Sprint-Planner Extensions & Skills Hardening Handoff

## Context

A comprehensive senior engineering review of the sprint-planner extensions ecosystem identified critical bugs, recovery gaps, LLM usability friction, and over-abstractions. The ecosystem includes: `sprint-planner` extension, `orchestrate` skill, `senior-agent` skill, `image-viewing` skill, `internal-dev` extension, and `subagents` extension. The architecture concept is sound with strong happy-path behavior, but the review found two P0 critical bugs, numerous P1 issues, and several recovery/robustness gaps that must be addressed to make the system production-reliable.

## Objective

Harden the entire extensions and skills ecosystem against the findings in the senior review. Every issue in the priority matrix must be addressed. The overarching principle: move deterministic validation, parsing, locking, and checkpointing into code; keep skills as concise policy wrappers; make the LLM's job easier by removing brittle enforcement and replacing it with clear instructions.

## Targets

1. **Fix P0 critical bugs:** session-ID collisions in persistent workers, orphan sibling workers on parallel fan-out failure
2. **Fix P1 bugs and gaps:** orchestrate skill contradiction, synthesis cross-review coverage, pause/resume retry exhaustion, missing run lease, validation error feedback to children, plan inconsistency between phases and orchestration
3. **Remove regex-based time-estimate enforcement:** Replace the aggressive regex validation in `validation.ts` with a clear instruction in prompts not to include time estimates. No hard-code validation path for this — trust the instruction. Remove `rejectTimeEstimates` and all scheduling regex machinery.
4. **Add missing recovery paths:** `/sprint list`, `/sprint doctor`, durable execution-run records for orchestrate, per-run locking
5. **Reduce LLM friction:** Pass semantic validation errors back to children in retry prompts, add `--` end-of-options marker to commands, expose a `sprint_validate_plan` tool instead of making the orchestrate skill re-parse the plan in prose, narrow time-estimate rejection to instruction-only
6. **Fix over-abstractions:** Remove dead APIs (atomicWriteJson, replaceFlatDirectory, ArtifactSink), fix ThinkingLevel type (duplicate "medium", missing "xhigh"), document the actual public tool surface
7. **Harden orchestrate skill:** Remove the contradictory repair loop (keep only the GPT validator owns repair contract), add durable execution checkpointing, add per-agent tool allowlists
8. **Harden subagents:** Add pagination or file-backed full results for oversized outputs, add bounded abort escalation on shutdown, add per-agent tool policies
9. **Harden internal-dev:** Validate user-supplied artifact content against kind-specific contracts, reduce proactive initialization prompts, deduplicate injected contract vs generated AGENTS.md
10. **Close specification gaps:** Update spec to list all three planning tools, remove the subagents.md nesting requirement or mark it superseded

## Settled Decisions

1. **Time-estimate checking becomes instruction-only.** The entire regex-based `rejectTimeEstimates` function and its scheduling-language detection machinery in `validation.ts` will be removed. Prompts will include a clear instruction not to include human time estimates, duration, effort, ETA, or calendar scheduling language. This removes a major source of LLM friction and false positives.
2. **Orchestrate skill will not have a separate DeepSeek repair loop.** The existing contradiction (forbidding separate repair, then requiring it) is resolved by removing the "Repair blocked phases" section. `BLOCKED` means a genuine external blocker. The GPT validator already owns repair within its session.
3. **Session IDs will use a hash suffix scheme** to guarantee uniqueness within the 64-char limit.
4. **Parallel fan-outs will use scoped abort controllers** with `Promise.allSettled()` for safe termination.
5. **A durable execution-run record** will be added for orchestrate so that phase verdicts survive reload. This is a prerequisite before any orchestrate recovery skill.
6. **A `sprint_validate_plan` tool** will expose the TypeScript plan parser to LLMs so the orchestrate skill doesn't need to reimplement it in prose.
7. **Per-agent tool allowlists** will be added to subagent_spawn so orchestrate can constrain implementers to edit/bash and validators to read-only inspection.

## Constraints

- Preserve the existing public API surface of commands and tools where possible; add, don't break
- The sprint-planner engine owns planning; orchestrate owns implementation — this boundary stays
- Keep model routes exactly as specified (no substitution)
- Existing test suites must continue to pass; add coverage for all fixes
- No time estimates, duration, effort, ETA, or calendar scheduling language in any plan or report — enforced by instruction, not regex
- Flat plan directory shape (concepts.md, orchestration.md, phase-NN-*.md) remains unchanged
- Ownership-safe publication semantics remain, but documentation narrows to best-effort identity-checked rollback

## Scope

### In Scope

All findings from the senior review prioritized P0 through P2, specifically:

**P0 — Must Fix:**
- Worker session-ID collisions (safeSessionId truncation)
- Orphan sibling workers on parallel fan-out failure

**P1 — Must Fix:**
- Semantic validation errors not returned to children in retry prompts
- Pause/crash increments retry attempts, exhausting budget on resume
- Missing per-run lock/lease for concurrent process safety
- Orchestrate skill repair-loop contradiction
- Synthesis cross-review path coverage validation
- Remove regex time-estimate enforcement (instruction only)
- Plan phase-to-orchestration cross-validation
- No decomposition correction gate before phase freeze
- Standalone workflow memory-only vulnerability for long runs
- Oversized subagent results unrecoverable through subagent_status
- Missing per-agent tool allowlists in subagent_spawn
- Orchestrate skill manually re-parses plan (needs sprint_validate_plan tool)
- No durable orchestrate execution checkpoints
- Orchestrate contradiction in test suite (false green)

**P2 — Should Fix:**
- TOCTOU window in ownership rollback — document as best-effort
- Missing /sprint list and /sprint doctor commands
- Immediate /sprint status race condition
- No -- end-of-options marker in commands
- Quadratic brainstorm context growth
- Sequential phase reviews (can be parallelized after concepts+orchestration)
- internal-dev doesn't validate user-supplied artifact content
- Undeclared package dependencies (user-questioning, subagents)
- Subagent shutdown hangs on non-cooperative workers
- Specification lists only sprint_brainstorm, not all three tools
- subagents.md nesting requirement vs implementation reality

**P3 — Nice to Fix:**
- Dead APIs removal (atomicWriteJson, replaceFlatDirectory, ArtifactSink)
- ThinkingLevel type fix (duplicate "medium", missing "xhigh")
- Orchestrate skill density — consider splitting reference material

### Out of Scope

- Changing the planning/implementation boundary between sprint-planner and orchestrate
- Adding new model routes or changing existing model assignments
- Changing the flat plan directory format
- Adding a full orchestrate recovery skill (needs durable execution records first)
- Rewriting the publication ownership system (narrow documentation instead)

## Recommended Direction

### Phase 1: Critical Bug Fixes (P0)
Fix the two critical bugs first — they undermine the entire reliability model:
1. Session-ID uniqueness via hash suffix
2. Scoped abort + allSettled for parallel fan-outs

### Phase 2: Remove Regex Time-Estimate Enforcement + LLM Friction Fixes
Strip the validation.ts scheduling regex entirely. Replace with prompt instructions. Also fix validation error feedback to children and retry accounting.

### Phase 3: Recovery Infrastructure
Add run lease/locking, /sprint list, /sprint doctor, durable orchestrate execution records, sprint_validate_plan tool. This is the foundation for everything else.

### Phase 4: Orchestrate Skill Hardening
Remove the repair contradiction, add the sprint_validate_plan tool integration, add durable checkpointing, add per-agent tool allowlists. The skill becomes a concise policy wrapper around deterministic tooling.

### Phase 5: Subagents & Internal-dev Hardening
Oversized result recovery, bounded abort escalation, per-agent tool policies, artifact content validation, deduplicate context injection.

### Phase 6: Specification, Documentation & Cleanup
Update specs, remove dead APIs, fix types, close doc gaps, optimize context growth and phase review concurrency.

## Validation

1. All existing test suites pass (sprint-planner: 67/67, internal-dev: 13/13, subagents: 15/15)
2. New tests for: session-ID uniqueness with max-length run IDs, sibling abort on fan-out failure, retry budget not consumed by interruptions, run lease acquisition/rejection, sprint_validate_plan output schema
3. Manual verification: sprint_brainstorm → ironout → advanceplan → orchestrate full pipeline with an 8-agent brainstorm
4. Adversarial checks: concurrent resume rejection, pause/resume cycle within retry budget, oversized subagent result recovery
5. The orchestrate skill no longer contains contradictory repair instructions
6. No time-estimate regex code remains in validation.ts; prompts carry the instruction instead

## Open Questions

1. Should the orchestrate durable execution records live in .internal-dev/sprints/ alongside planning runs, or in a separate .internal-dev/executions/ store?
2. For the sprint_validate_plan tool — should it be a read-only agent-callable tool exposed by the sprint-planner extension, or a standalone CLI script?
3. Should per-agent tool allowlists be additive (base set + requested) or exact (only requested)?
4. For oversized subagent results — pagination via offset/limit parameters on subagent_status, or file-backed storage with a readable path?

## Sign-off

This handoff captures the complete scope of hardening work identified by the senior review, organized by priority and phased for incremental delivery. All P0 and P1 items are in scope. The key architectural decision is replacing regex-based time-estimate enforcement with instruction-only guidance, which removes the largest source of LLM friction while preserving the intent.
