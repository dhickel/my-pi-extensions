# Toast-It Pi Extension

## Ownership

`toast-it/` is a private Pi package containing a toolkit-independent HTTP client,
Pi registration/rendering, README, and isolated node:test coverage. It does not
change the Toast-It Java repository, global Pi settings, or live application
configuration/data. The authoritative protocol is Toast-It's `docs/http-api.md`
and its `AgentHttpServer`, `ApiToken`, and `ToolResultEnvelope` implementations.

## Interface

Register `toastit_tools`, `toastit_call`, `toastit_approval`, and `toastit_health`
synchronously with no network or background resources at factory time.
Discovery returns paged summaries or one exact complete schema. Generic calls
verify names against fresh discovery and forward exactly `{"arguments":{...}}`
to POST `/api/v1/tools/{name}`. Domain validation and authorization remain
server-owned. Every discovered tool is available without a hard-coded allowlist.
No arbitrary URL, method, headers, wrapper metadata, or self-approval is exposed.

## Configuration and credentials

Default base is `http://127.0.0.1:47631/api/v1`. `TOAST_IT_HTTP_URL` permits only
that literal loopback host or localhost with a valid local port and the exact
base path. Pin localhost to IPv4. Refuse redirects and bypass proxy dispatchers.
`TOAST_IT_CONFIG_ROOT` overrides `${XDG_CONFIG_HOME:-$HOME/.config}/toast-it`.
Roots must be absolute, owned, not group/other-writable, and without linked path
components. Read `http-api.token` in-process per request; require owned regular
0600 storage, no linked leaf, and server-valid 43–128 base64url characters.
Never put credentials in parameters, output, logs, exceptions, or result details.

`TOAST_IT_TIMEOUT_MS` defaults to 20000, integer range 1000–60000, covering each
whole operation. `TOAST_IT_OUTPUT_BYTES` defaults to 24576, integer range
2048–51200. Empty settings fall back; invalid settings fail without value echoes.

## Outcomes and bounds

200 success, unavailable, and failure envelopes are distinct. The implementation
also returns non-empty plain success objects for conditional web tools, despite
the HTTP guide's universal envelope wording; preserve these as result data with
an explicit no-execution-envelope summary, not fabricated success metadata.
202 is explicitly
not executed, with approval ID and instructions for Toast-It UI review. Approval
status is a single GET with no polling loop; PENDING/APPROVED are not confirmed
execution, and EXECUTED still requires inspecting the stored result.
Never retry automatically. Errors after dispatch warn of uncertain mutation
outcome and require state reads rather than repeating mutations.

Bound outgoing bodies to 64 KiB and incoming body consumption to 256 KiB.
Compact JSON and UTF-8-safe text limits bound model output, preserving outcome
summaries and explicit truncation notices. Complete schemas are refused instead
of truncated. No raw payload is persisted in details or temp files. Redact token
text, credential fields, bearer text, and nested serialized approval results
before any return or error. Rendering never echoes call arguments.

## Validation

Use synthetic temporary config roots, private test tokens, and local HTTP
servers. Cover catalog completeness/pagination, exact wrapper forwarding,
approval states, credential and redirect boundaries, proxy bypass, errors,
timeouts/cancellation, UTF-8 bounds, and Pi registration/rendering. Strict
TypeScript and node:test are required. A real Pi offline-loading smoke check
complements registration tests. Never use live Toast-It data as a test fixture.
Live UI approvals and provider conversations are separately reported limitations.
