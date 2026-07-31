# Sprint execution schema compatibility

## Date

2026-07-19

## Git Commit

462622124ae7ac3c5539423621ba3dfe0c453412

## Change Summary

Made the strict `sprint_execution_record` discriminated union provider-compatible by explicitly advertising `type: "object"` at the JSON Schema root. Added a regression assertion for the root type requirement.

## Files

- `sprint-planner/index.ts`
- `sprint-planner/test/core.test.ts`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- `.internal-dev/bugs/.archive/sprint-execution-record-root-schema/report.md`

## Behavioral Impact

Providers can accept the sprint-planner tool catalog, so ordinary agent turns no longer fail before inference. The seven strict start, checkpoint, and finish schema variants remain unchanged.

## Specification Impact

None. The repair restores provider compatibility while preserving the existing strict execution-record tool contract.

## Risks

Provider implementations may impose additional JSON Schema subset constraints in the future; the verified DeepSeek OpenAI-compatible path accepts the repaired root schema.

## Follow-up Items

None.
