---
title: Install BoxAI Connect
summary: Install the macOS Apple silicon or Windows x64 release safely.
section: clients
order: 31
audience: [user]
updated: 2026-09-27
status: published
---

Always get the current installer from [BoxAI Connect](/connect), not a third-party mirror. Download links there follow the current release; you do not need a version-specific URL.

## Choose your platform

| Platform | Package | Requirements and signing |
| --- | --- | --- |
| macOS | Apple silicon arm64 `.dmg` | macOS 11 or later; Developer ID signed and notarized. |
| Windows | x64 setup `.exe` | Windows 10 or later; currently unsigned. |

These packages are not Intel Mac or Windows ARM releases.

## macOS

1. Download and open the arm64 DMG.
2. Drag **BoxAI Connect** into **Applications**.
3. Open the app from Applications, rather than running it from the mounted disk image.
4. Look for its menu-bar icon if no window appears. Open Connect from that icon's menu.

If macOS blocks the download or reports damage, stop and download again from the official page. Do not remove quarantine attributes or disable Gatekeeper. If the warning remains, record the exact message and seek support.

## Windows

1. Download the x64 setup EXE from the official page.
2. Review any Windows warning before deciding whether to continue. The current installer is unsigned, so a publisher/reputation warning is possible; it is not proof that a file is safe.
3. Run the installer and choose the installation directory. It installs for your user, by default under `%LOCALAPPDATA%\Programs\BoxAI Connect`.
4. Launch **BoxAI Connect** from the Start menu. Check the notification area, including hidden icons, if no window appears.

If security software or an organization policy blocks installation, stop and contact your administrator or support. Do not disable Defender, SmartScreen or other protections.

## Success check and updates

You should be able to open Connect from its menu-bar or tray icon and see the sign-in screen, or the six tabs if already authorized. Closing the window hides it; **Quit BoxAI Connect** exits it and stops serving your agents.

Use the [Connect page](/connect) to check the current release and obtain a replacement installer. Before quitting or updating, finish active agent requests. Do not assume uninstalling removes credentials or undoes agent configuration.

Next: [sign in](/docs/clients/connect/sign-in). For a missing window or blocked request, see [troubleshooting](/docs/clients/connect/account-and-troubleshooting).
