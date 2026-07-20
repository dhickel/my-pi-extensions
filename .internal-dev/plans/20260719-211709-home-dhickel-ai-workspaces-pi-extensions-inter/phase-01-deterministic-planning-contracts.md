## Context

Current worker session identifiers collide when distinct long ids share a truncated safe prefix. Command parsing lacks literal option termination. Synthesis validation checks findings but not cross-reviews. Plan validation throws unstructured errors, does not cross-check phase metadata against orchestration, and has no read-only tool surface. The engine also freezes the author’s phase set before a corrective decomposition pass and can expose no stable progress while asynchronous initialization is pending.

## Goal

Establish deterministic identifiers and command lifecycle behavior, complete synthesis coverage, pre-freeze decomposition and cross-consistency validation, and read-only plan validation.

## In Scope

**Write Targets**: sprint-planner/commands.ts, sprint-planner/validation.ts, sprint-planner/prompts.ts, sprint-planner/types.ts, sprint-planner/engine.ts, sprint-planner/pi-runner.ts, sprint-planner/index.ts, sprint-planner/test/core.test.ts

- Collision-resistant provider-safe worker session ids.
- Literal `--` option termination with prompt preservation.
- Complete and exact synthesis Source coverage.
- A synchronous observable `starting` progress state.
- One medium decomposition correction gate before phase names freeze.
- Versioned structured plan inspection with deterministic cross-consistency.
- Agent-callable read-only `sprint_validate_plan`.
- Focused contract, lifecycle, and path-security tests.

## Out of Scope

- Scope-local fan-out cancellation, retry accounting, or corrective-review concurrency.
- Run leases, list, doctor, or execution records.
- Orchestrate skill edits or implementation-worker coordination.
- Prose scheduling-intent scanning.
- Changes to phase budgets, flat plan layout, model routes, or PASS gates.

## Dependencies

none

## Constraints

- Preserve the provider session-key limit of 64 characters and its accepted identifier character set.
- Hash the complete original identifier bytes; normalization or prefix truncation must not remove distinguishing input before hashing.
- Preserve prompt bytes after command-option parsing. Command handlers must not inspect or expand referenced files.
- The structured plan inspector is the single acceptance authority. `validatePlanFiles` and `validatePlanDirectory` remain throwing compatibility wrappers over its result rather than independent parsers.
- The decomposition gate uses `MODEL_ROUTES.advancedReviewer` unchanged and is the only point allowed to add, remove, or rename phase files. Once its output passes full validation, every component reviewer preserves that exact file set.
- Preserve the flat plan shape, phase budgets, exact orchestration lines, exact model tuples, no-replace publication, and review-and-repair PASS gate.
- `sprint_validate_plan` and all inspection APIs are read-only and do not create, normalize, touch, or rewrite files.
- Deterministic validation must not scan prose for delivery forecasts; technical machine timing and complexity notation remain valid.

## Implementation Steps

1. In `sprint-planner/commands.ts`, replace truncation-only `safeSessionId` with `<safe-readable-prefix>-<fixed-hex-hash>`. Compute the suffix from SHA-256 of the complete unnormalized UTF-8 source identifier, reserve the separator and suffix width before truncating the normalized readable prefix, and retain a valid readable fallback. Include the hash for every input, not only long inputs. Keep the final value within 64 characters and the provider-safe character set. In `sprint-planner/pi-runner.ts`, verify every persistent, in-memory, resumed, and adviser `SessionManager` construction still routes the complete worker id through this helper; do not add a second normalizer.

2. Extend `parseCommand` in `sprint-planner/commands.ts` so standalone `--` terminates option parsing only during a start command. Options before it retain workflow-specific validation. Text after it is always prompt content, including `status`, `--name`, quotes, and option-like tokens. Start the prompt at the first non-separator character after the terminator and do not tokenize, unquote, trim, or reinterpret the remaining substring. A leading `--` therefore forces start semantics; a terminal `--` produces no prompt and follows the existing missing-input path.

3. In `sprint-planner/prompts.ts`, require synthesis Source entries as one literal Markdown list item per supplied report path. In `sprint-planner/validation.ts`, make `validateSynthesisCoverage` compare the exact expected report-path set against those non-code Source entries, rejecting missing, unknown, or duplicate paths. Update both persisted and standalone engine callers to pass the complete ordered findings-plus-cross-review path set that was supplied to synthesis.

4. In `sprint-planner/types.ts`, add `PLAN_VALIDATION_RESULT_VERSION = 1` and public structured inspection types. Define a stable category union covering `root`, `shape`, `phase-budget`, `phase-metadata`, `dependency`, `wave`, `target`, `model-route`, `gate`, `integration`, and `symbolic-link`. Each finding carries a stable code, category, actionable message, and relevant project-relative path when available. The result carries `version`, `valid`, deterministic metadata for successfully parsed portions, and ordered findings. Keep persisted `RunStatus` unchanged; add `starting` only to the progress-status type. Correct `ThinkingLevel` so `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` each appear once, without changing any `MODEL_ROUTES` tuple.

5. Refactor `sprint-planner/validation.ts` around one in-memory structured inspector and one directory reader that delegates to it. The inspector must retain all existing flat-shape, heading, contiguous-numbering, budget, orchestration-line, dependency, wave, target-overlap, route, gate, and integration checks while returning categorized findings in deterministic path/code order. Unknown result/schema inputs must produce an explicit unsupported-version finding where parsing applies. `validatePlanFiles` and `validatePlanDirectory` throw a deterministic summary built from the same result; they must not repeat parsing logic. Keep a narrow draft-submission shape check for the pre-freeze gate that validates safe unique flat names, required top-level files, contiguous phase numbering, file count, and required headings without treating the uncorrected draft as accepted.

6. Extend the shared parser to compare each phase with its orchestration ledger entry using metadata already present in the phase sections:
   - the first nonblank `Goal` line equals the ledger goal exactly;
   - `Dependencies` contains exactly one line: `none` or the ledger’s ordered comma-separated phase filenames;
   - `In Scope` contains exactly one `**Write Targets**: ...` line whose ordered canonical paths equal the ledger targets;
   - the filename supplies phase identity and must agree with ledger and wave membership.
   Reject duplicate markers, duplicate or unknown dependencies, self-dependencies, dependency-order drift, unsafe or duplicate targets, goal drift, target drift, phase-set drift, and wave drift under the appropriate stable category. Parse orchestration and each phase metadata field once and compare typed values rather than rescanning with independent regex paths.

7. Add an `advancedDecompositionReviewPrompt` in `sprint-planner/prompts.ts` and integrate it into both persisted and standalone advanced planning in `sprint-planner/engine.ts`. After the author returns a safely shaped draft, call exactly one `MODEL_ROUTES.advancedReviewer` worker and require `review.md` plus a complete corrected flat plan. The prompt may correct phase count, filenames, goals, dependencies, targets, and waves within the fixed scope and budget; it may not change model routes, layout, or ownership boundaries. Validate the complete corrected plan inside that worker call’s consume/validation boundary before checkpoint completion. Persist the gate review with the other planning reviews, derive the immutable phase-name index only from the accepted corrected output, and feed that output to the existing concepts → orchestration → phase review sequence. Component review expectations remain exact and cannot alter the frozen file set. Run full structured validation again before publication.

8. Register `sprint_validate_plan` in `sprint-planner/index.ts` with a strict TypeBox object containing one path string and no extra properties. Apply built-in-style single leading-`@` normalization. Require project trust, require a canonical relative path beneath `ctx.cwd`, and reject absolute paths, `..` escape, missing roots, non-directories, foreign ownership, and symlinks in every traversed component or direct child. Use `lstat` before reads and never follow a symbolic link. Call the directory inspector directly. Return the complete versioned result in `details` and a concise model-visible valid/invalid summary; an invalid plan is a diagnostic result rather than partial acceptance or an opaque replacement error.

9. Establish immediate lifecycle visibility in `sprint-planner/engine.ts`, `sprint-planner/types.ts`, and `sprint-planner/index.ts`. At the synchronous beginning of sprint start and explicit resume, set transient engine identity and progress to `{status: "starting", stage: "starting"}` before the first filesystem or background initialization await. Pass the known run id into resume initialization rather than deriving identity from unchecked paths. Transition to `running` only after state attachment or standalone worker dispatch. Ensure command job registration and status formatting accept `starting`, and ensure initialization failure clears active-job/footer accounting without persisting `starting` as sprint state or launching provider work on reload.

10. Harden directory inspection without mutating inputs. Resolve from the trusted project root using safe relative segments, `lstat` every path component and direct entry, reject non-regular or nested entries, and compare ownership where the platform exposes uid information. Read each accepted file once, preserve bytes, and feed the resulting collection to the shared inspector. Categorize expected filesystem and contract failures; propagate only truly unexpected runtime faults. Keep result ordering independent of directory enumeration order.

11. Extend `sprint-planner/test/core.test.ts` with focused regression cases for every contract above. Use fake runners and temporary stores only; tests must not invoke models. Cover short and maximum-length same-prefix identifier pairs with different tails, stable hash output, length and charset; all `--` workflows and management-looking literal prompts; exact findings-plus-cross-review Source sets; decomposition changes before freeze and immutable phase names afterward; complete phase/ledger drift cases; every structured category and stable code/order; missing, escaping, ancestor-symlink, child-symlink, non-directory, and foreign-owned inputs where portable; immediate start and resume status before delayed initialization settles; initialization cleanup; complete tool registration/schema/details; and byte/entry-metadata equality before and after inspection.

## Required Guides

- `.internal-dev/specifications/sprint-planner-suite.md`
- `.internal-dev/knowledge/sprint-planner-runtime-contracts.md`
- Pi `docs/extensions.md`

## Technical Guidance

Keep the authoritative flow explicit: safely shape-check author output → medium decomposition correction → full structured acceptance → freeze phase names → concepts review → orchestration review → phase reviews → full structured acceptance → publication. Draft shape checking is not plan acceptance.

Use one parsed representation for the ledger, waves, and phase metadata, then project both structured diagnostics and throwing compatibility errors from it. Preserve the first causal code and stable ordering even when messages improve. For the tool path, reject a symlink before any `readFile`; checking only the final root is insufficient when an ancestor is a link.

The transient `starting` state belongs to in-memory progress only. Persisted planning state begins at `running`, and process start or reload remains read-only with no automatic provider work.

## Validation

- Run `npm --prefix sprint-planner test`.
- Verify two 64-character-or-longer source ids with identical normalized prefixes and different tails produce stable, distinct, provider-valid session ids.
- Verify `parseCommand("sprint", "-- --name literal")` returns prompt `--name literal`, and `parseCommand("sprint", "-- status")` remains a start command.
- Verify synthesis rejects omission, duplication, or substitution of any findings or cross-review Source path.
- With a fake reviewer, verify the decomposition gate can replace a phase filename and adjust the ledger before freeze, while concepts, orchestration, and phase component reviews cannot change the frozen set.
- Verify a valid flat plan passes the structured inspector and both throwing wrappers; mutate each contract dimension and assert the exact category and stable code.
- Delay run creation and resume loading in the harness; assert status is `starting` immediately, then `running` after attachment, with no persisted `starting` state.
- Invoke `sprint_validate_plan` against valid, invalid, escaping, symbolic-link, and malformed roots. Snapshot file bytes, directory entries, and metadata before and after every invocation and assert no change.
- Confirm technical machine-duration wording remains accepted and no prose forecast scanner is introduced.

## Exit Criteria

- Prefix truncation can no longer make distinct complete worker ids equal; every session-manager path uses the same bounded hashed identifier helper.
- Option-like and management-looking prompt text is preserved literally after `--`.
- Synthesis cannot pass without the exact complete findings and cross-review Source set.
- Start and explicit resume expose `starting` before asynchronous initialization and never persist it or auto-start work on reload.
- Decomposition can change only in the medium pre-freeze gate; all accepted component reviews preserve its phase-name set.
- Plan shape, orchestration semantics, and phase cross-metadata have one versioned structured acceptance parser with throwing compatibility wrappers.
- `sprint_validate_plan` is trusted-project-only, read-only, path-safe, registered, tested, and returns the parser’s complete versioned diagnostic result.
- The phase metadata exactly matches the authoritative ledger, has no target overlap with other wave-01 phases, and remains executable by one implementation agent.
- Exact model routes, phase budgets, flat layout, no-replace publication, prompt-only forecast guidance, and no-automatic-provider-work behavior remain green.
