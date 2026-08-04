#!/usr/bin/env bash
# Build frontend + Go binary inside a release directory on the production host.
# Usage: build-native.sh /opt/boxai/releases/<id>
set -euo pipefail

ROOT="${1:-}"
[[ -n "$ROOT" && -d "$ROOT" ]] || {
  echo "usage: $0 /path/to/release" >&2
  exit 2
}

APP_ROOT="${BOXAI_APP_ROOT:-/opt/boxai}"

export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
export GO111MODULE=on
export CGO_ENABLED=0
export GOEXPERIMENT=greenteagc

cd "$ROOT"

VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo dev)"
echo "==> building web default (v${VERSION})"
(
  cd web
  bun install --frozen-lockfile
  cd default
  DISABLE_ESLINT_PLUGIN=true VITE_REACT_APP_VERSION="$VERSION" bun run build
)

# Publish SPA to on-disk layout for WEB_DIST_DIR (/opt/boxai/web).
# Atomic symlink flip — running gateway picks this up without restart when
# WEB_DIST_DIR is set (see deploy/boxai.service). Embed remains the fallback.
if [[ -f "${ROOT}/web/default/dist/index.html" ]]; then
  RELEASE_ID="$(basename "$ROOT")"
  WEB_RELEASES="${APP_ROOT}/web-releases"
  WEB_LINK="${APP_ROOT}/web"
  TARGET="${WEB_RELEASES}/${RELEASE_ID}"
  echo "==> publish web dist → ${TARGET}"
  rm -rf "$TARGET"
  mkdir -p "$TARGET"
  # Copy contents (not the dist directory node) so TARGET/index.html exists.
  cp -a "${ROOT}/web/default/dist/." "$TARGET/"
  test -f "${TARGET}/index.html"
  tmp="${WEB_LINK}.next.$$"
  rm -f "$tmp"
  ln -s "$TARGET" "$tmp"
  mv -Tf "$tmp" "$WEB_LINK"
  echo "==> WEB_DIST ${WEB_LINK} → ${TARGET}"
else
  echo "WARN: web/default/dist/index.html missing; skip disk web publish" >&2
fi

echo "==> installing chat-service dependencies"
(
  cd chat-service
  bun install --frozen-lockfile --production
)

echo "==> building go binary"
go mod download
go build -ldflags "-s -w -X 'github.com/dev-fan-sophon/boxai/common.Version=${VERSION}'" -o new-api .

mkdir -p "${APP_ROOT}/bin" "${APP_ROOT}/logs" "${APP_ROOT}/data"
install -m 755 new-api "${APP_ROOT}/bin/new-api.next"
echo "==> staged ${APP_ROOT}/bin/new-api.next"
"${APP_ROOT}/bin/new-api.next" --help >/dev/null 2>&1 || true
echo "BUILD_OK ${VERSION}"
