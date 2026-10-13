---
title: First request
summary: Send a successful chat completion from Playground or curl, then confirm usage.
section: start
order: 30
audience: [user, developer]
updated: 2026-08-04
status: published
checklist:
  [
    Open Playground or prepare curl,
    Select a model,
    Send Hello,
    Confirm 200 or visible reply,
  ]
---

## Goal

Complete one successful model call so you know billing, keys, and routing work end to end.

![First request flow](/doc-assets/screenshots/start/first-request-flow.svg 'Key → model ID → gateway request → HTTP 200')

## Option A — Playground (fastest)

![Playground successful chat](/doc-assets/screenshots/playground/chat-success.en.webp '1. Open Playground → pick a model → send Hello')

:::steps

1. Sign in and open [Playground](/playground).
2. Pick a model that your group can access (same IDs as [Model Hub](/pricing)).
3. Send a short message such as `Hello`.
4. Confirm you see an assistant reply without an error banner.
   :::

## Option B — API (production shape)

1. Create a key in [API Keys](/docs/console/api-keys) and export it as `BOXAI_API_KEY`.
2. Copy an exact model ID from Model Hub (do not invent aliases).
3. Run:

```bash
curl "https://you-box.com/v1/chat/completions" \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'
```

## Verify success

| Check       | Expected                                                     |
| ----------- | ------------------------------------------------------------ |
| HTTP status | `200`                                                        |
| Body        | Includes model output (`choices` for OpenAI-compatible chat) |
| Console     | A new row in [Usage logs](/docs/console/usage-logs)          |

## Common failures

| Symptom          | Fix                                                                              |
| ---------------- | -------------------------------------------------------------------------------- |
| `401` / `403`    | Check the key, Authorization header, and model access for your group             |
| `400` / `422`    | Fix JSON shape or model ID; do not retry unchanged                               |
| `429`            | Slow down; see [Errors and rate limits](/docs/api/errors#http-status-categories) |
| Empty model list | Confirm group permissions or top up quota                                        |

## Next

- [Streaming](/docs/api/streaming)
- [Errors, retries, and rate limits](/docs/api/errors)
- [API authentication](/docs/api/auth)
