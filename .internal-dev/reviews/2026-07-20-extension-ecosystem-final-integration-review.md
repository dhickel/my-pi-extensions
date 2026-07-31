# Extension Ecosystem Final Integration Review

## Scope

Final cross-package integration validation for the nine-phase sprint-planner ecosystem hardening plan. Inspected sprint-planner planning, validation, leases, execution records, orchestration policy, subagent exact-tool and lifecycle behavior, internal-dev initialization/content validation, package manifests, public documentation, and final criteria in `concepts.md`.

## Findings

- All four required deterministic package suites pass: sprint-planner 199, subagents 70, internal-dev 66, and user-questioning 12.
- Package dry-run archives and direct external-import-to-peer-dependency checks pass. Public package versions and documented tool surfaces are coherent.
- Repaired an integration mismatch: the orchestrate skill requires retaining returned source identity and hashes, but `sprint_execution_record start` exposed only `runId` and `revision`. The tool now returns a detached copy of the persisted immutable source descriptor, with focused assertions and matching specification/README updates.
- Corrected subagent documentation to match the actual fingerprint inputs, including prompt guidance and source metadata.
- Corrected both ecosystem-hardening changelog Git sections to the repository baseline `462622124ae7ac3c5539423621ba3dfe0c453412`.
- The active hardening source plan is accepted legacy input but fails the current version-1 structured validator with phase goal, dependency, and write-target cross-consistency findings. Per the plan's own phase-09 edge-case policy, its historical bytes were not rewritten.
- No preserved evidence exists for the required isolated eight-worker brainstorm → ironout → advance-plan → orchestrate acceptance pipeline. `.internal-dev/sprints/` contains no planning or execution records, and current reviews/changelogs explicitly state that this criterion was not completed.

## Risk Assessment

The deterministic implementation and package integration checks are healthy after repair. The legacy source-plan incompatibility is expected transition evidence rather than permission to rewrite accepted history. However, the missing provider-backed acceptance record is an explicit final criterion in `concepts.md` and an exit criterion in phase 09. Without source before/after hashes, reload inspection, durable phase PASS checkpoints, and durable final integration PASS for that isolated run, a repository-state PASS would overstate validation.

## Recommendations

- Run the required isolated eight-worker acceptance pipeline through the installed sprint-planner, subagents, and orchestrate resources.
- Preserve its planning and execution records, source hashes before and after orchestration, reload inspection evidence, all phase PASS checkpoints, and integration PASS.
- Re-run final integration and confirm the worktree diff and all four package suites before recording terminal PASS.

## Follow-ups

Final verdict remains BLOCKED solely on the absent provider-backed acceptance evidence. No deterministic test, package, API, specification, or documentation defect remains known after the recorded repairs.
