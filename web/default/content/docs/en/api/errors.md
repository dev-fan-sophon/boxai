---
title: Errors, retries, and rate limits
summary: Classify failures, retry transient requests safely, and respect gateway limits.
section: api
order: 40
audience: [developer]
updated: 2026-08-04
status: published
---

## HTTP status categories

| Status             | Meaning                  | Action                                               |
| ------------------ | ------------------------ | ---------------------------------------------------- |
| 400, 422           | Invalid input            | Fix the request; do not retry unchanged              |
| 401, 403           | Auth or permission       | Verify key and model access                          |
| 429                | Rate limit               | Honor `Retry-After` when present; reduce concurrency |
| 500, 502, 503, 504 | Transient server/gateway | Retry only if the operation is safe to repeat        |

## Safe retry policy

Retry only idempotent requests or operations protected by an idempotency mechanism. Never automatically retry authentication, permission, or validation failures.

Use capped exponential backoff with random jitter, honor `Retry-After`, and set a small attempt limit. Cancel retries when the caller deadline or `AbortSignal` expires.

## Rate limits

When you receive **429**:

1. Back off according to `Retry-After` or your client policy.
2. Lower parallel in-flight requests.
3. Check [Usage logs](/docs/console/usage-logs) for hot keys or loops.

## Next

- [Streaming](/docs/api/streaming)
- [Authentication](/docs/api/auth)
