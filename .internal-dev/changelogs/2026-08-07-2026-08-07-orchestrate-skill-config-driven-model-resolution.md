# Changelog: Orchestrate skill resolves model tuples from the loaded sprint-planner configuration

## Date

2026-08-07

## Git Commit

95145c14300e659734c4563d2fe4a2a7a567ed13

## Change Summary

Made the orchestrate skill's delegated model contract genuinely configuration-driven. The skill previously hard-coded `deepseek/deepseek-v4-pro:max` (implementation), `openai-codex/gpt-5.6-terra:high` (validators), and `openai-codex/gpt-5.6-sol:xhigh` (senior escalation) while claiming the tuples were drawn from the loaded sprint-planner agent configuration — so the active `lite` config never reached implementation spawns. The "Fixed model contract" section is now a "Model resolution contract" with six mandatory resolution steps: locate the extension root, read `configs/index.ts` for `DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION`, read the active config file for `implementationWorker` / `phaseValidator` / `integrationValidator` / `advisor`, expand `MODEL_PROFILES` references through `types.ts`, map `thinking` to `thinkingLevel`, and stop with a concrete failure if any step cannot be satisfied. Resolution must happen before the preflight and before every implementation delegation. All spawn examples (preflight, implementer, phase validator, integration validator) now use resolved-tuple placeholders instead of literal model values. Skill version bumped 4.1.0 -> 4.2.0.

## Files

- `sprint-planner/skills/orchestrate/SKILL.md` — rewritten model contract (section renamed, mandatory resolution steps, placeholder-based spawn examples, preflight and delegation prose updated); frontmatter description/compatibility updated; version 4.2.0.
- `sprint-planner/test/core.test.ts` — contract assertions updated: section name, resolution-step regexes, placeholder-based spawn-example tuple assertions, tool-set labels, and rewording-sensitive regexes.
- `sprint-planner/AGENTS.md` — documents lite as the active configuration, runtime resolution by the skill, and the lite execution tuples.
- `sprint-planner/README.md` — skill contract paragraph rewritten to describe run-time config resolution with the lite tuples.
- `sprint-planner/index.ts` — stale comment updated (load-time snapshot resolves the active configuration, currently lite).
- `.internal-dev/reviews/2026-08-07-2026-08-04-sprint-planner-lite-config-model-routing-confusion.md` — diagnostic review that motivated this change.

## Behavioral Impact

An orchestrator following the skill now resolves the implementation model from the loaded configuration before preflight/implementation. Under the active `lite` config, implementation agents spawn at `deepseek/deepseek-v4-pro:high` (previously the skill forced `:max`); phase/integration validators and senior escalation resolve to `deepseek/deepseek-v4-pro:max` (previously GPT-5.6 Terra high / Sol xhigh). Planning pipeline behavior, tool sets, spawn contract, and validation gates are unchanged. A config change now propagates to execution without editing the skill.

## Specification Impact

The sprint-planner suite specification's model-contract prose should be re-checked against the renamed section; the skill's contract is now runtime resolution rather than a fixed tuple list.

## Risks

- The orchestrator must be able to locate the extension root (`configs/index.ts`); if the extension is installed outside the working repository the resolution steps still apply, but the root must be found. The skill instructs stopping with a concrete failure if it cannot be located.
- Placeholder-based examples rely on the orchestrator substituting resolved values; the mandatory resolution steps and preflight confirmation mitigate silent copying.

## Follow-up Items

- The four pre-existing senior-agent skill-contract test failures (tracked in GitHub Issue #1) remain; they are unrelated to this change and were verified present at the prior HEAD (8a1cf20).
- Decide whether `lite` should keep `implementationWorker` at `deepseek-v4-pro:high` or move to flash; the `deepseekFlashMax` profile in `types.ts` remains unused.
