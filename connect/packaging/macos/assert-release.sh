#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
metadata_path="${2:-$root/release-metadata.json}"
license_path="${3:-$root/LICENSE}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release assertions require macOS" >&2
  exit 1
fi

metadata_value() {
  python3 - "$metadata_path" "$1" <<'PY'
import json
import pathlib
import sys

print(json.loads(pathlib.Path(sys.argv[1]).read_text())[sys.argv[2]])
PY
}

version="$(metadata_value version)"
product_name="$(metadata_value product_name)"
binary_name="$(metadata_value binary_name)"
architecture="$(metadata_value macos_architecture)"
icon_name="$(metadata_value macos_icon_name)"
artifact_name="$(metadata_value macos_artifact)"
artifact_name="${artifact_name//\{version\}/$version}"
volume_name="$(metadata_value macos_volume_name)"
artifact="${1:-$root/dist/$artifact_name}"

if [[ ! -f "$artifact" ]]; then
  echo "macOS release artifact is missing: $artifact" >&2
  exit 1
fi

image_format="$(hdiutil imageinfo "$artifact" -format)"
if [[ "$image_format" != "UDZO" ]]; then
  echo "release disk image must be read-only and compressed (UDZO), got $image_format" >&2
  exit 1
fi
extracted="$(mktemp -d "${TMPDIR:-/tmp}/boxai-connect-macos-release.XXXXXX")"
icon_work="$(mktemp -d "${TMPDIR:-/tmp}/boxai-connect-macos-icon.XXXXXX")"
iconset="$icon_work/BoxAIConnect.iconset"
mounted=0
cleanup() {
  # An image left attached blocks the next assertion run and keeps a volume on
  # the operator's desktop, so detaching is not conditional on success.
  if [[ "$mounted" -eq 1 ]]; then
    hdiutil detach "$extracted" -quiet || hdiutil detach "$extracted" -force -quiet || true
  fi
  rm -rf "$extracted" "$icon_work"
}
trap cleanup EXIT

hdiutil attach "$artifact" -readonly -nobrowse -noautoopen -mountpoint "$extracted" -quiet
mounted=1
# The name Finder shows once the image is open, which is the product name and
# not the file name a download happens to land under.
image_volume="$(diskutil info -plist "$extracted" | python3 -c 'import plistlib,sys; print(plistlib.loads(sys.stdin.buffer.read())["VolumeName"])')"
if [[ "$image_volume" != "$volume_name" ]]; then
  echo "release disk image volume expected $volume_name, got $image_volume" >&2
  exit 1
fi
app="$extracted/$product_name.app"
contents="$app/Contents"
binary="$contents/MacOS/$binary_name"
icon="$contents/Resources/$icon_name"
plist="$contents/Info.plist"

python3 - "$extracted" "$metadata_path" "$license_path" <<'PY'
import json
import os
import pathlib
import plistlib
import sys

root = pathlib.Path(sys.argv[1])
metadata_path = pathlib.Path(sys.argv[2])
license_path = pathlib.Path(sys.argv[3])
metadata = json.loads(metadata_path.read_text())
app_name = metadata["product_name"] + ".app"
expected_directories = {
    app_name,
    f"{app_name}/Contents",
    f"{app_name}/Contents/MacOS",
    f"{app_name}/Contents/Resources",
}
expected_files = {
    "LICENSE",
    "release-metadata.json",
    f"{app_name}/Contents/Info.plist",
    f"{app_name}/Contents/MacOS/{metadata['binary_name']}",
    f"{app_name}/Contents/Resources/{metadata['macos_icon_name']}",
}
actual_directories = set()
actual_files = set()
actual_symlinks = {}
for path in root.rglob("*"):
    relative = path.relative_to(root).as_posix()
    # A mounted HFS+ volume always carries its own dot-prefixed bookkeeping
    # (.fseventsd, .Trashes); those are the filesystem's, not the release's.
    if relative.split("/")[0].startswith("."):
        continue
    if path.is_symlink():
        actual_symlinks[relative] = os.readlink(path)
    elif path.is_dir():
        actual_directories.add(relative)
    elif path.is_file():
        actual_files.add(relative)
    else:
        raise SystemExit(f"release image contains a special entry: {relative}")
if actual_directories != expected_directories or actual_files != expected_files:
    raise SystemExit(
        f"release image contents differ: directories={sorted(actual_directories)}, files={sorted(actual_files)}"
    )
# The only link is the install drop target; anything else could point a user
# outside the image.
if actual_symlinks != {"Applications": "/Applications"}:
    raise SystemExit(f"release image symlinks differ: {actual_symlinks}")
if (root / "LICENSE").read_bytes() != license_path.read_bytes():
    raise SystemExit("release LICENSE differs from the repository source")
if (root / "release-metadata.json").read_bytes() != metadata_path.read_bytes():
    raise SystemExit("release metadata differs from the repository source of truth")

plist_path = root / app_name / "Contents" / "Info.plist"
with plist_path.open("rb") as source:
    plist = plistlib.load(source)
expected_plist = {
    "CFBundleDevelopmentRegion": "vi",
    "CFBundleDisplayName": metadata["product_name"],
    "CFBundleExecutable": metadata["binary_name"],
    "CFBundleIconFile": metadata["macos_icon_name"],
    "CFBundleIdentifier": metadata["macos_bundle_id"],
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": metadata["product_name"],
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": metadata["version"],
    "CFBundleSupportedPlatforms": ["MacOSX"],
    "CFBundleVersion": metadata["version"],
    "LSArchitecturePriority": [metadata["macos_architecture"]],
    "NSHighResolutionCapable": True,
    "NSHumanReadableCopyright": metadata["legal_copyright"],
}
if plist != expected_plist:
    raise SystemExit(f"Info.plist differs from release metadata: {plist!r}")
binary = root / app_name / "Contents" / "MacOS" / metadata["binary_name"]
if not os.access(binary, os.X_OK):
    raise SystemExit("release binary is not executable")
PY

plutil -lint "$plist" >/dev/null
actual_architectures="$(lipo -archs "$binary")"
if [[ "$actual_architectures" != "$architecture" ]]; then
  echo "Mach-O architecture expected $architecture, got $actual_architectures" >&2
  exit 1
fi
if ! file "$binary" | grep -Fq "Mach-O 64-bit executable $architecture"; then
  echo "release binary is not the expected native Mach-O executable: $(file "$binary")" >&2
  exit 1
fi

iconutil -c iconset "$icon" -o "$iconset"
python3 - "$iconset" <<'PY'
import pathlib
import sys

iconset = pathlib.Path(sys.argv[1])
expected = {
    "icon_16x16.png",
    "icon_16x16@2x.png",
    "icon_32x32.png",
    "icon_32x32@2x.png",
    "icon_128x128.png",
    "icon_128x128@2x.png",
    "icon_256x256.png",
    "icon_256x256@2x.png",
    "icon_512x512.png",
    "icon_512x512@2x.png",
}
actual = {path.name for path in iconset.iterdir() if path.is_file()}
if actual != expected:
    raise SystemExit(f"macOS icon representations differ: {sorted(actual)}")
PY

python3 - "$metadata_path" "$artifact" "$actual_architectures" "$image_format" "$image_volume" <<'PY'
import hashlib
import json
import pathlib
import sys

metadata = json.loads(pathlib.Path(sys.argv[1]).read_text())
artifact = pathlib.Path(sys.argv[2])
print(json.dumps({
    "platform": "darwin-arm64",
    "artifact": str(artifact),
    "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
    "image_format": sys.argv[4],
    "volume": sys.argv[5],
    "bundle": metadata["product_name"] + ".app",
    "bundle_id": metadata["macos_bundle_id"],
    "version": metadata["version"],
    "architecture": sys.argv[3],
    "icon": metadata["macos_icon_name"],
    "signed": metadata["signed"],
    "notarized": metadata["notarized"],
    "updater": metadata["updater"],
    "release_feed": metadata["release_feed"],
}, separators=(",", ":")))
PY
