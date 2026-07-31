---
name: image-viewing
description: Delegates image inspection to openai-codex/gpt-5.6-sol at medium reasoning and returns a detailed, request-focused visual summary. Use only when image analysis is required and the current model is known not to support image input; never use when the current model can view images or when its capability is merely uncertain.
compatibility: Requires Pi with the read, subagent_spawn, subagent_poll, and subagent_status tools, configured authentication for openai-codex/gpt-5.6-sol, medium reasoning support, and each image available to the child as a readable local file.
metadata:
  version: "2.1.0"
---

# Image Viewing

Delegate visual inspection to one fixed vision-capable subagent, then return its description to the caller.

## Mandatory trigger gate

Use this skill only when both conditions are true:

1. The task requires inspecting one or more images.
2. The current model is known to lack image-input capability, based on Pi model metadata, an explicit user/platform statement, or an image-input rejection.

Do not invoke this skill when the current model supports images. Do not invoke it merely because image capability is uncertain; verify capability first using available model metadata or other direct evidence.

## Image access requirement

The vision subagent receives no caller transcript or prior attachments. Every image must therefore be available as a readable local file and identified by path in the delegated task.

- Prefer image paths explicitly supplied by the user, including `@path` references.
- Resolve relative paths against the current working directory and pass clear paths to the child.
- For multiple images, label them in the same order used by the user's request.
- Do not substitute a similarly named file or search unrelated locations.
- If an image exists only as an inline attachment and no readable path can be established, do not claim it was inspected. Explain that this subagent interface cannot transfer a prior inline attachment and request a local file path or saved copy.

## Fixed execution contract

Always launch exactly one subagent with `subagent_spawn` using:

- `provider`: `openai-codex`
- `model`: `gpt-5.6-sol`
- `thinkingLevel`: `medium`

Never inherit, omit, downgrade, or replace these values. Do not attempt the visual analysis in the caller's non-vision context.

If the required tools, model, authentication, reasoning level, or image files are unavailable, report the concrete blocker. Do not silently fall back to another model.

## Exact tool policy

The subagent implementation validates every spawn batch atomically before any child initializes. If any requested tool is unregistered, forbidden, duplicated, or fingerprint-mismatched, the complete batch is rejected and no child starts. A registered tool does not need to be active in the caller: naming it in the exact allowlist enables it for the child.

The vision subagent is inspection-only. It receives exactly:

```json
"tools": ["read"]
```

It must not receive edit, write, bash, subagent, sprint, user-questioning, or any other tools. Excluded tool definitions and guidance never enter child context.

## Build the visual-analysis task

The child receives only its delegated task. Include all of the following:

1. The absolute or unambiguous path of every image, with labels when there are several.
2. The user's exact analysis goal: what to find, describe, compare, transcribe, diagnose, or verify.
3. Relevant context needed to interpret the image, without unrelated conversation history.
4. The requested output depth and format.
5. A requirement to call `read` on every listed image before answering.

Use a task shaped like this:

```text
You are the vision analyst for a caller whose current model cannot accept images.

Images:
- Image 1: <path>
- Image 2: <path, if any>

Analysis request:
<what the user wants found, described, compared, transcribed, or checked>

Relevant context:
<only context needed to interpret the images>

Instructions:
- Use the read tool on every listed image before drawing conclusions.
- Focus on the analysis request, but provide enough visual context to make the answer understandable.
- Report visible text accurately and preserve important spelling, numbers, labels, and layout.
- Distinguish direct observations from interpretations.
- Identify ambiguity, unreadable regions, occlusion, or low-confidence details instead of guessing.
- When multiple images are supplied, identify which image supports each observation and make requested comparisons explicit.
- Do not edit files or perform unrelated work.

Return a detailed, self-contained summary that the caller can relay directly.
```

Choose a short, unique subagent name such as `vision-<scope>` and launch:

```json
{
  "agents": [
    {
      "name": "vision-<unique-scope>",
      "task": "<complete visual-analysis task>",
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "thinkingLevel": "medium",
      "tools": ["read"]
    }
  ]
}
```

## Poll and return the result

After spawning, call `subagent_poll` until the vision subagent reaches a terminal state. Do not leave it running after answering.

### Oversized result recovery

When a visible result is truncated, use `subagent_status` with `includeResults: true`. Follow the returned stable result identity and cursor chain:

1. Collect UTF-8-safe page bytes in cursor order.
2. Concatenate pages byte-for-byte, never by string slicing.
3. Verify the final digest matches the complete-result digest.
4. Verify the reconstructed byte count matches the complete-result byte count.
5. Confirm completion metadata and terminal identity are consistent before consuming the reconstructed report.

Invalid or stale cursors, digest mismatch, or byte-count mismatch block that evidence path. Do not infer missing text or repoll it as a new result.

When the result arrives (direct or reconstructed):

1. Confirm the reported provider, model, and thinking level are `openai-codex`, `gpt-5.6-sol`, and `medium`.
2. Return the subagent's requested description or findings clearly and preserve its uncertainty qualifiers.
3. Do not add visual claims that the subagent did not report.
4. If useful, organize the returned material for readability without changing its meaning.
5. If the run fails, report the concrete failure. Retry only for a clearly transient failure or a correctable path/task error; never use a different fallback model.
