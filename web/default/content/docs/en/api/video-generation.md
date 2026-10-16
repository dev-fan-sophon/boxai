---
title: Video generation (Seedance)
summary: Submit, poll, and download Seedance video tasks, including reference images, videos, audio, and first/last frames.
section: api
order: 60
audience: [developer]
updated: 2026-10-16
status: published
---

## Models

| Model ID                | Duration | Resolution  | Reference images / videos / audio |
| ----------------------- | -------- | ----------- | --------------------------------- |
| `dreamina-seedance-2-5` | 4–30 s   | 720p, 1080p | 30 / 10 / 10                      |
| `seedance-2-0`          | 4–15 s   | 720p, 1080p | 9 / 3 / 3                         |
| `seedance-2-0-fast`     | 4–15 s   | 720p        | 9 / 3 / 3                         |
| `seedance-2-0-mini`     | 4–15 s   | 720p        | 9 / 3 / 3                         |

Audio may be referenced on its own for Seedance 2.5; on the 2.0 family an audio reference needs an image or video reference alongside it.

## Submit a task

```bash
curl https://you-box.com/v1/videos \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dreamina-seedance-2-5",
    "prompt": "a red apple on a wooden table, slow push-in, warm light",
    "duration": 5,
    "size": "1280x720"
  }'
```

```json
{
  "id": "task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u",
  "object": "video",
  "model": "dreamina-seedance-2-5",
  "status": "queued",
  "progress": 0,
  "created_at": 1792163473
}
```

`HTTP 200` means the task was accepted, not that the video exists yet. Keep the `id`.

### Parameters

| Field                        | Type            | Notes                                                                            |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `model`                      | string          | One of the model IDs above                                                       |
| `prompt`                     | string          | Required. Describe scene, motion, camera, and light                              |
| `duration` / `seconds`       | integer         | Seconds of output; ranges above                                                  |
| `size`                       | string          | `1280x720`, `720x1280`, `1920x1080`, or a ratio via `metadata.ratio`             |
| `metadata.ratio`             | string          | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`                                      |
| `metadata.resolution`        | string          | `720p` or `1080p`; defaults to the tier your `size` implies                      |
| `metadata.generate_audio`    | boolean         | Native synchronized audio (on by default)                                        |
| `metadata.seed`              | integer         | Reproducible generation                                                          |
| `metadata.watermark`         | boolean         | Provider watermark                                                               |
| `image` / `images`           | string \| array | Image-to-video: the first frame (up to 9 images on 2.0, 30 on 2.5)               |
| `first_frame` / `last_frame` | string          | Frame-guided generation; both require `metadata.ratio: adaptive` on Seedance 2.5 |
| `reference_images`           | array           | Reference images, addressed as `@Image1`, `@Image2`, …                           |
| `reference_videos`           | array           | Reference videos, addressed as `@Video1`, …                                      |
| `reference_audios`           | array           | Reference audio, addressed as `@Audio1`, …                                       |

Media may be a public HTTPS URL or a `file-<id>` handle from [Files and media references](/docs/api/files). Reference media and first/last frames are mutually exclusive. Do not inline base64 media: a create-task body over 64 MB is rejected with `413` before the provider is called.

## Poll and download

```bash
curl https://you-box.com/v1/videos/task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u \
  -H "Authorization: Bearer $BOXAI_API_KEY"

curl -L https://you-box.com/v1/videos/task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u/content \
  -H "Authorization: Bearer $BOXAI_API_KEY" -o clip.mp4
```

Poll every 5–15 seconds. A 5-second 720p clip typically takes 3–7 minutes; the status moves `queued` → `in_progress` → `completed`, and a failed task reports `error.message`. Always download the finished file and check its actual duration and resolution. Poll the same `id` after a timeout — never resubmit a task you already own.

## Errors

| Status        | Meaning                                                            | What to do                                                                |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `400`         | Invalid parameter, unsupported combination, or unknown `file-<id>` | Fix the request; nothing was charged                                      |
| `401` / `403` | Missing or unusable key, banned account, insufficient quota        | Check the key and balance                                                 |
| `413`         | Request body too large                                             | Send media as URLs or file handles, not base64                            |
| `429`         | Rate limited                                                       | Wait and retry with backoff                                               |
| `502`         | The upstream provider refused the submission                       | Retry with backoff; the request is replayed automatically before it fails |

Billing is per generated video token and settles when the task finishes; a failed task is refunded. See [Errors, retries, and rate limits](/docs/api/errors) for the gateway-wide contract.
