---
title: Create and manage API keys
summary: Issue a key, set limits, copy the secret once, and use it only from trusted servers.
section: console
order: 10
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Prerequisites

- Signed-in BoxAI account
- Permission to manage keys for your workspace

## Create a key

:::steps
1. Open **API Keys** in the console ([/keys](/keys)).
2. Choose **Create** and give the key a clear name (for example `prod-server`).
3. Set optional limits if shown (quota, IP, model scope).
4. Confirm creation and **copy the secret immediately** — it is shown only once.
:::

Store the secret in your server environment as `BOXAI_API_KEY` (or your secret manager). Never commit it to git.

## Use the key

Most OpenAI-compatible routes expect:

```http
Authorization: Bearer $BOXAI_API_KEY
```

Some protocol profiles (for example Claude Messages) use `x-api-key` instead. See the matching page under [API](/docs/api/overview).

## Rotate or revoke

- Rotate when a key may have leaked, a teammate leaves, or a client is decommissioned.
- Revoke unused keys instead of leaving long-lived secrets active.
- After rotate, update every server that still holds the old value before revoking.

## Keep credentials private

:::callout type="warning"
Never put API keys in browser bundles, mobile apps, public repos, screenshots, or support tickets. If a key leaks, revoke it and create a new one.
:::

## Verify success

- You can list the key in **/keys** (secret hidden).
- A test call with the secret returns **200** (see [First request](/docs/start/first-request)).

## Next

- [First request](/docs/start/first-request)
- [API authentication](/docs/api/auth)
- [Usage logs](/docs/console/usage-logs)
