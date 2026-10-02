---
name: releasing-boxai-clients
description: Builds, natively verifies, stages, and publishes BoxAI Desktop Electron installers to R2. Use for Desktop releases, installer rebuilds, automatic update feeds, or Studio Windows release work; consult Connect's own build guidance for that independent client.
---

# Releasing BoxAI Clients

BoxAI Desktop is the LGPL-3.0 PI-Desktop fork in `desktop/`: Electron, Rust
host-core, and pnpm. It is not OpenWorker/Tauri. Connect is an independent
product; do not rebuild or publish it as a side effect of a Desktop release.

## Distribution contracts

- Version: `desktop/apps/desktop/package.json`, starting at `0.2.0` (> Tauri `0.1.7`).
- Bump: `cd desktop && node scripts/release.mjs <version>` updates the app/root
  package versions and shared `APP_VERSION`. Review and commit before tagging.
- macOS arm64: `BoxAI-Desktop-<version>-macos-arm64.dmg`.
- Windows x64: `BoxAI-Desktop-<version>-windows-x64-setup.exe` plus `.blockmap`.
- Native stage: `desktop/release/<version>/`, including each installer's
  `.assertion.json`. Reports must come from actual native install and boot.
- R2: canonical account `4379d21a3d3eadc0e37d63abff091f31`, bucket `boxai-desktop`.
- Immutable objects: `https://dl.you-box.com/desktop/<version>/<filename>`.
- Electron generic feeds: `desktop/latest.yml`, `desktop/latest-mac.yml`.
- Website feed: `desktop/releases.json`; preserves platform/arch/kind/signed/
  minimum_os/url/filename/size/sha256 schema. Windows arch remains `x86_64`.

## Tauri migration is a manual reinstall, not an updater payload swap

Never overwrite `desktop/latest.json`: it is frozen for the old Tauri updater.
That updater expects minisign signatures and platform-specific Tauri payloads;
an Electron DMG or NSIS executable is not a compatible macOS app archive or
guaranteed compatible installer/argument contract. A signature alone cannot
make it compatible. Do not sign Electron packages with the old updater key.

The website advertises the newer comparable version and manual migration.
Existing Tauri users download/install Electron, sign in again, and retain their
old local data. There is no automatic data or credential migration. An in-app
bridge for old users would require a separately built, signed Tauri maintenance
release with an explicit migration UI; this pipeline does not fabricate one.

## Build and native acceptance

Use separate clean checkouts of the same pushed commit on macOS arm64 and
Windows x64. Do not cross-compile or hand-write/patch assertion JSON.

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm dist
cd ..
node scripts/client-release/desktop-native.mjs
```

`desktop-native.mjs` mounts/copies the DMG or installs NSIS into a temporary
directory, verifies architecture/identity, launches that installed executable
with an isolated profile, and requires the renderer/preload/host IPC boot probe.
It records artifact hash, exact commit and boot evidence only after success.
Windows uses a real NSIS install and removes that temporary installation after
the probe; run in a release account without an existing Electron BoxAI install.
Mac copies to a temporary directory and never replaces `/Applications`.

On Studio Windows prepend `$env:USERPROFILE\.cargo\bin` to PATH if needed.
Native runners: `macos-builder` under `/Volumes/app`; `studio-win` under
`C:\Users\win\src\origingame`. Preserve other worktrees and running apps.

Existing SSH helpers (when configured):

```bash
bash scripts/client-release/run-windows-build.sh desktop <commit>
bash scripts/client-release/wait-windows-build.sh desktop
bash scripts/client-release/pull-windows-artifacts.sh desktop <version>
```

`full-release.sh` prepares Desktop's two stages only. It does not publish.
`make desktop-build`, `desktop-stage`, `desktop-check`, `desktop-publish` map to
the Electron commands, never deleted Tauri paths.

## Signing is explicit and verified

Default local and CI builds are unsigned. macOS has no Developer ID/notarization
claim and uses notify-and-download updates. Windows has no Authenticode claim
and uses NSIS automatic updates with SHA-512 from the HTTPS generic feed.

An optional `BOXAI_MAC_SIGN=1` lane selects only the verified existing BoxAI team
`9UUWCMKMDH`. Supply Apple credentials through the existing private environment
(APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID); never print them. It
builds notarized DMG + ZIP, sets packaged `boxaiMacSigned`, and enables in-app
updates. Use the same `BOXAI_MAC_SIGN=1` for native stage. Stage requires strict
codesign, team requirement, spctl, app+DMG stapler validation, and matching ZIP
payloads before recording `signed=true`. Failed notarization must not fall back
to a falsely signed release. Legal agreement/403 errors require the account
holder to accept Apple's agreements; do not bypass them.

## Prepare and publish

Combine both stages from the exact release commit. Install Python dependencies
in an isolated venv: `python -m pip install -r scripts/client-release/requirements.txt`.

```bash
python scripts/client-release/desktop_release.py             # local validation
python scripts/client-release/desktop_release.py --publish   # explicit production write
```

Publish only after final integrated native validation and main integration.
The publisher requires a clean checkout of current `origin/main`, matching
native reports, and dedicated R2_DESKTOP_ACCESS_KEY_ID / R2_DESKTOP_SECRET_ACCESS_KEY
plus BOXAI_CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_TOKEN) for cache purge.
Never use the playground bucket token or print secrets.

The publisher creates immutable objects conditionally and verifies public bytes
before advancing any feed. Existing objects with different bytes stop the release.
It generates SHA-512 YAML and SHA-256 website metadata from the final bytes
(after stapling), updates feeds, purges their cache, and verifies live content.
If only a feed update fails, rerun with the same staged bytes; do not rebuild and
overwrite the version. A rebuilt installer requires a new version.

## CI

`desktop-ci.yml` checks PRs and builds packages on native macOS and Windows hosts.
`desktop-release.yml` accepts `desktop-v*` tags on main, validates tag/version,
builds both native lanes, uploads their reports, then publishes through the
`desktop-production` environment using dedicated R2 and Cloudflare secrets.
Default CI is unsigned; signed releases currently use the explicit Mac lane.
Do not push a release tag to publish a second, rebuilt copy of a version already
published manually. Never publish an unvalidated integration branch.

After release, report immutable download URLs, SHA-256, tested commit, native
evidence and signing status. A build is not an install/boot check, and boot is
not proof of authenticated model requests or successful upgrade handoff.
