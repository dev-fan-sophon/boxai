#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/connector-release.json")"
STAGE="${BOXAI_RELEASE_STAGE:-$ROOT/release/$VERSION}"
BINARY="$ROOT/target/release/boxai-connector"
[ "$(uname -s)" = Darwin ] || { echo "BoxAI Connector GPUI packaging is macOS-only" >&2; exit 1; }
[ -x "$BINARY" ] || { echo "missing $BINARY; run cargo build --release --features gpui-app" >&2; exit 1; }
APP="$STAGE/BoxAI Connector.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/boxai-connector"
cp "$ROOT/packaging/icons/boxai-connector.icns" "$APP/Contents/Resources/boxai-connector.icns"
sed "s/@VERSION@/$VERSION/g" "$ROOT/packaging/Info.plist.in" > "$APP/Contents/Info.plist"
tar -C "$STAGE" -czf "$STAGE/BoxAI-Connector-macos-arm64.app.tar.gz" "BoxAI Connector.app"
rm -rf "$APP"
echo "Staged $STAGE/BoxAI-Connector-macos-arm64.app.tar.gz"
