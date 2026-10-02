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

1. Open BoxAI Desktop and choose **Sign in with BoxAI** on the **BoxAI account** screen.
2. In the browser, check that the account page is on **you-box.com**, then sign in using your normal BoxAI method.
3. Review and approve the Desktop authorization request. Do not approve a request you did not start.
4. The browser returns through a temporary `127.0.0.1` callback on your computer. Keep Desktop open; when the browser says to return to Desktop, switch back and wait for the workspace.

<!-- Screenshot: /desktop-screenshots/docs/login.webp — real BoxAI authorization entry, with safe fictional identity. -->

You do not need to create an OpenAI, Anthropic or Google provider account, paste their API keys, or configure a custom model endpoint. Built-in model requests use BoxAI.

## Check the account before working

Confirm the displayed account is the one you intended. Then [choose a model](/docs/clients/desktop/models-and-billing) and send a short test request. A website session alone does not prove the desktop authorization completed.

The **BoxAI account** settings page is read-only: it shows wallet balance and total usage in quota units, plus request count. These are account-wide figures, not the cost of the current session or a currency amount. Use **Refresh**, **Top up** or **Open console** to check or manage the account.

## Sign-in does not finish

- Keep the app open while authorizing in the browser.
- If you canceled or the authorization expired, start a fresh attempt from Desktop instead of reusing an old browser tab.
- If the browser is signed into another account, switch accounts on the website before authorizing again.
- Check your internet connection and the computer's date and time. Do not disable TLS verification to fix a connection error.
- If authorization succeeded but no models appear, see [models and billing](/docs/clients/desktop/models-and-billing).

## Protect access

Use the app's sign-out action before handing the computer to someone else. Treat local authorization data as a credential: do not send it to support or include it in backups shared publicly. Signing out of the website and signing out of Desktop are separate actions.

**Sign out** revokes the Desktop session and its relay key on the server before clearing local credentials. If the network request fails, sign-out has not completed: reconnect and retry before handing over the computer. The app stores credentials in its encrypted host-side secret store, not in the visible account page. For suspected exposure, also review affected authorizations or keys on the website. See [API key security](/docs/console/api-keys).

Next: [Models and billing](/docs/clients/desktop/models-and-billing) · [Troubleshooting](/docs/clients/desktop/troubleshooting).
