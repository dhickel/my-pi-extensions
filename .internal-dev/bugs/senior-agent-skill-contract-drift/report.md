## Summary

The sprint-planner test suite's senior-agent contract assertions expect the installed global skill to be version `3.0.0` and use `gpt-5.6-sol:xhigh`, but the installed skill is version `3.1.0` and its spawn examples use `high`.

## Scope

`sprint-planner/test/core.test.ts` senior-agent contract tests and `/home/dhickel/.pi/agent/skills/senior-agent/SKILL.md`.

## Reproduction

Run `npm --prefix sprint-planner test`.

## Expected

The repository tests and installed senior-agent skill use the same version and exact model-thinking contract.

## Actual

Four tests fail before or independently of advanced-planning routing changes: metadata version assertion, advisory tuple assertion, edit-authorized tuple assertion, and a dependent mutation assertion.

## Evidence

The full suite reports 207 passing tests and four failures. The skill frontmatter reports `version: "3.1.0"`; failing tests expect `version: "3.0.0"` and `xhigh`, while parsed spawn examples report `high`. Mirrored as GitHub Issue #1: https://github.com/dhickel/my-pi-extensions/issues/1. No related closed GitHub issue was found.

## Impact

The full sprint-planner suite cannot pass until the test contract and installed skill are reconciled. Sprint-planner's advanced-planning routing tests pass.

## Status

Open; unrelated to the advanced-planning agent configuration refactor.

## Next Action

Decide the authoritative senior-agent contract, then update either the global skill or the repository tests and rerun the suite.
