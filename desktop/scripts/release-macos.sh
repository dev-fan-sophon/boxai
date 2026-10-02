#!/usr/bin/env bash
# BoxAI native macOS build. Signing is opt-in via BOXAI_MAC_SIGN=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo 'BoxAI macOS releases require a native arm64 Mac' >&2
  exit 1
}
pnpm -C "$ROOT" dist
node "$ROOT/../scripts/client-release/desktop-native.mjs"
