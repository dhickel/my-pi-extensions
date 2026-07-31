# Pi child-session SDK and nested lifecycle

## Topic

Current Pi SDK model lookup and safe ownership patterns for in-memory child sessions with one nested subagent layer.

## Source References

- `subagents/index.ts`
- `subagents/core.ts`
- Pi 0.80.8+ `AgentSessionServices` and `ModelRuntime` declarations
- `.internal-dev/bugs/subagent-launch-sdk-regression/report.md`

## Key Takeaways

- Pi 0.80.8 moved service-level model access from `services.modelRegistry` to `services.modelRuntime`. Child initialization must use `modelRuntime.getModel(provider, model)` and `modelRuntime.hasConfiguredAuth(provider)`. Extension command and tool contexts can still expose their own `modelRegistry`; the migration is scoped to `AgentSessionServices`.
- A child extension instance can receive parent-owned hierarchy state through a dedicated `EventBus` passed in `resourceLoaderOptions`. Emit configuration after services load and before child-session creation, attach exactly one nested manager, and reject ambiguous duplicate managers.
- Cancellation during asynchronous initialization needs an `AbortSignal` plus late-value cleanup. Racing the caller against abort is not enough: services or sessions that resolve after cancellation must be cleared, shut down, and disposed without starting a delegated task.
- Batch initialization should fail fast. The first real initializer failure aborts still-initializing siblings, disposes already-created handles, and terminalizes every reserved record before any task runs.
- Parent lifecycle owns descendants. Cancellation, normal completion, turn limits, initialization failure, reload, and shutdown must cascade into the nested manager. Re-evaluate cancellation state after asynchronous disposal so a completion observed before cleanup cannot overwrite a later cancellation.
- Share one coordinator across the hierarchy for capacity accounting, and clear terminal records' runtime handles after disposal. This prevents per-manager fan-out, retained sessions, duplicate release, and late state mutation.
- Runtime acceptance must load the root and child extension from the same discovered installation identity. Because exact fingerprints intentionally include `sourceInfo`, loading the root with an explicit repository `--extension` path while the child discovers a temporary symlink correctly reports different control-tool definitions even when both paths resolve to the same source bytes. Use one isolated agent directory and let both sessions discover its installed extension path.
- Provider-visible or model-recalled tool schemas can disagree with the registered TypeBox definition. Inspect `session.getAllTools()` to verify the runtime schema and state defaults directly in tool guidance. For `subagent_spawn` v0.5.0+, omitted `agents[].tools` selects every registered child-allowed ordinary tool; `[]` selects none, and a supplied nonempty list is a complete exact restriction. Explicit lists may activate registered tools that are inactive in the caller, but cannot conjure definitions absent from `pi.getAllTools()`. The standard coding harness exposes search/listing through `bash` rather than guaranteed standalone `grep`, `find`, or `ls` APIs. Subagent controls remain separately gated by `allowSubagents`.

## Project Relevance

These rules underpin the subagents extension's Pi 0.80.10 compatibility, explicit `allowSubagents` grant, tree-wide eight-agent cap, and bounded no-orphan local lifecycle. Reuse them when Pi SDK child-session setup or nested ownership changes.

## Open Questions

- Remote provider work can outlive local cancellation when the provider does not cooperate; Pi currently exposes no stronger universal termination guarantee.
