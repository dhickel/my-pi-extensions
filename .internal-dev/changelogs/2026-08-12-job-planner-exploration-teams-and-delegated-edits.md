# Job Planner Exploration Teams and Delegated Jog Edits

## Date

2026-08-12

## Git Commit

70d3e153dd043556279035cac5193f0feb0e45e7

## Change Summary

Extended the job-planner package so both stages may use read-only exploration teams for broad code surveys and jog may dispatch large single-domain edits to subagents. The `jog` skill now keeps user interaction, plan amendments, integration, validation, and completion on the root thread while allowing two delegated capabilities: exploration teams under the installed exploration skill's fixed `deepseek/deepseek-v4-flash:max` read-only contract, and one-subagent-per-domain edits dispatched only after targets are identified and the approach for that domain is ironed out with the user. Delegated edits follow an exact model policy: `deepseek/deepseek-v4-flash:max` for light basic work, document editing, and well-defined simple-logic edits; `deepseek/deepseek-v4-pro:max` for anything relatively complicated or important. The `/job` planning prompt and JOB PLANNING MODE system prompt now permit read-only exploration teams for repository inspection while keeping planning decisions, questioning, and implementation on the root thread.

## Files

- `job-planner/skills/jog/SKILL.md`
- `job-planner/index.ts`
- `job-planner/README.md`
- `job-planner/test/core.test.ts`
- `.internal-dev/specifications/job-planner-suite.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

A fresh Pi RPC `get_commands` probe confirmed `/job` resolves to the updated extension and `skill:jog` resolves to the updated workspace skill with the new delegation description. Jogging remains interactive: subagents never question the user, never inherit a caller model, never receive user-questioning, subagent-control, or sprint tools, and return escalation requests the root puts to the user. Child self-reports are evidence, not completion; the root validates every delegated diff. Sprint Planner workflows and advanced-plan conversion remain prohibited for jog. Package tests pass 6/6.

## Specification Impact

Updated `job-planner-suite.md` planning and jog contracts and the validation coverage wording. Recorded a new durable decision in `decisions.md` that supersedes in part the 2026-08-11 root-thread-only decision.

## Risks

Delegated edits rely on the root reviewing and validating child work; the model policy is prompt-enforced rather than mechanically validated. Exploration and delegation require the subagent tool set; without it, jog falls back to full root-thread execution.

## Follow-up Items

None.
