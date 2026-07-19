#!/usr/bin/env bash
# Install Go + Bun on the production host (idempotent).
set -euo pipefail

GO_VERSION="${GO_VERSION:-1.25.1}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GO_ARCH=amd64; BUN_ARCH=x64 ;;
  aarch64|arm64) GO_ARCH=arm64; BUN_ARCH=aarch64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

need_cmd() { command -v "$1" >/dev/null 2>&1; }

install_go() {
  if need_cmd go; then
    local cur
    cur="$(go env GOVERSION 2>/dev/null || true)"
    if [[ "$cur" == "go${GO_VERSION}" ]]; then
      echo "go ${GO_VERSION} already installed"
      return 0
    fi
  fi
  echo "installing go ${GO_VERSION} (${GO_ARCH})..."
  local tgz="/tmp/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o "$tgz"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "$tgz"
  rm -f "$tgz"
  ln -sfn /usr/local/go/bin/go /usr/local/bin/go
  ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  go version
}

install_bun() {
  if need_cmd bun; then
    echo "bun already installed: $(bun --version)"
    return 0
  fi
  echo "installing bun..."
  curl -fsSL https://bun.sh/install | bash
  # shellcheck disable=SC1091
  source "$HOME/.bun/bin/bun" 2>/dev/null || true
  ln -sfn "$HOME/.bun/bin/bun" /usr/local/bin/bun
  bun --version
}

export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
install_go
install_bun
echo "toolchain ready"
