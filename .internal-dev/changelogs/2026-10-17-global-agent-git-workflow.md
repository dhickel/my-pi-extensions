# Global Agent Git Workflow Policy

## Date
2026-10-17

## Git Commit

e4fe8eeb123b98927c42bb7b48bc40ee2e3507a9

## Change Summary
Added the user-requested global workflow: branch → commits → validate → merge. Every phase or unit uses a dedicated branch; completed sub-units receive separate focused commits; required validation must pass before merging into the active development branch or master. Explicit user instructions override these defaults.

## Files
- `/home/dhickel/.pi/agent/AGENTS.md` (external to this repository)

## Behavioral Impact
Future Git-based work must follow the branch/commit/validation/merge sequence, preserve unrelated edits, and integrate validated work unless the user directs otherwise.

## Specification Impact
Specification Impact: none. This updates the external global engineering policy, not this repository's product contracts.

## Risks
No runtime code changed. The global policy file is outside Git, so no branch or merge applies to this file edit itself. Git evidence here identifies the workspace baseline only.

## Follow-up Items
None. Verified the added section includes the workflow sequence, focused sub-unit commits, integration targets, and explicit user overrides.
