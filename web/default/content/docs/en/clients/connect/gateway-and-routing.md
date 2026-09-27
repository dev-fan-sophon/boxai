---
title: Gateway and Routing
summary: Use Connect's local connection details and inspect requests without exposing your cloud key.
section: clients
order: 34
audience: [user]
updated: 2026-09-27
status: published
---

## Keep the gateway available

An agent configured for Connect sends requests to the local gateway, which uses your private BoxAI credential to reach the cloud. The app must remain running and signed in. Closing its window hides it; quitting the app stops the gateway. Sleep or loss of network connectivity can interrupt requests too.

## Use the displayed connection details

For supported agents, prefer the [Agents tab](/docs/clients/connect/agents-and-models). For a client you configure manually:

1. Open **Gateway** and check its status.
2. Use the connection details for the protocol your client supports. Copy the displayed **Base URL** instead of assuming a fixed port or appending an extra API path.
3. Use the displayed local API-key placeholder, such as `boxai`, and a model ID from the Gateway list. Copy the complete model ID rather than guessing its prefix.
4. Send one short request and inspect **Recent calls**.

The local placeholder is **not a secret BoxAI key** and will not authorize direct requests to `you-box.com`. Do not replace it with your cloud key or extract the key from `auth.json`. Local connection details are for this computer; do not expose the gateway to the internet or open firewall ports to solve a connection error.

## Inspect routing

**Routing** shows decisions as the gateway makes them. Use it alongside Gateway's recent calls to see where a request was sent and investigate failures. It is a local routing view, not proof of final account charges and not a way to add third-party providers in this BoxAI-only fork.

**Success check:** your client receives a response, Gateway records the call, and Routing reflects the request when it passes through the gateway. If nothing appears, first check that the client is actually using the Base URL shown by Connect, not a previous provider endpoint.

Before sharing screenshots, use Routing's email-masking control and inspect the result for remaining personal information. Never share keys, authorization callback URLs or private prompt content.

## If a request fails

- **Connection refused:** confirm Connect is running, then compare the client's address with the current Gateway details.
- **Authentication rejected:** check [Keys](/keys) and [sign in again](/docs/clients/connect/sign-in) if the credential was revoked.
- **Cloud/network error:** check access to `you-box.com` and retry once connectivity returns. Do not disable TLS verification or security software.
- **Balance or allowance issue:** check [Billing](/billing); local routing does not create extra quota.

See [account and troubleshooting](/docs/clients/connect/account-and-troubleshooting) for more recovery steps and the meaning of Usage.
