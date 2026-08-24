---
name: using-boxai-gateway
description: Uses the BoxAI gateway and its provisioned model catalog safely from supported coding agents. Use when choosing BoxAI models, applying agent configuration, checking account availability, or troubleshooting a BoxAI Connect setup.
license: Apache-2.0
---

# Using the BoxAI Gateway

Use the connection and model catalog provisioned by BoxAI Connect. Never ask
the user to paste, print, or commit the connection bearer token.

## Workflow

1. Confirm BoxAI Connect shows **Connected** and that the target agent is one
   of Claude Code, Codex, Gemini CLI, Grok Build, or OpenCode.
2. Select a chat-capable model from Model Plaza. Prefer the provisioned default
   unless the task requires a capability exposed by another available model.
3. Use the agent's **Apply** action. Do not hand-edit its configuration unless
   Connect reports that automatic projection failed.
4. Run one small request in the agent before starting expensive work.
5. If the user wants to stop using BoxAI, use **Disconnect** so Connect can
   restore the configuration it backed up.

## Model selection

- Match the model to the protocol and capabilities shown by Connect; do not
  infer support from a model name.
- For Codex, use a model marked compatible with the Responses protocol and
  choose only a reasoning level listed for that model.
- Use BoxAI Media through the provisioned `boxai-media` MCP server. Image and
  video models are tools, not chat defaults.
- If a model disappears after refresh, treat the current provisioned catalog
  as authoritative. Do not preserve a stale model identifier manually.

## Troubleshooting

- **Authentication failure:** sign out and complete browser sign-in again.
  Never copy the bearer token between machines.
- **Agent still uses an old endpoint:** run Disconnect, then Apply again. If
  the agent was open, restart it after the reversible projection completes.
- **Model unavailable:** refresh the account and Model Plaza, then select a
  currently advertised model.
- **Quota or billing error:** open the BoxAI account/subscription page from
  Connect. Do not retry an expensive request repeatedly.
- **MCP or Skill missing:** refresh provisioning, then apply the target agent
  again so its catalog projection is synchronized.

Keep generated credentials and local agent configuration out of logs, issue
reports, source control, and chat responses.
