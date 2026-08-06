#!/usr/bin/env bash
# Capture the BoxAI Connect window on macOS and write the web-ready WebP set.
#
# The console walkthrough shows the real app, so these come from a signed-in
# build rather than a mocked renderer. Run it once per step of the flow, with
# the app already on the screen you want:
#
#   bash connect/packaging/capture_screenshots.sh sign-in
#
# Output: web/default/public/connect-screenshots/<id>-{480,960,1536}.webp
set -euo pipefail

id="${1:?usage: capture_screenshots.sh <shot-id>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$root/web/default/public/connect-screenshots"
mkdir -p "$out"

bounds="$(
  osascript <<'APPLESCRIPT'
tell application "System Events"
  tell process "BoxAI Connect"
    set frontmost to true
    delay 0.8
    set {x, y} to position of window 1
    set {w, h} to size of window 1
    return (x as text) & "," & (y as text) & "," & (w as text) & "," & (h as text)
  end tell
end tell
APPLESCRIPT
)"

png="$(mktemp -t connect-shot).png"
# -R avoids the window shadow, so the frames tile cleanly in the console layout.
screencapture -x -R"$bounds" "$png"

cd "$root/web/default"
node --input-type=module -e "
import sharp from 'sharp'
const [png, out, id] = process.argv.slice(1)
for (const width of [480, 960, 1536]) {
  const info = await sharp(png)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: width <= 480 ? 78 : 82 })
    .toFile(\`\${out}/\${id}-\${width}.webp\`)
  console.log(\`\${id}-\${width}.webp \${info.width}x\${info.height}\`)
}
" "$png" "$out" "$id"

rm -f "$png"
