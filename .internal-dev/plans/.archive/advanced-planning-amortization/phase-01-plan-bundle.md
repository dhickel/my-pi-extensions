# Phase 01 — Advanced Plan Bundle and Correction Pipeline

## Context

The planner currently publishes only `concepts.md` plus one or more phases, permits a one-phase plan, gives weak detail guidance, and has no orchestration artifact or phase-budget validation.

## Goal

Implement the complete generated-plan contract: size-aware phase counts, one-agent cohesive phase design, detailed head-down guidance, `orchestration.md`, corrective orchestration review, and deterministic validation.

## In Scope

`sprint-planner/types.ts`, `prompts.ts`, `validation.ts`, `engine.ts`, and `test/core.test.ts`; state-version handling if required by the incompatible checkpoint/artifact contract.

## Out of Scope

The installed orchestration skill’s execution behavior and living documentation/specifications.

## Implementation Steps

1. Define concise required headings for `orchestration.md` and richer phase instructions, including scope size, phase ledger, dependency/wave scheduling, exact models, review-and-repair gate, and final integration.
2. Require exactly one `concepts.md`, one `orchestration.md`, and 2–10 contiguous phases. Parse an explicit small/medium/large marker and enforce 2–3, 3–5, or 6–10 phases respectively.
3. Update planner prompts to classify scope, group cohesive vertical/domain/target edits, size each phase for one agent, front-load difficult reasoning, and add compact code examples only where useful.
4. Add an xhigh corrective orchestration review between concepts review and per-phase review. Give phase reviewers corrected concepts plus corrected orchestration and their one phase.
5. Publish and resume the complete corrected bundle safely, update manifest phase counts, and bump incompatible runtime state if necessary.
6. Add focused tests for valid budgets, missing/invalid orchestration, correction call context, publication shape, and prompt/contract language.

## Validation

Run `npm --prefix sprint-planner test` and inspect failure messages for malformed size markers and out-of-budget phase counts.

## Exit Criteria

Both full sprint and standalone advance-plan paths publish `concepts.md`, `orchestration.md`, and a valid size-budgeted phase set; all component reviews and deterministic gates cover the new contract; focused tests pass.
