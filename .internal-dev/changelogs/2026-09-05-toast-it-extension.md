# Toast-It Private Pi Package

## Date

2026-09-05

## Git Commit

040c066fac57643ae8f42f09a61597769bd8f86c

Baseline HEAD; changes are uncommitted.

## Change Summary

Added the complete private `toast-it/` Pi package with on-demand authenticated
HTTP discovery/invocation, one-shot approval status, health, fixed offline
registration, concise rendering, strict client safety, focused tests, and README.
No senior/helper agents were launched. All repository edits are in Pi-extensions;
Toast-It Java source/docs and global Pi settings were not modified.

## Files

- `toast-it/package.json`, `package-lock.json`, `tsconfig.json`
- `toast-it/core.ts`, `index.ts`, `README.md`
- `toast-it/test/core.test.ts`, `test/extension.test.ts`
- `.internal-dev/specifications/toast-it-extension.md`, `index.md`, `decisions.md`
- `.internal-dev/knowledge/toast-it-http-client.md`
- `.internal-dev/reviews/2026-09-05-toast-it-extension.md`

## Behavioral Impact

Registers toastit_tools, toastit_call, toastit_approval, and toastit_health.
Requests target only loopback /api/v1 with private file-backed authentication;
no arbitrary transport controls, retries, startup networking, or polling loops.
Enforces 64 KiB requests, 256 KiB response consumption, operation deadlines,
cancellation, UTF-8 model bounds, redaction, and no hidden raw output retention.
202 explicitly reports not executed and routes human review to Toast-It UI.

Final source review found that conditional WebToolCallback successes are plain
JSON objects despite the HTTP guide's general envelope wording. Preserve these
as result data without fabricated execution-success metadata. Regression tests
and the package README document this discrepancy. ApiToken accepts existing
43–128 character credentials, broader than its generated 43-character format;
client validation matches the implementation range.

Validation:
- `npm run check` in toast-it: strict TypeScript PASS, node:test 31/31 PASS.
- `npm test` in web-search: 4/4 PASS, no source changes.
- Installed Pi 0.85.0 bundled CLI offline explicit `-e ./index.ts` loading:
  PASS using --list-models with an intentionally unmatched filter, no model call.
- Registration/rendering tests exercise the exact four tools and throw-based
  Pi error behavior using synthetic HTTP fixtures.
- `git diff --check`: PASS; final scope review found only package/record changes.

## Specification Impact

New independently owned Toast-It extension specification, indexed alongside
existing suites; durable generic-discovery choice recorded in decisions.md.
Existing planner behavior/specifications were not changed.

## Risks

No live Toast-It mutations, provider conversation, or human UI approval flow
was exercised. A dispatched manager mutation can survive client cancellation;
errors warn and no automatic retry is attempted. Token access grants the API's
ordinary mutation permissions; same-user Pi tools are not sandboxed.

Direct import of the installed Pi 0.85.0 unbundled loader failed on an absent
@earendil-works/pi-server distribution dependency, before loading this package.
The bundled CLI path succeeds. This unrelated global installation was not
modified; evidence and the validation alternative are recorded in knowledge.

## Follow-up Items

User may enable/restart the Toast-It API and explicitly install the package
with `pi install /home/dhickel/AI/Workspaces/Pi-extensions/toast-it`, or use
`pi -e /home/dhickel/AI/Workspaces/Pi-extensions/toast-it/index.ts` immediately.
Persistent global configuration remains outside this pass's write authority.
