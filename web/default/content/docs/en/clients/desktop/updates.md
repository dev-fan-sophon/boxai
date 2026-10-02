---
title: Update BoxAI Desktop
summary: Check the current release, install an official update and preserve your projects and local data.
section: clients
order: 17
audience: [user]
updated: 2026-10-02
status: published
---

## Before updating

Finish or stop active tasks, review unfinished file changes and back up important projects. Record your current app version if you are investigating a problem. Keep Desktop's local data and project folders; deleting them is not part of a normal update.

## How updates differ by platform

- **Unsigned macOS builds:** updates are manual. Download the new DMG and replace the application as described below; an update notice does not install it for you.
- **Windows setup installations:** automatic in-app updates are supported and enabled by default. Follow the app's update status and restart prompt. If you choose manual updates, install the new setup file yourself.
- **Development builds:** the packaged-app updater is disabled.

## Install the current build

1. Open the [official Desktop download page](/agents) and compare its current version with your installed version.
2. Read the release information, including any changed system requirements.
3. Download the installer for the same platform and architecture as your current app.
4. Quit Desktop. On macOS, copy the new app into Applications and replace the old app bundle. On Windows, run the new setup installer and follow its prompts.
5. Open the app and verify the version, account state and a familiar project/session before starting more work.

![Info settings showing Couldn't check for updates and UPDATE_UNAVAILABLE](/desktop-screenshots/docs/updates.webp "The captured candidate could not access a published update feed. This is an unavailable-update state, not a successful check or installation.")

If the app offers an update check or download action, follow its displayed result. Do not assume a background check means the update has been installed; verify after restarting. The official installer is the fallback when in-app updating cannot complete.

## If an update fails

- Confirm the architecture and available disk space; download again from the official page if the file is incomplete.
- Close the running app before replacing it. Do not overwrite its data directory with the installer contents.
- Handle an unsigned-build warning using the [installation guide](/docs/clients/desktop/install), without disabling system protection.
- Do not downgrade onto newer app data unless the release notes explicitly support it. Preserve a backup and seek help first.

## Moving from the retired client

This is a replacement application, not a promise of automatic migration from the old client. Keep old projects and backups until you confirm what you need. Do not copy old authorization files, connector configuration or update manifests into the new app.

Next: [Troubleshooting](/docs/clients/desktop/troubleshooting) · [Desktop overview](/docs/clients/desktop).
