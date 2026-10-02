---
title: Work with projects and sessions
summary: Open a folder, give the agent a bounded task and review results without losing track of your work.
section: clients
order: 14
audience: [user]
updated: 2026-10-02
status: published
---

## Open a project

1. Prepare a small local folder you are comfortable letting the agent read. Commit or back up important files first.
2. Use the project's add/create action to select an existing folder. You can include multiple folders when needed; grant only the scope required for the task.
3. Confirm the project name and selected paths. The Git option can clone a repository into a destination you choose; it still requires your own repository access.
4. Select the project and start a new session.

![Lotus Travel demo project with a completed quote-discount task and test results](/desktop-screenshots/docs/project-session.webp 'Example of a completed editing task. Review the changed files and verification results; this is not the read-only first-task example below.')

## Give a clear task

Start in **Agent** mode with **Ask** permissions. Try: “Read the README and explain how this project is organized. Do not edit files or run installation commands.” The wording sets intent; [tool permissions](/docs/clients/desktop/tool-approvals) control approval, so keep checking the actual requests.

For a change, describe the desired result, relevant files, constraints and how to verify success. Keep unrelated work in separate sessions. Switching sessions changes conversation context, but sessions in the same project can still edit the same files; it is not a filesystem isolation boundary.

## Choose an operating mode

- **Agent** works through the task directly using allowed tools.
- **Plan** prepares a proposal for review. Read it before approving execution, and choose the permission mode deliberately.
- **Goal** supports longer autonomous work and uses Auto permissions. It is not the safest first task; use it only after understanding the scope and possible side effects.

Operating mode and permission mode are different controls. Approving a plan is not a guarantee that every future action is safe.

## Review and continue

Read the answer and tool results, inspect file changes, and run appropriate checks before using generated work. If a task is going in the wrong direction, stop it, inspect what already happened and give a narrower follow-up. Stopping does not roll back edits or external actions.

The session list lets you return to conversations, pin useful sessions, archive finished work or delete sessions. Prefer archiving when you only want to declutter. Keep independent backups of important project files; chat history is not version control.

## Verify success

The selected project is correct, the transcript contains the completed result, and any requested file changes pass your checks. If a session appears stalled, check for a [pending approval](/docs/clients/desktop/tool-approvals) before sending the task again.

Next: [Tool approvals](/docs/clients/desktop/tool-approvals) · [Skills, plugins and MCP](/docs/clients/desktop/extensions).
