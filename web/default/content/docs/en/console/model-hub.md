---
title: Model Hub
summary: Find exact model IDs, compare pricing and capabilities, then use those IDs in API calls.
section: console
order: 20
audience: [user, developer]
updated: 2026-08-04
status: published
---

## What Model Hub is

[Model Hub](/pricing) is the public catalog of models available through BoxAI: prices, modalities, and integration hints. Always copy the **exact model ID** shown in the hub — do not invent short names.

## Pick a model
![Model Hub catalog](/docs/screenshots/console/model-hub.en.webp "1. Browse models on Model Hub")

![Model detail with exact ID](/docs/screenshots/console/model-hub-detail.en.webp "2. Copy the exact model ID from the detail page")


:::steps
1. Open [Model Hub](/pricing).
2. Filter by provider, modality, or price if needed.
3. Open a model detail page and copy the model ID.
4. Confirm the model is available to **your group** (some models are group-gated).
:::

## Use the ID in requests

```json
{
  "model": "YOUR_MODEL_ID",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

Gateway protocol pages under [/docs/api](/docs/api/overview) show path and header differences; the model ID still comes from Model Hub.

## Verify success

- The model ID string in your request matches the hub exactly.
- A test completion returns 200 for that ID with your key.

## Next

- [First request](/docs/start/first-request)
- [Models, groups, and quota](/docs/concepts/models-groups-quota)
