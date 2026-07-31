---
name: releasing-boxai-clients
description: Build, stage, and publish BoxAI Desktop and BoxAI Connect for macOS and Windows (including the Studio Windows SSH host), then push artifacts to Cloudflare R2 at dl.you-box.com.
---

# Releasing BoxAI clients (Desktop + Connect)

Use this skill whenever the user asks to **ship / release / publish / rebuild** BoxAI Desktop or BoxAI Connect installers, refresh client icons across platforms, or run the **full multi-machine release**.

## Products

| Product | Path | Version file | CDN prefix | Make targets |
|---------|------|--------------|------------|--------------|
| **BoxAI Desktop** | `desktop/` | `desktop/surfaces/gui/src-tauri/tauri.conf.json` | `https://dl.you-box.com/desktop/` | `desktop-build` `desktop-stage` `desktop-publish` |
| **BoxAI Connect** | `connect/` | `connect/src-tauri/tauri.conf.json` | `https://dl.you-box.com/connect/` | `connect-build` `connect-stage` `connect-publish` |

Both share:

- Updater minisign key: `~/.config/boxai/desktop-updater.key` (+ `.pub` baked into each `tauri.conf.json`)
- Publish script: `desktop/packaging/publish_release.sh` (`BOXAI_RELEASE_PRODUCT=connect` for Connect)
- R2 bucket `boxai-desktop`, credentials in **`.env.cloudflare`**: `R2_DESKTOP_*`, `R2_ENDPOINT`, plus `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` for cache purge

## Architecture (who builds what)

```
┌─────────────────────┐     stage      ┌──────────────────────────┐
│ Mac (arm64)         │ ─────────────► │ desktop/release/<ver>/   │
│ make desktop-build  │                │ connect/release/<ver>/   │
│ make connect-build  │                └────────────▲─────────────┘
└─────────────────────┘                             │ pull scp
                                                    │
┌─────────────────────┐   win_remote_build.ps1      │
│ Windows Studio host │ ────────────────────────────┘
│ SSH: win-cf / win-lan
│ packaging/build_windows.ps1  (Desktop)
│ pnpm tauri build             (Connect)
└─────────────────────┘
         │
         ▼  make desktop-publish / connect-publish
   Cloudflare R2 → https://dl.you-box.com/{desktop,connect}/
```

### Windows SSH hosts (`~/.ssh/config`)

| Alias | When | Host |
|-------|------|------|
| **`win-lan`** | On office LAN | `192.168.31.135` user `win` |
| **`win-cf`** | Remote / default | `studio-win.origingame.dev` via `cloudflared access ssh` user `win` |

Prefer `win-lan` when reachable; otherwise `BOXAI_WIN_SSH_HOST=win-cf` (default in scripts).

Host layout (Windows user `win`):

| Path | Role |
|------|------|
| `C:\Users\win\.config\boxai\desktop-updater.key` | Updater private key (must match pubkey in tauri.conf) |
| `C:\Users\win\src\boxai-desktop-<ver>\` | Clean clone for Desktop build |
| `C:\Users\win\src\boxai-connect-<ver>\` | Clean clone for Connect build |
| `C:\Users\win\build_*_remote.log` | Build logs |
| `C:\Users\win\build_*_remote.done` | `exit=0` when finished |

## One-shot full release

From repo root on Mac (after the release commit is **pushed** so Windows can `git clone`):

```bash
# Optional: LAN host
# export BOXAI_WIN_SSH_HOST=win-lan

bash scripts/client-release/full-release.sh
```

Flags:

| Env | Effect |
|-----|--------|
| `SKIP_MAC=1` | Only Windows + publish (macOS already staged) |
| `SKIP_WIN=1` | Only macOS + publish (Windows already staged) |
| `BOXAI_RELEASE_REF=main` | Git ref Windows clones (default `main`) |
| `BOXAI_WIN_SSH_HOST` | `win-cf` or `win-lan` |

## Step-by-step (manual)

### 0. Preflight

```bash
# Versions
python3 -c "import json;print('desktop',json.load(open('desktop/surfaces/gui/src-tauri/tauri.conf.json'))['version'])"
python3 -c "import json;print('connect',json.load(open('connect/src-tauri/tauri.conf.json'))['version'])"

# Signing key (pubkey must match tauri.conf plugins.updater.pubkey)
test -f ~/.config/boxai/desktop-updater.key

# Publish env
set -a; source .env.cloudflare; set +a
test -n "$R2_DESKTOP_ACCESS_KEY_ID" && test -n "$R2_ENDPOINT"

# Windows SSH
ssh -o BatchMode=yes -o ConnectTimeout=15 win-cf "echo ok"
# or: ssh win-lan "echo ok"

# Push release commit first (Windows clones from GitHub)
git push origin HEAD
```

### 1. macOS builds

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/boxai/desktop-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

make desktop-build    # packaging/build_dmg.sh → arm64 DMG + updater tar.gz
make desktop-stage    # → desktop/release/<ver>/

make connect-build    # pnpm tauri build (needs signing key env)
make connect-stage    # → connect/release/<ver>/
```

**Connect signing tip:** if `pnpm tauri build` fails with “public key found but no private key”, export `TAURI_SIGNING_PRIVATE_KEY` to the **path** of `desktop-updater.key` (not `updater.key` — wrong pubkey).

### 2. Windows builds (Studio host)

```bash
# Desktop
bash scripts/client-release/run-windows-build.sh desktop main
bash scripts/client-release/wait-windows-build.sh desktop
bash scripts/client-release/pull-windows-artifacts.sh desktop 0.1.7   # use real version

# Connect
bash scripts/client-release/run-windows-build.sh connect main
bash scripts/client-release/wait-windows-build.sh connect
bash scripts/client-release/pull-windows-artifacts.sh connect 0.1.0
```

Drivers (uploaded automatically):

- `desktop/packaging/win_remote_build.ps1`
- `connect/packaging/win_remote_build.ps1`

They clone `main` (or `-Ref`), build, run `stage_release.sh` under Git Bash, write `exit=0` to the done marker.

Tail logs while waiting:

```bash
ssh win-cf "cmd /c type C:\\Users\\win\\build_desktop_remote.log"
ssh win-cf "cmd /c type C:\\Users\\win\\build_connect_remote.log"
```

### 3. Stage completeness checklist

Before publish, each product stage dir should contain:

**Desktop** `desktop/release/<ver>/`:

- `BoxAI-Desktop-macos-arm64.dmg` + `.app.tar.gz` + `.sig`
- `BoxAI-Desktop-windows-setup.exe` + `.sig`
- `BoxAI-Desktop-windows.msi` + `.sig`

**Connect** `connect/release/<ver>/`:

- `BoxAI-Connect-macos-arm64.dmg` + `.app.tar.gz` + `.sig`
- optionally `BoxAI-Connect-macos-x64.*` if cross-built
- `BoxAI-Connect-windows-setup.exe` + `.sig`
- `BoxAI-Connect-windows.msi` + `.sig`

`publish_release.sh` only ships platforms it can hash; missing Windows silently drops that platform from the manifest — always verify after publish.

### 4. Publish to R2

```bash
set -a; source .env.cloudflare; set +a
make desktop-publish
make connect-publish
```

Verify:

```bash
curl -fsS https://dl.you-box.com/desktop/releases.json | head -c 400; echo
curl -fsS https://dl.you-box.com/connect/releases.json | head -c 400; echo
```

Website download buttons read those manifests (`web/default` → `useAppRelease`).

## Version bumps

1. Edit `version` in the product’s `tauri.conf.json`
2. Commit + push
3. Optional tags for CI: `desktop-v0.1.8`, `connect-v0.1.1` (see `.github/workflows/*-release.yml`)
4. Run full release (local path above **or** tag-triggered GitHub Actions)

Do **not** re-use an old Windows binary under a new version number.

## Brand icons

App icons live under:

- Desktop: `desktop/surfaces/gui/src-tauri/icons/`
- Connect: `connect/src-tauri/icons/`
- Web marketing: `web/default/public/brand/{desktop,connect}-icon.png`

Regenerate from the mark kit:

```bash
python3 logo/scripts/build-brand-kit.py
```

Then rebuild **all** platforms so Dock / Explorer / installers match the site.

## Common failures

| Symptom | Fix |
|---------|-----|
| `no private key` / updater sign fail (Mac Connect) | `export TAURI_SIGNING_PRIVATE_KEY=$HOME/.config/boxai/desktop-updater.key` |
| `incorrect updater private key password` | Use **file path** for key env; empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; Desktop uses `win_tauri_build.mjs` on Windows |
| Windows `No route to host` (win-lan) | Use `win-cf` + cloudflared login |
| Stage has only macOS | Windows build not pulled — re-run `pull-windows-artifacts.sh` |
| Publish missing Windows in JSON | Stage dir missing `.exe` / `.msi` — check remote `STAGED` lines in log |
| Deploy web incomplete `common/` | Rare race on `git archive \| ssh tar`; re-run `make deploy` once |
| SmartScreen on Windows | Expected until Authenticode; users use “More info → Run anyway” |

## CI alternative

- Tag `desktop-v*`: `.github/workflows/desktop-release.yml` (matrix mac + windows, then R2 publish job)
- Tag `connect-v*`: `.github/workflows/connect-release.yml`

Local + Studio Windows is the emergency / icon-hotfix path when you need control without waiting for Actions.

## Agent checklist (do in order)

1. Confirm commit with icons/version is **pushed**
2. Preflight keys + SSH + `.env.cloudflare`
3. Prefer `bash scripts/client-release/full-release.sh` over ad-hoc commands
4. If only Windows missing: `SKIP_MAC=1` after mac stage is good
5. After publish, `curl` both `releases.json` and confirm Windows URLs return 200
6. Report residual (e.g. macOS x64 Connect not rebuilt on arm64-only Mac)
