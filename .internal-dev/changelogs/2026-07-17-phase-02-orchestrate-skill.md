# Phase 02 — Orchestration Skill Execution Contract

## Date

2026-07-17

## Git Commit

Not a Git repository.

## Change Summary

Rewrote the `orchestrate` skill (SKILL.md) and strengthened package tests to implement the Phase 02 execution contract. The skill now treats `orchestration.md` as authoritative scheduling metadata, makes one phase the atomic implementation unit for exactly one DeepSeek agent, replaces the old read-only validator + separate DeepSeek repair loop with editing GPT review-and-repair gates, and removes `VERDICT: REPAIR` entirely.

## Files

- `sprint-planner/skills/orchestrate/SKILL.md` — Complete rewrite (version 1.0.0 → 2.0.0)
- `sprint-planner/test/core.test.ts` — Strengthened package test assertions for the new contract

## Behavioral Impact

### Skill behavior changes (breaking)

1. **`orchestration.md` is now authoritative scheduling metadata.** The skill requires reading `orchestration.md`, `concepts.md`, and every contiguous phase file from a plan directory. It rejects unknown phases/dependencies, cycles, missing phase coverage, unsafe parallel writes, or topology drift.

2. **One phase = one agent.** A phase is the atomic implementation unit. Phase steps, aspects, bullet points, and subsections are instructions within that one delegation — never split among multiple child agents.

3. **Explicit sequential/parallel wave enforcement.** The skill validates that parallel phases have non-overlapping write targets, known write sets, and no shared mutable state. Large declared parallel waves may be batched without advancing dependencies early.

4. **Editing validators replace read-only + repair loop.** The GPT-5.6 Sol xhigh validator now has full edit authority. It inspects actual state, reviews every criterion, edits all in-scope defects itself, reruns checks, and returns exactly `VERDICT: PASS` or `VERDICT: BLOCKED`. There is no `VERDICT: REPAIR` and no separate DeepSeek repair handoff.

5. **PASS-before-dependent.** No dependent phase starts before every dependency has a recorded `VERDICT: PASS`. BLOCKED phases cancel unsafe siblings and stop downstream waves.

6. **Final integration gate is also an editing gate.** The integration validator has the same edit-and-repair authority and PASS/BLOCKED contract.

7. **Failed implementers still get validated.** If an implementation agent fails after possible edits, the GPT review-and-repair gate still runs against actual state and may rectify missing criteria.

8. **No time estimates.** Implementers are explicitly told not to include time estimates, duration, effort, ETA, or human scheduling language.

### Test changes

The package test now asserts: orchestration.md is authoritative; one agent owns exactly one complete phase; phases are never split among multiple agents; parallel safety checks include non-overlapping targets; exact model tuples; full edit authority for validators; VERDICT: PASS and VERDICT: BLOCKED are the only verdicts; VERDICT: REPAIR is explicitly prohibited, not offered as a bullet; no read-only validator or read-only GPT; no repair loop or fresh DeepSeek repair; PASS-before-dependent behavior; final editing integration gate; no time estimates; root-session orchestration (no persistence claims). Version bumped to 2.0.0.

## Specification Impact

None in this phase. Phase 02 only updates the skill and its tests; the living specification at `.internal-dev/specifications/sprint-planner-suite.md` still describes the old orchestrate contract. Phase 03 will update specifications, workflow guidance, and user documentation.

## Risks

- The old specification still describes read-only validators and a separate DeepSeek repair loop. Phase 03 must align it.
- The skill now uses editing validators which require the GPT model to have write access (bash, edit, write tools). The Pi runner configuration must allow this.

## Follow-up Items

- Phase 03: Update living specifications, workflow guidance, and user documentation to match the new skill contract.
- Verify that the Pi runner configuration grants GPT validators the necessary edit/write tools.
