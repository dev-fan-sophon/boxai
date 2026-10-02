---
title: Sign in to BoxAI Desktop
summary: Authorize the desktop app with your BoxAI account and keep account access private.
section: clients
order: 12
audience: [user]
updated: 2026-10-02
status: published
---

## Before you start

[Install Desktop](/docs/clients/desktop/install) and create a BoxAI account on [you-box.com](https://you-box.com) if you do not have one. Use the same account whose balance or subscription you want to spend.

## Authorize the app

1. Open BoxAI Desktop and start the BoxAI sign-in flow.
2. In the browser, check that the account page is on **you-box.com**, then sign in using your normal BoxAI method.
3. Review and approve the Desktop authorization request. Do not approve a request you did not start.
4. Return to the app and wait for the signed-in state before selecting a model.

<!-- Screenshot: /desktop-screenshots/docs/login.webp — real BoxAI authorization entry, with safe fictional identity. -->

You do not need to create an OpenAI, Anthropic or Google provider account, paste their API keys, or configure a custom model endpoint. Built-in model requests use BoxAI.

## Check the account before working

Confirm the displayed account is the one you intended. Then [choose a model](/docs/clients/desktop/models-and-billing) and send a short test request. A website session alone does not prove the desktop authorization completed.

## Sign-in does not finish

- Keep the app open while authorizing in the browser.
- If you canceled or the authorization expired, start a fresh attempt from Desktop instead of reusing an old browser tab.
- If the browser is signed into another account, switch accounts on the website before authorizing again.
- Check your internet connection and the computer's date and time. Do not disable TLS verification to fix a connection error.
- If authorization succeeded but no models appear, see [models and billing](/docs/clients/desktop/models-and-billing).

## Protect access

Use the app's sign-out action before handing the computer to someone else. Treat local authorization data as a credential: do not send it to support or include it in backups shared publicly. Signing out of the website and signing out of Desktop are separate actions.

For suspected credential exposure, review and revoke the affected authorization or key on the BoxAI website; do not assume a local sign-out revokes server-side access. See [API key security](/docs/console/api-keys).

Next: [Models and billing](/docs/clients/desktop/models-and-billing) · [Troubleshooting](/docs/clients/desktop/troubleshooting).
