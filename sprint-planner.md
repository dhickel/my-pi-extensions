# Sprint Planner Suite

The original design sketch has been superseded by the living specification at [`.internal-dev/specifications/sprint-planner-suite.md`](.internal-dev/specifications/sprint-planner-suite.md).

The suite covers brainstorming, ironout, advanced phased planning, run-record discovery, read-only plan validation, versioned execution-evidence persistence, and the orchestrate skill. Complete command, tool, lifecycle, and operational documentation is in [`sprint-planner/README.md`](sprint-planner/README.md).

## Quick Reference

| Capability | Entrypoint |
|---|---|
| Full sprint planning | `/sprint` |
| Standalone brainstorm | `/brainstorm` or `sprint_brainstorm` |
| Standalone ironout | `/ironout` or `sprint_ironout` |
| Standalone advanced plan | `/advanceplan` or `sprint_advanceplan` |
| Plan validation | `sprint_validate_plan` |
| Execution evidence | `sprint_execution_record` |
| Run discovery | `/sprint list` |
| Run diagnosis | `/sprint doctor [run-id]` |
| Workflow orchestration | `/skill:orchestrate` |
