---
name: exploration
description: Trigger this skill whenever the agent is about to explore, scout, scour, survey, map, trace, or summarize a codebase/document area across multiple files. Use for bigger-picture architecture maps, behavior/location searches, API/data-flow overviews, docs/tests/spec synthesis, and function/class logic summaries without loading every source file into root context. Runs 1–6 read-only deepseek/deepseek-v4-flash:max agents. Do not use for routine small edits or as a replacement for directly reading critical logic before implementation.
compatibility: Requires Pi with subagent_spawn, subagent_poll, and subagent_status; configured deepseek/deepseek-v4-flash with max thinking.
metadata:
  version: "1.0.0"
---

# Exploration

Use a small team of read-only exploration agents to survey a codebase, documents, specifications, tests, or logs and return concise, evidence-backed maps for the root agent. This skill is for context acquisition, not implementation.

## Trigger rule

If the root agent is about to *explore* rather than directly inspect one known file, strongly consider this skill first. Trigger it when the user says or implies: explore, scour, survey, map, trace, locate, find where, understand the architecture, get the bigger picture, summarize a module, summarize classes/functions, compare likely areas, inspect docs/tests/specs broadly, or identify where behavior lives.

Also trigger it proactively when the agent would otherwise need to read or skim many files just to orient itself. The purpose is to delegate broad scouting and receive compact summaries so the root context stays clean.

Do not trigger it for a simple targeted lookup where one `rg` and one or two direct `read` calls are enough. Do not use it to avoid directly reading critical code before edits.

## When to use

Use this skill when the root task would benefit from a broader picture before deciding where to focus, such as:

- understanding high-level architecture, module boundaries, package ownership, or system seams;
- locating where a behavior, route, command, workflow, event, model, or persistence rule is implemented;
- summarizing the logic shape of important functions, classes, packages, or documents;
- mapping data flow, request flow, lifecycle flow, or dependency relationships;
- comparing several candidate areas before choosing what the root agent should read deeply;
- scanning docs/specs/tests to summarize intended contracts and likely implementation touchpoints.

Do **not** use it automatically for every task. Avoid this skill when a direct `rg` and one or two `read` calls are enough, when the user only asked for a small targeted edit, or when the root already knows the relevant code.

## Non-replacement rule

Exploration summaries are orientation aids only. They do not replace root familiarity with critical code.

After the exploration returns, the root agent must directly read relevant files/symbols when:

- exact behavior, important relationships, data transformations, concurrency, security, persistence, migrations, or API contracts matter;
- making edits based on the finding;
- validating a bug diagnosis or acceptance criterion;
- resolving contradictions between exploration reports;
- the decision depends on nuanced control flow or edge cases.

Use exploration to decide where to look and to avoid context pollution, then load the necessary sister code into root context for real implementation decisions.

## Fixed model and tool contract

Every exploration subagent must be launched explicitly with:

- `provider`: `deepseek`
- `model`: `deepseek-v4-flash`
- `thinkingLevel`: `max`
- `tools`: `["read", "bash"]`

Never inherit, omit, downgrade, clamp, or substitute these values. Inherited caller model/provider/thinking is forbidden even if the caller is already DeepSeek. If `deepseek-v4-flash:max`, `subagent_spawn`, `subagent_poll`, or the exact read-only tool set is unavailable, do not emulate this skill with another model. Report the blocker and proceed with ordinary root inspection only if appropriate.

Exploration agents are read-only. They must not receive `edit`, `write`, subagent, sprint, user-questioning, or other root-only tools. They may use `bash` for `rg`, `find`, `ls`, lightweight parsing commands, and read-only inspections. They must not mutate files, install packages, run long builds, start services, or perform destructive commands.

## Choose team size

Use the smallest team that covers the uncertainty:

- **1 agent** — narrow behavior search, one package, one document family, or one symbol/class family.
- **2–3 agents** — medium feature area, architecture plus behavior lookup, or docs/tests/code comparison.
- **4–6 agents** — broad codebase or document survey with independent lenses.

Do not exceed 6 agents. Prefer fewer agents with clear scopes over a large generic swarm.

## Exploration approaches

Pick complementary approaches based on the task; do not spawn duplicate lenses.

Common lenses:

1. **Architecture map** — modules, packages, ownership boundaries, entry points, service/repository/controller/data-flow shape, major abstractions, and seams.
2. **Behavior tracer** — where a named behavior starts, how it flows, key branches, state changes, side effects, and relevant tests.
3. **Contract/doc synthesizer** — intended behavior from specs, docs, README files, AGENTS files, API docs, changelogs, and tests.
4. **Function/class logic summarizer** — purpose and algorithmic structure of selected classes/functions without pasting whole source into root context.
5. **Dependency and integration mapper** — inbound/outbound callers, data models, persistence tables/files, external APIs, configuration, events, or tool boundaries.
6. **Risk and gap scout** — likely edge cases, missing tests, TODOs, suspicious stubs/placeholders, drift between docs and code, and areas needing root verification.

## Build self-contained tasks

Each child receives no caller transcript. Every exploration task must include:

- the user objective and what the root needs to learn;
- repository-relative starting paths, symbols, route names, keywords, or documents to inspect;
- explicit lens and boundaries;
- whether to prioritize code, docs/specs, tests, history artifacts, or a mixture;
- what not to inspect if scope must stay bounded;
- expected output structure;
- instruction to cite file paths and relevant symbols/line anchors when available;
- instruction not to edit or mutate anything.

Do not paste large source files into the child task. Point agents to paths and search terms instead.

## Launch pattern

Use a single `subagent_spawn` batch with 1–6 agents. Give each a unique name.

```json
{
  "agents": [
    {
      "name": "explore-architecture-<unique>",
      "task": "<self-contained architecture exploration brief>",
      "provider": "deepseek",
      "model": "deepseek-v4-flash",
      "thinkingLevel": "max",
      "tools": ["read", "bash"]
    },
    {
      "name": "explore-behavior-<unique>",
      "task": "<self-contained behavior tracing brief>",
      "provider": "deepseek",
      "model": "deepseek-v4-flash",
      "thinkingLevel": "max",
      "tools": ["read", "bash"]
    }
  ]
}
```

## Required child output

Require every child to return concise Markdown with these headings:

- `Scope Inspected`
- `Search Strategy`
- `Findings`
- `Key Files and Symbols`
- `Relationships / Flow`
- `What Root Should Read Directly`
- `Uncertainties and Gaps`

The child should distinguish verified facts from inferences, avoid dumping large code, and cite paths. It should call out where root verification is required before edits.

## Poll and synthesize

After spawning, call `subagent_poll` until every exploration agent reaches a terminal state. If an agent fails, report the failure and synthesize only the remaining evidence; do not pretend the missing lens completed.

When a result is oversized or truncated, use `subagent_status` with `includeResults: true` or `resultPage` as needed to recover it before relying on it.

Then synthesize in the root context:

1. Identify agreement, conflicts, likely source-of-truth files, and next direct-read targets.
2. Keep the synthesis short and decision-focused.
3. Do not treat exploration as proof for exact implementation behavior; read critical files directly before editing or making high-stakes conclusions.
4. If the user asked only for exploration, report the synthesized map and recommended next files to inspect.
