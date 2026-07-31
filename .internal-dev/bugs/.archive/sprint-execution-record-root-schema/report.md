# Sprint execution record root schema

## Summary

The `sprint_execution_record` tool advertised a root-level JSON Schema union without an explicit object type, causing OpenAI-compatible providers to reject every turn while the extension was enabled.

## Scope

The defect was limited to the provider-facing parameter schema registered for `sprint_execution_record`.

## Reproduction

Enable the sprint-planner extension and send any message through `deepseek/deepseek-v4-pro`, whether or not the sprint tool is requested.

## Expected

The provider accepts the tool catalog and completes the turn.

## Actual

The provider returned HTTP 400 because `sprint_execution_record` had a root schema type of `null` instead of `object`.

## Evidence

`Type.Union([...])` serializes to a root `anyOf` with no `type`. Pi forwards TypeBox schemas directly to the provider. Adding `{ type: "object" }` as the union options retains the strict variants and emits a provider-compatible object root.

## Impact

All agent turns failed at request validation whenever the extension tool was present, including new sessions and turns that never called the tool.

## Status

Resolved and archived on 2026-07-19.

## Next Action

Keep the package regression assertion requiring an explicit object root on union-based function schemas.
