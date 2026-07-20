# Remove capture-specific internal-dev stores

## Date

2026-07-15

## Git Commit

Not applicable (the Pi-extensions workspace is not a Git repository).

## Change Summary

Removed the two visual-validation-specific artifact kinds, stores, templates, scaffold paths, and generated workflow guidance from the internal-dev extension.

## Files

- `internal-dev/core.ts`
- `internal-dev/contract.ts`
- `internal-dev/README.md`
- `internal-dev/test/core.test.ts`
- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/decisions.md`
- `.internal-dev/changelogs/2026-07-15-remove-capture-stores.md`

## Behavioral Impact

New and repaired internal-dev stores no longer expose or create the removed artifact categories. The installed package uses this workspace path directly, so the runtime installation receives the same implementation after Pi reloads.

## Specification Impact

Updated `.internal-dev/specifications/decisions.md` and the generated root contract to establish the reduced artifact API and scaffold layout.

## Risks

Existing stores in other projects are intentionally not migrated or deleted. Their existing project-owned guides also remain unchanged because initialization never overwrites them.

## Follow-up Items

- Reload Pi before relying on the revised tool schema in an already-running session.
