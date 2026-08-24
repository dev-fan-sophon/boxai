---
name: generating-boxai-videos
description: Generates and monitors asynchronous videos with the official BoxAI Media MCP tools. Use when a user asks to create, animate, render, or check a video through BoxAI.
license: Apache-2.0
---

# Generating BoxAI Videos

Use the `boxai-media` MCP server provisioned by BoxAI Connect. Video generation
is asynchronous: starting a task is not completion.

## Workflow

1. Call `list_media_models` before the first generation in a session.
2. Use `default_video` unless another advertised video model is needed.
3. Prepare a shot-oriented prompt covering subject, action over time, scene,
   camera movement, framing, lighting, style, and ending state.
4. Call `generate_video` with:
   - `prompt` — required temporal and visual instructions.
   - `model` — a video model returned by `list_media_models`; omit for the
     account default.
   - `seconds` — requested duration when known.
   - `size` — requested frame dimensions when known.
   - `metadata` — only documented vendor-specific options the user needs.
5. Extract the returned task id. Do not describe the video as generated yet.
6. Call `get_video_status` with `task_id` until the task reaches a terminal
   state. Use reasonable intervals and avoid rapid polling.
7. On completion, return the final video URL or output metadata. On failure,
   report the terminal error rather than continuing to poll.

## Prompt guidance

- Describe motion and camera behavior explicitly; a static image description
  is not enough.
- Keep one coherent shot unless the user asks for cuts or a sequence.
- State the desired first frame, progression, and final frame for controlled
  animation.
- Preserve exact Vietnamese text and diacritics when visible copy is required.
- For revisions, keep successful timing and composition constraints while
  changing only the requested elements.

## Failure handling

- If no video model is available, tell the user the BoxAI account currently
  has no provisioned video model.
- If the task remains non-terminal, report the current status and task id; do
  not invent an ETA.
- Do not automatically restart failed, quota-rejected, or billed tasks without
  the user's confirmation.
