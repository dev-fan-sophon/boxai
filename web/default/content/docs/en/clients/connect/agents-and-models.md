---
title: Agents, models and Library
summary: Choose conversational BoxAI models for your installed agents and use Library carefully.
section: clients
order: 33
audience: [user]
updated: 2026-09-27
status: published
---

## Select a model for an agent

1. Install the coding agent you want to use separately, then [sign in to Connect](/docs/clients/connect/sign-in).
2. Open **Agents** and find it in the detected list. Examples include Claude Code, Codex, Gemini CLI and OpenCode; the available controls depend on the agent.
3. Open its model field and choose an available BoxAI model. Selection applies the setting to that agent's local configuration; there is no universal extra Save step for a model choice.
4. Review other fields only if the agent exposes them, such as reasoning effort or model tiers. Do not assume every agent supports the same options.
5. Reopen the agent if it has not picked up the change, then send a short, non-sensitive prompt. Requests can consume your account balance or subscription allowance.

**Success check:** the chosen model appears in the agent row, the agent returns a response, and the corresponding request appears in Gateway's recent calls. Keep Connect running throughout.

If no agents appear, confirm the agent is installed for the same operating-system user. Check folded or hidden entries in the list before assuming it is unsupported. Do not overwrite unrelated agent configuration to force detection.

## Which models appear?

Connect fetches the BoxAI model list using your authorized key and exposes conversational models for coding and chat. Model access can differ by account and key restrictions; compare with the [website model catalog](/pricing), not an assumed fixed list.

Vision **input** is allowed where the conversational model and agent support it. This does not mean the picker supports image, video, music, speech or other media **generation**. Embedding and reranking models are also outside this conversational picker. A missing media model is therefore expected, not a reason to paste its ID into configuration to bypass the filter.

If an expected chat model is missing, check connectivity and key access, refresh the model lists using the toolbar refresh control, and reopen the picker. See [troubleshooting](/docs/clients/connect/account-and-troubleshooting) if it remains absent. For other API workflows, consult the [API overview](/docs/api/overview).

## Library is the upstream resource library

**Library** retains Magpie's instructions, MCP and skills workflows, including upstream marketplace resources. It is not limited to official BoxAI content and is not another model store.

Review a resource's source, instructions, permissions and any commands or servers it uses before adding it. Library actions can write files used by your agents. Do not install resources merely to fix sign-in, and never give a resource your `auth.json` or BoxAI key. Keep your own backup of important agent files before making changes; sign-out is not an undo operation.

Next: [Gateway and Routing](/docs/clients/connect/gateway-and-routing).
