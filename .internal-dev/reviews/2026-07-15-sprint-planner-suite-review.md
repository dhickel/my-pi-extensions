# Sprint Planner Suite Implementation Review

## Scope

Reviewed the new sprint planner suite, the `internal-dev` sprint-store extension, the user-questioning event-bus service, command parsing, safe storage, recovery state, typed worker protocol, Pi runner, documentation, and fake-runner tests.

## Findings

- Exact provider/model/thinking routes are centralized and tested, including DeepSeek `max`.
- The engine owns sequencing and enforces synthesis, correction, repair, escalation, and final validation gates.
- Full runs use atomic versioned state and resumable Pi sessions; standalone runs use in-memory sessions and delayed publication.
- Published plan directories are flat and implementation request metadata is limited to concepts, the assigned phase, and required guides.
- Resume revalidates hashes and invalidates downstream checkpoints after the first mismatch.
- Reset is confirmed, path-bounded, symlink-safe, and independent of state parsing.
- Pi's package manager lists `internal-dev`, `user-questioning`, and `sprint-planner` as user-scoped packages, and RPC command discovery reports all five suite commands with package origin.
- A live installed `/ironout --auto` run completed both the configured `high` author and `xhigh` corrective-review calls, published a signed handoff, and left no standalone runtime state.
- The first live attempt exposed OpenAI's 64-character `prompt_cache_key` limit. Child-session IDs are now bounded to that limit and covered by a regression test; the repeated installed run succeeded.
- Command and editor inputs remain opaque workflow prompts. The command layer performs no filesystem probing or plan-directory expansion; regression tests preserve multiline formatting, accept 10,000-character prompts, and verify that standalone orchestration delegates referenced-file selection and reading to its agents.
- Local model metadata contains both required model ids.

## Risk Assessment

The main operational risk is provider behavior: a model can fail to call the typed submission tool or produce invalid content, which deliberately consumes the bounded retry budget and pauses. Hard process loss between external repository edits and the next state transition can cause a resumed implementer to re-check or repeat work; persisted conversation context and review gates reduce but cannot eliminate that external side-effect boundary.

## Recommendations

- Keep submission schemas and prompts versioned with the state format.
- Re-run fake-runner and regression suites whenever Pi's session or extension APIs change.
- Review model ids and supported thinking levels before upgrading beyond Pi 0.80.7.

## Follow-ups

- No known blockers remain for the implemented specification.
