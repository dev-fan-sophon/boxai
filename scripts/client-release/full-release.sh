#!/usr/bin/env bash
# Full BoxAI client release (Desktop + Connect): macOS local + Windows remote + R2 publish.
#
# Prerequisites on Mac:
#   - Repo at release commit (main pushed)
#   - ~/.config/boxai/desktop-updater.key
#   - .env.cloudflare with R2_* + CLOUDFLARE_* for publish
#   - SSH Host win-cf (or win-lan) in ~/.ssh/config
#
# Steps:
#   1) macOS Desktop DMG + Connect app/dmg (arm64)
#   2) stage macOS artifacts
#   3) Windows Desktop + Connect builds on win-cf
#   4) pull Windows artifacts into stage dirs
#   5) publish both products to https://dl.you-box.com
#
# Usage:
#   bash scripts/client-release/full-release.sh
#   BOXAI_WIN_SSH_HOST=win-lan bash scripts/client-release/full-release.sh
#   SKIP_MAC=1 bash scripts/client-release/full-release.sh   # only Windows + publish
#   SKIP_WIN=1 bash scripts/client-release/full-release.sh   # only macOS + publish (if win already staged)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
HOST="${BOXAI_WIN_SSH_HOST:-win-cf}"
REF="${BOXAI_RELEASE_REF:-main}"
SKIP_MAC="${SKIP_MAC:-0}"
SKIP_WIN="${SKIP_WIN:-0}"

DESKTOP_VER="$(python3 -c "import json;print(json.load(open('desktop/surfaces/gui/src-tauri/tauri.conf.json'))['version'])")"
CONNECT_VER="$(python3 -c "import json;print(json.load(open('connect/src-tauri/tauri.conf.json'))['version'])")"

echo "=========================================="
echo " BoxAI client release"
echo "   Desktop  $DESKTOP_VER"
echo "   Connect  $CONNECT_VER"
echo "   ref      $REF"
echo "   win host $HOST"
echo "=========================================="

export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.config/boxai/desktop-updater.key}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if [[ "$SKIP_MAC" != "1" ]]; then
  echo ""
  echo "==> [mac] Desktop build"
  make desktop-build
  make desktop-stage

  echo ""
  echo "==> [mac] Connect build"
  make connect-build
  make connect-stage
else
  echo "==> skip macOS builds"
fi

if [[ "$SKIP_WIN" != "1" ]]; then
  echo ""
  echo "==> [win] Desktop + Connect (sequential; MSVC is heavy)"
  bash scripts/client-release/run-windows-build.sh desktop "$REF"
  bash scripts/client-release/wait-windows-build.sh desktop
  bash scripts/client-release/pull-windows-artifacts.sh desktop "$DESKTOP_VER"

  bash scripts/client-release/run-windows-build.sh connect "$REF"
  bash scripts/client-release/wait-windows-build.sh connect
  bash scripts/client-release/pull-windows-artifacts.sh connect "$CONNECT_VER"
else
  echo "==> skip Windows builds"
fi

echo ""
echo "==> publish Desktop $DESKTOP_VER"
set -a
# shellcheck disable=SC1091
[[ -f .env.cloudflare ]] && source .env.cloudflare
set +a
make desktop-publish

echo ""
echo "==> publish Connect $CONNECT_VER"
make connect-publish

echo ""
echo "=========================================="
echo " Published"
echo "   https://dl.you-box.com/desktop/latest.json"
echo "   https://dl.you-box.com/desktop/releases.json"
echo "   https://dl.you-box.com/connect/latest.json"
echo "   https://dl.you-box.com/connect/releases.json"
echo "=========================================="
