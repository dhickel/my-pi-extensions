# Pi User Questioning Extension

Install it as a Pi package from the repository root with `pi install ./user-questioning` (or add `-l` for project-local registration).

This extension adds two interactive, root-session-only tools to Pi 0.80.7:

- `ask_user_choices` asks one to three option-based questions and always supplies an internal `Other` choice.
- `ask_user_text` opens Pi's multiline editor for the uncommon case where meaningful options cannot express the needed nuance.

One question uses a simple option list. Multiple questions use tabs plus a review/submit tab, and every question must be answered before submission. Escape cancels the whole questionnaire except while editing `Other`, where it returns to the option list. Cancellation discards partial answers. `optionIndex` values are zero-based indexes into the model-supplied options.

Terminal UI is the primary interface. RPC mode uses Pi's sequential `select`, `input`, and `editor` dialogs. JSON and print modes return explicit non-interactive results instead of attempting to prompt.

Other extensions can request the same UI in the root session through the shared Pi event bus. Import `requestRootQuestion`, or emit the versioned `QUESTION_SERVICE_REQUEST_CHANNEL` protocol directly. Responses are correlated by request id, requests are serialized so dialogs never overlap, and print/JSON sessions fail explicitly. This keeps root-only questioning tools out of child agents while allowing a deterministic workflow engine to pause for user input.

The companion subagents extension excludes both tools from child allowlists. Consequently their definitions, schemas, and prompt guidance are absent from every child session, including senior-advisor delegates.

## Test

```sh
npm test
```
