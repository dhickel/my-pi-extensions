# Deferred Features

Record accepted capabilities that are intentionally deferred.

## Named advanced-planning configuration selection

- Status: accepted and deferred.
- Capability: select among additional schema-conforming model-assignment files registered under `sprint-planner/configs/`.
- Current boundary: extension initialization always loads the registered `default` configuration. No command, tool, environment, project, or caller parameter selects a configuration.
- Preconditions: define configuration ownership, selection scope, validation, persistence/resume semantics, and the compatibility policy before exposing a selector.
- Source: user direction on 2026-08-04.
