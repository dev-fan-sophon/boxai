#!/usr/bin/env bash
# Publish immutable official Skill archives, then atomically activate the
# complete BoxAI Connect MCP/Skill catalog in production.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/.." && pwd)"
stage="${BOXAI_CONNECT_CATALOG_STAGE:-$root/dist/catalog}"
bucket="${BOXAI_RELEASE_BUCKET:-boxai-desktop}"
prefix="connect/catalog"
base_url="https://dl.you-box.com/$prefix"
env_file="${BOXAI_CLOUDFLARE_ENV:-$repo/.env.cloudflare}"
admin_env="${BOXAI_ADMIN_ENV:-$repo/.env.boxai-admin}"

for file in "$env_file" "$admin_env"; do
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
done

for variable in BOXAI_ADMIN_USER_ID BOXAI_ADMIN_TOKEN; do
  [[ -n ${!variable:-} ]] || {
    echo "ERROR: $variable is required to publish the Connect catalog" >&2
    exit 1
  }
done
for command_name in curl jq openssl python3; do
  command -v "$command_name" >/dev/null || {
    echo "ERROR: required command not found: $command_name" >&2
    exit 1
  }
done

upload_method=""
if [[ -n ${R2_DESKTOP_ACCESS_KEY_ID:-} && -n ${R2_DESKTOP_SECRET_ACCESS_KEY:-} && -n ${R2_ENDPOINT:-} ]]; then
  command -v aws >/dev/null || {
    echo "ERROR: aws is required when publishing the Connect catalog with R2 S3 credentials" >&2
    exit 1
  }
  upload_method="s3"
  export AWS_ACCESS_KEY_ID="$R2_DESKTOP_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_DESKTOP_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
elif [[ -n ${CLOUDFLARE_ACCOUNT_ID:-} && -n ${CLOUDFLARE_API_TOKEN:-} ]]; then
  command -v npx >/dev/null || {
    echo "ERROR: npx is required when publishing the Connect catalog with the Cloudflare API" >&2
    exit 1
  }
  upload_method="wrangler"
else
  echo "ERROR: R2 S3 credentials or CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

python3 "$root/packaging/build_catalog.py" --output "$stage"

temporary=""
cleanup() {
  [[ -z "$temporary" ]] || rm -f "$temporary"
}
trap cleanup EXIT

echo "==> uploading immutable BoxAI Connect Skill archives"
while IFS= read -r archive; do
  relative="${archive#"$stage"/}"
  if [[ "$upload_method" == "s3" ]]; then
    aws s3 cp "$archive" "s3://$bucket/$prefix/$relative" \
      --endpoint-url "$R2_ENDPOINT" \
      --content-type "application/zip" \
      --cache-control "public, max-age=31536000, immutable" \
      --no-progress
  else
    npx --yes wrangler@4.76.0 r2 object put "$bucket/$prefix/$relative" \
      --file "$archive" \
      --content-type "application/zip" \
      --cache-control "public, max-age=31536000, immutable" \
      --remote
  fi
done < <(find "$stage/skills" -type f -name '*.zip' -print | sort)

echo "==> verifying published archive bytes"
while IFS=$'\t' read -r url expected_hash expected_size; do
  temporary="$(mktemp)"
  curl --fail --silent --show-error "$url" -o "$temporary"
  actual_hash="$(openssl dgst -sha256 -r "$temporary" | awk '{print $1}')"
  actual_size="$(wc -c <"$temporary" | tr -d ' ')"
  rm -f "$temporary"
  temporary=""
  [[ "$actual_hash" == "$expected_hash" && "$actual_size" == "$expected_size" ]] || {
    echo "ERROR: published archive verification failed for $url" >&2
    exit 1
  }
done < <(jq -r '.skills[] | [.archive.url, .archive.sha256, (.archive.size_bytes | tostring)] | @tsv' "$stage/catalog.json")

echo "==> atomically activating the production connector catalog"
response="$("$repo/.agents/skills/managing-boxai-platform/scripts/boxai-api" \
  PUT /api/admin/connector/catalog "$(cat "$stage/catalog.json")")"
jq -e '.success == true and (.data.mcp_servers | length) == 1 and (.data.skills | length) == 3' \
  >/dev/null <<<"$response"

servers="$("$repo/.agents/skills/managing-boxai-platform/scripts/boxai-api" GET /api/admin/connector/mcp-servers)"
skills="$("$repo/.agents/skills/managing-boxai-platform/scripts/boxai-api" GET /api/admin/connector/skill-releases)"
jq -e '[.data[] | select(.enabled == true and .id == "boxai-media")] | length == 1' >/dev/null <<<"$servers"
jq -e '[.data[] | select(.enabled == true)] | length == 3' >/dev/null <<<"$skills"

echo "Published BoxAI Media and 3 official Skills at $base_url/skills/"
