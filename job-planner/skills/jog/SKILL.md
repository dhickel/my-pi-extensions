---
name: jog
description: Execute a job-planner plan collaboratively on the main agent thread. Use when the user asks to jog, implement, or work through a plan produced by /job and wants interactive decisions and clarification during implementation. The root agent owns interaction, decisions, validation, and completion; after targets are identified and the approach is ironed out with the user, large single-domain edits may be dispatched to subagents while the root continues planning other aspects and working with the user. Exploration teams may survey the code. Every completed implementation domain must pass the luna validation loop before the next domain starts.
compatibility: Requires a readable job plan produced by job_plan_submit and Pi's normal repository tools. Interactive user-questioning tools are strongly recommended. Subagent tools (subagent_spawn, subagent_poll, subagent_status) are required when delegating large single-domain edits or running exploration teams; without them, jog runs fully on the root thread. Delegated edits require a readable sprint-planner configuration (configs/index.ts plus the active configuration file) with basicImplementer and advancedImplementer assignments.
metadata:
  version: "2.1.0"
---

# Jog

Implement one job plan as an interactive collaboration. The root agent owns repository inspection decisions, user questions, plan amendments, validation, closeout, and completion. Subagent support is an execution aid, not a replacement for that ownership: exploration teams may survey the code, and once targets are identified and the approach is ironed out with the user, large single-domain edits may be delegated while the root keeps planning other aspects and working with the user.

Jogging is not a background pipeline, a Sprint Planner workflow, or an advanced-plan conversion. It never replaces the accepted job plan with a new plan.

## Ownership contract

- The root session owns: resolving the plan, deciding what to inspect, every user question, plan amendments, the validation gate, closeout records, and the completion report.
- The root may delegate only two things, under their own contracts below:
  1. **Exploration teams** — read-only surveys for broad codebase context, per the installed exploration skill.
  2. **Large single-domain edits** — after targets are identified and the approach for that domain is ironed out with the user.
- Do not use Sprint Planner workflows, sprint tools, or an advanced-plan conversion merely because the job has multiple steps. Delegated validation is allowed only through the mandatory domain validation loop defined below, never ad hoc.
- Do not replace the job plan with a new plan. The accepted job plan is the execution contract.
- A governing senior-escalation policy may require narrowly scoped expert consultation after a concrete failed attempt or genuine blocker. Such consultation is advisory only: the root agent retains implementation, validation, user interaction, and completion ownership.

## Exploration teams

For broader inspection — architecture maps, behavior searches, API and data-flow overviews, docs/tests/spec synthesis, or summaries across many files — load and follow the installed `exploration` skill instead of reading every file into root context.

- Every exploration subagent must be launched with the exploration skill's exact fixed contract: `provider: "deepseek"`, `model: "deepseek-v4-flash"`, `thinkingLevel: "max"`, `tools: ["read", "bash"]`. Never inherit, omit, downgrade, clamp, or substitute these values.
- Exploration agents are read-only and never receive edit, write, subagent, sprint, or user-questioning tools. If the exploration skill or its exact contract is unavailable, do not emulate it with another model; report the blocker and proceed with ordinary root inspection.
- Exploration summaries are orientation aids. Read critical files directly before editing based on a finding, validating a diagnosis, or resolving contradictions between reports.
- Poll every exploration agent to a terminal state before relying on its report.

## Model policy for delegated edits

Resolve every delegated-edit tuple from the loaded sprint-planner agent configuration before dispatch. This document contains no authoritative model tuple; the configuration is the single source of truth. Never inherit the caller model, reuse a tuple from a previous run, or accept a tuple from the user prompt as a substitute for resolving the configuration.

### Mandatory resolution steps

1. Locate the sprint-planner extension root: the directory containing `configs/index.ts` and `types.ts`. If the extension root cannot be located, stop and report the exact failure.
2. Read `configs/index.ts` and determine the active configuration name (`DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION`).
3. Read the active configuration file (`configs/<name>.ts`) and take the `basicImplementer` and `advancedImplementer` assignments. Configuration entries may reference `MODEL_PROFILES` from `types.ts`; expand each referenced profile to its provider/model/thinking tuple.
4. Convert each resolved tuple to spawn fields: `provider`, `model`, and `thinkingLevel` (the configuration's `thinking` value maps directly to `thinkingLevel`).
5. If the configuration cannot be read, the active name is missing, or either assignment is absent, stop and report the exact failure.

Choose the resolved tuple by complexity. Never downgrade an assignment:

- **`basicImplementer`** — light basic work, document editing, and well-defined edits of simple logic.
- **`advancedImplementer`** — anything relatively complicated or important: nontrivial logic, cross-file behavior, concurrency, persistence, API contracts, security-sensitive changes, or work the plan itself treats as significant.

If a required tuple is unavailable, do not substitute a weaker model. Report the exact failure and either do the work on the root thread or escalate per the governing senior-escalation policy.

Light, small, or tightly coupled changes stay on the root thread. Do not spawn agents for trivial edits or to dodge reading critical code.

## Domain validation loop (luna)

Every completed implementation domain passes a validator review before the next domain starts. The loop is part of jog's defined workflow, not an optional extra.

### Trigger

- After every coherent implementation domain lands (delegated or root-made) and its focused root-run checks pass, before the next domain starts.
- After every repair of validator findings: a focused confirmation pass with the same tuple runs until the verdict is PASS.

### Validator tuple

- Resolve from the loaded sprint-planner agent configuration exactly like the implementer tuples (the same mandatory resolution steps): take `MODEL_PROFILES.lunaXhigh` (currently `openai-codex` / `gpt-5.6-luna` / thinking `xhigh`). Never hardcode, inherit, downgrade, or substitute; if the profile cannot be resolved, report the exact failure and pause the domain gate.
- Spawn contract: `tools: ["read", "bash"]` only (read-only; `mvn` test runs that write under `target/` are acceptable), `allowSubagents: false`, name `validate-<domain>-<unique>`.

### Brief and verdict

- Each validator brief is self-contained: the domain's objective and its contract from the resolved plan, the exact files and write boundaries, the verification commands it may run, and the required output format: `Verdict` (PASS or BLOCKED), `Findings` (numbered: severity, file:line, issue, concrete fix; real defects only), `Verified Strengths`, `Residual Risks`.
- Poll the validator to a terminal state. A PASS verdict gates the next domain.

### BLOCKED handling (root-owned)

- The root reviews every finding and independently confirms it before acting; the validator never edits and its report is evidence, not authority.
- The root repairs in-scope defects (on the root thread or through a focused single-domain delegation) and adds or strengthens regression tests for each finding.
- After each repair round, run a focused confirmation pass with the same tuple and a brief pointing at the repaired code and tests. Iterate until PASS; multiple rounds are expected and are a feature of the loop, not a failure.
- A BLOCKED finding that resists root repair after a reasonable attempt is escalated to a senior engineer through the senior-agent skill (edit-authorized when the fix needs implementation); the senior result is integrated and independently validated before the confirmation pass resumes.
- Never skip, weaken, or postpone a BLOCKED finding to unblock the next domain.

## Resolve the job plan

Treat arguments to `/skill:jog` as the requested plan path or as user context identifying the plan.

1. If a path is supplied, normalize a leading `@`, resolve it from the project working directory, and read the plan directly.
2. If no path is supplied, look in the current conversation for the path returned by `job_plan_submit`. If exactly one current completed job plan is unambiguous, use it. Otherwise ask the user to choose the plan; do not guess.
3. Require these headings: `Feature`, `Required Behavior`, `Targets`, `Constraints`, `Assumptions`, `Settled Decisions`, `Implementation Approach`, `Validation Criteria`, and `Out of Scope`.
4. Read applicable repository instructions, living specifications, and only task-relevant knowledge before editing.
5. Inspect every declared target and its important callers, tests, and integration boundaries. Resolve safely discoverable facts from the repository instead of asking the user. Use an exploration team when broad inspection would otherwise flood the root context.

If the plan conflicts with governing project instructions, current intended specifications, or actual repository constraints, stop the affected work and present the conflict to the user. Do not silently reinterpret accepted scope.

## Collaborate with the user

Interactive collaboration is part of jogging, not a fallback of last resort.

- Ask the user when implementation exposes a consequential choice, unclear authority, behavior not settled by the plan, an assumption contradicted by evidence, a scope boundary decision, an irreversible action, or multiple materially different valid outcomes.
- Prefer the available constrained choice-question tool for concrete decisions. Present two to five meaningful options with concise trade-offs and include an open answer route when the tool supports one.
- Use a written-answer tool only when meaningful choices cannot capture the required nuance.
- Ask related decisions together only when doing so helps the user reason about them. Otherwise ask one focused question, incorporate the answer, and continue.
- Do not ask for facts that repository inspection, tests, documentation, or safe commands can establish.
- Treat cancellation or no answer as a stop for that decision. Do not repeatedly prompt or choose on the user's behalf.
- Give concise progress updates at natural boundaries, especially before a user-visible behavior choice or after validation changes the diagnosis.
- Subagents cannot question the user. When a delegated edit uncovers a decision, the child returns a precise escalation request and the root asks the user on its behalf.

## Delegate a large single-domain edit

### Gate

Delegate a domain edit only when all of these hold:

1. The affected targets are identified in the resolved plan.
2. The approach for that domain is ironed out with the user — any consequential choices for it are settled in the plan or answered during jogging.
3. The edit is one coherent large domain: a substantial slice scoped to one feature area, module, or file family with clear boundaries. Do not split work across subagents merely because it is large, and do not delegate pieces that depend on unsettled decisions.

Delegation does not pause the collaboration. While a child implements one domain edit, the root continues planning other aspects of the job and keeps working with the user. The root remains responsible for integrating each child's result.

### Spawn

Launch each domain edit as one subagent with an explicit tuple resolved from the model policy and an exact tool allowlist:

```json
{
  "agents": [
    {
      "name": "edit-<domain>-<unique>",
      "task": "<self-contained domain-edit brief>",
      "provider": "<config-basic-provider>",
      "model": "<config-basic-model>",
      "thinkingLevel": "<config-basic-thinking>",
      "tools": ["read", "bash", "edit", "write"]
    }
  ]
}
```

Use the resolved `advancedImplementer` tuple for complicated or important work. Never omit the tuple fields, never inherit the caller model, and never grant subagent, sprint, or user-questioning tools or subagent controls to a child.

Every child receives no caller transcript, so each brief must be self-contained:

- the user objective and the resolved plan's relevant contract for this domain;
- exact targets, files, and write boundaries;
- constraints, settled decisions, and out-of-scope items that apply;
- unrelated edits or untracked files that must be preserved;
- required validation commands or expectations for the changed behavior;
- an instruction that any consequential open decision returns as an escalation request for the root, never a guess;
- required return sections: `Summary`, `Files Changed`, `Validation`, `Criteria`, `Remaining Risks`, `Escalation Requests`.

### Poll and integrate

- After spawning, call `subagent_poll` until every launched agent reaches a terminal state. Poll timeouts are status updates, not completion.
- When a result is oversized or truncated, use `subagent_status` with `includeResults: true` or `resultPage` to recover it before relying on it.
- If a child fails after possible edits, inspect the actual repository state; a failed delegation does not excuse unvalidated changes.
- A child self-report is evidence, not completion. The root reviews every delegated diff, runs the focused and broader checks itself, resolves escalation requests with the user, and repairs defects found during integration.

## Execute the plan

1. Establish a clean baseline without discarding unrelated edits. Record existing worktree changes and preserve them.
2. Work through `Implementation Approach` in order unless the plan explicitly permits another dependency order.
3. Implement every item in `Required Behavior` at the declared `Targets`, subject to `Constraints`, `Settled Decisions`, and `Out of Scope`.
4. Treat `Assumptions` as recorded planning assumptions, not permission to ignore contrary evidence. When an assumption is disproved and the consequence is material, ask the user before changing the contract.
5. Keep light, small, and tightly coupled changes on the root thread. For broad inspection, use an exploration team; for a large single-domain edit whose targets and approach are settled, delegate per the contract above while continuing to plan and collaborate.
6. Use the simplest coherent implementation that satisfies the complete current plan. Do not add speculative APIs, placeholders, stubs, fake behavior, deferred TODOs, or adjacent features.
7. After each coherent implementation slice — root-made or delegated — run focused checks for the changed behavior and relevant edge or failure cases. Repair in-scope failures before continuing. Then run the domain validation loop for that slice before starting the next domain.
8. If an ordinary implementation or debugging attempt fails and uncertainty prevents a confident next action, follow the governing senior-escalation policy. Integrate any advice yourself and independently validate it. Any bug that cannot be fixed after a reasonable root attempt, or that survives a repair round, is escalated to a senior engineer through the senior-agent skill: resolve the configured `seniorAgent` tuple, launch one focused escalation (advisory or edit-authorized as the situation requires), integrate and independently validate the senior result, and escalate the thinking level for repeated failures. Never stall on an unfixable bug without a senior escalation.

The plan is authoritative, but user decisions made during jogging may explicitly amend it. When that happens, summarize the accepted amendment in the conversation and update the plan's relevant section before implementing the changed contract. Do not mutate the plan for discoverable implementation detail or routine progress.

## Validation gate

Before claiming completion (every completed domain must already hold a PASS verdict from the domain validation loop):

1. Check every bullet in `Validation Criteria` and report concrete evidence for each.
2. Run focused tests for changed behavior, including applicable failure and edge cases, for root-made and delegated changes alike.
3. Run the broader test, typecheck, lint, or build checks appropriate to the affected project.
4. Diagnose and repair failures caused by the work. Distinguish demonstrably pre-existing or unrelated failures with evidence.
5. Review the final diff for scope, accidental API growth, placeholders, debug residue, unrelated edits, and missed targets, including every delegated edit.
6. Complete the repository's required specification, knowledge, changelog, and other closeout records.

If a criterion cannot pass because of an external blocker or missing user decision, report the exact evidence and unfinished scope. Do not describe the job as complete.

## Completion report

Keep the report concise and include:

- implemented behavior and plan path;
- files changed, marking which edits were delegated;
- the model tuple used for each delegated edit and each luna validation pass (with its verdict);
- user decisions that amended or clarified the plan;
- validation commands and outcomes mapped to the criteria;
- any genuine remaining blocker.
