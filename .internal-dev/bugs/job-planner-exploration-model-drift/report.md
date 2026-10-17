# Job Planner Exploration Model Drift

## Summary
Broader snapshot validation finds one pre-existing Job Planner test failure: prompt strings still name GPT-6 Luna while the package test requires the fixed GPT-5.6 Luna exploration route.

## Scope
`job-planner/index.ts` planningPrompt and before_agent_start strings; `job-planner/test/core.test.ts` package manifest/skill contract test.

## Reproduction
Run `npm test --prefix job-planner`. Result: 12 pass, 1 fail. Failure: `package manifest ships the extension and the collaborative jog skill`.

## Expected
Exploration instructions agree with the installed exploration skill's fixed `openai-codex/gpt-5.6-luna:high` route.

## Actual
The source prompt strings name `openai-codex/gpt-6-luna:high`; the test expects GPT-5.6 Luna.

## Evidence
- `job-planner/test/core.test.ts:117` checks the extension prompt model.
- `job-planner/index.ts:158` and `:460` contain the divergent route.
- `git diff master -- job-planner` is empty: the complete package is unchanged from master before integration.
- Validation log: `/tmp/pi-extensions-job-planner-merge-test.log`.

## Impact
Existing broader test suite is not fully green. This does not originate in the pending snapshot changes and must not be described as a new regression or silently repaired under a Git-only request.

## Status
OPEN. Discovered during user-authorized WIP snapshot integration. No repair made. GitHub: https://github.com/dhickel/my-pi-extensions/issues/6 . No related closed issue was found before filing.

## Next Action
Repair prompt/skill contract alignment under a separately scoped task, rerun package tests, and close the mirrored GitHub issue after validation.
