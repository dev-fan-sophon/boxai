---
title: Getting started
summary: Create an API key, choose a model, and send your first gateway request on you-box.com.
section: start
order: 20
audience: [user, developer]
updated: 2026-08-04
status: published
checklist: [Create an account, Create an API key, Pick a model ID, Send a test request]
---

## Prerequisites
![Getting started guide](/doc-assets/screenshots/start/getting-started.en.webp "BoxAI getting started guide on you-box.com")


- A BoxAI account at [you-box.com](https://you-box.com)
- Enough quota for a small test call (top up if needed — see [Billing and top-up](/docs/console/billing-topup))

## Three steps to production

:::steps
1. Create and securely store an [API key](/docs/console/api-keys).
2. Choose an exact model ID that is available to your group in [Model Hub](/docs/console/model-hub).
3. Send requests to the BoxAI gateway and monitor status codes and [usage](/docs/console/usage-logs).
:::

## Make your first request

On BoxAI, use the production base URL `https://you-box.com`. Create a key in the dashboard, then copy an exact model ID from Model Hub.

```bash
curl "https://you-box.com/v1/chat/completions" \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'
```

Prefer a browser walkthrough? Follow [First request](/docs/start/first-request) in Playground, then switch to the API sample above for production.

## Keep credentials private

:::callout type="warning"
Never expose API keys in browser code, public repositories, screenshots, or logs. Call the gateway from your trusted server and rotate any leaked key immediately.
:::

## Verify success

- The API returns HTTP **200** with a `choices` (or protocol-equivalent) payload.
- Usage appears under [Usage logs](/docs/console/usage-logs) within a short delay.

## Next

- [First request (Playground + API)](/docs/start/first-request)
- [API overview](/docs/api/overview)
- [Streaming](/docs/api/streaming)
