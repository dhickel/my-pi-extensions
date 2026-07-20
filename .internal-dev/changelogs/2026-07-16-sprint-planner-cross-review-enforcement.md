# Sprint Planner Cross-review Enforcement

## Date

2026-07-16

## Git Commit

Not applicable — `/home/dhickel/AI/Workspaces/Pi-extensions` is not a Git repository.

## Change Summary

Confirmed that both full-sprint and standalone engine paths already block synthesis on the complete findings and cross-review rounds. Added an agent-callable `sprint_brainstorm` entrypoint that routes root-agent requests through that engine instead of generic subagent spawning, made the unconditional barrier explicit in tool and command guidance, and added a negative test proving failed cross-review prevents synthesis and publication.

## Files

- `sprint-planner/index.ts`
- `sprint-planner/prompts.ts`
- `sprint-planner/test/core.test.ts`
- `sprint-planner/README.md`
- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

Root agents can now invoke `sprint_brainstorm`; the call completes only after engine-managed findings, same-session all-to-all cross-review, synthesis, and red-team stages. Slash-command and model-visible metadata state that cross-review is mandatory and generic `subagent_spawn` is not an equivalent workflow.

## Specification Impact

Updated `sprint-planner-suite.md` to specify the agent-callable engine path, the failed-cross-review publication barrier, and the boundary around generic manual subagents. Recorded the routing tradeoff in `specifications/decisions.md`.

## Risks

A root model can still ignore the dedicated tool and perform unrelated manual ideation outside sprint-planner. The extension cannot safely infer and enforce lifecycle state across arbitrary generic subagent task text.

## Follow-up Items

None.
