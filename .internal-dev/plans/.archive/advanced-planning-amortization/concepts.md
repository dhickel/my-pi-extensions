# Advanced Planning Amortization Concepts

## Scope Classification

- Size: medium
- Phase budget: 3 phases.
- Rationale: the change spans the advanced-plan artifact pipeline, the independently installed orchestration skill, and living contracts/documentation, but remains confined to the sprint-planner package and its records.

## Objective

Make advanced plans executable by one head-down implementation agent per phase. Planning must amortize architectural and difficult-edit reasoning without flooding worker context.

## Settled Behavior

- Small plans contain 2–3 phases, medium plans 3–5, and large plans 6–10.
- Phases group cohesive edits by target, domain, or vertical behavior and are not decomposed into one agent per bullet.
- Every published plan adds a concise `orchestration.md` beside `concepts.md` and contiguous phase files.
- Orchestration declares dependencies and sequential/parallel execution waves, exact implementation and validation model tuples, one implementer per phase, and a mandatory post-phase review-and-repair gate before dependents start.
- Implementation defaults to `deepseek/deepseek-v4-pro` at `max`; phase validation uses `openai-codex/gpt-5.6-sol` at `xhigh`.
- The GPT validator reviews actual code, repairs in-scope defects itself, reruns checks, and signs off only after criteria pass.
- Plans include exact targets, ordered edits, invariants, edge cases, and concise code/pseudocode examples only where they reduce implementation ambiguity.

## Architecture

Extend the typed flat plan bundle and deterministic structural validation, add a dedicated corrective review for orchestration, provide corrected orchestration context to each phase review, and teach the execution skill to treat orchestration as authoritative scheduling metadata.

## Final Validation

Run `npm --prefix sprint-planner test`, inspect all generated-plan expectations, verify the skill text and package discovery assertions, and review specification/documentation consistency.
