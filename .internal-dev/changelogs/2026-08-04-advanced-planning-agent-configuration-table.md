## Date

2026-08-04

## Git Commit

2b8d04585b0d5ed08333b674df60ebebe5c0ce99

## Change Summary

Centralized every advanced-planning child assignment in a fixed default configuration table. The table covers the planner, advisor, decomposition reviewer, concepts reviewer, orchestration reviewer, and dynamic phase reviewer. It preserves all existing provider/model/thinking tuples and senior-advisor call bounds while making future configurations additive.

## Files

- `sprint-planner/types.ts` — added model profiles, the default advanced-planning agent configuration registry, and typed lookup.
- `sprint-planner/engine.ts` — resolved every persisted and standalone advanced-planning request through that lookup.
- `sprint-planner/test/core.test.ts` — asserted exact assignments and emitted request metadata.
- `sprint-planner/index.ts`, `sprint-planner/AGENTS.md`, `sprint-planner/README.md`, `sprint-planner/prompts.ts` — documented the table and aligned reviewer-level prose with the existing Terra/high routes.

## Behavioral Impact

No model assignment, senior-call bound, role name, workflow stage, fan-out, retry, artifact, or publication behavior changed. The active configuration is fixed to `default`; callers cannot select alternatives yet.

## Specification Impact

None. This is an internal routing refactor with no user-facing selection or behavior change; the existing specification remains the intended workflow contract.

## Risks

The full test suite has four unrelated existing failures in senior-agent skill contract tests: the installed global skill reports version `3.1.0` and `high`, while the repository tests expect version `3.0.0` and `xhigh`. All sprint-planner routing and advanced-planning tests passed.

## Follow-up Items

Reconcile the senior-agent skill contract tests with the installed global skill separately. Add configuration selection only when a concrete additional configuration and selection contract are accepted.
