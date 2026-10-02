---
title: Review tool permissions
summary: Understand Ask, Accept edits and Auto before allowing file changes, commands or external tools.
section: clients
order: 15
audience: [user]
updated: 2026-10-02
status: published
---

## Start with Ask

Choose **Ask** in the session's permission control for unfamiliar projects and first-time tasks. The app pauses for actions that require approval. Read the tool name, arguments, affected paths and any command before deciding. Not every read-only tool call necessarily prompts.

![Permission needed dialog for bash running npm test, with Deny, Allow for this chat and Allow once](/desktop-screenshots/docs/permissions.webp "Read the command and working directory before choosing whether to allow it.")

| Permission mode | Meaning                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ask             | Keep approval prompts for actions that require permission.                                                          |
| Accept edits    | Allow file edits with fewer prompts; command execution still has its own approval rules.                            |
| Auto            | Allow autonomous execution, including Bash without asking; commands can change files or have external side effects. |

These modes are not a substitute for backups, sandbox boundaries or reading the result. **Goal** mode uses Auto. Do not switch to Auto merely to make an unexplained permission prompt disappear.

## Decide on a request

1. Check that the request belongs to the task you asked for and targets the intended project.
2. For shell commands, read the full command. Consider deletion, package installation, network requests and production credentials.
3. Choose **Allow once** for a single understood request, **Allow for this chat** only when you trust the repeated operation within that session, or **Deny** if it is unnecessary or unclear.
4. After execution, inspect the tool result and any changed files. Approval does not mean the action succeeded.

If you deny a request, explain what the agent should do instead. Do not approve requests based only on a tool name: a familiar shell tool can run a destructive command.

## Review a plan separately

In Plan mode, inspect the proposed steps and affected files before approving. The approval control lets you select Ask, Accept edits or Auto for execution. Reject a proposal that lacks the constraints you need and ask for a revision.

## If work seems stuck

Check the active session for a pending tool or plan approval, including collapsed transcript content. Resolve the request or stop the task. Repeatedly sending the same instruction can create confusing follow-ups and extra model usage.

Next: [Projects and sessions](/docs/clients/desktop/projects-and-sessions) · [Extension safety](/docs/clients/desktop/extensions).
