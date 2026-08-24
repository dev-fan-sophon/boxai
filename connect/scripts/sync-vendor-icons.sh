#!/usr/bin/env bash
# Sync the Gateway vendor icon keys from @lobehub/icons-static-svg (MIT).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/connector-app/assets/vendors"
package="@lobehub/icons-static-svg"
version="${LOBE_ICONS_STATIC_SVG_VERSION:-1.94.0}"
base="https://cdn.jsdelivr.net/npm/${package}@${version}/icons"

# Unique first-segment keys from gateway/model/pricing_default.go defaultVendorIcons.
keys=(
  openai
  elevenlabs
  meshy
  claude
  gemini
  moonshot
  zhipu
  qwen
  deepseek
  minimax
  wenxin
  spark
  hunyuan
  cohere
  cloudflare
  ai360
  yi
  jina
  mistral
  xai
  ollama
  doubao
  kling
  jimeng
  vidu
  azureai
)

mkdir -p "$out"

fetch() {
  local key="$1"
  local dest="$out/${key}.svg"
  for candidate in "${key}-color.svg" "${key}.svg" "${key}-avatar.svg"; do
    if curl -fsSL --no-progress-meter "$base/$candidate" -o "$dest" 2>/dev/null; then
      echo "fetched $candidate -> ${key}.svg"
      return 0
    fi
  done
  echo "missing icon for $key" >&2
  return 1
}

for key in "${keys[@]}"; do
  fetch "$key"
done

cat > "$out/SOURCE.md" <<EOF
# Vendor icons

Source: [\`${package}\`](https://www.npmjs.com/package/${package}) \`${version}\`
License: MIT
Upstream: https://github.com/lobehub/lobe-icons

These SVGs are the Gateway \`vendor.icon\` keys from
\`gateway/model/pricing_default.go\` (\`defaultVendorIcons\`). Color variants
are preferred when the static package publishes them. Re-run
\`connect/scripts/sync-vendor-icons.sh\` from the repository root to refresh.
EOF

echo "wrote $out/SOURCE.md"
