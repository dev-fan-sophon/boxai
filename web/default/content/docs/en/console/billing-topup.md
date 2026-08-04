---
title: Billing and top-up
summary: Understand balance, top up with supported payment rails (including Vietnam-first options), and keep usage within quota.
section: console
order: 30
audience: [user]
updated: 2026-08-04
status: published
---

## Prerequisites

- Signed-in account
- Access to the billing / top-up area in the console

## Check balance

Open the billing or wallet section in the console and confirm your current balance and any active subscription. Usage is deducted according to model pricing in [Model Hub](/pricing).

## Top up

:::steps
1. Open top-up / billing in the console.
2. Choose an amount and a payment method available in your region.
3. Complete payment. Vietnam-first rails (for example Waffo and local methods when enabled) appear when configured for your account.
4. Wait for the balance to refresh; keep any transaction reference if review is required.
:::

:::callout type="info"
Available payment methods depend on configuration and region. If a method is missing, try another listed option or contact support with your account email — never send API keys.
:::

## After payment

- Confirm the new balance in the console.
- Run a small [test request](/docs/start/first-request) if you were blocked by insufficient quota.
- Review [Usage logs](/docs/console/usage-logs) for consumption.

## Common issues

| Issue | What to do |
|-------|------------|
| Balance not updated | Wait briefly, refresh; keep the bank/Waffo reference for review queues |
| Payment pending review | Upload the requested proof in the console flow if prompted |
| Still 403 on calls | Confirm model access for your group, not only balance |

## Next

- [Usage logs](/docs/console/usage-logs)
- [Getting started](/docs/start/getting-started)
