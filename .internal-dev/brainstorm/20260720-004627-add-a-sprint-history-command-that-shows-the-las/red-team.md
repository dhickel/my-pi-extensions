## Prompt

Red-team the supplied synthesis for a read-only `/sprint history` command, focusing on overlooked constraints, invalid assumptions, defects, and failure modes. This review evaluates only the synthesis and does not reconstruct the underlying worker reports.

## Source

- The supplied `<authoritative-synthesis>` only.
- Statements about current discovery, manifests, execution records, and filesystem helpers are treated as proposals or unverified assumptions unless the synthesis itself establishes them.

## Findings

### Contract-level problems

1. **“True newest five” is incompatible with approximate timestamps.** A planning-manifest `mtime` can change after completion through edits, restoration, migration, copying, or tooling. Mixing it with authoritative `completedAt` values cannot guarantee the actual five most recent completions. The defensible promise is “up to five records ordered by the best available completion evidence,” with approximation disclosed. The synthesis repeatedly claims exact selection despite lacking exact historical evidence.

2. **Completion authority is internally inconsistent.** It first makes discovery’s `state === "completed"` the qualification boundary, then calls an execution structured record authoritative, and treats absent planning state as normal cleanup. It does not define precedence when these sources disagree or explain how normal cleanup is distinguished from corruption. Reusing discovery is unsafe unless its classification semantics exactly match this contract.

3. **The artifact-count definition is not yet proven coherent.** A planning manifest artifact list and an execution “source-file inventory” may describe different concepts. The assertion that the latter “should correspond” to the execution manifest is an assumption, not a contract. The design also leaves duplicate entries, invalid paths, intentionally empty inventories, and partially malformed inventories unspecified. The UI should say `recorded-artifacts=` or otherwise make clear that it counts declarations, not extant files.

4. **Planning and execution may double-count one user initiative.** A unified timeline can show both stages of the same logical sprint, potentially crowding independent work out of the last five and repeating the same directive. Explicit kind labels do not resolve whether product intent is five persisted run records or five logical sprint activities.

5. **“No arguments” lacks error behavior.** The contract does not state what `/sprint history extra`, flags, or malformed whitespace do, nor whether usage errors are distinct from an empty history.

### Correctness and resilience gaps

6. **Concurrent reads do not produce a coherent snapshot.** A record can be completed, deleted, replaced, or enriched while the scan runs. Selecting winners before enrichment can yield fewer than five, stale entries, or metadata from a different file generation. The contract must choose best-effort snapshot semantics and define whether vanished winners are retained as degraded entries, dropped and backfilled, or cause a warning.

7. **Failure states are conflated with an empty store.** Missing root, inaccessible root, unreadable directories, all candidates being malformed, and genuinely no completed runs must not all produce `No completed sprint runs found…`. Otherwise operational failure appears as valid emptiness. Exit/status behavior and concise degradation summaries remain unspecified.

8. **Per-record tolerance can silently violate the headline promise.** If timestamp-less completed records are skipped, the result is not necessarily the last five completed records. The command should report omitted completed candidates, or the contract should explicitly permit an incomplete best-effort result.

9. **Timestamp validation is underspecified.** The proposal needs rules for invalid dates, missing timezone offsets, future timestamps, implausibly old values, sub-millisecond differences, and conflicting timestamps. Displaying minute precision while sorting at finer precision can make the visible order appear wrong.

10. **The tiebreaker may not be a total order.** A run ID alone is insufficient if planning and execution namespaces can contain the same ID or if duplicate discoveries are possible. Determinism also requires a specified bytewise comparator rather than locale-dependent ordering. Kind and canonical path may be needed as final keys.

11. **Full-store scanning creates an unbounded read/latency surface.** Exact-by-evidence selection requires inspecting every candidate, but no limits are proposed for candidate count, manifest size, record size, line length, or parser work. A corrupt or hostile project can cause excessive memory, latency, or output processing. Bounded reads and explicit oversize degradation are needed even if directory count remains uncapped.

### Filesystem and read-only assumptions

12. **“Reuse discovery” may conflict with both safety and purity.** Existing discovery could follow symlinks, acquire leases, repair state, update caches, or classify with weaker rules. A narrow read-only history module does not prove its transitive dependencies are read-only. Discovery must be audited or exposed through an explicitly pure read-only boundary.

13. **`lstat` followed by read is still vulnerable to replacement races.** “Reject symlinks” and “use no-follow reads” need descriptor-level semantics: open without following links where supported, verify the opened object is a regular file, and avoid path re-resolution. Platform support and fallback behavior must be defined. Direct-child string validation alone is insufficient.

14. **Symlink rejection does not establish full containment.** Hard links, bind mounts, unusual filesystem objects, and path replacement can still expose content outside the apparent tree. If the goal is merely to reject symlinks, say so; if it is security containment, the proposed controls are incomplete.

15. **A filesystem snapshot test is not a complete purity proof.** Reads can update access times, concurrent processes can change the tree, and transitive writes may occur outside the snapshotted directory. Tests should ignore atime or run on suitable mounts, instrument write-capable dependencies/syscalls, and separately assert no lease, repair, binding, or cache APIs are invoked.

### Parsing, output, and privacy gaps

16. **Manifest section extraction is more complex than stated.** `## Directive` and `## Artifacts` can appear in code fences, repeat, be malformed, contain nested headings, or use unexpected line endings. “First meaningful line” and inventory-entry grammar require exact definitions to avoid incompatible parsers.

17. **Directive text is untrusted terminal content.** Newlines, tabs, ANSI escapes, control characters, bidi controls, and very long Unicode grapheme sequences can corrupt the display or spoof adjacent fields. Whitespace normalization is not sufficient. Truncation should be based on display width or grapheme-safe rules, followed by terminal-safe sanitization.

18. **Cross-referencing execution runs expands exposure and ambiguity.** A source ID may be malformed, point outside the current store, refer to a non-completed plan, be reused, or resolve to a changed plan. The fallback also risks leaking directive content from a record the execution entry would not otherwise expose. Validation, trust boundaries, and whether the directive is historical or current must be explicit.

19. **Session-independent history has a privacy implication.** Directives may contain secrets or sensitive project details. Showing them across all project runs may be appropriate locally, but this is a user-visible expansion beyond metadata and should be consciously accepted rather than assumed harmless.

20. **Warnings are not optional polish.** “Summarize omitted/degraded entries if useful” is too vague for truthful output and stable tests. Define when a warning appears, whether counts reveal inaccessible records, and whether degraded entries consume one of the five slots.

## Options

1. **Best-evidence history with explicit honesty.** Show up to five run records ranked by authoritative timestamps where available and marked approximate fallback evidence otherwise. Define degradation and omission summaries. This is the closest viable version of the synthesis, but it must abandon the claim of the objectively newest five.

2. **Strict authoritative history.** Include only records with a validated authoritative completion timestamp. Ordering is defensible, but historical planning records without such timestamps disappear and the feature may return fewer than five.

3. **Separate exact and approximate groups.** Present authoritative records first and legacy approximate planning records in a separately labeled section. This avoids pretending that incomparable evidence forms one exact chronology, at the cost of losing a single unified “latest five” list.

4. **Defer unified history until the record contract is upgraded.** Add authoritative planning completion timestamps and a genuinely common artifact inventory in a separate record-format change, then implement history. This gives the cleanest future semantics but does not repair old records and delays the feature.

5. **Reduce the first version’s claims.** Use execution directives as `Source plan: <id>` and omit cross-record directive lookup initially. This lowers path, privacy, race, and parsing risk, but provides a weaker directive summary for execution entries.

## Trade-offs

| Choice | Benefit | Cost / risk |
|---|---|---|
| Best-evidence mixed chronology | Broad historical coverage | Cannot guarantee actual completion order |
| Strict authoritative timestamps | Truthful deterministic ordering | Excludes legacy planning completions |
| Unified planning/execution records | Simple activity feed | Double-counts related stages and mixes record semantics |
| Cross-plan directive lookup | More user-friendly summaries | Adds races, trust-boundary checks, privacy exposure, and failure modes |
| Declared inventory count | Stable without checking every artifact | May not mean the same thing by kind and does not prove files exist |
| Full scan | Avoids arbitrary directory cutoffs | Unbounded latency unless file reads and parsing are constrained |
| Preserve degraded winners | Better chronology coverage | Requires explicit unknown states and can display stale records |
| Backfill vanished winners | More consistently returns five rows | Result no longer corresponds to one scan snapshot |
| Strong no-follow handling | Reduces link and replacement attacks | Platform-specific complexity; still not complete filesystem containment |

## Open Questions

1. Is the product promise five persisted run records or five logical sprint activities?
2. Is “most recent” allowed to mean order by best available evidence, or must every listed record have an authoritative completion timestamp?
3. What is the exact precedence when discovery state, planning state, manifest, and execution record disagree?
4. How is legitimate planning cleanup distinguished from a missing or corrupt state record?
5. Does execution inventory actually enumerate artifacts, and are counts raw entries, valid entries, or unique canonical paths?
6. Do degraded or concurrently vanished records occupy one of the five slots, and are lower-ranked entries backfilled?
7. What status and output distinguish empty, missing, inaccessible, partially degraded, and wholly unreadable stores?
8. What are the maximum file sizes and parser limits, and how are oversized records reported?
9. What terminal-sanitization and Unicode truncation rules apply to directive summaries and IDs?
10. Is symlink rejection the complete security requirement, or is containment against hard links, mounts, and replacement races required?
11. Is disclosure of all project directives acceptable for a session-independent command?
12. What exact argument-validation, timestamp-format, precision, and total-sort-key contracts should tests enforce?

## Recommended Next Step

Do not promote the synthesis to an implementation plan yet. First revise the feature contract to remove the impossible “true newest five” guarantee for legacy planning records and explicitly define:

- record identity versus logical sprint identity;
- source precedence for completion and timestamps;
- a single demonstrably equivalent artifact-count meaning, or kind-specific labels;
- concurrency and degradation behavior, including backfill and warnings;
- empty versus unreadable-store outcomes;
- bounded parsing, terminal sanitization, and timestamp validation;
- transitive read-only and descriptor-level filesystem safety requirements.

The most defensible initial contract is “up to five completed run records ordered by the best available validated completion evidence,” visibly marking approximate times and reporting skipped completed candidates. If product requires the actual newest five, authoritative completion timestamps for all eligible record kinds are a prerequisite rather than an implementation detail.
