#!/usr/bin/env bash
# Build frontend + Go binary inside a release directory on the production host.
# Usage: build-native.sh /opt/boxai2/releases/<id>
set -euo pipefail

ROOT="${1:-}"
[[ -n "$ROOT" && -d "$ROOT" ]] || {
  echo "usage: $0 /path/to/release" >&2
  exit 2
}

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

mkdir -p /opt/boxai2/bin /opt/boxai2/logs /opt/boxai2/data
install -m 755 new-api /opt/boxai2/bin/new-api
echo "==> installed /opt/boxai2/bin/new-api"
/opt/boxai2/bin/new-api --help >/dev/null 2>&1 || true
echo "BUILD_OK ${VERSION}"
