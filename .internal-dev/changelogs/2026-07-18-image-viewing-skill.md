# Image Viewing Skill

## Date

2026-07-18

## Git Commit

Not applicable: `/home/dhickel/AI/Workspaces/Pi-extensions` is not a Git repository.

## Change Summary

Added and globally installed the `image-viewing` Pi skill. It delegates path-based image inspection to one `openai-codex/gpt-5.6-sol` subagent at medium reasoning, but only when the caller model is confirmed not to support image input.

## Files

- `skills/image-viewing/SKILL.md`
- `/home/dhickel/.pi/agent/skills/image-viewing/SKILL.md`
- `.internal-dev/knowledge/pi-subagent-image-delegation.md`
- `.internal-dev/changelogs/2026-07-18-image-viewing-skill.md`

## Behavioral Impact

Text-only models can load `/skill:image-viewing`, pass local image paths and a focused analysis brief to the fixed vision model, poll it to completion, and relay a detailed visual summary. The skill forbids use when the caller already supports image input or when capability is merely uncertain.

## Specification Impact

Specification Impact: none. This standalone global skill does not alter the sprint-planner suite or another existing living specification class; its complete execution contract is contained in the skill itself.

## Risks

- The current subagent tool transmits only a text task, so images must be readable local files; prior inline-only attachments cannot be forwarded by this skill.
- Runtime use depends on configured authentication for `openai-codex/gpt-5.6-sol` and availability of the `read`, `subagent_spawn`, and `subagent_poll` tools.

## Follow-up Items

None required. Direct image payload support could be considered later as a subagent-extension enhancement.
