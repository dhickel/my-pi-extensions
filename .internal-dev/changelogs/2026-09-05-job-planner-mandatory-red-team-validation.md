# Job Planner mandatory red-team validation

## Date

2026-09-05

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

Added a mandatory corrective red-team gate to Job Planner candidate submission. Every complete candidate now resolves the active Sprint Planner `redTeamValidator` assignment, runs an in-memory read-only whole-plan review, preserves inferable corrections, returns unresolved authority or context as a typed handoff for another root user-question loop, and permits exclusive publication only after PASS.

The workflow now records exact question-and-answer evidence, carries corrected drafts and cumulative repairs across handoffs, requires exact reconciliation of every prior issue, guards the actual provider stream against cancellation and model-tuple drift, tracks child startup through graceful extension shutdown and disposal, and keeps cancellation active through ownership-bounded publication. Restored state uses a fail-closed version-2 schema. Jog refuses plans without the final red-team Planning Record.

Sprint Planner now exposes configured role tuples through a versioned event-bus assignment service. `redTeamValidator` remains `openai-codex/gpt-6-astra:high`, and `brainstormWorker2` remains `deepseek/deepseek-v4-flash:max`.

## Files

- `job-planner/red-team.ts`
- `job-planner/index.ts`
- `job-planner/core.ts`
- `job-planner/package.json`
- `job-planner/package-lock.json`
- `job-planner/test/red-team.test.ts`
- `job-planner/test/core.test.ts`
- `job-planner/README.md`
- `job-planner/skills/jog/SKILL.md`
- `sprint-planner/agent-configuration-service.ts`
- `sprint-planner/index.ts`
- `sprint-planner/core.ts`
- `sprint-planner/configs/default.ts`
- `sprint-planner/types.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `sprint-planner/AGENTS.md`
- `.internal-dev/specifications/job-planner-suite.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/knowledge/pi-child-session-sdk-and-nested-lifecycle.md`

## Behavioral Impact

- `job_plan_submit` validates candidates instead of immediately publishing them.
- The validator reviews all nine structured plan sections exactly once and rereads the corrected whole plan before PASS.
- Safely inferable omissions, inconsistencies, and architectural contradictions are corrected in the candidate.
- Non-inferable decisions publish nothing and return complete issue ids, questions, choice meanings, repair explanations, and the corrected draft to the root planning agent.
- User answers are preserved as exact authority evidence; each resubmission reconciles every prior issue and retained repair.
- Missing configuration service, unavailable model/authentication/thinking support, malformed output, cancellation, model-tuple drift, invalid restored state, or unresolved issues fail closed.
- Final artifacts include validator tuple, PASS, attempt count, cumulative repair count, timestamp, and no remaining consequential questions.

## Specification Impact

Updated `job-planner-suite.md` with the mandatory review, repair, handoff, authority-evidence, repeated-validation, provider-boundary, cancellation, publication, and restored-state contracts. Updated `sprint-planner-suite.md` with the versioned role-assignment service. Recorded the accepted architectural decision in `specifications/decisions.md`.

## Risks

- Job-plan publication now depends on the Sprint Planner extension and availability/authentication of the exact Astra High assignment.
- Validation adds provider latency and usage before publication.
- Legacy active version-1 interviews cannot supply authoritative answer evidence and therefore restore blocked until cancelled; terminal version-1 records remain readable.
- The repository contains unrelated pre-existing worktree changes, so the Git hash above is the baseline HEAD rather than a commit containing this change.

## Follow-up Items

- Exercise the first real unresolved-issue handoff in an interactive planning session and review whether the structured questions remain concise without losing authority context.
