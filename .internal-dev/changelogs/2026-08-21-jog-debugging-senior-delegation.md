# Changelog: Jog skill debugging delegation to senior agents

## Date

2026-08-21

## Git Commit

2e9995c174257737e0b4807265f5b3dc2c6a2f2e

## Change Summary

Amended the jog skill (`job-planner/skills/jog/SKILL.md`) so debugging and repair work is delegated to senior agents instead of being ground through on the root thread, per explicit user directive.

## Files

- `job-planner/skills/jog/SKILL.md` (version 2.2.0 -> 2.3.0)

## Behavioral Impact

- The ownership contract now lists a third delegable category: debugging and repair, under the new "Debugging and repair delegation (senior)" section.
- New trigger: any concrete reproduced defect, failed implementation/repair attempt, contradictory evidence, or subtle/recurring/cross-cutting bug is escalated to one senior agent through the `senior-agent` skill (edit-authorized `["read","bash","edit","write"]` when a fix is needed, advisory `["read"]` otherwise, `allowSubagents: true`), using the resolved `seniorAgent` tuple from the sprint-planner configuration with thinking-level escalation on failed passes.
- Root investigation is limited to assembling a self-contained escalation brief (reproduce, capture output, name files/symbols); extended trial-and-error repair on the root thread is no longer the expected path.
- The luna-loop BLOCKED handling and the execution-plan escalation step now point at the same contract: small obvious fixes may be repaired by the root; anything beyond that goes to the senior agent.
- The root retains integration, independent validation, regression-test, and completion ownership; a senior verdict remains evidence, not authority.

## Specification Impact

- `job-planner-suite.md` intent for jog execution delegation is expanded: debugging is senior-delegated, matching the senior-agent skill contract (fixed resolved tuple, thinking-level escalation, bounded nested delegation).

## Risks

- Senior delegations add latency per debugging episode; the root must keep briefs self-contained and poll to terminal state before integrating.
- The directive does not change the validation gate, the luna loop, or the final sol:medium review; those contracts are unchanged.

## Follow-up Items

- Apply the directive to the current jog run (backend scene-authoring plan): delegate the active projection-mapping defect to a senior agent with edit authorization, integrate, and re-run the equivalence suite.
