# Pi `.internal-dev` Extension

This extension establishes and advertises a lightweight persistent engineering-record contract around a project's `.internal-dev/` directory.

## Behavior

- Initialization is explicit only: `/internal-dev init`, the `internal_dev` tool action `initialize`, or the `internal_dev` create action (which offers interactive initialization when the store is missing or partial). Session start never prompts for or performs initialization.
- Untrusted projects are never mutated; trust the project before initialization.
- `/internal-dev status` reports `missing`, `partial`, `ready`, or `conflict`; `/internal-dev init` offers safe initialization.
- The `internal_dev` tool supports `status`, `initialize`, and exclusive artifact `create` actions.
- Every turn receives concise store-state and guide-routing guidance. Existing project-specific `.internal-dev/AGENTS.md` remains authoritative and is never replaced.

Initialization creates missing stores for specifications, bugs, plans, reviews, knowledge, changelogs, debug reports, skills, handoffs, brainstorming, and staged sprint records. Every store gets a sibling `.archive/`. Starter guides and specification indexes are created only when absent. The generated root `AGENTS.md` carries the linked workflow contract plus the handoff, brainstorm, sprint, additive-initialization, advisory-naming, and Git-hash clarifications.

For trusted, ready projects, `.internal-dev/skills` is contributed through Pi's resource discovery. Reload Pi after adding a new skill during a running session.

`handoffs/` holds high-level plan directives and other context transfers. When persistence is useful, `reviews/` holds completed repository-history, architecture or codebase assessments, audits, and analytical assessments. Ordinary informational answers need no persistent artifact unless requested or required by another workflow. `brainstorm/` uses one folder only for each explicit brainstorming or ideation effort with unaccepted alternatives, never merely because subagents participated; every participating agent/source finding in a real brainstorm must be retained separately from synthesis. `sprints/` contains self-contained staged records. Each manifest states whether implementation and final validation were performed, delegated, or not run; runtime state and child checkpoints are temporary, and `/sprint reset` is the sole confirmed destructive-deletion exception.

## Artifact contract

`internal_dev({ action: "create", kind, path?, title?, content? })` creates one file in the selected store:

- `path` is relative to that store. Descriptive names, spaces, and nested paths are accepted; there is no rigid naming schema.
- Absolute paths, traversal outside the store, and symbolic-link traversal are rejected.
- **Content validation**: supplied and generated content is validated against the canonical ordered H2 heading contract for the artifact kind before any parent directory or artifact file is created. Required sections must be literal level-two ATX headings; fenced or indented code does not count. Missing, duplicate, out-of-order, wrong-level, or malformed required headings are rejected without filesystem mutation.
- **Changelog normalization**: when `kind` is `changelog`, user-supplied content must contain every user-owned canonical heading. `Git Commit` may be absent or unfilled, but supplied commit text is rejected rather than replaced. After pre-validation, the extension inserts or fills that section with current Git HEAD evidence in its canonical position (after `Date`, before `Change Summary`). The final content undergoes strict validation, including verification of the full hash for Git repositories. User-owned sections (`Date`, `Change Summary`, `Files`, `Behavioral Impact`, `Specification Impact`, `Risks`, `Follow-up Items`) are never synthesized, reordered, or repaired.
- Parent folders may be created, but the artifact file is opened exclusively. Existing files are never overwritten.
- If `content` is omitted, the extension writes a minimum-heading template appropriate to the artifact kind.
- An unborn Git repository may initialize, but the initialization changelog is omitted and explicit changelog creation remains blocked until the first commit.

The extension intentionally does not modify the project's `.gitignore`. Teams may track or ignore `.internal-dev/` according to repository policy.

## Install or test

```sh
pi install /absolute/path/to/internal-dev
# or for one run
pi -e ./internal-dev/index.ts

cd internal-dev
npm test
```
