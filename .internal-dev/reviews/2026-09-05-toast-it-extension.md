# Toast-It Extension Implementation Review

## Scope

Root-owned review of new `toast-it/` package, its tests and README, and associated
living records. No delegated or senior-agent review was launched. Toast-It source
and global Pi settings were read-only/outside write scope.

## Findings

- Fixed offline registration exposes the full discovered API through generic
  calls with exact wrappers, not arbitrary HTTP controls.
- Verified 202 staging versus 200 success/failure and single-check approval status.
- Final source review caught the HTTP guide's envelope mismatch: successful web
  callbacks return plain JSON objects. Added generic no-envelope data handling
  and regression tests for both current web shapes; no Java source was changed.
- Checked credential rereads, POSIX ownership/permissions, linked-path rejection,
  direct loopback dispatch, redirect refusal, cancellation, and bounded bodies.
- Checked redaction before result/error output; no hidden raw payload in details.
- Corrected test-only Typebox option typing and whitespace-sensitive renderer
  assertions during validation. Production strict typecheck and all 31 package
  tests pass; the existing web-search suite passes all four tests. The installed
  bundled Pi CLI loads the extension offline without errors.
- Existing installed Pi unbundled loader import is blocked by a missing external
  distribution package; bundled CLI loading works. No global repair was attempted.

## Risk Assessment

No known unfinished client behavior in the requested scope. Timeout/cancellation
cannot guarantee rollback of a dispatched server mutation; the client warns and
never retries automatically. Same-user Pi tools are not isolated from each other.

## Recommendations

Load with `pi -e` or explicitly install the package through Pi, enable the API in
Toast-It, and use health/discovery before user-authorized application operations.

## Follow-ups

Live provider conversation and human Toast-It UI approval acceptance remain
unexercised. Persistent global installation is an explicit user action because
this pass only authorized edits to the sibling repository.
