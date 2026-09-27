#!/usr/bin/env python3
"""Generate website and unmodified Magpie updater feeds; never upload anything."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def manifests(stage, version, commit, notes, published_at):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("expected a release version without v")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("expected a full accepted source commit")
    for platform in ("macos", "windows"):
        if (stage / f"{platform}-source.txt").read_text().strip() != commit:
            raise ValueError(f"{platform} source does not match accepted commit")
    dmg = f"BoxAI-Connect-{version}-macos-arm64.dmg"
    installer = f"BoxAI-Connect-{version}-windows-x64-setup.exe"
    app = "magpie-darwin-arm64.zip"
    binary = "magpie-windows-amd64.exe"
    with zipfile.ZipFile(stage / app) as archive:
        if "magpie.app/Contents/MacOS/magpie" not in archive.namelist():
            raise ValueError("updater ZIP must contain magpie.app")
    assets = {}
    for name in (dmg, installer, app, binary):
        path = stage / name
        size = path.stat().st_size
        if not size:
            raise ValueError(f"empty artifact: {name}")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        assets[name] = dict(url=f"https://dl.you-box.com/connect/{version}/{name}",
                            size=size, sha256=digest.hexdigest())
    website = dict(version=version, published_at=published_at, notes=notes, downloads=[
        dict(platform="macos", arch="arm64", kind="dmg", signed=True,
             minimum_os="11.0", filename=dmg, **assets[dmg]),
        dict(platform="windows", arch="x86_64", kind="exe", signed=False,
             minimum_os="10", filename=installer, **assets[installer]),
    ])
    updater = dict(version=version, notes=notes, url="https://you-box.com/downloads",
                   assets={app: assets[app], binary: assets[binary]})
    return website, updater


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", type=Path)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--notes", required=True)
    parser.add_argument("--published-at", required=True)
    args = parser.parse_args()
    version = Path(__file__).with_name("VERSION").read_text().strip()
    website, updater = manifests(args.stage, version, args.commit, args.notes, args.published_at)
    for name, value in (("releases.json", website), ("magpie-latest.json", updater)):
        (args.stage / name).write_text(json.dumps(value, indent=2) + "\n")
