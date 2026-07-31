# Subagent tools schema omission launch failure

## Summary

A subagent launch without `agents[].tools` fails validation even when the model-visible schema appears not to expose that property, causing an avoidable retry for the safest no-tool child.

## Scope

`subagent_spawn` agent parameter schema and core spawn-batch normalization in the Pi subagents extension.

## Reproduction

1. Give an agent a model-visible `subagent_spawn` schema in which it does not recognize `agents[].tools`.
2. Let it submit an agent with only `name` and `task`.
3. Observe schema validation reject the call because `tools` is required.

## Expected

Omitting `tools` safely means no ordinary child tools, equivalent to `tools: []`. The schema and tool guidance make the default explicit. Supplying a malformed or unauthorized tool list still fails atomically.

## Actual

The launch fails with `agents.0.tools: must have required properties tools`, requiring the model to infer and retry with a property it believed `additionalProperties: false` excluded.

## Evidence

- User-provided agent trace shows the model-visible properties as `name`, `task`, model options, and `allowSubagents`, while validation reports missing required `tools`.
- Direct inspection of the currently installed Pi tool definition shows `tools` is present and required, indicating a model-view or stale-schema mismatch rather than omission from the source TypeBox schema.
- The prior core validator rejected every omitted `tools` value before normalization.
- In v0.3.1 the registered runtime schema requires only `name` and `task`; it still exposes `tools` with `default: []` and an explicit least-privilege description.
- Fresh-process acceptance captured an actual `subagent_spawn` call containing only `name` and `task`, then completed with `OMITTED_RESULT:completed:OMITTED_TOOLS_READY`.
- The complete subagents suite passes 79/79.

## Impact

No-tool delegation can fail before initialization and waste a model turn. Agents may also incorrectly conclude that explicit tool grants are unsupported.

## Status

Resolved and validated in v0.3.1 on 2026-07-21.

## Next Action

Archived. Reopen if an omitted `tools` field stops normalizing to the exact empty ordinary-tool set or provider-facing schema projection again obscures explicit grants.
