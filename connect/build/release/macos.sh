#!/usr/bin/env bash
# Run only in an isolated checkout of the accepted, pushed release commit.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:?usage: macos.sh VERSION OUTPUT_DIRECTORY}"
OUT="${2:?absolute output directory required}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$OUT" = /* ]]
[[ "$VERSION" = "$(cat build/release/VERSION)" ]]
[[ "$(uname -sm)" = 'Darwin arm64' ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
: "${APPLE_SIGNING_IDENTITY:?Developer ID Application identity required}"
: "${APPLE_ID:?notarization Apple ID required}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?notarization password required}"
: "${APPLE_TEAM_ID:?notarization team required}"
mkdir -p "$OUT"
DMG="$OUT/BoxAI-Connect-$VERSION-macos-arm64.dmg"
ZIP="$OUT/magpie-darwin-arm64.zip"
[[ ! -e "$DMG" && ! -e "$ZIP" ]]
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Packaging only: run focused tests in the sandbox, never agent tests on this host.
export GOPATH="$(go env GOPATH)" GOCACHE="$(go env GOCACHE)"
SIGNING_HOME="$HOME"
export HOME="$WORK/home"
mkdir -p "$HOME"
make app VERSION="$VERSION"
cp LICENSE magpie.app/Contents/Resources/LICENSE.txt
# Signing must use the existing login keychain; the app is never launched here.
export HOME="$SIGNING_HOME"
codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" magpie.app
codesign --verify --deep --strict magpie.app
ditto -c -k --keepParent magpie.app "$WORK/app.zip"
NOTARY=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
xcrun notarytool submit "$WORK/app.zip" "${NOTARY[@]}" --wait
xcrun stapler staple magpie.app
xcrun stapler validate magpie.app
spctl --assess --type execute magpie.app
# The upstream updater requires this exact root bundle name inside the ZIP.
ditto -c -k --keepParent magpie.app "$ZIP"
mkdir "$WORK/volume"
ditto magpie.app "$WORK/volume/BoxAI Connect.app"
ln -s /Applications "$WORK/volume/Applications"
hdiutil create -volname 'BoxAI Connect' -srcfolder "$WORK/volume" -format UDZO "$DMG"
codesign --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$DMG"
xcrun notarytool submit "$DMG" "${NOTARY[@]}" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature "$DMG"
shasum -a 256 "$DMG" "$ZIP"
git rev-parse HEAD > "$OUT/macos-source.txt"
echo 'Built and notarized; application not launched and agent configurations not tested.'
