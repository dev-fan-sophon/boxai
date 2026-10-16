---
title: Image generation
summary: Generate and edit images with GPT Image, Grok Imagine, Seedream and Gemini image models.
section: api
order: 74
audience: [developer]
updated: 2026-10-16
status: published
---

## Request

Image generation is an OpenAI Images call on the same key as every other endpoint:

```text
POST https://you-box.com/v1/images/generations
Authorization: Bearer <BOXAI_API_KEY>
```

```json
{
  "model": "seedream-5.0",
  "prompt": "A minimalist travel poster of a beach at sunrise, flat illustration",
  "aspect_ratio": "16:9",
  "resolution": "2k",
  "n": 1
}
```

Images come back as `data[]` entries with either a `url` or a `b64_json` payload. Send reference
images for an edit with `POST /v1/images/edits` (multipart) or by passing `image` (one) and
`images` (several) on the generation call, which is what the Studio does.

## Per-model options

Every model accepts the same OpenAI shape; each family reads the options it understands and the
gateway rejects the rest with a 400 before the upstream is called.

| Family       | Models                                                         | Size control                                                                                                                                                  | Other options                                                                                         |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Seedream     | `seedream-5.0`                                                 | `aspect_ratio` (or the upstream `size`) — `auto`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `2:1`, `1:2`, `3:1`, `1:3`, `21:9`, `9:21` | `resolution` `1k`/`2k`, `n` 1–4, up to 10 reference images                                            |
| Gemini image | `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`             | `aspect_ratio` — the ten standard ratios plus `4:1`, `1:4`, `8:1`, `1:8`                                                                                      | `resolution` `1K`/`2K`/`4K`, `quality` = thinking level `minimal`/`medium`/`high`, one image per call |
| GPT Image    | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2` | `size` as `WIDTHxHEIGHT`                                                                                                                                      | `quality`, `background`, `output_format`, `n`                                                         |
| Grok Imagine | `grok-imagine-image-2.0`                                       | `aspect_ratio`                                                                                                                                                | `resolution` `1k`/`2k`, `quality`, up to five references                                              |

`GET /api/playground/image-capabilities?model=<model>&group=<group>` returns the same contract as
JSON (family, size mode, allowed sizes, ratios, resolutions, qualities, `maxN`,
`maxReferenceImages`, defaults), which is how the Studio builds its controls.

## Billing

Image calls are billed per delivered image at the model's fixed price, so a request that comes
back with fewer images than `n` settles down to what actually arrived. Token-billed image models
are charged from the usage the upstream reports.

## Notes

- `n` is capped per family (Seedream 4, Gemini image 1, GPT Image and Grok Imagine 10) and larger
  values are rejected with a 400 instead of being silently reduced.
- Reference images accept public URLs or full `data:image/...;base64,...` URLs.
- For video, see [Video generation](/docs/api/video-generation).
