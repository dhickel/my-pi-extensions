# Internal Dev Artifact Routing Clarification

## Date

2026-07-16

## Git Commit

Not applicable (source workspace is not a Git repository).

## Change Summary

Narrowed brainstorm routing to explicit ideation with unaccepted alternatives, routed persisted completed assessments to reviews, and made ordinary informational answers artifact-free by default.

## Files

- `internal-dev/index.ts`
- `internal-dev/contract.ts`
- `internal-dev/README.md`
- `internal-dev/test/core.test.ts`
- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/decisions.md`

## Behavioral Impact

The injected workflow and flat tool guidance no longer classify generic efforts or subagent participation as brainstorming. Generated guides now distinguish reviews, brainstorms, and artifact-free ordinary answers.

## Specification Impact

Updated the durable artifact-routing decision and generated workflow contract.

## Risks

Existing generated project guides are preserved by initialization and do not update automatically.

## Follow-up Items

- Reload or restart Pi to load the corrected extension source.
