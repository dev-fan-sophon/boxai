#!/usr/bin/env bash
# Upload remote driver + kick off a Windows product build on the Studio host.
#
# Usage:
#   bash scripts/client-release/run-windows-build.sh desktop [ref]
#   bash scripts/client-release/run-windows-build.sh connect [ref]
#
# Logs on the host:
#   %USERPROFILE%\build_desktop_remote.log  /  build_connect_remote.log
# Done markers:
#   %USERPROFILE%\build_desktop_remote.done /  build_connect_remote.done  (exit=0)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PRODUCT="${1:?product: desktop|connect}"
REF="${2:-main}"
HOST="${BOXAI_WIN_SSH_HOST:-win-cf}"

case "$PRODUCT" in
  desktop)
    LOCAL_PS1="$ROOT/desktop/packaging/win_remote_build.ps1"
    REMOTE_PS1="C:/Users/win/win_remote_build_desktop.ps1"
    LOG="build_desktop_remote.log"
    DONE="build_desktop_remote.done"
    ;;
  connect)
    LOCAL_PS1="$ROOT/connect/packaging/win_remote_build.ps1"
    REMOTE_PS1="C:/Users/win/win_remote_build_connect.ps1"
    LOG="build_connect_remote.log"
    DONE="build_connect_remote.done"
    ;;
  *)
    echo "unknown product: $PRODUCT" >&2
    exit 2
    ;;
esac

[ -f "$LOCAL_PS1" ] || { echo "missing $LOCAL_PS1" >&2; exit 1; }

echo "==> upload driver -> $HOST:$REMOTE_PS1"
scp -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=15 \
  "$LOCAL_PS1" "${HOST}:${REMOTE_PS1}"

WIN_PS1="${REMOTE_PS1//\//\\}"
echo "==> start $PRODUCT build (ref=$REF) on $HOST"
# Detach with Start-Process so the SSH session can exit without killing the build.
ssh -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=15 "$HOST" \
  "powershell -NoProfile -Command \"if (Test-Path 'C:\\Users\\win\\${DONE}') { Remove-Item -Force 'C:\\Users\\win\\${DONE}' }; Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${WIN_PS1}','-Ref','${REF}') -WindowStyle Hidden; Write-Output 'started'\""

echo "    build started. poll with:"
echo "    bash scripts/client-release/wait-windows-build.sh $PRODUCT"
