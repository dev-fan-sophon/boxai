#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/connector-release.json")"
STAGE="${BOXAI_RELEASE_STAGE:-$ROOT/release/$VERSION}"
export BOXAI_RELEASE_STAGE="$STAGE"
# Connector staging currently produces unsigned archives. Refuse publication
# until the platform-specific signing/notarization step has been implemented
# and the release manifest can truthfully mark the artifacts as signed.
echo "ERROR: BoxAI Connector publication is blocked until Windows code signing and macOS signing/notarization are configured" >&2
exit 1
