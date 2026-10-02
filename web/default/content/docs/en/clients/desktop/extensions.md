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

## Use the BoxAI catalog

After signing in, the Skill and MCP markets include a fixed, read-only **BoxAI** source. You cannot remove this official source, but you can add your own catalog sources and GitHub skill sources. Official skills/MCP are separate from the plugin marketplace; the former upstream private plugin market is not provided.

For an official skill, choose **Install**, review the `SKILL.md` preview and confirm. Desktop downloads and verifies the package again, then copies the complete resource bundle into your global skills. Installation checks the declared size and SHA-256, limits the archive and extracted data to 64 MiB and the archive to 4,096 entries, and rejects unsafe paths and links. If verification fails, do not bypass it or install an unverified replacement.

An official MCP installation creates a global server. You do not paste a BoxAI key: the background process checks the current account and official server address for every request, then adds the gateway credential privately. Redirects are rejected. Account sign-in, credential refresh and sign-out invalidate old connections. Signing out keeps installed skill files and MCP records, but the official MCP can no longer authorize requests until you sign in again.

If **BoxAI** is shown as an unavailable source, check connectivity and retry later. The catalog endpoint must also be deployed on the BoxAI server; installing the Desktop client alone does not make it available. A catalog-load failure does not itself sign you out, and configured custom sources remain available independently.

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
