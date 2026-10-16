---
title: Files and media references
summary: Upload your own images, videos, and audio once, then reference them by file id in any generation request.
section: api
order: 50
audience: [developer]
updated: 2026-10-16
status: published
---

## Why upload instead of inlining

Generation requests accept media either as a public HTTPS URL or as a `file-<id>` handle from this API. Sending bytes **inside** the JSON body (base64 `data:` URLs) is what makes a request cross the upstream body limit: video providers reject a create-task body larger than 64 MB with `413`, and a reseller may report that as a generic gateway error. Upload once, then pass the handle.

Handles are owner-scoped: only the API key's user can read, download, or delete them.

## Upload a file

```bash
curl https://you-box.com/v1/files \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -F purpose=vision \
  -F file=@first-frame.png
```

```json
{
  "id": "file-1234",
  "object": "file",
  "bytes": 204800,
  "created_at": 1792163930,
  "filename": "first-frame.png",
  "purpose": "vision"
}
```

`multipart/form-data` with a `file` field is required. `purpose` is accepted for OpenAI compatibility; the returned purpose is derived from the sniffed content type (`vision` for images, `video`, `audio`, `user_data` for documents). The declared MIME type is only a hint — the content is sniffed, and an unsupported type is rejected with `400`.

Size caps per kind:

| Kind | Cap |
|------|-----|
| image | 10 MB |
| video | 200 MB |
| audio | 20 MB |
| document | 20 MB |

## Use a file in a request

Pass the handle anywhere a media URL is accepted — the relay swaps in a short-lived URL the provider can fetch:

```bash
curl https://you-box.com/v1/videos \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dreamina-seedance-2-5",
    "prompt": "slow push-in on @Image1, keep the subject identical",
    "duration": 5,
    "size": "1280x720",
    "first_frame": "file-1234"
  }'
```

Supported on video task requests (`/v1/videos`, `/v1/videos/text2video`, `/v1/videos/image2video`, `/v1/videos/{id}/remix`) for `image`/`images`, `first_frame`, `last_frame`, `input_reference`, `reference_images`, `reference_videos`, `reference_audios`, and on image requests (`/v1/images/generations`, `/v1/images/edits`) for `image`, `images`, and `mask`. A handle that does not exist, or that belongs to another account, fails with `400` before any quota is reserved.

## Retrieve, list, download, delete

```bash
curl https://you-box.com/v1/files/file-1234          -H "Authorization: Bearer $BOXAI_API_KEY"
curl "https://you-box.com/v1/files?limit=50"         -H "Authorization: Bearer $BOXAI_API_KEY"
curl https://you-box.com/v1/files/file-1234/content  -H "Authorization: Bearer $BOXAI_API_KEY" -o media.bin
curl -X DELETE https://you-box.com/v1/files/file-1234 -H "Authorization: Bearer $BOXAI_API_KEY"
```

Deleting a file removes both the record and the stored object; the response is `{"id": "file-1234", "object": "file", "deleted": true}`.

## Storage and lifetime

Files live in BoxAI's object storage for as long as the account keeps them, not for 24 hours: the handle stays valid, and the relay mints a fresh provider URL on every request. References are handed to providers as signed links, so uploads never make your bucket or files public.
