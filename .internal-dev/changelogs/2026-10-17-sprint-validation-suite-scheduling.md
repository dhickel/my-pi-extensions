# Sprint Validation Suite Scheduling

## Date
2026-10-17

## Git Commit

cd96b616b1c33f85be21423b8291a0215407cf1b

## Change Summary
Updated both policy copies to require focused unit checks during sprint phases and reserve large full test/validation suites for the final sprint validation gate by default. Earlier full-suite runs may be planned or performed when required by the unit contract or justified during planning by a large change; document the requirement or justification in the plan.

## Files
- `global-AGENTS.md`
- `/home/dhickel/.pi/agent/AGENTS.md` (external to this repository)

## Behavioral Impact
Agents must not routinely schedule or run a large full suite after every phase or unit. Required unit validation and the final full-suite gate remain mandatory. Replaced the previous blanket broader-suite instruction to avoid contradictory scheduling guidance.

## Specification Impact
Specification Impact: none. This updates global engineering policy rather than product contracts or sprint-planner runtime behavior.

## Risks
Documentation-only change. Existing product validation defects and Tileset Lab acceptance status are unaffected. The external global policy file is not version-controlled; the repository copy contains the same validation section.

## Follow-up Items
Validate that both validation sections match, include the default and both exceptions, and preserve existing failure-reporting rules. Review the diff and run whitespace checks; unrelated full product suites are not required for this policy-only unit. Commit on a dedicated branch, merge into master, push origin, and verify remote identity and clean worktree.
