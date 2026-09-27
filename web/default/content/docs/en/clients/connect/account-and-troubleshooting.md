---
title: Account, usage and troubleshooting
summary: Understand account-wide usage, manage authorization and recover safely from common Connect problems.
section: clients
order: 35
audience: [user]
updated: 2026-09-27
status: published
---

## Account and Usage

**Account** shows identity and authorization information, with links to top up, manage subscriptions and account security. Confirm the account before sending requests. Use **Reverify authorization** when you need a fresh authorization check and **Sign out** to remove the local credential.

**Usage** comes from BoxAI's account service: wallet balance, lifetime consumption and subscription counters are shown in **raw quota units**. These are account-wide figures, including activity outside this Connect installation. They are not currency amounts, a per-agent breakdown or local estimated costs. Gateway activity and Routing are useful diagnostics, not billing records.

Use [Billing](/billing) for balance and subscriptions, [Keys](/keys) for credential management, [account security](/profile) for your website account and the [model catalog](/pricing) for model prices and availability.

## Common problems

### The app is running but no window appears

Check the macOS menu bar or Windows notification area, including hidden icons. Use **Open BoxAI Connect** in its icon menu. Closing the window normally hides it instead of quitting. If the icon is absent, launch the installed app once; do not start multiple copies as a workaround.

**Check:** the sign-in screen or six tabs become visible. Keep the app running for agent requests.

### Browser authorization stalls or times out

The browser callback must return to Connect on the same computer within about three minutes. Keep Connect open, verify that the authorization site is `you-box.com`, and finish the browser approval. Use **Cancel** for a pending flow, or **Retry** after an error, then start a new flow. Do not reuse an expired callback URL or send it to support.

If a managed browser, proxy or firewall blocks the local callback, ask your administrator to review that specific connection. Do not disable security protections.

**Check:** Connect leaves the sign-in gate and Account shows the intended identity.

### Account, Usage or model lists fail to load

Check whether `https://you-box.com` opens in your browser and whether the network or proxy is reporting a failure. Retry after connectivity returns; refresh model lists if needed. A temporary account-service outage is not by itself evidence that your saved key was deleted. Opening Connect uses the local credential, while these cloud-backed views need successful API requests.

**Check:** Account or Usage loads fresh data without an error. Do not interpret missing data as a zero balance.

### A key was revoked, deleted or rejected

Check the corresponding entry in website [Keys](/keys). Use **Reverify authorization** if available. If the key is no longer valid, sign out locally and [authorize again](/docs/clients/connect/sign-in) with the intended account. Authorization creates a new ordinary key; do not copy the old secret into agent settings.

Revocation is enforced when requests reach the server; an already open window is not proof of ongoing access. Signing out only removes the local credential. To invalidate a leaked key, revoke it on the website as well.

**Check:** Account loads and a short agent request succeeds. Neither sign-out nor uninstall promises to restore previous agent configuration.

### An image, video or audio model is missing

This is expected for media-generation models: Connect's BoxAI picker is conversational-only. Vision-input chat models may still appear. Use the [model catalog](/pricing) and [API documentation](/docs/api/overview) to choose another suitable workflow. For a missing chat model, check key access and refresh the model list instead of bypassing the filter.

### An agent cannot connect

Follow [Gateway and Routing](/docs/clients/connect/gateway-and-routing): confirm Connect is running and signed in, compare the client's Base URL and model ID with the displayed values, and inspect recent calls. Check [Billing](/billing) for quota-related failures. Avoid repeated billable retries while investigating.

## Sharing a useful problem report

Include your OS and architecture, Connect version from its menu, the failing step, approximate time and exact error message with private values removed. Describe whether the failure is in sign-in, an account view or an agent request. Do not attach `auth.json`, API keys, full callback URLs, private prompts or unreviewed configuration backups.

Return to the [Connect overview](/docs/clients/connect) or [installation guide](/docs/clients/connect/install).
