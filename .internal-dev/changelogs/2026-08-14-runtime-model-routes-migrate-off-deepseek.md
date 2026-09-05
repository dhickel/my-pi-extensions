# Changelog: Runtime model routes migrate off DeepSeek; lite config removed; exploration moves to GPT-5.6 Luna high

## Date

2026-08-14

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e (working-tree changes not yet committed)
2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

- `sprint-planner/configs/default.ts`: `brainstormWorker` (and therefore brainstorm cross-review workers, which reuse the tuple) moved to `MODEL_PROFILES.lunaMax` (`openai-codex/gpt-5.6-luna`, thinking `max`); `basicImplementer` moved to `MODEL_PROFILES.lunaHigh` (`openai-codex/gpt-5.6-luna`, thinking `high`); `advancedImplementer` moved to `MODEL_PROFILES.lunaMax`. New `lunaHigh` and `lunaMax` profiles were added to `MODEL_PROFILES` in `types.ts`. DeepSeek entries remain in the catalog (labeled catalog-only) for label translation and legacy record parsing; no active configuration assigns them.
- `sprint-planner/configs/lite.ts`: deleted entirely along with its registration in `configs/index.ts`; `default` is now the only installed configuration. The lite configuration test was removed.
- `skills/exploration/SKILL.md` (v1.1.0): fixed contract moved from `deepseek/deepseek-v4-flash:max` to `openai-codex/gpt-5.6-luna:high` across the description, compatibility, contract block, and spawn examples. Job-planner follow-through in `job-planner/index.ts`, `README.md`, `skills/jog/SKILL.md`, and its tests.
- `sprint-planner/execution-records.ts`: `parseLegacyRecord` now validates v1 implementation/validator evidence against the record's own frozen `implementationModel`/`validationModel` tuples (consistent with the v2 path) instead of the hardcoded `IMPL_TUPLE`/`VAL_TUPLE`; the constants remain only as fallbacks when frozen tuples are absent.
- `sprint-planner/prompts.ts`: removed the DeepSeek-specific implementer phrasing.
- Documentation, specifications, and knowledge updated: sprint-planner `AGENTS.md` and `README.md`; `.internal-dev/specifications/sprint-planner-suite.md`, `job-planner-suite.md`, and a new dated entry in `decisions.md`; `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`.
- Sprint-planner test fixtures (`orchestrationFor`, `makeBranchingPlanDir`) and frozen-tuple/agent-model assertions migrated to the new luna tuples; the legacy v1 fixture and prompt-builder tuple inputs remain as intentional test data.

## Files

- `sprint-planner/configs/default.ts`, `sprint-planner/configs/index.ts`, `sprint-planner/configs/lite.ts` (deleted), `sprint-planner/types.ts`, `sprint-planner/execution-records.ts`, `sprint-planner/prompts.ts`
- `sprint-planner/test/core.test.ts`, `job-planner/test/core.test.ts`
- `skills/exploration/SKILL.md`
- `job-planner/index.ts`, `job-planner/README.md`, `job-planner/skills/jog/SKILL.md`
- `sprint-planner/AGENTS.md`, `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`, `.internal-dev/specifications/job-planner-suite.md`, `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`

## Behavioral Impact

- Brainstorm findings and cross-review now run on gpt-5.6-luna at max; basic implementation on gpt-5.6-luna at high; advanced implementation on gpt-5.6-luna at max; exploration teams on gpt-5.6-luna at high.
- No runtime-used configuration, skill, or current specification assigns DeepSeek. The lite configuration no longer exists.
- Validated plans published before this change keep their plan-owned tuples and remain authoritative for their own orchestration; only new planning runs resolve the new tuples.
- v1 execution records parse against their own frozen tuples; records with absent frozen tuples fall back to the legacy constants.

## Specification Impact

- `sprint-planner-suite.md`: brainstorm/cross-review worker row updated; repair-handoff phrasing no longer names a provider.
- `job-planner-suite.md`: exploration-team contract updated to the new fixed contract.
- `decisions.md`: new 2026-08-14 entry records the full migration; older dated entries remain as superseded history.

## Risks

- Luna at high/max thinking is costlier than the former DeepSeek Flash/Pro routes for implementation and exploration work.
- Previously published plans still carry DeepSeek plan-owned tuples; orchestration of those plans keeps using them (the plan-owned contract is authoritative), so DeepSeek must remain available until those plans are consumed.

## Follow-up Items

- None. DeepSeek catalog entries and the legacy parsing fallback are retained deliberately for label translation and reading pre-existing records.
