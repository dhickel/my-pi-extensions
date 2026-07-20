# Pi Resource Discovery Validation

## Topic

Reliable validation of global Pi context, tools, and skills.

## Source References

- `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `/home/dhickel/.pi/agent/skills/senior-agent/SKILL.md`

## Key Takeaways

- A model response about whether a skill is available is a behavioral smoke check, not authoritative discovery evidence. A fresh Pi model session reported `senior-agent` as missing even though the skill was loaded.
- Use RPC `get_commands` for deterministic skill discovery. Loaded skills appear as commands named `skill:<name>` with their source path and scope.
- Pi's `--tools` allowlist controls tools, not skill command discovery. `skill:senior-agent` remained present while the smoke process used `--tools internal_dev`.
- Use a fresh no-session model run to smoke-test the behavior induced by global `AGENTS.md`, then use registry or loader introspection to verify exact resources.

## Project Relevance

Use this validation pattern when installing or changing global Pi policies, skills, prompt templates, or extensions. It prevents a model's mistaken self-report from being treated as a resource-loading defect.

## Open Questions

None.
