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

echo "==> building web classic"
(
  cd web
  bun install --filter ./classic --frozen-lockfile
  cd classic
  VITE_REACT_APP_VERSION="$VERSION" bun run build
)

echo "==> building go binary"
go mod download
go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=${VERSION}'" -o new-api .

mkdir -p "${APP_ROOT}/bin" "${APP_ROOT}/logs" "${APP_ROOT}/data"
install -m 755 new-api "${APP_ROOT}/bin/new-api"
echo "==> installed ${APP_ROOT}/bin/new-api"
"${APP_ROOT}/bin/new-api" --help >/dev/null 2>&1 || true
echo "BUILD_OK ${VERSION}"
