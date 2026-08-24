#!/usr/bin/env bash
# Publish the complete natively asserted BoxAI Connect release to Cloudflare R2.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/.." && pwd)"
metadata="$root/release-metadata.json"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$metadata")"
stage="${BOXAI_RELEASE_STAGE:-$root/release/$version}"
bucket="${BOXAI_RELEASE_BUCKET:-boxai-desktop}"
prefix="connect"
base_url="https://dl.you-box.com/$prefix"
env_file="${BOXAI_CLOUDFLARE_ENV:-$repo/.env.cloudflare}"
key="${BOXAI_CONNECT_UPDATE_SIGNING_KEY:-$HOME/.config/boxai/connect-update-signing.pem}"

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi
[[ -f "$key" ]] || {
  echo "ERROR: BoxAI Connect Ed25519 update signing key is required at $key" >&2
  exit 1
}
for command_name in curl jq openssl python3; do
  command -v "$command_name" >/dev/null || {
    echo "ERROR: required command not found: $command_name" >&2
    exit 1
  }
done

upload_method=""
if [[ -n ${R2_DESKTOP_ACCESS_KEY_ID:-} && -n ${R2_DESKTOP_SECRET_ACCESS_KEY:-} && -n ${R2_ENDPOINT:-} ]]; then
  command -v aws >/dev/null || {
    echo "ERROR: aws is required when publishing BoxAI Connect with R2 S3 credentials" >&2
    exit 1
  }
  upload_method="s3"
  export AWS_ACCESS_KEY_ID="$R2_DESKTOP_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_DESKTOP_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
elif [[ -n ${CLOUDFLARE_ACCOUNT_ID:-} && -n ${CLOUDFLARE_API_TOKEN:-} ]]; then
  command -v npx >/dev/null || {
    echo "ERROR: npx is required when publishing BoxAI Connect with the Cloudflare API" >&2
    exit 1
  }
  upload_method="wrangler"
else
  echo "ERROR: R2 S3 credentials or CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

python3 "$root/packaging/make_release.py" \
  --stage "$stage" \
  --key "$key" \
  --notes "${BOXAI_RELEASE_NOTES:-BoxAI Connect $version}"

echo "==> uploading immutable BoxAI Connect $version artifacts"
for artifact in "$stage"/*.dmg "$stage"/*-setup.exe; do
  [[ -f "$artifact" ]] || {
    echo "ERROR: complete macOS and Windows artifacts are required" >&2
    exit 1
  }
  if [[ "$upload_method" == "s3" ]]; then
    aws s3 cp "$artifact" "s3://$bucket/$prefix/$version/$(basename "$artifact")" \
      --endpoint-url "$R2_ENDPOINT" \
      --content-type "application/octet-stream" \
      --cache-control "public, max-age=31536000, immutable" \
      --no-progress
  else
    npx --yes wrangler@4.76.0 r2 object put "$bucket/$prefix/$version/$(basename "$artifact")" \
      --file "$artifact" \
      --content-type "application/octet-stream" \
      --cache-control "public, max-age=31536000, immutable" \
      --remote
  fi
done

echo "==> publishing BoxAI Connect feeds"
for feed in releases.json native-latest.json; do
  if [[ "$upload_method" == "s3" ]]; then
    aws s3 cp "$stage/$feed" "s3://$bucket/$prefix/$feed" \
      --endpoint-url "$R2_ENDPOINT" \
      --content-type "application/json" \
      --cache-control "public, max-age=60" \
      --no-progress
  else
    npx --yes wrangler@4.76.0 r2 object put "$bucket/$prefix/$feed" \
      --file "$stage/$feed" \
      --content-type "application/json" \
      --cache-control "public, max-age=60" \
      --remote
  fi
done

if [[ -n ${CLOUDFLARE_API_TOKEN:-} && -n ${CLOUDFLARE_ZONE_ID:-} ]]; then
  purge_response="$(curl --fail --silent --show-error -X POST \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' \
    "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
    -d "{\"files\":[\"$base_url/releases.json\",\"$base_url/native-latest.json\"]}")"
  jq -e '.success == true' >/dev/null <<<"$purge_response"
fi

echo "==> verifying live feeds and artifact bytes"
live_releases="$(curl --fail --silent --show-error "$base_url/releases.json")"
live_native="$(curl --fail --silent --show-error "$base_url/native-latest.json")"
jq -e --arg version "$version" '.version == $version and (.downloads | length) == 2' >/dev/null <<<"$live_releases"
jq -e --arg version "$version" '.version == $version and (.platforms | keys | sort) == ["darwin-arm64", "win32-x64"]' >/dev/null <<<"$live_native"
while IFS=$'\t' read -r url expected_hash expected_size; do
  temporary="$(mktemp)"
  curl --fail --silent --show-error "$url" -o "$temporary"
  actual_hash="$(openssl dgst -sha256 -r "$temporary" | awk '{print $1}')"
  actual_size="$(wc -c <"$temporary" | tr -d ' ')"
  rm -f "$temporary"
  [[ "$actual_hash" == "$expected_hash" && "$actual_size" == "$expected_size" ]] || {
    echo "ERROR: live artifact verification failed for $url" >&2
    exit 1
  }
done < <(jq -r '.downloads[] | [.url, .sha256, (.size | tostring)] | @tsv' <<<"$live_releases")

echo "Published and verified BoxAI Connect $version"
echo "  website $base_url/releases.json"
echo "  updater $base_url/native-latest.json"
