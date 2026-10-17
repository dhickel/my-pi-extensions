# Tileset Lab implementation preflight

## Scope

Model-free workflow bootstrap for the authorized Tileset Lab implementation in `/home/dhickel/AI/Workspaces/Pi-extensions`, while the caller remains in `/home/dhickel/Assets/tilesets`. This review concerns SDK artifact creation, not application or native-painting validation. No Tileset Lab implementation files were created during this preflight.

## Findings

The executable `/tmp/tileset-lab-workflow/internal-dev-create.mjs` reads one JSON argument object on stdin and invokes the actual `internal_dev` tool loaded from the target repository's `internal-dev/index.ts`. Pi 1.1.0 on Node 24.18.0 supplies the real target-bound tool context through its registered-tool wrapper; the helper supplies no fabricated tool context, assistant message, or transcript. It explicitly validates arguments with Pi's installed `validateToolArguments` before execution.

Pi's actual `resolveProjectTrusted` resolver returned trusted because the target has no protected project resources. This is Pi's documented no-resource branch, not a saved user approval or a helper-created approval. The global trust file is absent; no trust decision was written. In-memory settings begin untrusted and receive only the resolver's decision. If protected resources later require unavailable approval, the helper refuses creation and requests a saved `/trust` decision in the target workspace.

The actual tool status confirmed the target store is ready. Only the actual internal-dev extension is loaded. Argument-schema, initialization-action, traversal-path, absolute-path, and incomplete-heading probes were rejected; invalid content created no requested parent directory. The helper disables catalog refresh and network model discovery, uses empty in-memory credential storage and no models.json, disables cache warming, creates no persistent session, and records no transcript messages. Fetch and socket-connect tripwires recorded zero attempted calls. Agent core provides its own `unknown/unknown` unconfigured sentinel; no real model was selected or requested. Bound sessions explicitly await one real quit `session_shutdown` emission before disposal, including failing probes.

The installed SDK wrapper adapts context only; it does not dispatch `tool_call`, `tool_result`, or normal tool execution events. Direct wrapped execution is adequate here because the helper refuses sessions with interception handlers and loads no external permission extension. The actual internal-dev execute method still owns its trust check, `withFileMutationQueue`, Markdown validation, path protections, local Git evidence lookup, and exclusive `wx` publication. Changelog HEAD normalization remains owned by that actual path; no second artifact or changelog was created to test it during this one-review authorization.

## Risk Assessment

The helper is a narrow local bootstrap, not a public SDK extension or general-purpose tool framework. It does not provide a model-issued transcript or interception-hook pipeline. Network tripwires and offline configuration are not an operating-system sandbox. Cross-process non-overwrite safety comes from the actual tool's exclusive publication; the SDK mutation queue coordinates within its process. The temporary helper uses exact installed implementation module paths and must be rechecked after a Pi upgrade.

## Recommendations

Use the executable helper only for explicit complete-content records in the target store. Pass paths relative to the selected kind's store, so this review's request path is `tileset-lab-implementation-preflight.md`, not `reviews/tileset-lab-implementation-preflight.md`. For changelogs, omit `Git Commit` or leave it empty so the actual tool fills the current target HEAD. Do not use a source-level creator clone, direct artifact writes, fabricated contexts, invented assistant history, or automatic trust overrides. Preserve the existing eight modified and three untracked upstream files.

## Follow-ups

The caller owns subsequent implementation records, Tileset Lab implementation, full application tests, and visual native-painting validation. Verify duplicate creation is refused and this review remains byte-identical before closing the bootstrap. Record reusable SDK lessons in the appropriate knowledge artifact during the caller's later authorized record phase.
