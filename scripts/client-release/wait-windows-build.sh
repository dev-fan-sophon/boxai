#!/usr/bin/env bash
# Poll the Studio Windows host until a remote product build finishes.
set -euo pipefail

PRODUCT="${1:?product: desktop|connect}"
HOST="${BOXAI_WIN_SSH_HOST:-win-cf}"
TIMEOUT_SEC="${BOXAI_WIN_BUILD_TIMEOUT:-7200}"
SLEEP_SEC=30

case "$PRODUCT" in
  desktop) DONE="build_desktop_remote.done"; LOG="build_desktop_remote.log" ;;
  connect) DONE="build_connect_remote.done"; LOG="build_connect_remote.log" ;;
  *) echo "unknown product" >&2; exit 2 ;;
esac

echo "==> waiting for $PRODUCT on $HOST (timeout ${TIMEOUT_SEC}s)"
start=$(date +%s)
while true; do
  now=$(date +%s)
  if (( now - start > TIMEOUT_SEC )); then
    echo "TIMEOUT after ${TIMEOUT_SEC}s" >&2
    ssh -o BatchMode=yes "$HOST" "cmd /c type C:\\Users\\win\\${LOG}" | tail -40 || true
    exit 1
  fi
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=30 "$HOST" "cmd /c if exist C:\\Users\\win\\${DONE} (type C:\\Users\\win\\${DONE}) else (echo pending)" 2>/dev/null || echo "ssh-fail")
  echo "    $(date +%H:%M:%S) $out"
  if [[ "$out" == exit=0* ]]; then
    echo "BUILD_OK $PRODUCT"
    ssh -o BatchMode=yes "$HOST" "cmd /c type C:\\Users\\win\\${LOG}" | tail -30
    exit 0
  fi
  if [[ "$out" == exit=* ]]; then
    echo "BUILD_FAILED $out" >&2
    ssh -o BatchMode=yes "$HOST" "cmd /c type C:\\Users\\win\\${LOG}" | tail -80
    exit 1
  fi
  sleep "$SLEEP_SEC"
done
