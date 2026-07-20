# Senior Agent Skill

## Date

2026-07-15

## Git Commit

Not applicable — this workspace is not a Git repository.

## Change Summary

Created and globally installed the `senior-agent` Pi skill. The skill escalates difficult engineering diagnosis, architectural review, bug repair, and stuck implementation work through a dedicated subagent and fixes its execution contract to `openai-codex/gpt-5.6-sol` with `xhigh` reasoning.

## Files

- `skills/senior-agent/SKILL.md` — archived, portable skill source.
- `/home/dhickel/.pi/agent/skills/senior-agent/SKILL.md` — active user-level installation, byte-identical to the archived source.
- `.internal-dev/changelogs/2026-07-15-senior-agent-skill.md` — this change record.

## Behavioral Impact

Pi now discovers `/skill:senior-agent` globally. When activated, it directs the caller to prepare a self-contained escalation, launch exactly one senior subagent by default with the required provider/model/thinking tuple, poll it to completion, and review and validate the returned diagnosis or edits. It explicitly fails rather than substituting another model when the required runtime is unavailable.

## Specification Impact

Specification Impact: none. No living project specification currently owns standalone archived skills; the skill's `SKILL.md` is the self-contained behavior contract.

## Risks

- Execution requires the globally installed subagent extension and configured authentication for `openai-codex/gpt-5.6-sol`.
- The current subagent extension is a flat pool, so a child subagent without `subagent_spawn` cannot recursively invoke this escalation skill.

## Follow-up Items

- Exercise the skill on real escalations and refine its trigger description or escalation brief based on observed traces if needed.
