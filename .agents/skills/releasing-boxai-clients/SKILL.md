---
name: releasing-boxai-clients
description: Builds, natively asserts, stages, and publishes BoxAI Desktop and BoxAI Connect for macOS and Windows. Use for client releases, installer rebuilds, R2 publication, or Studio Windows release work.
---

# Releasing BoxAI Clients

Release BoxAI Desktop and the native Rust/GPUI BoxAI Connect to the
`boxai-desktop` Cloudflare R2 bucket served at `https://dl.you-box.com`.

## Products

| Product | Version source | Stage | Public feeds |
| --- | --- | --- | --- |
| Desktop | `desktop/surfaces/gui/src-tauri/tauri.conf.json` | `desktop/release/<version>/` | `desktop/latest.json`, `desktop/releases.json` |
| Connect | `connect/release-metadata.json` | `connect/release/<version>/` | `connect/native-latest.json`, `connect/releases.json` |

Desktop remains Tauri and uses the minisign key at
`~/.config/boxai/desktop-updater.key`. Connect is not Tauri: it uses Cargo,
native GPUI packaging, and the Ed25519 PEM key at
`~/.config/boxai/connect-update-signing.pem`.

Connect's metadata public key must match the private PEM before anything can
publish. Never print either private key.

## Build ownership

```text
macOS arm64 host ──native build/assert──┐
                                       ├── release/<version> ──publisher── R2
Studio Windows x64 ─native build/assert┘
```

Do not cross-build or fabricate native assertion reports. Connect publication
requires both exact artifacts and their assertion JSON:

- `BoxAI-Connect-<version>-macos-arm64.dmg`
- `BoxAI-Connect-<version>-macos-arm64.dmg.assertion.json`
- `BoxAI-Connect-<version>-windows-x64-setup.exe`
- `BoxAI-Connect-<version>-windows-x64-setup.exe.assertion.json`

The OS packages are currently unsigned and the macOS app is not notarized.
The in-app update feed is still signed over the exact installer bytes with the
Connect Ed25519 key. Do not claim Authenticode, Developer ID, or notarization.

## Full release

Run from a Mac after the release commit is pushed to `origin/main`, because the
Windows driver clones the pushed ref:

```bash
bash scripts/client-release/full-release.sh
```

Optional environment:

- `BOXAI_RELEASE_REF=main`
- `BOXAI_WIN_SSH_HOST=win-cf` (default) or `win-lan`
- `SKIP_MAC=1` when valid macOS stages already exist
- `SKIP_WIN=1` when valid Windows stages already exist

The script stages both products, publishes both product feeds, then publishes
the BoxAI Media MCP and official Skill catalog.

## Connect manual flow

### 1. Validate

```bash
make connect-check
python3 connect/packaging/build_catalog.py
```

### 2. Build/assert macOS arm64

On a native arm64 Mac:

```bash
make connect-stage
```

`connect/packaging/macos/stage-release.sh` builds the release binary, creates
the DMG, inspects its bundle, architecture, icon, volume, and metadata, then
stages the artifact and assertion report.

### 3. Build/assert Windows x64

The helper uploads `connect/packaging/win_remote_build.ps1`, clones the pushed
ref on the Studio Windows host, installs Rust 1.97, builds NSIS, reads the PE
resources and installer payload back, and stages the exact setup + report.

```bash
bash scripts/client-release/run-windows-build.sh connect main
bash scripts/client-release/wait-windows-build.sh connect
VERSION=$(python3 -c 'import json; print(json.load(open("connect/release-metadata.json"))["version"])')
bash scripts/client-release/pull-windows-artifacts.sh connect "$VERSION"
```

Tail failures with:

```bash
ssh win-cf 'cmd /c type C:\Users\win\build_connect_remote.log'
```

### 4. Publish Connect

Preflight without revealing secrets:

```bash
test -f ~/.config/boxai/connect-update-signing.pem
test -f .env.cloudflare
find "connect/release/$VERSION" -maxdepth 1 -type f -print
```

Then:

```bash
make connect-publish
```

`connect/packaging/publish_release.sh` fails closed unless both native targets
and matching assertions exist. It verifies the key, signs both exact artifact
bytes, uploads immutable versioned objects first, publishes both feeds, purges
their cache, and verifies live schemas, sizes, and SHA-256 hashes.

### 5. Publish Media MCP and Skills

After the backend containing `/api/admin/connector/catalog` is deployed:

```bash
make connect-catalog-publish
```

This deterministically rebuilds three official Skill ZIPs, uploads immutable
archives, verifies their live bytes, then atomically activates the complete
catalog through the root-only management API.

## Desktop manual flow

Desktop release behavior is unchanged:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/boxai/desktop-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
make desktop-build
make desktop-stage

bash scripts/client-release/run-windows-build.sh desktop main
bash scripts/client-release/wait-windows-build.sh desktop
DESKTOP_VERSION=$(python3 -c 'import json; print(json.load(open("desktop/surfaces/gui/src-tauri/tauri.conf.json"))["version"])')
bash scripts/client-release/pull-windows-artifacts.sh desktop "$DESKTOP_VERSION"

make desktop-publish
```

## Windows hosts

- `win-lan`: office LAN Studio host
- `win-cf`: remote Studio host through Cloudflare Access

Prefer `win-lan` when reachable. Never disable SSH host-key checking.

## CI release

- `desktop-v*` tags run `.github/workflows/desktop-release.yml`.
- `connect-v*` tags run `.github/workflows/connect-release.yml`.

The Connect workflow requires `BOXAI_CONNECT_UPDATE_SIGNING_KEY` and R2
production secrets. It does not silently downgrade to an unsigned update feed.

## Verification

```bash
curl -fsS https://dl.you-box.com/connect/releases.json | jq '.version, .downloads'
curl -fsS https://dl.you-box.com/connect/native-latest.json | jq '.version, (.platforms | keys)'
curl -fsS https://dl.you-box.com/desktop/releases.json | jq '.version'
```

Verify every advertised artifact returns HTTP 200 and matches its manifest
size/hash. For Connect, verify both `darwin-arm64` and `win32-x64` are present;
the publisher must never advance a partial feed.

## Common failures

| Symptom | Action |
| --- | --- |
| Connect key mismatch | Use `connect-update-signing.pem`; do not use the Desktop minisign key |
| Missing native assertion | Rebuild on that target OS; never hand-write a report |
| Windows build cannot find NSIS/7-Zip | Install NSIS and 7-Zip on the Studio host |
| `win-lan` unreachable | Set `BOXAI_WIN_SSH_HOST=win-cf` |
| R2 feed points at missing bytes | Stop; upload immutable artifacts before feeds and republish |
| macOS or SmartScreen warning | Expected until OS signing/notarization is introduced; report it truthfully |
