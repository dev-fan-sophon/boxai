---
name: generating-boxai-images
description: Generates images with the official BoxAI Media MCP tools and returns usable outputs. Use when a user asks to create, illustrate, render, or iterate on an image through BoxAI.
license: Apache-2.0
---

# Generating BoxAI Images

Use the `boxai-media` MCP server provisioned by BoxAI Connect.

## Workflow

1. Call `list_media_models` before the first generation in a session.
2. Use `default_image` unless the user requests a capability that another
   advertised image model provides.
3. Turn the request into a concrete visual prompt that preserves every user
   constraint: subject, composition, environment, style, lighting, palette,
   camera or perspective, and required text.
4. Call `generate_image` with:
   - `prompt` — required visual instructions.
   - `model` — an image model returned by `list_media_models`; omit for the
     account default.
   - `n` — only the number of distinct outputs the user needs.
   - `size` and `quality` — only when requested or supported by the model.
5. Return the generated URL or payload and briefly identify which requested
   variation it represents. Do not claim success if the tool returned an
   error or no output.

## Prompt guidance

- Put the core subject and action first.
- State aspect ratio or dimensions through `size` when exact framing matters.
- Quote exact visible copy and ask for legible typography; preserve the user's
  language and spelling.
- For revisions, describe the delta and keep unchanged constraints explicit.
- Do not add logos, people, text, or cultural details the user did not request.
  For Vietnam-oriented work, preserve Vietnamese diacritics exactly.

## Failure handling

- If no image model is available, tell the user the BoxAI account currently
  has no provisioned image model.
- If a model is rejected, refresh with `list_media_models` and retry only with
  an advertised model.
- If a safety or provider error occurs, report it accurately and ask for the
  smallest necessary prompt change.
- Do not loop on billing, quota, or repeated provider failures.
