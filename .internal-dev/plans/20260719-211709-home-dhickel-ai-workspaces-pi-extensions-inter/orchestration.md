## Scope Size
**Size**: large
## Phase Ledger
- phase-01-deterministic-planning-contracts.md | depends: none | targets: sprint-planner/commands.ts, sprint-planner/validation.ts, sprint-planner/prompts.ts, sprint-planner/types.ts, sprint-planner/engine.ts, sprint-planner/pi-runner.ts, sprint-planner/index.ts, sprint-planner/test/core.test.ts | goal: Establish deterministic identifiers and command lifecycle behavior, complete synthesis coverage, pre-freeze decomposition and cross-consistency validation, and read-only plan validation.
- phase-02-planning-engine-reliability.md | depends: phase-01-deterministic-planning-contracts.md | targets: sprint-planner/engine.ts, sprint-planner/pi-runner.ts, sprint-planner/prompts.ts, sprint-planner/types.ts, sprint-planner/test/core.test.ts | goal: Make scope-local fan-outs, causal retries and resume accounting, context transfer, and corrective reviews failure-safe.
- phase-03-run-leases-list-and-doctor.md | depends: phase-02-planning-engine-reliability.md | targets: sprint-planner/artifacts.ts, sprint-planner/run-records.ts, sprint-planner/commands.ts, sprint-planner/engine.ts, sprint-planner/index.ts, sprint-planner/core.ts, sprint-planner/types.ts, sprint-planner/test/core.test.ts | goal: Centralize safe run discovery, paths, ownership, schemas, and exclusive leases for list and read-only doctor behavior.
- phase-04-durable-execution-records.md | depends: phase-03-run-leases-list-and-doctor.md | targets: sprint-planner/execution-records.ts, sprint-planner/artifacts.ts, sprint-planner/index.ts, sprint-planner/core.ts, sprint-planner/types.ts, sprint-planner/test/core.test.ts | goal: Persist versioned execution-only orchestration evidence without moving implementation into the planner.
- phase-05-exact-subagent-tool-policy.md | depends: none | targets: subagents/core.ts, subagents/index.ts, subagents/package.json, subagents/test/core.test.ts | goal: Enforce complete exact child tool policies atomically at spawn.
- phase-06-subagent-results-and-shutdown.md | depends: phase-05-exact-subagent-tool-policy.md | targets: subagents/core.ts, subagents/index.ts, subagents/test/core.test.ts | goal: Add reconstructable result pagination and bounded non-cooperative child termination.
- phase-07-internal-dev-content-and-init.md | depends: none | targets: internal-dev/core.ts, internal-dev/index.ts, internal-dev/contract.ts, internal-dev/test/core.test.ts, internal-dev/README.md, .internal-dev/AGENTS.md | goal: Validate and normalize artifact content by kind, preserve exclusive creation, and make initialization explicit and concise.
- phase-08-skill-policy-integration.md | depends: phase-04-durable-execution-records.md, phase-06-subagent-results-and-shutdown.md, phase-07-internal-dev-content-and-init.md | targets: sprint-planner/skills/orchestrate/SKILL.md, sprint-planner/test/core.test.ts, skills/senior-agent/SKILL.md, skills/image-viewing/SKILL.md | goal: Align orchestration and specialist skills with deterministic tools, exact permissions, authoritative PASS barriers, and validator-owned repair without a separate repair loop.
- phase-09-specifications-docs-and-integration.md | depends: phase-08-skill-policy-integration.md | targets: .internal-dev/specifications/sprint-planner-suite.md, .internal-dev/specifications/decisions.md, .internal-dev/knowledge/sprint-planner-runtime-contracts.md, .internal-dev/changelogs/extension-ecosystem-hardening.md, sprint-planner/package.json, subagents/package.json, internal-dev/package.json, user-questioning/package.json, sprint-planner/README.md, sprint-planner.md, subagents/README.md, subagents.md | goal: Reconcile package manifests, intended contracts, durable decisions, and public documentation, then complete full integration validation.
## Execution Waves
- wave-01: phase-01-deterministic-planning-contracts.md, phase-05-exact-subagent-tool-policy.md, phase-07-internal-dev-content-and-init.md
- wave-02: phase-02-planning-engine-reliability.md, phase-06-subagent-results-and-shutdown.md
- wave-03: phase-03-run-leases-list-and-doctor.md
- wave-04: phase-04-durable-execution-records.md
- wave-05: phase-08-skill-policy-integration.md
- wave-06: phase-09-specifications-docs-and-integration.md
## Model Assignments
- Implementation: deepseek/deepseek-v4-pro:max
- Validation: openai-codex/gpt-5.6-sol:medium
- Implementers: exactly one implementation agent per phase
## Validation Gate
- Gate: post-phase validator review-and-repair must PASS before a phase is complete.
- Dependencies: no dependent phase starts before every dependency has PASS.
## Final Integration
- Integration: after all phases PASS, run final integration validation with openai-codex/gpt-5.6-sol:medium.
