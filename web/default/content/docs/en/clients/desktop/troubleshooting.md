---
title: Troubleshoot BoxAI Desktop
summary: Find safe fixes for startup, authorization, model access and tools, and prepare a useful support report.
section: clients
order: 18
audience: [user]
updated: 2026-10-02
status: published
---

## Start with a small check

Record the app version, operating system and CPU architecture. Check your connection and the official release information. Try one short request in a disposable project with Ask permissions. Change one thing at a time; do not reset all app data or repeatedly submit a task that may already have changed files.

## Match the symptom

| Problem                                          | Safe next step                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| App does not open                                | Confirm installer architecture and supported OS; follow [first-open security guidance](/docs/clients/desktop/install).                             |
| Browser login completes but app stays signed out | Keep Desktop open, cancel stale attempts and start a new [authorization](/docs/clients/desktop/sign-in). Check which website account is signed in. |
| Empty model list or access denied                | Confirm account authorization and model access. Use a model offered by the picker, not a copied upstream provider ID.                              |
| Insufficient balance/quota                       | Check [Billing](/billing), subscription allowance and [usage logs](/docs/console/usage-logs).                                                      |
| Rate-limit or temporary gateway error            | Wait and retry a bounded request; do not create many simultaneous retries. See [API errors](/docs/api/errors).                                     |
| Agent waits without answering                    | Look for a pending [tool or plan approval](/docs/clients/desktop/tool-approvals) in the active session.                                            |
| Wrong files are being used                       | Stop, verify the selected project and folder scope, then start a clearly scoped session.                                                           |
| MCP connection fails                             | Check that server's command/URL, dependencies and credentials; run its connection test.                                                            |
| Problem started after adding an extension        | Disable that resource and repeat the smallest reproduction. See [extensions](/docs/clients/desktop/extensions).                                    |
| Update will not apply                            | Quit the app and use the official same-platform installer; see [updates](/docs/clients/desktop/updates).                                           |

## Common questions

### Is this BoxAI Connect?

No. Desktop runs the agent workspace. [Connect](/docs/clients/connect) connects other locally installed agents to BoxAI. You do not need Connect merely to use Desktop.

### Can I use a separate provider key?

The BoxAI client uses BoxAI account authorization and built-in model routing through BoxAI. Upstream pi-desktop tutorials for third-party provider setup do not describe this client.

### Are projects completely offline?

Project files are local, but model requests require a network connection. Conversation context, relevant file content and tool output may leave your computer for model processing. Extensions can have their own network access and privacy policies.

### Does Stop undo changes?

No. Inspect the files and any external actions already completed. Use your version-control history or backups when recovery is needed. Do not rerun a whole task blindly after a network interruption.

### Should I delete the data directory?

Not as a first troubleshooting step. It can contain sessions, settings and credentials. Preserve a backup and get specific recovery guidance. Never upload that directory as a support attachment.

## Ask for help safely

Include the version, OS/architecture, expected and actual behavior, minimal reproduction, selected model ID, timestamp with timezone and a redacted error message. If a gateway request ID is shown, include it. A screenshot should show only the relevant error, not private prompts, files, email addresses or credentials.

Never send account passwords, API keys, browser cookies, local authorization files or a complete project/database. Report suspected vulnerabilities privately rather than posting exploit details in a public issue.

Next: [Desktop overview](/docs/clients/desktop) · [API key security](/docs/console/api-keys).
