---
title: Add skills, plugins and MCP tools
summary: Extend Desktop carefully, choose global or project scope and verify each capability before relying on it.
section: clients
order: 16
audience: [user, developer]
updated: 2026-10-02
status: published
---

## Choose the right extension

| Type       | Use it for                                                       | Review before enabling                                          |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Skill      | Reusable instructions and task knowledge                         | Instruction content, bundled scripts and source.                |
| Plugin     | App capabilities, commands or UI supplied by an extension        | Author, permissions, code and update source.                    |
| MCP server | Tools or data exposed by another local process or remote service | Command/URL, credentials, filesystem access and external costs. |

A catalog entry is not a security endorsement. All built-in model traffic uses BoxAI, but extensions may run local programs or contact other services. Do not assume their data stays on BoxAI.

<!-- Screenshot: /desktop-screenshots/docs/settings.webp — real Skills/MCP settings with project scope visible. -->

## Add a skill

1. Open the **Skills** settings page.
2. Choose global scope if you need it across projects, or the selected project's scope for project-specific instructions.
3. Create, import or edit the skill using the available action. Review the content before enabling it.
4. Test in a disposable session with a small request that needs the skill.

Skills use `.agents/skills` in a project or `~/.agents/skills` globally. A global resource can affect more than one project; avoid putting private project instructions there accidentally.

## Connect an MCP server

1. Open **MCP** settings and select the intended global or project scope.
2. Add/import the server configuration supplied by a source you trust. Check the executable and arguments for a local server, or the URL and authentication for a remote one.
3. Supply any required credentials privately. Local servers may require tools that are not bundled with Desktop; follow that server's installation instructions.
4. Use the connection test, enable the server and try one harmless operation. A saved configuration alone does not prove the server is reachable.

MCP configuration uses `.agents/servers` in a project or `~/.agents/servers` globally. Do not commit secret-bearing configuration into a shared repository. Review each tool request using [Ask permissions](/docs/clients/desktop/tool-approvals).

## Install a plugin

Open **Plugins**. **Marketplace** offers available packages; **Installed** lets you enable, configure and manage them. Review the source and requested capabilities before installing. Development loading and templates are for authors who understand the code being loaded, not a way to bypass trust warnings.

After installation, check the plugin's scope/settings and test its advertised capability. Plugin updates are separate from [app updates](/docs/clients/desktop/updates); review changes before applying them.

## Undo a problematic change

Disable the recently added resource and retry the same small task. If the problem disappears, inspect that resource's configuration or contact its author with redacted diagnostics. Disabling a resource does not undo commands, file edits or external actions it already performed.

Next: [Troubleshooting](/docs/clients/desktop/troubleshooting) · [Tool permissions](/docs/clients/desktop/tool-approvals).
