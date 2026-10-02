---
title: Choose a Desktop model and understand billing
summary: Select an available BoxAI model, run a small test and check authoritative usage on the website.
section: clients
order: 13
audience: [user]
updated: 2026-10-02
status: published
---

## Choose a model

1. [Sign in](/docs/clients/desktop/sign-in), then open a project or session.
2. Open the model selector in the message composer and choose an available model.
3. Where supported, choose a reasoning level appropriate to the task. More reasoning can take longer and consume more tokens.
4. Send a short request and confirm that a reply arrives before starting a large task.

![Open BoxAI model picker in the Lotus Travel demo session](/desktop-screenshots/docs/models.webp 'Choose a model available to your account. The list can change; these captured model names are not a guarantee of availability.')

Available models come from BoxAI and depend on account access and compatibility with the desktop agent. The website catalog is not a promise that every image, video or audio model appears in the conversation picker. Do not copy a model ID from an unrelated provider tutorial or add a separate provider to work around a missing model.

Desktop shows only models present in both the gateway's model list and your account's permitted chat models. Claude models use the Messages API; other model families use Chat Completions, all through BoxAI. You do not choose an endpoint or provide a separate provider key. Standalone image generation and third-party live voice are not available in this integration.

## What you pay for

Model requests use your BoxAI account's applicable pricing, group and allowance. Read [Model Hub](/pricing) for current prices and [Billing](/billing) for balance and subscriptions. Do not treat an app-side token or cost estimate as an invoice: the website's [usage logs](/docs/console/usage-logs) are the place to check actual gateway consumption.

A single instruction may cause several model requests as the agent reads files, calls tools and continues. Subagents, retries and long conversations can add usage. Stopping a task prevents further work but does not undo already processed model requests. A failed overall task may still have completed billable requests.

External services used by plugins or MCP may require separate accounts and charge separately from BoxAI. Review their terms before enabling them.

## Keep a first task small

- Pick a model you can afford for repeated tool-assisted turns.
- Ask for one bounded result, not an open-ended background goal.
- Use a small folder and avoid attaching unnecessary large files.
- Review usage after the test before granting broader permissions.

## If the model fails

| Symptom                            | What to check                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No models                          | Confirm Desktop sign-in completed and the account has access; restart the app to refresh, then retry.       |
| Insufficient balance or quota      | Check the website's balance, subscription allowance and applicable limits; top up if needed.                |
| Model unavailable or access denied | Select another model offered by the picker; check account/group access rather than inventing an endpoint.   |
| Rate limit                         | Wait before retrying; avoid repeatedly resubmitting the same task.                                          |
| Interrupted response               | Inspect the transcript and file changes before continuing so you do not repeat an already completed action. |

Next: [Projects and sessions](/docs/clients/desktop/projects-and-sessions) · [Billing and top-up](/docs/console/billing-topup).
