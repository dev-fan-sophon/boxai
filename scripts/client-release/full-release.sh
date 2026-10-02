#!/usr/bin/env bash
# Desktop only. Connect has its own independent release lifecycle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
REF="${BOXAI_RELEASE_REF:-$(git rev-parse HEAD)}"
VERSION="$(node -p 'require("./desktop/apps/desktop/package.json").version')"
if [[ "${SKIP_MAC:-0}" != 1 ]]; then
  make desktop-build desktop-stage
fi
if [[ "${SKIP_WIN:-0}" != 1 ]]; then
  bash scripts/client-release/run-windows-build.sh desktop "$REF"
  bash scripts/client-release/wait-windows-build.sh desktop
  bash scripts/client-release/pull-windows-artifacts.sh desktop "$VERSION"
fi
# Preparation is local. Publication is a separate, explicit command on main.
python3 scripts/client-release/desktop_release.py
echo 'Both native stages prepared. To publish the accepted main commit: make desktop-publish'
