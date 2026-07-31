# Subagents (Superseded)

This original design sketch has been superseded. The implemented contract uses exact tool policies and supports one explicitly granted delegation layer: root → opted-in child → nested agent. Nesting is disabled by default, and nested agents cannot delegate again.

See [`subagents/README.md`](subagents/README.md) for the current public contract, including default-all and exact restricted tool modes, `allowSubagents`, tree-wide concurrency, cascading cleanup, tool fingerprints, atomic spawn-batch rejection, immutable result snapshots, UTF-8-safe pagination, and bounded terminal detachment.



