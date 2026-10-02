---
title: Get started with BoxAI Desktop
summary: Install the desktop agent, sign in to BoxAI, and work safely with projects, models and tools.
section: clients
order: 10
audience: [user]
updated: 2026-10-02
status: published
---

BoxAI Desktop is an agent workspace for tasks on your computer. Open a project, explain the outcome you want, choose a BoxAI model and review the agent's work. Model requests use your BoxAI account through the BoxAI gateway.

This guide covers the current pi-desktop-based app. Instructions for the retired client, its connectors and its configuration do not apply. [BoxAI Connect](/docs/clients/connect) is a different app: it connects separately installed coding agents to BoxAI.

## Your first task

1. [Install and open Desktop](/docs/clients/desktop/install) from the [official download page](/agents).
2. [Sign in with your BoxAI account](/docs/clients/desktop/sign-in).
3. [Select a model and check billing](/docs/clients/desktop/models-and-billing).
4. [Open a small project and start a session](/docs/clients/desktop/projects-and-sessions). Begin with a read-only request such as “Summarize this project's README without changing files.”
5. [Review tool requests](/docs/clients/desktop/tool-approvals) and inspect the answer and any file changes before continuing.

<!-- Screenshot: /desktop-screenshots/docs/project-session.webp — a real disposable project and successful short session. -->

## Before you grant access

Use a test folder for your first session and back up important work. An agent can read project content, edit files and run commands when its tools and permissions allow it. Relevant conversation, file content and tool results may be sent to the selected model; “desktop” does not mean offline model inference.

Do not add secrets, personal documents or production credentials unless the task requires them and you accept the data flow. Skills, plugins and MCP servers are third-party capabilities, not automatically trusted BoxAI services.

## Continue learning

- [Skills, plugins and MCP](/docs/clients/desktop/extensions): add a capability with the right scope.
- [Updates](/docs/clients/desktop/updates): install the current build without deleting your data.
- [Troubleshooting](/docs/clients/desktop/troubleshooting): resolve sign-in, model, tool and startup problems.
