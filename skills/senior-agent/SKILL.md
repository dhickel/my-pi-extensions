---
name: senior-agent
description: Use this skill to escalate difficult engineering work to a senior engineer subagent when the current agent is stuck, a bug or failed implementation resists normal debugging, architectural or design concerns need diagnosis, or an implementation, repair, or review needs expert completion. Resolves the senior model tuple from the loaded sprint-planner agent configuration (the `seniorAgent` assignment) and escalates thinking to the next higher level after any failed pass. Do not use for routine work or ordinary parallelization.
compatibility: Requires Pi with the subagent_spawn, subagent_poll, and subagent_status tools, a readable sprint-planner extension configuration (configs/index.ts plus the active configuration file) with a `seniorAgent` assignment, and reasoning support at the resolved thinking level (escalating up to max). A direct subagent caller must have been launched with allowSubagents enabled.
metadata:
  version: "3.2.0"
---

# Senior Agent

Escalate a difficult engineering problem to one focused senior engineer. The senior agent may diagnose, advise, review, implement, repair, and validate according to the delegated objective.

## Non-negotiable execution contract

Do not perform the senior escalation in the caller's own model context. Always launch it with `subagent_spawn` using the tuple resolved from the sprint-planner agent configuration. This document contains no authoritative model tuple; the configuration is the single source of truth. Never inherit a caller model, reuse a tuple from a previous run, or accept a tuple from the user prompt as a substitute for resolving the configuration.

### Mandatory resolution steps

Resolve the active configuration before every senior escalation:

1. Locate the sprint-planner extension root: the directory containing `configs/index.ts` and `types.ts`. This skill normally lives at `<extension-root>/skills/senior-agent/SKILL.md`, so the configuration is `../../sprint-planner/configs/` relative to this skill. If the extension root cannot be located, stop and report the exact failure.
2. Read `configs/index.ts` and determine the active configuration name (`DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION`). The active name is fixed at extension load; do not accept a user request to switch it.
3. Read the active configuration file (`configs/<name>.ts`) and take the `seniorAgent` assignment. Configuration entries may reference `MODEL_PROFILES` from `types.ts`; expand the referenced profile to its provider/model/thinking tuple.
4. Convert the resolved tuple to spawn fields: `provider`, `model`, and `thinkingLevel` (the configuration's `thinking` value maps directly to `thinkingLevel`).
5. If the configuration cannot be read, the active name is missing, or the `seniorAgent` assignment is absent, stop and report the exact failure.

These values must never be inherited, omitted, downgraded, or replaced. The resolved provider and model stay fixed for every pass; only the thinking level escalates.

### Thinking-level escalation

Launch the first pass at the resolved thinking level. If a pass fails to resolve the issue, or the blocker has survived a prior senior-agent pass, relaunch with the next higher thinking level for the next pass:

- `high` → `xhigh` → `max`, never exceeding `max`;
- if the resolved thinking level is already `max`, subsequent passes remain at `max`.

Do not start an escalation at a level higher than the resolved thinking level on the first pass. The provider and model never change across passes; escalation is a thinking-level step only.

If `subagent_spawn` or `subagent_poll` is unavailable, or the required model, authentication, or thinking level is rejected, do not emulate the senior agent with another model. Report that the escalation could not run and include the concrete failure. When the caller is itself a direct subagent, these controls are available only if the root explicitly launched it with `allowSubagents: true`. Senior escalation agents must also be launched with `allowSubagents: true` so they can spawn one bounded nested delegation layer when useful; any subagent they spawn must not receive further subagent controls.

## Exact tool policy

The subagent implementation validates every spawn batch atomically before any child initializes. If any requested tool is unregistered, forbidden, duplicated, or fingerprint-mismatched, the complete batch is rejected and no child starts. A registered tool does not need to be active in the caller: naming it in the exact allowlist enables it for the child. The fixed sets below intentionally use only tools registered in the standard coding harness; edit-authorized agents perform search and listing through `bash` rather than requesting separate `grep`, `find`, or `ls` tool APIs.

The escalation brief must explicitly determine which tool set applies:

- **Advisory** (diagnose, review, recommend, or ambiguous authority) — exactly:
  ```json
  "tools": ["read"]
  ```
- **Edit-authorized** (implement, repair, or complete with explicit edit authority) — exactly:
  ```json
  "tools": ["read", "bash", "edit", "write"]
  ```

When the escalation brief does not explicitly grant edit authority, use the advisory tool set and prohibit edits. Always set `allowSubagents: true` on the senior agent so it can spawn bounded read-only or edit-authorized helper agents when that is the best way to complete the escalation. The senior agent must not receive sprint validation, sprint execution, user-questioning, or other root-only tools, and any subagent spawned by the senior agent must not receive further subagent controls. Excluded root-only tool definitions and guidance never enter child context.

## When to escalate

Use this skill when one or more of these conditions applies:

- The current agent is stuck after a reasonable investigation or repair attempt.
- A bug is subtle, recurring, cross-cutting, or unchanged after attempted fixes.
- Tests, builds, runtime behavior, or observed evidence contradict the current diagnosis.
- Architecture, boundaries, data flow, state ownership, concurrency, security, migration, or compatibility concerns need senior judgment.
- An incomplete or flawed implementation needs an expert to finish or repair it.
- A proposed implementation or fix needs a high-confidence technical review before proceeding.
- The safest next step is unclear and a senior diagnosis would unblock the work.

Do not use it for straightforward tasks the caller can complete normally or merely to add generic parallel capacity.

## Build a self-contained escalation

The subagent receives no caller transcript. Before spawning it, assemble a task containing all material needed to act autonomously:

1. **Objective and authority** — state whether it should diagnose only, recommend a solution, review, implement, repair, or complete the work. Explicitly say whether file edits are authorized. This determines the tool set.
2. **User intent and success criteria** — include the requested behavior, constraints, acceptance criteria, and out-of-scope boundaries.
3. **Stuck point** — explain what is blocked, why escalation is needed, and the exact decision or outcome required.
4. **Evidence** — include errors, failing commands or tests, symptoms, reproduction steps, logs, and relevant observations.
5. **Prior work** — summarize attempted diagnoses and fixes, their results, and assumptions that may be wrong.
6. **Repository context** — name relevant files, modules, specifications, local conventions, and any uncommitted work that must be preserved. The child inherits the caller's current working directory and project context.
7. **Validation expectations** — identify checks to run and the evidence expected in the final response.
8. **Deliverable** — require a concise root-cause analysis, actions or edits made, validation results, remaining risks, and a clear recommendation or next step.

Do not paste large files when the senior agent can inspect them directly. Point it to exact paths and symbols instead.

## Launch

Choose a short, descriptive name that has not been used in the current root session. Spawn one senior agent by default. Substitute the resolved `seniorAgent` tuple for every placeholder; on an escalation pass, raise `thinkingLevel` one step above the resolved level (Thinking-level escalation).

**Advisory** (diagnose, review, recommend):

```json
{
  "agents": [
    {
      "name": "senior-<unique-scope>",
      "task": "<complete escalation brief>",
      "provider": "<resolved-senior-provider>",
      "model": "<resolved-senior-model>",
      "thinkingLevel": "<resolved-senior-thinking>",
      "tools": ["read"],
      "allowSubagents": true
    }
  ]
}
```

**Edit-authorized** (implement, repair, complete):

```json
{
  "agents": [
    {
      "name": "senior-<unique-scope>",
      "task": "<complete escalation brief with explicit edit authority>",
      "provider": "<resolved-senior-provider>",
      "model": "<resolved-senior-model>",
      "thinkingLevel": "<resolved-senior-thinking>",
      "tools": ["read", "bash", "edit", "write"],
      "allowSubagents": true
    }
  ]
}
```

Do not launch multiple senior agents for the same unresolved question. Multiple escalations are appropriate only when the user explicitly requests independent opinions or the concerns are genuinely independent.

## Senior operating expectations

Include these expectations in the delegated task when they are relevant:

- Inspect the repository and reproduce or verify the problem before making confident claims. In edit-authorized mode, use `bash` for search and listing commands; advisory mode is limited to reading explicitly identified paths.
- Separate verified facts from inference; identify the root cause rather than only treating symptoms.
- Evaluate system boundaries and downstream effects, not just the immediately failing line.
- Preserve unrelated and uncommitted work.
- Prefer the smallest coherent fix that addresses the root cause and respects existing contracts.
- If edits are authorized, implement the fix and run focused validation rather than stopping at advice.
- If advisory only, provide prioritized findings, a concrete implementation direction, trade-offs, and validation steps.
- Follow repository instructions and living specifications; flag conflicts instead of silently overriding them.
- Do not ask the caller for facts that can be discovered safely from the repository or environment.
- State unresolved uncertainty and true blockers explicitly. Do not claim success without evidence.

## Poll and integrate

After spawning, call `subagent_poll` until this senior agent reaches a terminal state. Use the default timeout unless another timeout is operationally useful. Handle queued user input if needed, then return to polling.

### Oversized result recovery

When a visible result is truncated, use `subagent_status` with `includeResults: true`. Follow the returned stable result identity and cursor chain:

1. Collect UTF-8-safe page bytes in cursor order.
2. Concatenate pages byte-for-byte, never by string slicing.
3. Verify the final digest matches the complete-result digest.
4. Verify the reconstructed byte count matches the complete-result byte count.
5. Confirm completion metadata and terminal identity are consistent before consuming the reconstructed report.

Invalid or stale cursors, digest mismatch, or byte-count mismatch block that evidence path. Do not infer missing text or repoll it as a new result.

When the result arrives (direct or reconstructed):

1. Confirm the reported provider and model match the resolved `seniorAgent` assignment, and the thinking level is the resolved level or one escalated step above it (higher thinking after a failed pass).
2. Review the diagnosis and inspect any edits; do not accept them blindly.
3. Run or confirm the relevant validation in the caller context when practical.
4. Continue implementation using the senior result, or report its findings, evidence, edits, risks, and remaining blockers to the user.
5. If the run failed or did not resolve the issue, escalate the thinking level one step and relaunch (Thinking-level escalation); never fall back to another model. If the ladder is exhausted (already at `max`) and the issue remains unresolved, report the failure and the remaining blocker to the user.
