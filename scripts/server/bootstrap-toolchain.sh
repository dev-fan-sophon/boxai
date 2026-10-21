#!/usr/bin/env bash
# Install Go + Node + Bun on the production host (idempotent).
set -euo pipefail

GO_VERSION="${GO_VERSION:-1.26.10}"
NODE_VERSION="${NODE_VERSION:-24.22.1}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) GO_ARCH=amd64; NODE_ARCH=x64; BUN_ARCH=x64 ;;
  aarch64|arm64) GO_ARCH=arm64; NODE_ARCH=arm64; BUN_ARCH=aarch64 ;;
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

install_node() {
  if need_cmd node && [[ "$(node --version)" == "v${NODE_VERSION}" ]]; then
    echo "node ${NODE_VERSION} already installed"
    return 0
  fi
  echo "installing node ${NODE_VERSION} (${NODE_ARCH})..."
  local archive="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "$tmp/$archive"
  local checksum
  checksum="$(curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" |
    awk -v filename="$archive" '$2 == filename {print $1}')"
  [[ ${#checksum} -eq 64 ]]
  printf '%s  %s\n' "$checksum" "$tmp/$archive" | sha256sum --check --status
  local destination="/usr/local/node-v${NODE_VERSION}"
  mkdir -p "$destination"
  tar -C "$destination" --strip-components=1 -xzf "$tmp/$archive"
  rm -rf "$tmp"
  ln -sfn "$destination/bin/node" /usr/local/bin/node
  hash -r
  node --version
}

install_unzip() {
  if need_cmd unzip; then
    return 0
  fi
  echo "installing unzip..."
  if need_cmd apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq unzip ca-certificates curl
  elif need_cmd dnf; then
    dnf install -y unzip ca-certificates curl
  else
    echo "install unzip manually" >&2
    exit 1
  fi
}

install_bun() {
  if need_cmd bun; then
    echo "bun already installed: $(bun --version)"
    return 0
  fi
  install_unzip
  echo "installing bun..."
  curl -fsSL https://bun.sh/install | bash
  ln -sfn "$HOME/.bun/bin/bun" /usr/local/bin/bun
  bun --version
}

install_poppler() {
  # Document parsing (playground attachments) shells out to pdftotext/pdftoppm.
  if need_cmd pdftotext && need_cmd pdftoppm; then
    return 0
  fi
  echo "installing poppler-utils..."
  if need_cmd apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq poppler-utils
  elif need_cmd dnf; then
    dnf install -y poppler-utils
  else
    echo "install poppler-utils manually (pdftotext/pdftoppm required)" >&2
  fi
}

export PATH="/usr/local/go/bin:${HOME}/.bun/bin:/usr/local/bin:${PATH}"
install_go
install_node
install_bun
install_poppler
echo "toolchain ready"
