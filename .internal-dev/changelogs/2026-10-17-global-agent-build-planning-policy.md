# Global Feature Planning Infrastructure Constraint

## Date
2026-10-17

## Git Commit

e4fe8eeb123b98927c42bb7b48bc40ee2e3507a9

## Change Summary
Added a global rule excluding CI, dependency pinning, and complex build workflows from feature planning and implementation unless explicitly requested by the user or explicitly required by the domain and its integrations. Domain-driven exceptions must state the concrete requirement and use a minimal solution.

## Files
- `/home/dhickel/.pi/agent/AGENTS.md` (external to this repository)

## Behavioral Impact
Generic best-practice arguments alone do not authorize these infrastructure additions.

## Specification Impact
Specification Impact: none. The change updates external global engineering instructions, not this repository's product contracts.

## Risks
Documentation only. The target file is outside Git; this record's Git evidence identifies the workspace baseline, not a commit containing the external edit.

## Follow-up Items
None. Verified the rule includes all three exclusions and both exceptions, and that the existing branch/commit/validate/merge rule remains intact.
