# Changelog: Sprint Planner Directive Scope Anchoring

## Date

2026-08-14

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

Re-anchored sprint planning scope to the user's original directive to stop the anti-defer directive from expanding plans to the brainstorm's synthesis:

- Full-sprint ironout now receives the user's original directive (or the handoff provided to brainstorming) in a `<user-directive>` block as the authoritative scope contract, with the brainstorm synthesis and red-team material demoted to supporting implementation approaches; context paths now include `input.md`.
- All brainstorm stages (workers, cross-reviews, synthesis, red team) are reframed as producing implementation approaches for the directive: quality-of-life and supporting features are allowed when they genuinely serve the directive, but approaches must tighten and refine the request rather than balloon or expand scope.
- Never-defer is scoped: all user-directive work and decided-on features must be completed fully, and mocks/stubs/placeholders/deferred work/partial implementations are acceptable only when the user directive itself asks for them. This carve-out is carried through ironout and every advanced-plan corrective review prompt.
- Advanced planning keeps the extra-large budget (11–20 phases) and lettered subphases, adds guidance that most sprints should land around 5–10 phases, and states that plans are complete and must not be trimmed to save tokens.
- Removed the "Do not concern yourself with plan size, phase count, token budget, session length, or elapsed time" bullet from the global Pi policy (`~/.pi/agent/AGENTS.md`) because planning children inherited it and it licensed unbounded plan growth; completeness enforcement now lives in the planning prompts.

## Files

- `sprint-planner/prompts.ts` — new `BRAINSTORM_SCOPE_GUIDANCE` and `DIRECTIVE_SCOPE_AUTHORITY` constants; updated `COMPLETE_PRODUCTION_SCOPE`; updated brainstorm, cross-review, synthesis, red-team, ironout, ironout-review, planner, and all corrective-review prompts.
- `sprint-planner/engine.ts` — `#sprintIronout` accepts the directive and forwards it with the synthesis and red team; context paths include the original input.
- `sprint-planner/test/core.test.ts` — updated the full-sprint ironout prompt contract test and prompt-contract assertions for directive embedding, never-defer carve-out, and the 5–10 phase guidance.
- `sprint-planner/README.md` — documented directive anchoring, brainstorm-as-approaches, the never-defer carve-out, and the 5–10 typical phase target.
- `.internal-dev/specifications/sprint-planner-suite.md` — brainstorm, ironout, and advanced-plan contracts updated to match.
- `.internal-dev/specifications/decisions.md` — new 2026-08-14 durable decision "Sprint planning re-anchors scope to the user directive".
- `~/.pi/agent/AGENTS.md` — removed the plan-size/token-budget bullet from the Plan and Completion Contract.

## Behavioral Impact

- Full-sprint handoffs are measured against the user's original request instead of the brainstorm expansion; out-of-domain features and work should no longer enter plans.
- Stubs or deferred items the user explicitly requests remain valid planned endpoints; everything else in the directive must be completed fully.
- Brainstorm output is expected to be tightened implementation approaches rather than an expanding feature catalog.
- Plan size expectations: normally 5–10 phases, up to 20 phases with lettered subphases when genuinely required.
- No changes to the orchestrate skill, deterministic validators, model routes, or execution gates.

## Specification Impact

`sprint-planner-suite.md` updated to match the new brainstorm, ironout, and advanced-plan contracts, including the extra-large budget tier previously missing from the spec; `decisions.md` records the tradeoffs. Global Pi policy adjusted as described above.

## Risks

- Prompt guidance is instruction-only; deterministic gates still cannot measure "scope" against the directive, so the improvement depends on planner/reviewer model behavior.
- The extra-large tier remains self-declared; plans may still classify upward when genuinely broad work is requested.

## Follow-up Items

- Observe real `/sprint` runs against a known directive and compare phase counts and wall time against the pre-change baseline.
- Revisit the self-declared scope classification (deferred in the decision) if bloat persists.
