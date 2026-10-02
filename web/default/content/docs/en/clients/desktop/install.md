---
title: Install and open BoxAI Desktop
summary: Download the right installer and handle first-open security warnings safely on macOS and Windows.
section: clients
order: 11
audience: [user]
updated: 2026-10-02
status: published
---

## Before you download

Use the [BoxAI Desktop page](/agents) on `you-box.com`. Official files are served through `dl.you-box.com`; do not use a search-ad mirror or an installer sent by an unknown person.

Choose **macOS Apple silicon (arm64)** for an M-series Mac, or **Windows x64** for a 64-bit Intel/AMD PC. These are different installers. Check the release's system requirements before downloading; an Intel Mac or Windows ARM device is not the same target. Packaged users do not need Python, Node.js or Rust.

You need an internet connection, a BoxAI account and enough account balance or subscription allowance for model requests. Installing the app does not include unlimited model usage.

## Install on macOS

:::steps

1. Open the downloaded `.dmg`.
2. Drag **BoxAI Desktop** to **Applications**.
3. Eject the disk image and open BoxAI Desktop from Applications, not from inside the DMG.
4. Continue to [sign-in](/docs/clients/desktop/sign-in).

:::

### If macOS blocks an unsigned build

If macOS says the developer cannot be verified or Apple could not verify the app, first confirm that you downloaded the official build. After trying to open it, go to **System Settings → Privacy & Security**, find the blocked-app notice and choose **Open Anyway** if available. Confirm the app name and authenticate when macOS asks.

Only make this exception for the specific verified download. Do not disable Gatekeeper globally, remove quarantine from entire folders, or bypass a malware warning. If macOS says the app will damage your computer, stop and report the exact message. If the exception is unavailable on a managed Mac, contact your administrator.

## Install on Windows

:::steps

1. Run the downloaded x64 setup `.exe` and follow the installation wizard.
2. Confirm the filename and download source before granting any requested installation permission.
3. Launch **BoxAI Desktop** from the Start menu.
4. Continue to [sign-in](/docs/clients/desktop/sign-in).

:::

### If SmartScreen shows an unsigned-app warning

An unsigned or low-reputation installer can show **Windows protected your PC**. For a verified official download, choose **More info**, check the filename, then **Run anyway** if Windows offers it. An unknown publisher is expected for an unsigned build, but it is not proof that a file is safe.

Do not disable Microsoft Defender or bypass an explicit malware detection. Company policy may hide the override; ask your administrator rather than changing security policy.

## Verify success

The app opens to the BoxAI sign-in screen or your existing signed-in workspace. If it does not, [troubleshoot startup](/docs/clients/desktop/troubleshooting) with the OS version, architecture and exact error message. Do not delete your app data as a first step.

Next: [Sign in](/docs/clients/desktop/sign-in) · [Update later](/docs/clients/desktop/updates).
