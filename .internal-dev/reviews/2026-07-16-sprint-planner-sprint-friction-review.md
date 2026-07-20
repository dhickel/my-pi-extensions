# Sprint Planner Sprint-friction Review

## Scope

Reviewed and patched the sprint-planner extension after the engine-alpha sprint run, focusing on per-phase plan correction, deterministic stage-boundary validation, missing-toolchain escalation, and same-session brainstorm cross-review. The existing agent-callable cross-review enforcement was also rechecked for concrete gaps.

## Findings

### Per-phase plan review

Root cause: `#sprintPlan` and `runStandaloneAdvancePlan` sent `concepts.md` and every phase to one `xhigh` reviewer and required one complete all-file rewrite. Cost and turn count therefore scaled with the whole plan in one conversation.

The corrective path now performs one `xhigh` concepts correction followed by one `xhigh` correction for each phase. A phase call receives corrected concepts, exactly one phase, and the phase-name index. The engine deterministically assembles component findings into `advanced-plan-review.md` and still publishes only `concepts.md` plus flat contiguous phase files.

### Structural stage gates

Root cause: typed submission validated individual call shape, but the engine had no explicit boundary checks for a complete findings set, synthesis source coverage, corrected handoff structure, or the real published plan directory.

Deterministic checks now run before the next stage. They name missing findings, headings, source paths, unexpected plan entries, nesting, and non-regular entries. Phase contracts now include `Context`, `Goal`, `In Scope`, `Out of Scope`, `Implementation Steps`, `Validation`, and `Exit Criteria` while retaining dependencies, constraints, required guides, and technical guidance.

### Toolchain user-action gate

Root cause: worker failures had no structured blocked state and child sessions could not ask the root user to install or expose a tool. Missing executables were indistinguishable from fatal worker errors and could lead later units into the same environment failure.

Implementation-mode children now expose `sprint_report_toolchain_blocker`. It returns a typed dependency, exact user command, and optional details. Full sprints pause, abort in-flight siblings, write a unit escalation artifact, leave the step pending without consuming its retry budget, and resume through `/sprint resume`. Standalone orchestration writes a review-store escalation and instructs the user to rerun because standalone workflows remain stateless.

### Cross-review continuation

The reported fresh-session cost was already addressed in the existing engine fix. Full runs reuse the finding step's persisted session path; standalone runs reuse a keyed in-memory `SessionManager`. Recreating the SDK `AgentSession` wrapper does not create a fresh conversation. Cross-review receives only the other reports, so the worker does not reread its own finding. Other parallel findings cannot be present in the initial worker context before they exist and must be ingested once. Added stronger full and standalone regression assertions; no production change was warranted.

## Risk Assessment

- Per-phase correction intentionally preserves the planner's phase file set. A phase reviewer cannot split or merge phases; the planner and concepts correction own that boundary.
- Structural validators prove artifact shape and explicit source references, not semantic completeness or coverage of every audit defect.
- Toolchain commands are worker-supplied, recorded, and shown to the user but never executed by the engine.
- Parallel siblings already in flight are aborted when a blocker arrives; no later scheduling group starts.
- Standalone orchestration remains rerun-only by the existing stateless-workflow decision.

## Recommendations

- Monitor real-run token and turn counts for the new concepts-plus-phase review fan-out.
- Keep required heading constants, prompts, specifications, and stage validators synchronized.
- Treat recurring semantic audit-coverage drift as a separate explicit identifier contract rather than expanding these structural checks into heuristic correctness review.

## Follow-ups

No implementation blocker remains. Revisit phase split/merge correction only if real plans show that planner output routinely requires cross-phase restructuring.
