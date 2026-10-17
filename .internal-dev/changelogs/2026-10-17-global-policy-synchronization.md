# Global Policy Synchronization

## Date
2026-10-17

## Git Commit

67803a8b939df787cbc2e48ebf2921bffbdeb962

## Change Summary
Reconciled the repository policy with the installed global policy, preserving the installed credentials-handling instructions (no credential values), completion requirements, current senior delegation rule, and scope safeguards. Added identical synchronization instructions to both policy copies. Added repository-root AGENTS.md so future agents discover the synchronization contract immediately.

## Files
- `AGENTS.md`
- `global-AGENTS.md`
- `/home/dhickel/.pi/agent/AGENTS.md` (installed copy outside Git)

## Behavioral Impact
The repository policy is the version-controlled source; the installed global file is its runtime copy. Every policy edit must deliberately reconcile prior differences, update both copies in the same session, and pass a byte-for-byte cmp before commit or completion. Missing or unwritable copies block synchronization. This is a mandatory agent workflow, not automatic mirroring.

## Specification Impact
Specification Impact: none. The change documents global engineering policy synchronization rather than a product/runtime feature.

## Risks
Manual workflow compliance remains necessary; no daemon, hook, symlink, or automatic synchronization is introduced. No credential values were copied into policy documentation.

## Follow-up Items
Validate byte-for-byte equality, repository instructions and referenced paths, and whitespace. Commit on the dedicated branch, merge master, push origin, and verify remote identity and a clean worktree. Unrelated large product test suites are not required for this documentation-only change; previously recorded product validation failures remain unresolved.
