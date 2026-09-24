#!/usr/bin/env python3
"""Write the website release manifest for the BoxAI Vetta desktop client.

The website reads https://dl.you-box.com/desktop/releases.json. The new client
is Electron, so in-app updates use electron-updater YAML in the same prefix.
This script only writes the website manifest. It never marks an artifact as
OS-signed: Developer ID notarization and Authenticode are not in place.

Expected staged names:

    BoxAI-<version>-macos-arm64.dmg
    BoxAI-<version>-windows-x64-setup.exe
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import sys


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--dist", required=True, type=pathlib.Path)
    parser.add_argument("--base-url", default="https://dl.you-box.com/desktop")
    parser.add_argument("--notes", default="")
    args = parser.parse_args()

    version = args.version.removeprefix("v")
    base = args.base_url.rstrip("/")
    specs = [
        {
            "filename": f"BoxAI-{version}-macos-arm64.dmg",
            "platform": "macos",
            "arch": "arm64",
            "kind": "dmg",
            "minimum_os": "12.0",
        },
        {
            "filename": f"BoxAI-{version}-windows-x64-setup.exe",
            "platform": "windows",
            "arch": "x86_64",
            "kind": "exe",
            "minimum_os": "10",
        },
    ]
    downloads = []
    for spec in specs:
        artifact = args.dist / spec["filename"]
        if not artifact.is_file():
            print(f"warning: {spec['filename']} not staged", file=sys.stderr)
            continue
        downloads.append(
            {
                **spec,
                "signed": False,
                "url": f"{base}/{version}/{spec['filename']}",
                "size": artifact.stat().st_size,
                "sha256": sha256(artifact),
            }
        )
    if not downloads:
        print("error: no BoxAI Vetta installers staged", file=sys.stderr)
        return 1
    published_at = (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )
    manifest = {
        "version": version,
        "published_at": published_at,
        "notes": args.notes,
        "downloads": downloads,
    }
    target = args.dist / "releases.json"
    target.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {target} ({len(downloads)} downloads)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
