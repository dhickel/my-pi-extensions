## Context

`internal_dev create` currently accepts supplied Markdown without enforcing each artifact kind’s canonical heading contract. Changelog commit insertion can place a missing section outside canonical order, the generated initialization changelog follows a separate unchecked write path, ordinary `session_start` may solicit initialization, and ready-store injection repeats material already owned by generated guides.

## Goal

Validate all typed artifact content by kind before exclusive creation, normalize only code-owned changelog commit evidence, make initialization explicit, and reduce injected guidance to trusted state and routing pointers.

## In Scope

**Write Targets**: `internal-dev/core.ts`, `internal-dev/index.ts`, `internal-dev/contract.ts`, `internal-dev/test/core.test.ts`, `internal-dev/README.md`, `.internal-dev/AGENTS.md`

- One canonical ordered required-heading contract for every `ArtifactKind`.
- Strict pre-creation and post-normalization validation for supplied and generated typed artifacts.
- Explicit-only initialization behavior.
- Concise missing, untrusted, and ready-store guidance.
- Generated/maintained root-contract parity and public behavior documentation.

## Out of Scope

- Changing artifact stores, artifact kinds, default paths, or naming conventions.
- Replacing exclusive creation, the file-mutation queue, traversal protection, or symlink protection.
- Sprint-planner run discovery or diagnosis.
- Automatic repair, reordering, or body generation for user-owned artifact sections.
- Editing any other plan phase or changing the authoritative phase ledger or waves.

## Dependencies

none

## Constraints

- Preserve the orchestration ledger: this phase remains one dependency-free wave-01 unit, executable by exactly one implementation agent, with only the listed write targets.
- Required sections are literal level-two ATX headings outside fenced and indented code, each appearing exactly once and in canonical relative order. Unrelated headings and arbitrary body prose remain allowed.
- Reject missing, duplicate, out-of-order, wrong-level, malformed, or code-fenced required headings before creating a requested parent directory or artifact file. Errors identify artifact kind, requested relative path, heading, and failure category.
- Changelog normalization is the sole content exception: user input must already contain every user-owned canonical section. `Git Commit` may be absent or unfilled so code can add or fill it, but a present section must be unique and canonically positioned. Validate the complete final content and repository commit evidence after normalization.
- Never synthesize, reorder, or repair `Date`, `Change Summary`, `Files`, `Behavioral Impact`, `Specification Impact`, `Risks`, or `Follow-up Items`.
- Templates and the generated initialization changelog pass the same final validator as supplied content.
- Ordinary `session_start` never asks to initialize or complete a store and never mutates it. `/internal-dev init`, tool action `initialize`, and the existing permission-gated `create` flow are the only initialization entry points.
- `create` against a missing or partial store retains the interactive permission gate and fails without mutation when permission cannot be obtained or is declined.
- Trusted ready-store injection points to `.internal-dev/AGENTS.md` and `.internal-dev/specifications/AGENTS.md` rather than duplicating their contracts. Missing and untrusted guidance remains explicit without implying a startup prompt.
- Keep `ROOT_AGENTS_CONTENT` and `.internal-dev/AGENTS.md` byte-identical. Preserve existing routing, changelog, archive, trust, and confirmed destructive-reset rules.

## Implementation Steps

1. In `internal-dev/core.ts`, define and export as narrowly as tests require one readonly canonical ordered required-heading map covering every `ArtifactKind`. Use the existing minimum templates and maintained guide as authority. Refactor `artifactTemplate` to obtain heading lists from this map while retaining kind-specific populated values such as changelog date and commit evidence.
2. Add a line-oriented Markdown section parser and kind-aware validator. Track backtick and tilde fenced-code state using openers indented by at most three spaces and closers with the same marker and at least the opener length; ignore every line inside a fence and every line indented as code. Recognize only literal H2 lines of the form `## <required name>` with optional surrounding horizontal whitespace, not blockquotes, list items, deeper headings, or headings with extra text. Record required-name occurrences and source lines, report required names seen at another ATX level as wrong-level, then enforce exactly one literal occurrence and canonical relative order. Do not require nonempty section bodies.
3. Rework `createArtifact` content preparation in this exact order: resolve the safe artifact path for diagnostic evidence; normalize the selected supplied content to one trailing newline or generate the template; run pre-creation validation before any nested parent `mkdir` or artifact write; for changelogs, use a pre-normalization mode that requires all user-owned headings and accepts only an absent or unfilled canonical `Git Commit`; normalize commit evidence; run strict final validation; and, for Git repositories, verify the full current `HEAD` occurs inside the final `Git Commit` section. An existing misplaced or duplicate `Git Commit` is a validation error, not a repair target.
4. Update `ensureChangelogCommit` so a missing `Git Commit` section is inserted in its canonical slot after the complete `Date` section and before `Change Summary`, while an existing canonical section is filled with the current full hash without disturbing later sections. Keep unborn Git repositories as explicit changelog-creation failures. Validate every generated template and the separately generated initialization changelog immediately before its exclusive write. Preserve `wx`, `withFileMutationQueue`, traversal rejection, and symlink checks; repeat the existing no-symlink directory check around parent creation.
5. In `internal-dev/index.ts`, remove the unsolicited initialization logic from `session_start`, including state used only to suppress repeated startup prompts. Keep `/internal-dev init` and tool action `initialize` explicit and permission-gated as currently designed. Keep `create` permission-gated when the store is missing or partial, and preserve noninteractive, declined, conflicting, and untrusted failure behavior without filesystem mutation.
6. Replace the verbose ready-store injection with concise state and routing guidance: state that the store is ready, require the two generated guides to be read before non-trivial work, and direct artifact creation through `internal_dev` for exclusive creation. Keep missing guidance explicit that initialization requires an explicit command/tool or a permission-gated create request; keep untrusted guidance prohibiting project-owned store access. Remove all wording that ordinary startup will ask for initialization.
7. Update `ROOT_AGENTS_CONTENT` in `internal-dev/contract.ts` and `.internal-dev/AGENTS.md` byte-for-byte together. Clarify explicit initialization and distinguish temporary planning/runtime checkpoints from durable execution-only sprint evidence without assigning orchestration or run-diagnosis behavior to internal-dev. Preserve all existing source-of-truth, routing, brainstorm, changelog, archive, no-overwrite, and `/sprint reset` rules. Do not edit `.internal-dev/specifications/AGENTS.md` unless parity inspection proves existing drift within the listed targets; it remains an authoritative injection destination, not a duplicated prompt body.
8. Update `internal-dev/README.md` to describe explicit initialization, kind-specific canonical heading validation, the narrow changelog normalization exception, final revalidation, exclusive creation, and concise ready-store injection. Remove startup-prompt claims and do not document automatic content repair.
9. Expand `internal-dev/test/core.test.ts` with table-driven coverage for every artifact kind’s valid generated template and complete supplied content; missing, duplicate, out-of-order, wrong-level, malformed, fenced, tilde-fenced, and indented-code heading cases; unrelated headings and empty bodies; nested-path rejection with no parent/file side effects; canonical changelog insertion and filling; misplaced/duplicate commit rejection; final hash-in-section validation; generated initialization-changelog validation; exclusive creation and path-security regressions; fake-extension lifecycle checks proving missing, partial, and ready `session_start` paths neither confirm nor mutate; explicit command/tool and permission-gated create behavior; concise ready/missing/untrusted injection; and exact `ROOT_AGENTS_CONTENT` parity with `.internal-dev/AGENTS.md`.

## Required Guides

- `.internal-dev/AGENTS.md`
- `.internal-dev/specifications/AGENTS.md`
- Pi `docs/extensions.md`

## Technical Guidance

Keep parser output structured, for example occurrences keyed by required heading plus line and level, so diagnostics and changelog insertion use the same interpretation rather than separate regular expressions. A fence closes only with its opening marker character and sufficient marker length; headings inside unclosed fences remain ignored. Treat tabs or four-space indentation as code before heading recognition.

For changelog pre-validation, evaluate the ordered sequence with `Git Commit` as an optional canonical slot. If present, it must lie between `Date` and `Change Summary`; if absent, insert it at that boundary. Commit evidence must be checked within that section’s parsed body, not elsewhere in the document.

Run content validation before `mkdir(dirname(selected.absolutePath))`. Use a previously absent nested requested path in rejection tests and assert both the nested parent and artifact remain absent. Path resolution and read-only security inspection may precede validation to produce safe path evidence, but no rejected content path may mutate the filesystem.

Test extension lifecycle behavior with a fake `ExtensionAPI` that captures registered handlers, commands, and tools and with contexts whose `ui.confirm` and mutation paths are observable. Do not rely solely on source-text matching for the no-startup-prompt invariant.

## Validation

- Run `npm --prefix internal-dev test`.
- Validate a generated template and a complete custom artifact for every `ArtifactKind`.
- Run focused parser cases for both fence marker styles, indentation, wrong levels, duplicates, ordering, unrelated headings, and empty bodies.
- Attempt malformed supplied content at an absent nested path and prove no directory or file was created.
- Verify missing and unfilled changelog commit sections normalize into canonical order, final content contains the full current `HEAD` in the correct section, malformed user-owned sections are not repaired, and unborn repositories still reject explicit changelog creation.
- Verify the initialization changelog passes strict changelog validation before exclusive creation.
- Invoke captured startup behavior for missing, partial, ready, conflicting, and untrusted stores and prove no initialization confirmation or mutation occurs.
- Exercise explicit command/tool initialization and permission-gated create paths, including noninteractive and declined cases.
- Assert concise injection for ready, missing, and untrusted states and exact byte parity between `ROOT_AGENTS_CONTENT` and `.internal-dev/AGENTS.md`.

## Exit Criteria

- Invalid supplied or generated content cannot be committed as a typed internal-dev artifact.
- Every artifact kind has one canonical heading source shared by templates and validation.
- Changelog commit normalization preserves canonical order, changes only code-owned commit evidence, and is followed by strict final validation.
- Rejected content creates no requested parent directory or artifact file.
- Initialization occurs only through explicit command/tool flows or the existing permission-gated create flow; ordinary session start is read/write inert for initialization.
- Ready-store injection is concise and points to authoritative generated guides.
- Generated and maintained root contracts remain byte-identical and accurately distinguish durable execution evidence from temporary checkpoints.
- Existing exclusive creation, file-mutation queue participation, path security, trust checks, artifact routing, and destructive-reset boundaries remain intact.
