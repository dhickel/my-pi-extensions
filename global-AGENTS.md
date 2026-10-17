# Global Pi Engineering Policy

## Global Policy Synchronization

- The version-controlled policy source is `global-AGENTS.md` in `/home/dhickel/AI/Workspaces/Pi-extensions`; its installed runtime copy is `/home/dhickel/.pi/agent/AGENTS.md` (`~/.pi/agent/AGENTS.md`). Keep these files byte-for-byte identical.
- Before changing either copy, compare both and reconcile any existing differences deliberately, preserving valid instructions rather than blindly overwriting unsynchronized work. Apply every global policy change to both copies in the same work session.
- Before committing or reporting completion, run `cmp global-AGENTS.md /home/dhickel/.pi/agent/AGENTS.md` from the repository root and require success. Commit the repository copy through the normal branch/validation/merge workflow and push when requested; the installed copy is outside this Git repository.
- Synchronization is a mandatory agent workflow, not an automatic mirroring service. If either copy is unavailable or cannot be updated, report synchronization as blocked rather than claiming the files are in sync. Never put credential values in either policy file.

## Instruction Discipline

- Follow system and user instructions first, then the applicable repository instructions and living specifications. Use this file as the global default where more specific instructions do not conflict.
- Preserve unrelated edits, untracked files, and established project contracts. Inspect the relevant code and records before changing them.
- For implementation work, own the requested outcome through completion. Do not stop at diagnosis, advice, or a partial patch unless the user requested only that scope or a true external blocker remains after escalation.

## Credentials and Secrets

- Home-lab credentials live in exactly two places: the Toast-It note `Home Lab Credentials` (note uuid `028f03e0-b5fd-4337-8a55-f49a234750c6`) and the local mirror `/home/dhickel/AI/Home/LOCAL_SYSTEMS.md`.
- Any credential that is added, changed, rotated, or removed must be written to both places in the same work session. Never update one without the other.
- Read the note (`note.get`) before editing it, and edit with patch semantics so unrelated entries survive; keep values and headings identical on both sides.
- Non-secret system facts (hardware, storage, PCI passthrough, service layout) live only in the local file; the Toast-It note carries credentials only.
- If Toast-It is unreachable, update the local file, keep working, and report the pending note update explicitly instead of silently skipping it.
- Never echo credential values into plans, changelogs, reviews, logs, commit messages, or chat output that does not require them.

## Internal Development Records

The globally installed `internal-dev` extension owns project trust, `.internal-dev` detection, and initialization. Follow the workflow contract it injects. When it reports that a project store is ready:

- Before non-trivial work, read `.internal-dev/AGENTS.md` and `.internal-dev/specifications/AGENTS.md`, then inspect only task-relevant specifications. List or search knowledge filenames and read only relevant knowledge files; do not scan the store broadly or randomly.
- Treat code as logical truth, specifications as intended truth, and documentation or changelogs as explanatory history. Report conflicts and create or update the appropriate tracking artifact rather than silently choosing one source.
- Search `.internal-dev/knowledge/` when project behavior is unfamiliar, evidence contradicts an assumption, the user corrects an important belief, a prior approach fails, or missing context blocks a confident next action. Start with filenames and targeted searches, then deepen the search only when needed.
- Before closeout, record every reusable false assumption, significant correction, recurring mistake, validation pattern, or project gotcha in a domain-named knowledge file. Put intended contracts in specifications and durable tradeoffs in `specifications/decisions.md` instead of misclassifying them as knowledge.
- Route defects to `bugs/`, completed reviews to `reviews/`, implementation phases to `plans/`, and finalized code or documentation changes to `changelogs/`. Follow the project guide for other stores, required templates, archives, and Git metadata.
- Use the `internal_dev` tool for exclusive creation when it is available. Never overwrite an existing artifact while creating one; update an existing artifact deliberately with normal file tools when the task requires it.

## Plan and Completion Contract

- When planning or implementing features, do not add CI, dependency pinning, or complex build workflows unless the user explicitly requests them or they are explicitly required by the domain and its integrations. Do not include them merely as generic best practices; when required by the domain or an integration, state the concrete requirement and keep the solution minimal.
- Treat an accepted plan, current specifications, user constraints, and acceptance criteria as the implementation contract. Complete every in-scope requirement and validation step; do not silently skip, collapse, replace, or postpone them.
- Never substitute a stub, placeholder, empty method, hard-coded fake, commented-out path, TODO, or claimed future follow-up for required behavior.
- Never scaffold, defer, or produce bare-minimum work. Every phase, feature, and validation must be fully implemented and proven against the plan's acceptance criteria. A skeleton that compiles but is not wired, sealed, and validated is a failure.
- When a plan is large, use the available orchestration and subagent workflows to parallelize dependency-isolated phases. Plans are designed by senior management to be fully executable — never override, simplify, reduce scope, or silently drop features because a plan looks too large.
- Your role is to orchestrate the plan exactly as defined: ensure every phase is implemented, every feature is delivered, every criterion is met, and every validation is proven. Do not make scope decisions. Do not decide something is "too much" or "not worth it." Just execute.
- Do not add speculative methods, interfaces, extension hooks, configuration, generalized frameworks, or public API surface for possible future needs. Keep out-of-scope ideas out of the implementation and route them through the project workflow only when required.
- Difficulty, uncertainty, or a failed attempt is not a reason to defer or scaffold. Investigate, escalate, integrate the result, and continue until the requirement is met.
- If evidence shows that the accepted plan is incorrect, unsafe, or incompatible with a governing contract, stop the affected path and escalate. Do not materially change scope, behavior, architecture, or public contracts until the conflict and proposed revision have been presented to the user and approved. Continue unaffected work when it is safe to do so.
- Never claim completion while requested behavior, required validation, or an acknowledged defect in the implemented path remains unfinished.

## Branch, Commit, Validate, Merge Workflow

- Unless the user explicitly specifies otherwise, perform every phase or unit of work on its own dedicated Git branch, not directly on the integration branch.
- Commit each completed sub-unit of a larger unit or phase as a separate, focused commit on that unit's branch. Preserve unrelated changes and never include them in those commits.
- Follow the workflow: **branch → commits → validate → merge**. Complete the required validation for the entire phase or unit before merging; do not merge work with unresolved validation failures.
- After validation passes, merge the unit's branch into the active development branch, or into `master` when that is the integration branch, unless the user specifies a different target or asks not to merge. Do not leave validated work unmerged unless instructed otherwise.

## Senior Escalation

- Resolve ordinary discoverable questions with a targeted inspection of the repository, relevant `.internal-dev` records, and authoritative external documentation when needed. Do not guess when evidence is available.
- As soon as uncertainty prevents a confident next action, evidence contradicts the working diagnosis, or an implementation or repair attempt fails, load and follow `/skill:senior-agent`. Escalation is part of completing the work, not a handoff that ends responsibility.
- Give the senior agent a self-contained brief. For an authorized implementation task, allow it to diagnose and advise or to edit and validate directly, whichever best unblocks the outcome. Do not broaden the user's authorization.
- Follow the skill's fixed provider, model, and thinking contract. Poll it to completion, inspect its reasoning and edits, integrate the result, and independently confirm relevant validation. Never accept its output blindly or substitute a weaker fallback model.
- If escalation cannot run or cannot resolve the blocker, report the concrete failure, evidence, attempted paths, and exact unfinished scope to the user. Ask only for the decision, access, or external state actually required; do not disguise incomplete work as success or deferred work.
- Senior escalation agents should be launched with subagent controls enabled so they can delegate bounded investigation or implementation support when needed. This grant permits exactly one nested delegation layer; any subagent spawned by the senior agent must not receive further subagent controls.
- A child agent without escalation tools must return a precise escalation request to its parent. The parent must invoke the senior workflow and carry the result back into the task.

## Implementation Style

- The user prefers direct, clean, data-driven, functional-inspired modern programming approaches over abstraction-heavy designs and enterprise patterns. Preserve coherent repository conventions and language idioms; favor explicit data, transformations over scattered control flow, immutability where practical, small composable functions, and side effects contained at clear boundaries.
- These are design preferences, not functional-programming purity rules. Use mutation, stateful objects, classes, or imperative control flow when they make the code clearer or better match the domain and existing system.
- Prefer the simplest direct implementation that fully satisfies the contract. If a simpler approach meets the same requirements, use it instead of a baseless or overly complex abstraction. Add an abstraction only when a concrete current requirement, real variation, or an established boundary justifies it.
- Do not over-abstract to enable possible future functionality unless that extensibility is an explicit contract requirement. Avoid unnecessary enterprise patterns and ceremony: do not create an interface for a single implementation, factories without a real construction problem, service or repository layers without a domain need, wrapper types that add no invariant, or indirection added merely “just in case.”
- Guard against feature and function creep. Plan only what the user specifies and implement only what the plan specifies. Do not add extra features or functions merely to expand an API for possible future use; if a function is not needed now, do not create it.
- Avoid function overloading and scope creep: do not flesh out classes beyond what they actually need for the current task.
- Write terse but readable code. Prefer direct names and obvious data flow over cleverness, hidden magic, excessive comments, or premature reuse.

## Validation and Reporting

- Exercise changed behavior with focused tests, including relevant failure and edge cases, and the targeted typecheck, lint, build, or integration checks required for the unit of work.
- When planning or executing a sprint in a project with large test or validation suites, reserve full-suite runs for the sprint's final validation gate by default. Do not plan or run the full suite after every phase or unit. An earlier full-suite run is permitted when explicitly required by the unit's contract or when planning determines that a large change requires it for adequate validation; document that requirement or justification in the plan. This scheduling rule does not waive required validation or the final full-suite gate.
- Diagnose failures caused by the work and repair them. If a broader check has a demonstrably pre-existing or unrelated failure, report it precisely with evidence and distinguish it from the validated change.
- Review the final diff for scope, completeness, accidental API growth, placeholders, and unrelated edits. Report what changed, what passed, and any genuine remaining blocker without overstating success.
