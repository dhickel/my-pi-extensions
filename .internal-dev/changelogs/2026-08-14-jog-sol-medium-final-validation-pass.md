# Changelog: Jog gains a fixed sol:medium final validation pass; DeepSeek references confirmed absent

## Date

2026-08-14

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

- `job-planner/skills/jog/SKILL.md` (v2.2.0): added the "Final validation pass (sol medium)" directive. After every completed domain holds a PASS verdict from the luna validation loop and the root-run validation gate is complete, one final fresh-eyes review of the complete job runs at the fixed contract `openai-codex` / `gpt-5.6-sol` / thinking `medium` (read-only, `tools: ["read", "bash"]`, `allowSubagents: false`). The reviewer returns `Verdict` (PASS or BLOCKED) with `Findings`, `Verified Strengths`, and `Residual Risks`; a PASS releases the completion report. BLOCKED handling mirrors the luna loop: root-owned confirmation, root repairs, confirmation passes with the same fixed tuple, and senior escalation for findings that resist root repair. The completion report now lists the final-pass tuple and verdict.
- Confirmed the jog skill and the whole job-planner package contain no hardcoded DeepSeek references.
- `job-planner/README.md`: delegated-capability description updated to include the luna domain loop and the final sol:medium pass.
- `job-planner/test/core.test.ts`: new assertions pin the final-pass contract (`gpt-5.6-sol`, final-validation-pass section, `thinkingLevel: "medium"`).
- `.internal-dev/specifications/job-planner-suite.md`: corrected stale delegation wording (removed "delegated validators" prohibition and the outdated "flash/pro max" policy phrase) and documented the luna domain loop and the fixed sol:medium final pass.
- `.internal-dev/specifications/decisions.md`: new dated entry records the final-pass decision and rationale.

## Files

- `job-planner/skills/jog/SKILL.md`
- `job-planner/README.md`
- `job-planner/test/core.test.ts`
- `.internal-dev/specifications/job-planner-suite.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

- Jog now runs a mandatory final sol:medium review of the complete job before claiming completion. The tuple is fixed in the skill and not resolved from the sprint-planner configuration; an unavailable tuple blocks the completion claim rather than being substituted.

## Specification Impact

- `job-planner-suite.md` now describes the luna domain loop and the sol:medium final pass as mandatory bounded delegated review; the root owns every verdict.

## Risks

- One additional model call per jogged job (plus confirmation passes after any BLOCKED findings).

## Follow-up Items

- None.
