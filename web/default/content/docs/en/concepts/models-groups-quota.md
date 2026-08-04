---
title: Models, groups, and quota
summary: How model IDs, access groups, and remaining quota work together on BoxAI.
section: concepts
order: 10
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Models

A **model ID** is the exact string you send in API requests. Discover IDs in [Model Hub](/pricing). Different providers may look similar in branding but use different IDs on the gateway.

## Groups

A **group** controls which models and rates your account can use. If a model appears in the public hub but your calls return permission errors, your group may not include that model.

## Quota

**Quota** is your remaining usage budget. Calls fail or are rejected when quota is insufficient. Top up via [Billing and top-up](/docs/console/billing-topup) and inspect consumption in [Usage logs](/docs/console/usage-logs).

## Practical checklist

- Copy model IDs from the hub, never from memory
- Confirm group access when debugging 403
- Watch quota before load tests

## Next

- [Model Hub](/docs/console/model-hub)
- [Errors and rate limits](/docs/api/errors)
