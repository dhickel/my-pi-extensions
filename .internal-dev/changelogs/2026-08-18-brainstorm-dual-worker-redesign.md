# Changelog: Brainstorm redesign — two workers per domain, synthesis notes disagreements, red team resolves and repairs

## Date

2026-08-18

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e (working-tree changes not yet committed)
2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

- `sprint-planner/configs/default.ts`: `brainstormWorker` replaced by `brainstormWorker1` (`MODEL_PROFILES.lunaMax` → `openai-codex/gpt-5.6-luna:max`) and `brainstormWorker2` (`MODEL_PROFILES.deepseekFlashMax` → `deepseek/deepseek-v4-flash:max`).
- `sprint-planner/types.ts`: `DEFAULT_BRAINSTORM_AGENTS`/`MIN_BRAINSTORM_AGENTS`/`MAX_BRAINSTORM_AGENTS` replaced by `BRAINSTORM_DOMAINS = 3` and `BRAINSTORM_WORKERS_PER_DOMAIN = 2`; agent-id union gains `brainstormWorker1`/`brainstormWorker2`; `agents` removed from `SprintState`, `SprintRunOptions`, and `StandaloneRunOptions`.
- `sprint-planner/prompts.ts`: lifecycle requirement and tool description/guidelines describe the 3-domain × 2-worker barrier; `routeRolesPrompt` fixes 3 domains; `brainstormPrompt` gains the worker index and independence framing; `crossReviewPrompt` removed; synthesis explicitly records worker disagreements; red team receives every raw finding plus the synthesis, picks the best path on disagreements, and states-and-solves undersights/oversights (no specification creep, no over-abstraction, nothing vital overlooked).
- `sprint-planner/engine.ts`: sprint and standalone brainstorm fan out both workers per domain (six findings), drop the same-session cross-review stage, and feed the red team all findings plus synthesis.
- `sprint-planner/commands.ts` / `index.ts` / `artifacts.ts`: `--agents` option and `agents` parameter removed from `/sprint`, `/brainstorm`, and `sprint_brainstorm`; state loader no longer validates brainstorm concurrency.
- `sprint-planner/AGENTS.md` / `README.md`: brainstorm model table (Worker 1 / Worker 2), usage strings, and lifecycle documentation updated.
- `sprint-planner/test/core.test.ts`: 320 lines updated — 3 domains, six-finding fan-out, per-worker model and session assertions, findings barrier before synthesis, red-team context over all findings plus synthesis, prompt-content checks, and removed `--agents` handling.

## Behavioral Impact

- `/brainstorm`, `/sprint`, and `sprint_brainstorm` always route exactly 3 domains and spawn 6 findings workers; `--agents`/the `agents` parameter now fail as unknown options.
- The same-session all-to-all cross-review round is gone; synthesis condenses all findings and records disagreements, and the red team resolves them over the full raw evidence.
- Worker 2 reintroduces one runtime DeepSeek tuple (`deepseek/deepseek-v4-flash:max`) into the default configuration, partially superseding the 2026-08-14 "fully off DeepSeek" decision for this slot.

## Specification Impact

- `.internal-dev/specifications/sprint-planner-suite.md` — Brainstorm Contract, exact-model-tuple table, artifact layout, fan-out and validation sections updated to the fixed 3-domain × 2-worker design.
- `.internal-dev/specifications/decisions.md` — new 2026-08-18 decision entry recording the redesign and its partial supersession of the DeepSeek migration decision.
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md` — same-session cross-review lesson replaced with the dual-worker findings-barrier lesson.
- `sprint-planner/AGENTS.md` and `sprint-planner/README.md` (user-facing docs updated in the same change).

## Risks

- Previously persisted `/sprint` state still contains an `agents` field; the loader ignores unknown fields, so resume of old runs is unaffected.
- Worker 2's DeepSeek availability and quality is a new runtime dependency for brainstorm runs; provider failures surface as normal retryable/fatal step errors with no model substitution.
- The red team prompt now embeds all six findings plus the synthesis, increasing red-team context; acceptable at the fixed 6-report volume.

## Follow-up Items

- None required. If a future configuration reintroduces a worker-count knob, `BRAINSTORM_DOMAINS` and `BRAINSTORM_WORKERS_PER_DOMAIN` are the single re-parameterization point.
