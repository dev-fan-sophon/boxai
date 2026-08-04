#!/usr/bin/env bash
# Publish only the SPA to production disk (no Go rebuild, no systemctl restart).
#
# Requires the running gateway to have WEB_DIST_DIR=/opt/boxai/web (set in
# deploy/boxai.service). Until the first successful full deploy that installs
# that unit + this layout, run a normal `make deploy` once.
#
# Usage:
#   ./scripts/deploy-web.sh              # build local dist, upload, flip symlink
#   ./scripts/deploy-web.sh --skip-build # upload existing web/default/dist
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_ROOT="/opt/boxai"
WEB_LINK="${APP_ROOT}/web"
WEB_RELEASES="${APP_ROOT}/web-releases"
WEB_DIR="./web/default"
DIST_DIR="${WEB_DIR}/dist"

SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -f .env.boxai-admin ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.boxai-admin
  set +a
fi

: "${BOXAI_SSH_HOST:?BOXAI_SSH_HOST required}"
: "${BOXAI_SSH_USER:?BOXAI_SSH_USER required}"
: "${BOXAI_BASE_URL:?BOXAI_BASE_URL required}"

TMP_SSH_DIR=""
cleanup_ssh_tmp() {
  if [[ -n "${TMP_SSH_DIR:-}" && -d "${TMP_SSH_DIR}" ]]; then
    rm -rf "${TMP_SSH_DIR}"
  fi
}
trap cleanup_ssh_tmp EXIT

KEY_FILE="${BOXAI_SSH_KEY_FILE:-}"
KNOWN_HOSTS="${BOXAI_SSH_KNOWN_HOSTS_FILE:-}"
if [[ -z "$KEY_FILE" || -z "$KNOWN_HOSTS" ]]; then
  if [[ -n "${BOXAI_SSH_PRIVATE_KEY:-}" || -n "${BOXAI_SSH_HOST_KEY:-}" ]]; then
    TMP_SSH_DIR="$(mktemp -d)"
    chmod 700 "$TMP_SSH_DIR"
    if [[ -z "$KEY_FILE" ]]; then
      : "${BOXAI_SSH_PRIVATE_KEY:?BOXAI_SSH_PRIVATE_KEY or BOXAI_SSH_KEY_FILE required}"
      KEY_FILE="${TMP_SSH_DIR}/id"
      if [[ "${BOXAI_SSH_PRIVATE_KEY}" == -----BEGIN* ]]; then
        printf '%s\n' "${BOXAI_SSH_PRIVATE_KEY}" >"$KEY_FILE"
      else
        printf '%s' "${BOXAI_SSH_PRIVATE_KEY}" | base64 -d >"$KEY_FILE" 2>/dev/null \
          || printf '%s\n' "${BOXAI_SSH_PRIVATE_KEY}" >"$KEY_FILE"
      fi
      if command -v sed >/dev/null 2>&1; then
        sed -i.bak 's/\r$//' "$KEY_FILE" 2>/dev/null || sed -i '' 's/\r$//' "$KEY_FILE" 2>/dev/null || true
        rm -f "${KEY_FILE}.bak"
      fi
      chmod 600 "$KEY_FILE"
    fi
    if [[ -z "$KNOWN_HOSTS" ]]; then
      : "${BOXAI_SSH_HOST_KEY:?BOXAI_SSH_HOST_KEY or BOXAI_SSH_KNOWN_HOSTS_FILE required}"
      KNOWN_HOSTS="${TMP_SSH_DIR}/known_hosts"
      printf '%s\n' "${BOXAI_SSH_HOST_KEY}" >"$KNOWN_HOSTS"
      chmod 600 "$KNOWN_HOSTS"
    fi
  else
    KEY_FILE="${HOME}/.ssh/boxai_orb_ed25519"
    KNOWN_HOSTS="${HOME}/.ssh/boxai_known_hosts"
  fi
fi

if [[ ! -f "$KEY_FILE" ]]; then
  echo "SSH private key file missing: $KEY_FILE" >&2
  exit 1
fi
if [[ ! -f "$KNOWN_HOSTS" ]]; then
  echo "SSH known_hosts file missing: $KNOWN_HOSTS" >&2
  exit 1
fi

PORT="${BOXAI_SSH_PORT:-22}"
if [[ -z "$PORT" ]]; then
  PORT=22
fi
SSH=(ssh -i "$KEY_FILE" -p "$PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  -- "${BOXAI_SSH_USER}@${BOXAI_SSH_HOST}")
SCP=(scp -i "$KEY_FILE" -P "$PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS")

VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo dev)"
GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo nogit)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_SHA}"

echo "==> deploy-web release=${RELEASE_ID} version=${VERSION} host=${BOXAI_SSH_HOST}"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> build web default (v${VERSION})"
  (
    cd web
    bun install --frozen-lockfile
    cd default
    DISABLE_ESLINT_PLUGIN=true VITE_REACT_APP_VERSION="$VERSION" bun run build
  )
fi

if [[ ! -f "${DIST_DIR}/index.html" ]]; then
  echo "missing ${DIST_DIR}/index.html — run without --skip-build or build first" >&2
  exit 1
fi

echo "==> upload dist → ${WEB_RELEASES}/${RELEASE_ID}"
"${SSH[@]}" "mkdir -p '${WEB_RELEASES}/${RELEASE_ID}' '${APP_ROOT}/logs'"
# Archive dist contents (not the dist folder name) into the release dir.
tar -C "$DIST_DIR" -czf - . | "${SSH[@]}" \
  "tar -xz -C '${WEB_RELEASES}/${RELEASE_ID}' && test -f '${WEB_RELEASES}/${RELEASE_ID}/index.html'"

echo "==> atomic symlink ${WEB_LINK} → web-releases/${RELEASE_ID}"
"${SSH[@]}" bash -s -- "$APP_ROOT" "$WEB_LINK" "$WEB_RELEASES" "$RELEASE_ID" <<'REMOTE'
set -euo pipefail
APP_ROOT="$1"
WEB_LINK="$2"
WEB_RELEASES="$3"
RELEASE_ID="$4"
TARGET="${WEB_RELEASES}/${RELEASE_ID}"
test -f "${TARGET}/index.html"
# Atomic replace: ln -sfn is not always atomic on all FS for busy readers;
# rename-over is. Create link in same directory then mv -Tf.
tmp="${WEB_LINK}.next.$$"
rm -f "$tmp"
ln -s "$TARGET" "$tmp"
mv -Tf "$tmp" "$WEB_LINK"
# Keep current + previous web release only
python3 - <<PY
import os, shutil
from pathlib import Path
rel = Path("${WEB_RELEASES}")
cur = Path("${WEB_LINK}").resolve().name
entries = sorted([p for p in rel.iterdir() if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True)
keep = set()
if cur:
    keep.add(cur)
for p in entries:
    if len(keep) >= 2:
        break
    keep.add(p.name)
for p in entries:
    if p.name not in keep:
        print(f"removing old web release {p.name}")
        shutil.rmtree(p, ignore_errors=True)
print("KEEP_WEB_RELEASES", sorted(keep))
PY
echo "WEB_LINK_OK $(readlink -f "${WEB_LINK}" 2>/dev/null || readlink "${WEB_LINK}")"
REMOTE

echo "==> public smoke (index + status; API process not restarted)"
# index.html is no-cache; hashed assets are long-cache. Hit a few paths.
curl -fsS -o /dev/null -w "GET / → %{http_code}\n" "${BOXAI_BASE_URL%/}/"
curl -fsS -o /dev/null -w "GET /sign-in → %{http_code}\n" "${BOXAI_BASE_URL%/}/sign-in"
curl -fsS "${BOXAI_BASE_URL%/}/api/status" | head -c 200
echo
echo "DEPLOY_WEB_OK ${RELEASE_ID}"
echo "Note: browser may hold old hashed chunks until hard refresh if CDN/cache sits in front;"
echo "      index.html is no-cache so new deploys should pick up new asset names on next navigation."
