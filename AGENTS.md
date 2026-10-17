# Repository Agent Instructions

Follow the global engineering policy in [`global-AGENTS.md`](global-AGENTS.md) and applicable project instructions.

## Global Policy Synchronization

- `global-AGENTS.md` is the version-controlled policy source. Its installed runtime copy is `/home/dhickel/.pi/agent/AGENTS.md` (`~/.pi/agent/AGENTS.md`). Both must remain byte-for-byte identical.
- For every change to either policy copy, compare and deliberately reconcile existing differences, then update both in the same work session. Do not overwrite unsynchronized work blindly.
- Before committing or reporting completion, run from this repository root:

  ```sh
  cmp global-AGENTS.md /home/dhickel/.pi/agent/AGENTS.md
  ```

  Require exit status 0. If either file is unavailable or cannot be updated, report the blocker instead of claiming synchronization.
- Commit the repository copy using the branch → commits → validate → merge workflow; push when requested. The installed copy is outside this repository and is not committed directly.
- This is a required agent workflow, not an automatic mirroring service. Never add credential values to either policy file.
