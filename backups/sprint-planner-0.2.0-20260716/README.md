# Pi Sprint Planner Suite

An installable Pi package containing a deterministic planning extension and the separate `orchestrate` skill.

The extension exposes `/sprint`, `/brainstorm`, `/ironout`, and `/advanceplan`, plus the agent-callable `sprint_brainstorm` tool. It does not implement plans and does not register `/orchestrate`.

## Install

From this repository's root, register the coordinated packages in Pi's user settings:

```sh
pi install ./internal-dev
pi install ./user-questioning
pi install ./sprint-planner
pi list
```

Use `-l` on each install for project-local registration. Local-path packages remain linked to their source directories. The `sprint-planner` package manifest installs both `index.ts` and `skills/orchestrate/SKILL.md`.

If older manually copied versions of `internal-dev` or `user-questioning` still exist under `~/.pi/agent/extensions/`, remove or archive those copies first. Interactive ironout requires the current `user-questioning` package.

The `orchestrate` skill requires Pi's `subagent_spawn`, `subagent_poll`, `subagent_status`, and `subagent_cancel` tools. Ensure the subagent extension or equivalent tool provider is installed separately.

After installation or source updates, run `/reload` or restart Pi.

## Extension commands

- `/sprint [--name <slug>] [--agents 2..8] <prompt>` runs brainstorm → ironout → corrected advanced planning, then stops.
- `/sprint status|pause|resume|reset [run-id]` manages a persisted planning run. Reset confirms, deletes only the selected sprint record, and never reverts repository edits.
- `/brainstorm [--agents 2..8] <prompt>` runs findings → same-session all-to-all cross-review → synthesis → red team.
- `/ironout [--interactive|--auto] <prompt>`
- `/advanceplan <prompt>`

Bare start commands open Pi's editor. Input may be a plain request, pasted material, a path, or natural language referring to paths. The command layer preserves it as prompt text; planning agents interpret references with read-only project tools.

Standalone commands support `status` and `cancel`, use in-memory child sessions, and publish only after all planning model work succeeds.

## Orchestrate skill

Invoke the separate skill explicitly or ask Pi to execute a complex workflow or plan:

```text
/skill:orchestrate Implement .internal-dev/plans/my-plan
```

The skill can interpret a user-presented workflow, checklist, plan file, or phased plan directory. It builds a dependency graph, defaults to sequential work, and permits parallel waves only for dependency-ready phases with known non-overlapping write areas.

Its fixed delegated model contract is:

- implementation and repair: `deepseek/deepseek-v4-pro` at `max`;
- independent validation of every phase and final integration: `openai-codex/gpt-5.6-sol` at `xhigh`.

The skill must not substitute another model or thinking level. It performs an atomic model preflight before edits and stops with the concrete error if either tuple is unavailable. The current local model registry must therefore provide GPT-5.6 Sol before the skill can implement work.

Unlike the former engine-owned orchestration, the skill does not claim background persistence, durable checkpoints, or `/sprint resume` behavior.

## Brainstorm lifecycle

The engine waits for every `findings.md`, continues each original worker session with every other finding, waits for every `cross-review.md`, and only then starts synthesis. A missing or failed cross-review stops the workflow; no partial standalone brainstorm is published.

Root agents call `sprint_brainstorm` for the same engine-owned lifecycle. Generic manual subagent coordination is not equivalent to this mandatory cross-review barrier.

## Planning and structural gates

Advanced-plan correction uses one `xhigh` concepts review and one independent `xhigh` corrective review per phase. Each phase reviewer receives corrected `concepts.md`, exactly one phase, and the phase-name index. The published plan contains only `concepts.md` plus flat contiguous `phase-NN-*.md` files; component reviews remain outside `planning/`.

Lightweight deterministic gates verify required headings, synthesis source coverage, corrected handoff structure, and plan directory shape. Contract failures identify the missing heading or path and stop publication.

## Storage and recovery

Trusted projects must have a ready `.internal-dev` store. Planning runs live under `.internal-dev/sprints/<run-id>/`; `planning/` contains only corrected concepts and phase files. `.state.json` and `.sessions/` exist only while incomplete and are removed after successful plan publication.

State version 2 contains planning stages only. Version-1 runs from the former implementation pipeline cannot be resumed with this package version; `/sprint reset [run-id]` remains available for cleanup and does not revert repository edits.

Reload, shutdown, or crash marks running work interrupted and never launches model calls automatically. `/sprint resume` revalidates planning artifact hashes, reopens recorded planning sessions, and continues from the first incomplete or invalid planning checkpoint.

## Test

```sh
npm --prefix sprint-planner test
```
