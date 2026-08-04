---
title: API authentication
summary: Authenticate gateway calls with Bearer keys or profile-specific headers and keep secrets server-side.
section: api
order: 20
audience: [developer]
updated: 2026-08-04
status: published
---

## Create a credential

Follow [Create and manage API keys](/docs/console/api-keys), then store the secret as an environment variable on your server.

## Common header

OpenAI-compatible routes:

```http
Authorization: Bearer $BOXAI_API_KEY
Content-Type: application/json
```

## Profile-specific auth

Some profiles use different schemes (for example `x-api-key` plus version headers for Claude Messages). Check the protocol page for the exact headers before integrating.

## Security rules

:::callout type="danger"
Do not ship API keys in browsers, mobile apps, or public clients. Use your backend as a trusted caller. Rotate immediately after any leak.
:::

## Verify success

Unauthenticated calls should fail with **401**. A valid key on an allowed model returns **200** for a minimal payload.

## Next

- [First request](/docs/start/first-request)
- [API overview](/docs/api/overview)
