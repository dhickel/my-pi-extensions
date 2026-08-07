# Review: Lite config vs. implementation model routing confusion

Date: 2026-08-04 (session against HEAD 8a1cf20)

## Scope

Diagnostic review of why implementation agents resolve to `deepseek/deepseek-v4-pro`
(pro) instead of the flash model the user believed the lite config sets. Reviewed the
config schema, engine prompt wiring, plan artifacts, the orchestrate skill, and
supporting docs/tests.

## Findings

1. **The orchestrate skill hard-codes `deepseek-v4-pro:max` for implementation.**
   `sprint-planner/skills/orchestrate/SKILL.md` v4.1.0 frontmatter, "Fixed model
   contract", preflight JSON, and every spawn example contain the literal
   `deepseek/deepseek-v4-pro:max` tuple with a policy-violation warning if omitted.
   The skill claims tuples are "drawn from the loaded sprint-planner agent
   configuration (`configs/default.ts`)", but it is static markdown; there is no
   wiring in `index.ts`/`engine.ts` that injects the loaded config into the skill.
   Execution-time spawns therefore ignore the lite config entirely.
2. **Engine plan artifacts also advertise DeepSeek Pro.** `prompts.ts` writes
   `- Implementation: deepseek/deepseek-v4-pro:high` into orchestration.md Model
   Assignments (from lite's `implementationWorker`) and hard-codes "DeepSeek
   implementation agent" prose in review prompts.
3. **Lite config sets pro:high, not flash.** `configs/lite.ts` assigns
   `implementationWorker: MODEL_PROFILES.deepseekProHigh`. Commit `8a1cf20`
   (latest) deliberately changed it from `deepseek-v4-flash:max` to
   `deepseek-v4-pro:high`; `test/core.test.ts` asserts this. The user's
   expectation matches the pre-`8a1cf20` state.
4. **`deepseekFlashMax` is orphaned.** `types.ts:28` defines
   `deepseek/deepseek-v4-flash:max`; neither config references it.
5. **Stale docs.** `sprint-planner/AGENTS.md` and `README.md` document the fixed
   contract as `deepseek-v4-pro:max` from `configs/default.ts`;
   `index.ts:138` comment still says the load-time snapshot is fixed to
   `configs/default.ts` although lite is loaded.
6. **Validator mismatch (parallel issue).** Lite config assigns
   `phaseValidator`/`integrationValidator`/`executionAdvisor` to
   `deepseek-v4-pro:max`, while the skill hard-codes `openai-codex/gpt-5.6-terra:high`
   for phase/integration validation and `gpt-5.6-sol:xhigh` for senior escalation.

## Risk Assessment

Low immediate risk to correctness of any single run — every source picks a
real, configured DeepSeek Pro model, so runs do not fail; the risk is
policy/opex: the lite config's intended cost/latency reduction is silently not
in effect for execution, plan documents misadvertise model assignments, and any
future config change will likewise not propagate to implementation spawns
unless the skill stops hard-coding tuples. The orphaned `deepseekFlashMax`
profile increases the chance a future edit reuses it without updating the
skill, perpetuating the mismatch.

## Recommendations

- Decide intended lite implementation model: restore flash (`deepseekFlashMax`) or
  keep pro:high; update `lite.ts` and the matching test assertion accordingly.
- Make the orchestrate skill genuinely config-aware: resolve the active config at
  runtime (e.g., read `configs/index.ts`/loaded snapshot) instead of hard-coding
  tuples, or template the contract into the skill at extension load.
- Reconcile AGENTS.md, README.md, and the `index.ts:138` comment.

## Follow-ups

- User decision on lite implementation model (flash vs. pro:high) before any fix.
- If fixing: changelog entry with commit hash; update `test/core.test.ts`
  assertions; re-run sprint-planner test suite (`npm test` or deno test in
  `sprint-planner/`).
