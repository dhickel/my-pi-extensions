# Subagent tool registration friction

## Summary

Fixed skill tool contracts and subagent validation caused avoidable spawn retries when `grep`, `find`, or `ls` were caller-inactive or absent as standalone tool APIs, even though the eventual reduced tool set launched successfully.

## Scope

Subagent registered/inactive tool resolution, provider-facing guidance, and the senior-agent, image-viewing, and orchestrate skill tool contracts.

## Reproduction

1. Load a coding harness whose available tool APIs include `read`, `bash`, `edit`, and `write` but do not register standalone `grep`, `find`, or `ls` APIs.
2. Follow the prior senior/orchestrate exact tool contract requesting all seven names.
3. Observe rejection for an inactive or unregistered name.
4. Retry after removing names until the four standard coding APIs remain.

## Expected

One spawn attempt succeeds. Caller-inactive registered definitions can be explicitly activated, while fixed portable skill contracts request only APIs registered in the standard harness and use `bash` for search/listing commands.

## Actual

The delegation eventually succeeded, but only after reasoning through missing-schema and inactive/unregistered-tool errors and reducing the requested set.

## Evidence

- User-provided trace shows successful launch only after dropping `grep` and `find` and settling on `read`, `bash`, `edit`, and `write`.
- Fresh-process reproduction rejected an exact seven-tool senior spawn with `Tool "grep" ... is not registered`.
- Fresh-process final validation launched exactly once with `read`, `bash`, `edit`, and `write`; `openai-codex/gpt-5.6-sol:xhigh` completed with PASS.
- Subagents tests pass 81/81 and sprint-planner skill-contract tests pass 210/210.

## Impact

Retries waste model turns, create confusing reasoning about active versus registered tools, and can tempt agents to violate fixed skill contracts by improvising tool reductions.

## Status

Resolved and validated in subagents v0.5.0, senior-agent v3.0.0, orchestrate v4.0.0, and image-viewing v2.1.0.

## Next Action

Archive. Reopen if fixed skill tool lists again reference APIs absent from the standard coding harness or caller-inactive registered tools fail child activation.
