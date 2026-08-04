---
title: API overview
summary: One gateway base URL, multiple protocol profiles, and model IDs from Model Hub.
section: api
order: 10
audience: [developer]
updated: 2026-08-04
status: published
---

## Base URL

Production host:

```text
https://you-box.com
```

OpenAI-compatible chat example path:

```text
https://you-box.com/v1/chat/completions
```

Always call **BoxAI**, not an upstream provider URL, when you intend to use BoxAI keys and billing.

## Protocol profiles

BoxAI exposes multiple integration profiles (OpenAI Chat, Responses, Claude Messages, Gemini, embeddings, images, audio, and more). Each profile documents:

- HTTP method and gateway path template
- Auth header scheme
- Streaming support
- Ready-to-copy samples (cURL, Python, TypeScript, JavaScript)

Browse protocol pages in the **API** section of the sidebar. They are generated from the live integration catalog.

## Model IDs

Use exact IDs from [Model Hub](/pricing). Availability can depend on your group.

## Related guides

- [Authentication](/docs/api/auth)
- [Streaming](/docs/api/streaming)
- [Errors and rate limits](/docs/api/errors)
- [Getting started](/docs/start/getting-started)
