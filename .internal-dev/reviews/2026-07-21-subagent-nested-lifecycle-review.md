# Subagent nested lifecycle review

## Scope

Final independent review of the Pi subagents extension's SDK launch repair and opt-in single nested escalation layer. Reviewed `subagents/core.ts`, `subagents/index.ts`, tests, public documentation, and relevant project decisions. The reviewer ran as `openai-codex/gpt-5.6-sol:xhigh` with edit authority but made no edits.

## Findings

**Verdict: PASS.** No remaining in-scope correctness defect was found. The reviewer confirmed:

- root-only `allowSubagents` opt-in and rejection of recursive depth;
- the fixed four-tool control bundle and exact fingerprint enforcement;
- one shared eight-agent coordinator across the complete tree;
- atomic, fail-fast, abort-aware initialization and late-resource disposal;
- cancellation-state re-evaluation after cascading disposal;
- parent-owned cleanup on cancellation, ordinary completion, limits, failure, reload, and shutdown;
- terminal handle clearing, immutable snapshots, pagination, and delivery semantics;
- Pi 0.80.10 `services.modelRuntime` compatibility.

Validation observed or rerun by the reviewer:

- `npm --prefix subagents test` — 79/79 passed;
- Node syntax checks — passed;
- `git diff --check` — passed;
- peer dependency and `npm pack --dry-run --json` audits — passed;
- isolated installed-identity runtime evidence — `ROOT_RESULT:completed:NESTED_RESULT:completed:NESTED_READY`.

## Risk Assessment

Residual risk is bounded and documented. A remote provider may continue processing after local cancellation when it does not cooperate; the implementation promises bounded local accounting and session disposal, not remote termination. Exact fingerprints intentionally include source identity, so root and child sessions must load the same installed extension identity.

## Recommendations

Keep nesting denied by default, retain the fixed control bundle and depth limit, and rerun isolated installed-identity acceptance whenever Pi child-session or resource-loader APIs change.

## Follow-ups

None required for this change.
