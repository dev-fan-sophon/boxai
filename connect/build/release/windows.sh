#!/usr/bin/env bash
# Git Bash on native Windows x64; Go, GNU make, and NSIS must be on PATH.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:?usage: windows.sh VERSION OUTPUT_DIRECTORY}"
OUT="${2:?absolute Git Bash output directory required}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$OUT" = /* ]]
[[ "$VERSION" = "$(cat build/release/VERSION)" ]]
[[ "$(go env GOHOSTOS)/$(go env GOHOSTARCH)" = windows/amd64 ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
mkdir -p "$OUT"
EXE="$OUT/magpie-windows-amd64.exe"
SETUP="$OUT/BoxAI-Connect-$VERSION-windows-x64-setup.exe"
[[ ! -e "$EXE" && ! -e "$SETUP" ]]
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GOPATH="$(go env GOPATH)" GOCACHE="$(go env GOCACHE)"
export HOME="$WORK/home" USERPROFILE="$(cygpath -w "$WORK/home")"
export APPDATA="$(cygpath -w "$WORK/home/AppData/Roaming")"
export LOCALAPPDATA="$(cygpath -w "$WORK/home/AppData/Local")"
mkdir -p "$HOME/AppData/Roaming" "$HOME/AppData/Local"
# Packaging only: run focused tests in the sandbox, never agent tests on this host.
make release-windows VERSION="$VERSION"
cp dist/magpie-windows-amd64.exe "$EXE"
makensis -WX -DVERSION="$VERSION" -DLICENSE="$(cygpath -aw LICENSE)" -DPAYLOAD="$(cygpath -w "$EXE")" -DOUTPUT="$(cygpath -w "$SETUP")" build/release/windows.nsi
sha256sum "$EXE" "$SETUP"
git rev-parse HEAD > "$OUT/windows-source.txt"
echo 'Built unsigned; application not launched and agent configurations not tested.'
