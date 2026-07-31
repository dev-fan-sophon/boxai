#!/usr/bin/env bash
# Pull staged Windows installers from the Studio Windows host into local stage dirs.
#
# Env:
#   BOXAI_WIN_SSH_HOST   SSH host alias (default: win-cf; fallback try win-lan)
#   BOXAI_WIN_USER       Remote user (default: win)
#
# Usage:
#   bash scripts/client-release/pull-windows-artifacts.sh desktop 0.1.7
#   bash scripts/client-release/pull-windows-artifacts.sh connect 0.1.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PRODUCT="${1:?product: desktop|connect}"
VERSION="${2:?version e.g. 0.1.7}"
HOST="${BOXAI_WIN_SSH_HOST:-win-cf}"
USER="${BOXAI_WIN_USER:-win}"

case "$PRODUCT" in
  desktop)
    REMOTE_STAGE="C:/Users/${USER}/src/boxai-desktop-${VERSION}/desktop/release/${VERSION}"
    LOCAL_STAGE="$ROOT/desktop/release/${VERSION}"
    NEED=(
      BoxAI-Desktop-windows-setup.exe
      BoxAI-Desktop-windows-setup.exe.sig
      BoxAI-Desktop-windows.msi
      BoxAI-Desktop-windows.msi.sig
    )
    ;;
  connect)
    REMOTE_STAGE="C:/Users/${USER}/src/boxai-connect-${VERSION}/connect/release/${VERSION}"
    LOCAL_STAGE="$ROOT/connect/release/${VERSION}"
    NEED=(
      BoxAI-Connect-windows-setup.exe
      BoxAI-Connect-windows-setup.exe.sig
      BoxAI-Connect-windows.msi
      BoxAI-Connect-windows.msi.sig
    )
    ;;
  *)
    echo "unknown product: $PRODUCT" >&2
    exit 2
    ;;
esac

mkdir -p "$LOCAL_STAGE"
echo "==> pull $PRODUCT $VERSION from ${HOST}:${REMOTE_STAGE}"
echo "    -> $LOCAL_STAGE"

# List remote stage first
ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" "cmd /c dir /b $(echo "$REMOTE_STAGE" | sed 's|/|\\|g')" || {
  echo "ERROR: cannot list remote stage (build not finished or path wrong)" >&2
  exit 1
}

for f in "${NEED[@]}"; do
  echo "    $f"
  scp -o BatchMode=yes -o ConnectTimeout=30 \
    "${HOST}:${REMOTE_STAGE}/${f}" \
    "$LOCAL_STAGE/$f"
done

echo ""
ls -la "$LOCAL_STAGE"
echo "PULL_OK $PRODUCT $VERSION"
