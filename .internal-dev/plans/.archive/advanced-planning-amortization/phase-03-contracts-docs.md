# Phase 03 — Contracts and Documentation

## Context

Living specifications, `.internal-dev` workflow guidance, runtime knowledge, and README text still define plans as concepts plus phases and validators as read-only with separate DeepSeek repairs.

## Goal

Align all intended and explanatory contracts with the implemented advanced-plan bundle and orchestration behavior.

## In Scope

`.internal-dev/AGENTS.md`, `.internal-dev/specifications/sprint-planner-suite.md`, `.internal-dev/specifications/decisions.md`, `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`, `sprint-planner/README.md`, plus the source-of-truth generated-guide wording and focused test in `internal-dev/contract.ts` and `internal-dev/test/core.test.ts`.

## Out of Scope

Historical changelogs except the new closeout changelog, unrelated extension packages, and speculative orchestration persistence.

## Implementation Steps

1. Document plan-size classification and 2–3/3–5/6–10 budgets.
2. Define the flat bundle as `concepts.md`, `orchestration.md`, and contiguous phases, with each phase cohesive and executable by one agent.
3. Explain concise amortized reasoning, difficult-edit walkthroughs, and selective code examples.
4. Define explicit sequential/parallel waves and safety checks.
5. Replace read-only phase-validation language with GPT-5.6 Sol xhigh full review, in-scope repair, rerun, and PASS-before-dependency semantics.
6. Record the superseding durable decision and reusable runtime lesson; update state-version wording because Phase 01 introduced state version 3.
7. Keep the checked-in `.internal-dev/AGENTS.md` guidance aligned with `internal-dev/contract.ts`, and add a focused scaffolding assertion so newly initialized stores retain `orchestration.md` in the sprint planning bundle.

## Validation

Search for stale plan-shape, one-or-more phase, read-only validator, separate repair-loop, and state-version-2 claims; run `npm --prefix sprint-planner test` and `npm --prefix internal-dev test`.

## Exit Criteria

Source behavior, skill instructions, living specifications, workflow guidance, knowledge, and README agree without broad unrelated rewrites.
