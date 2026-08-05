---
title: Usage logs
summary: Read request history, tokens, and status codes to debug billing and integration issues.
section: console
order: 40
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Open usage logs
![Usage logs table](/doc-assets/screenshots/console/usage-logs.en.webp "Filter by time, model, or status in Usage logs")


In the console, open **Usage** / **Logs** ([/usage-logs](/usage-logs) when signed in). Filter by time range, model, or status when available.

## What each row means

Typical fields:

| Field | Meaning |
|-------|---------|
| Time | When the gateway handled the request |
| Model | Exact model ID billed |
| Status | HTTP or gateway outcome |
| Tokens / quota | Amount consumed for the call |
| Key / client | Which credential or app was used (when shown) |

## Debug with logs

:::steps
1. Reproduce a failing call once.
2. Find the matching row by time and model.
3. Map status to the guide in [Errors and rate limits](/docs/api/errors).
4. Fix the request or key, then confirm a successful row appears.
:::

## Next

- [Errors, retries, and rate limits](/docs/api/errors)
- [API keys](/docs/console/api-keys)
