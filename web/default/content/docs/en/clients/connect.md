---
title: BoxAI Connect
summary: Connect your local coding agents to BoxAI through a desktop gateway.
section: clients
order: 30
audience: [user]
updated: 2026-09-27
status: published
---

BoxAI Connect is a desktop companion for coding agents you install separately. It configures those agents to use a local gateway, which forwards requests to BoxAI using your authorized account. Keep Connect running while those agents use it.

This guide covers **BoxAI Connect 1.1.1**, based on **Magpie v0.1.185**. It is not [BoxAI Desktop](/docs/clients/desktop). Upstream instructions for adding third-party providers do not apply: this fork uses BoxAI only and requires website sign-in.

## Start here

1. [Install Connect](/docs/clients/connect/install) from the [Connect download page](/connect).
2. [Sign in through your browser](/docs/clients/connect/sign-in).
3. [Choose an agent and model](/docs/clients/connect/agents-and-models).
4. Send a short prompt in that agent and check [Gateway and Routing](/docs/clients/connect/gateway-and-routing).

## The six tabs

| Tab | What it is for |
| --- | --- |
| Agents | Select models and supported settings for detected local agents. |
| Gateway | Find connection details, available model IDs and recent calls. |
| Routing | Inspect live routing decisions made by the gateway. |
| Usage | Read BoxAI account-wide wallet, lifetime consumption and subscription counters. |
| Library | Manage upstream Magpie instructions, MCP resources and skills. |
| Account | Check identity, open account management and sign out. |

There is no Providers tab. Library retains the upstream resource experience; it is not an official-only BoxAI catalog. Review third-party resources before enabling them.

## Know the boundaries

- The model picker is for conversation and coding. Compatible vision-input models can accept images, but this is not a picker for image, video or audio generation.
- Usage is server-reported account usage in quota units, not a per-agent bill or a local cost estimate.
- Browser authorization creates an ordinary entry in website [Keys](/keys). The cloud key stays in private local `auth.json`, not Keychain or agent configuration.
- Signing out locally does not revoke that website key. See [account and troubleshooting](/docs/clients/connect/account-and-troubleshooting).

For model availability and prices, use the [model catalog](/pricing). Manage balance and subscriptions in [Billing](/billing), or see the [API overview](/docs/api/overview) for direct integrations.
