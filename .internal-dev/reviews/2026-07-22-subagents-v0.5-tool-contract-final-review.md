# Subagents v0.5.0 and skill tool-contract final review

## Scope

Final edit-authorized review of the completed `subagents` v0.5.0 default-all tool policy and the senior-agent, image-viewing, and orchestrate skill tool-contract friction repair. Reviewed `subagents/core.ts`, `subagents/index.ts`, `subagents/test/core.test.ts`, package metadata and public docs; the relevant durable decisions and knowledge; all three skill files; and the sprint-planner skill contract tests. Unrelated worktree changes were preserved and not assessed as part of this verdict.

## Findings

**Verdict: PASS.** No concrete in-scope defect remains, so no source or contract edit was made during this review.

- Omitted `agents[].tools` resolves to every registered child-allowed ordinary definition, including caller-inactive definitions.
- `tools: []` resolves to no ordinary tools, while a supplied nonempty list remains the complete exact restriction.
- Explicit registered caller-inactive names are accepted and activated; absent definitions are rejected as unregistered before any child task starts.
- `ask_user_choices` and `ask_user_text` remain forbidden. The fixed subagent control bundle remains excluded by default and separately gated by `allowSubagents`.
- Senior advisory uses exactly `read`; edit-authorized senior and orchestrate workers use exactly `read`, `bash`, `edit`, and `write`; image viewing uses exactly `read`; preflight uses no tools. No skill requests standalone `grep`, `find`, or `ls` APIs.
- Public schema guidance, README text, package version `0.5.0`, durable decisions, and focused tests agree with the contract.

Validation rerun:

- `npm --prefix subagents test` — 81/81 passed.
- `npm --prefix sprint-planner test` — 210/210 passed.
- `node --check --experimental-strip-types subagents/core.ts` — passed.
- `node --check --experimental-strip-types subagents/index.ts` — passed.
- `git diff --check` — passed.
- `(cd subagents && npm pack --dry-run --json)` — passed; package contains the expected five files.
- Targeted skill scan confirmed every executable `tools` array and no standalone search/listing API grant.

## Risk Assessment

Residual risk is low and documented. Omitted tools intentionally grant a broad registered catalog, so sensitive delegations should use explicit allowlists. Exact child reproduction still depends on root and child discovering matching registered definitions and source fingerprints. Remote provider work may continue after bounded local cancellation. Existing unrelated dirty and untracked work remains outside this verdict.

## Recommendations

Keep the three-mode regression tests and exact skill-array tests. Re-run isolated installed-identity acceptance whenever Pi changes tool registration, active-tool ordering, resource discovery, or child-session APIs.

## Follow-ups

None required for the reviewed contract.
