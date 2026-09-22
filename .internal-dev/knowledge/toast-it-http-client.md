# Toast-It HTTP Client Validation

## Topic

Pi registration, credential safety, and HTTP outcome validation for Toast-It.

## Source References

- `toast-it/core.ts`, `toast-it/index.ts`, `toast-it/test/`
- `specifications/toast-it-extension.md`
- Toast-It `docs/http-api.md`, `http/ApiToken.java`, `http/AgentHttpServer.java`
- Installed Pi `docs/extensions.md`, `docs/packages.md`, `docs/tui.md`

## Key Takeaways

- The documented generated credential length is 43 characters, but ApiToken
  accepts existing private base64url credentials of 43–128 characters. Match
  that implementation range while keeping bounded reads and strict storage checks.
- Pi marks execution errors by thrown exceptions, not by an `isError` property
  on returned tool objects. Throw only already-sanitized client errors.
- The HTTP guide describes successful tool envelopes universally, but
  `agent/web/WebToolCallback.java` returns plain objects for successful
  web_search/web_fetch callbacks. AgentHttpServer preserves them. Rejecting all
  non-envelope 200 objects would break complete discovered-tool coverage. Keep
  those objects as result data without fabricating execution-success metadata;
  the package README and regression tests track this source-contract mismatch.
- A Toast-It 202 envelope includes success-like booleans but means staging,
  not execution. Normalize it to explicit not-executed output with its ID.
- Approval `result` may be JSON encoded inside a string or plain text. Sanitize
  both forms; do not blindly parse it or infer mutation success from EXECUTED.
- Pi Text wraps words across terminal rows. Renderer tests must permit wrapped
  whitespace rather than asserting literal multiword substrings across rows.
- Installed Pi 0.85.0's direct unbundled loader import failed before loading the
  extension because `dist/experimental/server.js` imports absent
  `@earendil-works/pi-server`. The bundled CLI's offline `-e index.ts
  --list-models __toastit_validation_no_model__` path succeeds without that
  distribution dependency. Do not mistake the unbundled import failure for an
  extension error or change a global installation outside authorization.
- Typebox 1's static schema types do not necessarily expose JSON Schema option
  fields such as additionalProperties. Tests can inspect a narrowed structural
  JSON schema representation without weakening production tool types.

## Project Relevance

Use local HTTP fixtures and exact registry/loader evidence, not live mutations
or a model's self-report, to validate this integration. Keep registration
independent of service availability and never persist raw response details.

## Open Questions

Live provider interactions and Toast-It UI approval acceptance were not tested.
The installed Pi unbundled-distribution issue is outside this package's scope.
