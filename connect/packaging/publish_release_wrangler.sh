#!/usr/bin/env bash
# Publish a staged Connect release to R2 via wrangler (Cloudflare API token),
# for environments that have CLOUDFLARE_API_TOKEN but not S3-style R2_DESKTOP_* keys.
#
# Required:
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ACCOUNT_ID   (default: 小 QQ account)
#   BOXAI_RELEASE_STAGE     directory with staged installers
# Optional:
#   CLOUDFLARE_ZONE_ID      purge edge cache for manifests
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONNECT="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$CONNECT/.." && pwd)"
VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$CONNECT/src-tauri/tauri.conf.json")"
STAGE="${BOXAI_RELEASE_STAGE:-$CONNECT/release/$VERSION}"
BUCKET="${BOXAI_RELEASE_BUCKET:-boxai-desktop}"
PREFIX=connect
BASE_URL="${BOXAI_RELEASE_BASE_URL:-https://dl.you-box.com/$PREFIX}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-4379d21a3d3eadc0e37d63abff091f31}"

[ -d "$STAGE" ] || { echo "ERROR: no staged release at $STAGE" >&2; exit 1; }
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "ERROR: CLOUDFLARE_API_TOKEN unset" >&2; exit 1; }

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
export CLOUDFLARE_API_TOKEN

echo "==> [1/4] composing manifests for $VERSION"
python3 "$REPO/desktop/packaging/make_release_manifests.py" \
  --version "$VERSION" --dist "$STAGE" --base-url "$BASE_URL" --product connect \
  --notes "${BOXAI_RELEASE_NOTES:-BoxAI Connect $VERSION}"

echo "==> [2/4] uploading artifacts to r2://$BUCKET/$PREFIX/$VERSION/ via wrangler"
shopt -s nullglob
for f in "$STAGE"/*; do
  base="$(basename "$f")"
  case "$base" in
    latest.json|releases.json) continue ;;
  esac
  [ -f "$f" ] || continue
  echo "    $base"
  npx --yes wrangler@4 r2 object put "$BUCKET/$PREFIX/$VERSION/$base" --remote --file "$f" >/dev/null
done

echo "==> [3/4] publishing manifests"
for manifest in latest.json releases.json; do
  [ -f "$STAGE/$manifest" ] || continue
  echo "    $manifest"
  npx --yes wrangler@4 r2 object put "$BUCKET/$PREFIX/$manifest" --remote --file "$STAGE/$manifest" \
    --content-type application/json >/dev/null
done

echo "==> [4/4] purging the edge cache"
if [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
  curl -fsS -X POST \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
    -d "{\"files\":[\"$BASE_URL/latest.json\",\"$BASE_URL/releases.json\"]}" >/dev/null
  echo "    purged latest.json + releases.json"
else
  echo "    WARNING: CLOUDFLARE_ZONE_ID unset — manifests stay cached for up to 60s"
fi

echo ""
echo "Published BoxAI Connect $VERSION"
echo "  updater  $BASE_URL/latest.json"
echo "  website  $BASE_URL/releases.json"
