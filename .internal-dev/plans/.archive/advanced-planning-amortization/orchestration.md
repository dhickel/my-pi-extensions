# Advanced Planning Amortization Orchestration

## Execution Strategy

Run all three phases sequentially because later contracts consume the artifact behavior established by earlier phases and phases 1–2 both update the shared test suite.

## Model Assignments

- Implementation: one `deepseek/deepseek-v4-pro` agent at `max` per phase.
- Validation: one `openai-codex/gpt-5.6-sol` agent at `xhigh` after each phase.

## Phase Ledger

1. Phase 01 — core advanced-plan bundle and correction pipeline; no dependencies; sequential.
2. Phase 02 — orchestration skill execution contract; depends on Phase 01 PASS; sequential.
3. Phase 03 — living specifications, workflow guidance, and user documentation; depends on Phases 01–02 PASS; sequential.

## Validation Gate

No dependent phase starts until its predecessor receives an independent PASS. For this implementation run, follow the currently installed orchestration skill’s validator/repair protocol; the product change introduced in Phase 02 applies to future orchestrations.

## Final Integration

After all phases pass, run one GPT-5.6 Sol xhigh integration review across source, tests, skill, and records.
