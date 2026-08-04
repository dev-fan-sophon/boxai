---
title: Streaming
summary: Process incremental server-sent events and cancel interrupted requests safely.
section: api
order: 30
audience: [developer]
updated: 2026-08-04
status: published
---

## Server-sent events

For OpenAI-compatible HTTP endpoints, request streaming in the payload and read each SSE data frame as it arrives. A data frame containing `[DONE]` ends the stream.

Do not assume every protocol uses the same event shape. OpenAI-compatible, Claude, and Gemini profiles expose protocol-specific chunks and finish events. See the matching protocol page in the sidebar.

## Cancellation and cleanup

Use `AbortController` to cancel fetch when the user leaves, stops generation, or a deadline expires. Stop parsing, release the reader, and treat a deliberate abort differently from a network failure.

```typescript
const controller = new AbortController()
const response = await fetch(url, { ...options, signal: controller.signal })
// Later: controller.abort()
```

## Next

- [Errors, retries, and rate limits](/docs/api/errors)
- [API overview](/docs/api/overview)
