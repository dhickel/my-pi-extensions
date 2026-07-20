# Phase 02 — Orchestration Skill Execution Contract

## Context

The skill currently ignores `orchestration.md`, may infer scheduling independently, uses read-only validators, and delegates every repair to a separate implementation agent.

## Goal

Make one phase the atomic implementation unit and make generated orchestration metadata drive sequential/parallel waves and mandatory self-repairing GPT validation gates.

## In Scope

`sprint-planner/skills/orchestrate/SKILL.md` and matching package tests in `sprint-planner/test/core.test.ts`.

## Out of Scope

Planner engine generation/correction logic and broad user documentation.

## Implementation Steps

1. Require discovery and precedence of `orchestration.md` with `concepts.md` and all phases.
2. State unequivocally that one DeepSeek agent owns one complete phase; phase steps/aspects are instructions, not separately delegated units.
3. Respect declared dependencies and sequential/parallel waves, validating that parallel phases have safe non-overlapping write sets; default uncertain work to sequential.
4. Use exactly `deepseek/deepseek-v4-pro:max` for each implementation phase and `openai-codex/gpt-5.6-sol:xhigh` for each post-phase review.
5. Give each validator edit authority and require it to inspect, repair all in-scope defects/missing criteria itself, rerun checks, and return PASS only after clean sign-off. Block dependents on any unresolved issue.
6. Preserve a final xhigh integration review-and-repair gate and bounded blocker semantics without claiming durable background state.
7. Strengthen skill-content tests for all requirements.

## Validation

Run `npm --prefix sprint-planner test`; manually inspect the skill for contradictory read-only or separate-repair instructions.

## Exit Criteria

The skill consumes orchestration metadata, delegates exactly once per phase, schedules explicit safe waves, and cannot advance until an editing GPT validator has repaired and passed the phase.
