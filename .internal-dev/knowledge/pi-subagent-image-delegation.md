# Pi Subagent Image Delegation

## Topic

Passing image-analysis work from a text-only Pi model to a vision-capable subagent.

## Source References

- `/home/dhickel/AI/Workspaces/Pi-extensions/subagents/README.md`
- `/home/dhickel/AI/Workspaces/Pi-extensions/subagents/index.ts`
- `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `/home/dhickel/AI/Workspaces/Pi-extensions/skills/image-viewing/SKILL.md`

## Key Takeaways

- The current `subagent_spawn` contract sends only a text `task`; children receive no caller transcript or prior image attachments.
- Reliable skill-based image delegation therefore requires each image to exist as a readable local file whose path is included in the child task.
- The child can call Pi's `read` tool on that image path, which sends the image to a vision-capable child model as an attachment.
- `openai-codex/gpt-5.6-sol` is registered with image input support. A medium-reasoning child successfully read `/tmp/image-viewing-skill-test.png` and transcribed `VISION TEST 47` with its approximate color.
- Deterministic global-skill discovery should use RPC `get_commands`, not a model's self-report.

## Project Relevance

The global `image-viewing` skill uses this path-based handoff to delegate image inspection from a confirmed text-only caller model to `openai-codex/gpt-5.6-sol` at medium reasoning. Inline-only attachments remain unavailable to the child unless they are first materialized as files.

## Open Questions

- A future subagent tool contract could accept image payloads directly, removing the local-file requirement for inline attachments.
