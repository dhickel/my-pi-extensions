# Sprint Planner Scope Creep Review

**Date:** 2026-08-14
**Git Commit (baseline):** `70d3e153dd043556279035cac5193f0feb0e45e7`
**Request:** Review the sprint-planning pipeline workflows and identify what contributes to massive scope creep, wasted compute, and long runtimes after the user added a global "never defer / always production quality" directive.

## Scope

Reviewed the full planning pipeline in `sprint-planner/`: brainstorm (role router, workers, cross-reviews, synthesis, red team), ironout (author, corrective reviewer), advanced planning (planner, decomposition, concepts, orchestration, and per-phase corrective reviews), deterministic validation (`validation.ts`, `types.ts` phase budgets), child-session construction (`pi-runner.ts`, `engine.ts`), the `orchestrate` execution skill, the exploration skill, the global policy at `~/.pi/agent/AGENTS.md`, and the living specification and decisions records. Read-only review; no code or specification changes were made.

## Findings

### 1. In `/sprint` mode the scope yardstick drifts away from the user's original request

`#sprintIronout` (engine.ts) builds the ironout author's authoritative input from the brainstorm **synthesis plus red team**, not the original directive:

```ts
prompt: ironoutPrompt(
  `${brainstorm.synthesis}\n\n<red-team>...</red-team>`,
  [], false, reportPaths),
contextPaths: ["brainstorm/synthesis.md", "brainstorm/red-team.md"],
```

The original directive is preserved in state (`input.md`) but is never passed forward into ironout or any later stage. From ironout onward, every "enforce the full requested user scope, and only that scope" instruction is measured against the **expanded synthesis**, not the user's actual request. The pipeline's no-creep containment language therefore protects the brainstorm's expansion. This is the single biggest structural contributor: brainstorm is designed to be expansive (see finding 2), and its output becomes the de-facto contract.

### 2. Every stage applies completeness pressure; no stage applies reduction pressure

- Brainstorm workers are told to "Brainstorm for feature completeness and production quality" and are encouraged to enumerate features, options, and trade-offs.
- Synthesis selects "the strongest approach for **each facet**" (a union across facets, not a minimal intersection).
- Red team flags "incomplete scope coverage" as a failure mode.
- `COMPLETE_PRODUCTION_SCOPE` (prompts.ts) is injected into brainstorm, cross-review, synthesis, red team, ironout, ironout review, planner, and all six corrective-review prompts. Its anti-defer half ("Do not propose or accept mocks, stubs, placeholders, deferred work, partial implementations...") is imperative and actionable; its containment half ("Do not add speculative, adjacent, optional, or otherwise unrequested features") is a passive negative that models already violate under completeness pressure.
- The decomposition reviewer is the only stage allowed to remove phases, and removal is optional wording ("You may add, remove, split, merge") while complete coverage is the hard requirement. After the phase set freezes, orchestration and phase reviewers are forbidden to remove phases, so early bloat is locked in.
- No stage is ever instructed to re-anchor scope against the original user directive, or to minimize to the smallest faithful decomposition.

### 3. The global "never defer" policy reaches planning children and licenses large plans

Child sessions are created with `createAgentSessionFromServices({ cwd: projectRoot, agentDir })` (pi-runner.ts), so every planning child loads the user's global policy from `~/.pi/agent/AGENTS.md`, including:

- "Never substitute a stub... Never scaffold, defer, or produce bare-minimum work."
- "**Do not concern yourself with plan size, phase count, token budget, session length, or elapsed time.** These are not your concern — the user and orchestration system own those tradeoffs."

For the root orchestrator that second line is a delegation discipline; for planning agents that *are* the system that owns the size tradeoff, it removes the last self-restraint on plan size. The prompts then double down with `COMPLETE_PRODUCTION_SCOPE`. The 2026-08-11 decision ("Production quality completes requested scope without expanding it") added containment wording to prompts, but it cannot override the higher-precedence global policy and it is instruction-only; nothing enforces it.

### 4. Scope size is self-declared and the phase cap was silently doubled

- The planner classifies the work itself as small/medium/large/extra-large. Deterministic validation only checks phase count against the declared tier (`PHASE_BUDGETS` in types.ts); nothing independently challenges the tier. Completeness bias pushes classification upward, and each tier earns a larger budget.
- `extra-large` (11–20 phases) exists in code (`types.ts`), prompts ("Submit 4–22 files"), and README, but was introduced in commit `5f878fd` ("curr", 2026-08-04) **without a durable decision in `specifications/decisions.md` and without updating the living specification**. `specifications/sprint-planner-suite.md` still states budgets as "small 2–3, medium 3–5, large 6–10 phases". Intended truth (spec) and code diverge, and the code path doubles the maximum plan size from 10 to 20 phases.

### 5. Splitting guidance inflates phase counts

Phase-design guidance prefers lettered subphases "whenever a cohesive phase is likely to exceed one implementation agent's context" (200k–300k token assumption), and the decomposition reviewer may split "to improve one-agent executability". Each subphase maps to its own sequential implementation agent. Under anti-defer pressure, planners split work rather than trim it, and the per-phase detail requirements (exact files, ordered edits, invariants, edge cases) make each phase grow further.

### 6. Execution amplifies any plan bloat and forbids correction

The `orchestrate` skill's "Authoritative execution principle" restates the global policy and forbids the one actor who could trim an over-scoped plan:

- "Never override, reduce, simplify, or reinterpret the plan. If the plan says 20 phases with 5 features each, deliver exactly that."
- "Never concern yourself with plan size, phase count, token budget..."

Every phase — including `basic`-labelled documentation and cleanup phases — gets a full review-and-repair validator at `gpt-5.6-luna:xhigh` plus a per-phase changelog and git commit; then a final integration validator. A 20-phase plan therefore costs roughly 40+ provider sessions of implementation plus 20 xhigh validator sessions, against an inflated scope no stage can reduce.

### 7. Duration amplifiers

- `EXPLORATION_GUIDANCE` instructs the planner and every reviewer to run the exploration skill "whenever understanding spans multiple files", which spawns 1–6 additional read-only agents per planning stage.
- Brainstorm defaults to 4 workers (up to 8) each producing findings and a cross-review at `deepseek-v4-pro:max`, plus synthesis and red team; over 10 provider calls before ironout even starts.
- The pipeline is a long sequential chain (route → findings → cross-reviews → synthesis → red team → ironout author → ironout review → planner → decomposition → concepts → orchestration → per-phase reviews), with up to 3 attempts per step, each regenerating the complete artifact, and the planner and decomposition reviewer each get up to 2 senior-advisor consultations.
- Autonomous sprint ironout is told to "make explicit, conservative assumptions where required" — conservative assumptions expand scope instead of asking the user.

## Risk Assessment

- **High:** The pipeline's own containment wording (2026-08-11 decision) is structurally incapable of preventing creep in `/sprint` mode because the yardstick it protects is the brainstorm synthesis, not the user request (finding 1), and because the global policy explicitly tells planning agents not to care about plan size (finding 3).
- **High:** The undocumented extra-large tier is a latent scope-cap widening and a spec/code divergence that must be reconciled one way or the other (finding 4).
- **Medium:** Even with a correctly scoped plan, execution cost is linear in phase count at xhigh validation, so budget discipline at planning time is the primary cost lever.
- **Low:** Findings 5 and 7 are duration amplifiers rather than scope sources, but they multiply the cost of findings 1–4.

## Recommendations

1. **Re-anchor scope in sprint mode.** Pass the original directive to the ironout author alongside the synthesis, and instruct the author and reviewer to treat the directive as the authoritative scope boundary: features in the handoff must be traceable to the directive, with synthesis ideas only as supporting evidence. Optionally add an explicit scope-reconciliation step that diffs handoff features against the original request and cuts unrequested ones.
2. **Remove or formally ratify the extra-large tier.** Either restore the code to the spec's small/medium/large budgets (recommended given the user's complaint) or record a durable decision and update `sprint-planner-suite.md`; the current silent divergence violates the spec-vs-code contract.
3. **Make scope classification independently checked.** Have the orchestration reviewer (or a deterministic heuristic) require justification for the declared tier against the handoff size, defaulting to the smallest fitting tier, instead of accepting the planner's self-declaration.
4. **Add a mandatory minimization pass.** Give the decomposition reviewer an explicit required step: remove/merge phases that do not serve the original request and reduce to the minimal faithful decomposition, with the completeness requirement applying only to retained work.
5. **Scope the global "do not concern yourself with plan size" line.** Reserve it for execution/orchestration; planning prompts should instead prefer the smallest correct decomposition. Alternatively add to `COMPLETE_PRODUCTION_SCOPE` an explicit instruction that phase count and plan size are plan defects when they exceed the minimal faithful coverage.
6. **Turn brainstorm synthesis from a union into a minimum.** Instruct synthesis to select the minimal sufficient approach per facet and to drop facets that do not serve the request, rather than the "strongest approach for each facet".
7. **Add must-have/optional tiers to handoff features** so planners prioritize requested behavior over completeness padding.
8. **Reduce exploration-skill guidance in review prompts** (or cap its use) to cut per-stage duration overhead.
9. **Consider lighter validation for basic phases** (documentation/closeout) during orchestration to reduce execution cost for plans that are already correctly scoped.

## Follow-ups

- Reconcile the spec/code divergence on phase budgets (recommendation 2) and record the outcome in `specifications/decisions.md` with review timing.
- If recommendations 1 and 4 are adopted, re-validate with a known small directive and compare phase counts and wall-clock time before/after.
- Revisit the 2026-08-11 scope-containment decision once the above changes land; its review timing clause already triggers on planning-prompt changes.
