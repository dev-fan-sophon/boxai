---
title: Sign in to BoxAI Connect
summary: Authorize Connect in your browser and understand where its API key is stored.
section: clients
order: 32
audience: [user]
updated: 2026-09-27
status: published
---

## Authorize on the same computer

1. Open Connect and select **Sign in with BoxAI**.
2. In the browser, check that the authorization website is `https://you-box.com`. Sign in to the BoxAI account you want to use and approve authorization.
3. Complete the flow in that computer's browser. Connect receives the result through a temporary local callback; do not move the authorization link to another device or share it.
4. Return to Connect when the browser says you may close the window. Open **Account** and check the identity before configuring an agent.

The flow expires after about **three minutes**. If it stalls, use **Cancel** and start again. If it has already timed out, use **Retry** and begin a fresh authorization rather than reusing the old browser tab.

## What authorization creates

Authorization creates an ordinary BoxAI API key visible in website [Keys](/keys). This is not a Desktop session or a refresh-token login. You do not need to paste a provider key into Connect, and manually adding one cannot bypass the sign-in gate.

Connect saves the key in `~/.config/magpie/auth.json`, under your operating-system home directory. The retained `magpie` directory name comes from upstream. It is private local JSON protected by file permissions, **not Keychain storage or an encrypted password vault**. Do not share this file, put it in a repository or attach it to a support ticket.

The cloud key is not copied into agent configuration or provider backups. A local value such as `boxai` is only a placeholder for the gateway, not the website key.

## Success check

- The sign-in gate is replaced by the six tabs.
- **Account** shows the intended account when the account request succeeds.
- Website [Keys](/keys) contains the key created by authorization. You do not need to reveal or copy its secret to verify this.

An existing local authorization lets Connect open without checking the account service on every launch. That does not guarantee the key is still valid: model requests, usage and cloud calls still need network access and an accepted key.

## Sign out versus revoke

**Sign out** in Account removes the locally saved key and returns to the sign-in gate. It does **not** revoke the key on the website or restore your previous agent settings. To invalidate the cloud credential, revoke or delete its corresponding entry in [Keys](/keys). Other copies of that key then lose access too.

Next: [agents and models](/docs/clients/connect/agents-and-models). For network failures or a revoked key, see [troubleshooting](/docs/clients/connect/account-and-troubleshooting).
