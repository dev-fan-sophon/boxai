#!/usr/bin/env python3
"""Validate native stages, prepare byte-exact feeds, and publish immutable-first to R2.

Install publisher dependencies with: python -m pip install boto3 PyYAML
Never writes desktop/latest.json (the frozen Tauri updater contract).
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

import yaml

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://dl.you-box.com/desktop"
BUCKET = "boxai-desktop"
ACCOUNT = "4379d21a3d3eadc0e37d63abff091f31"
ZONE = "2a653c5c030f278f165adc1cd803adfd"


def hashes(path):
    sha256, sha512 = hashlib.sha256(), hashlib.sha512()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha256.update(chunk)
            sha512.update(chunk)
    return sha256.hexdigest(), base64.b64encode(sha512.digest()).decode()


def prepare(stage, version, commit):
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version) or tuple(map(int, version.split("."))) < (0, 2, 0):
        raise ValueError("A stable BoxAI version >= 0.2.0 is required")
    downloads, objects, feeds = [], [], {}
    for platform, arch, suffix, feed, website_os, website_arch, kind, minimum in [
        ("darwin", "arm64", "macos-arm64.dmg", "latest-mac.yml", "macos", "arm64", "dmg", "12.0"),
        ("win32", "x64", "windows-x64-setup.exe", "latest.yml", "windows", "x86_64", "exe", "10"),
    ]:
        filename = f"BoxAI-Desktop-{version}-{suffix}"
        artifact = stage / filename
        sha256, sha512 = hashes(artifact)
        report_path = stage / f"{filename}.assertion.json"
        report = json.loads(report_path.read_text())
        expected = {"schema": 1, "version": version, "platform": platform, "arch": arch,
                    "filename": filename, "sha256": sha256, "commit": commit,
                    "installed": True}
        for key, value in expected.items():
            if report.get(key) != value:
                raise ValueError(f"Native assertion mismatch: {filename}: {key}")
        boot = report.get("boot", {})
        signed = report.get("signed")
        if type(signed) is not bool or (signed and (platform != "darwin" or report.get("notarized") is not True)):
            raise ValueError("Signed metadata requires native macOS notarization evidence")
        if not (boot.get("ok") is True and boot.get("version") == version
                and boot.get("appName") == "BoxAI Desktop" and boot.get("platform") == platform
                and boot.get("projectRemove", {}).get("ok") is True and boot.get("ctrlRBlocked") is True):
            raise ValueError(f"Installed boot assertion missing: {filename}")
        url = f"{BASE}/{version}/{filename}"
        downloads.append(dict(platform=website_os, arch=website_arch, kind=kind, signed=signed,
                              minimum_os=minimum, url=url, filename=filename,
                              size=artifact.stat().st_size, sha256=sha256))
        objects.extend([artifact, report_path])
        blockmap = stage / f"{filename}.blockmap"
        if platform == "win32" and not blockmap.is_file():
            raise ValueError("NSIS blockmap missing")
        if blockmap.is_file():
            objects.append(blockmap)
        # JSON-compatible strings, generated from the exact accepted installer bytes.
        files = [dict(url=url, sha512=sha512, size=artifact.stat().st_size)]
        if signed:
            archive = artifact.with_suffix(".zip")
            zip256, zip512 = hashes(archive)
            if report.get("zipSha256") != zip256:
                raise ValueError("ZIP does not match the natively accepted DMG payload")
            objects.append(archive)
            if archive.with_suffix(".zip.blockmap").is_file():
                objects.append(archive.with_suffix(".zip.blockmap"))
            files.insert(0, dict(url=f"{BASE}/{version}/{archive.name}", sha512=zip512, size=archive.stat().st_size))
        feeds[feed] = yaml.safe_dump(dict(version=version, files=files, path=files[0]["url"], sha512=files[0]["sha512"],
            releaseDate=datetime.datetime.now(datetime.timezone.utc).isoformat())).encode()
    feeds["releases.json"] = (json.dumps(dict(version=version,
        published_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        notes="BoxAI Desktop. See each download's signing status. Tauri 0.1.x users must install manually; existing data is not migrated or removed.",
        downloads=downloads), indent=2) + "\n").encode()
    return objects, feeds


def verify_live(url, path=None, expected=None):
    with urllib.request.urlopen(url, timeout=120) as response:
        digest = hashlib.sha256()
        size = 0
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    wanted_hash = hashes(path)[0] if path else hashlib.sha256(expected).hexdigest()
    wanted_size = path.stat().st_size if path else len(expected)
    if digest.hexdigest() != wanted_hash or size != wanted_size:
        raise ValueError(f"Live bytes differ: {url}")


def publish(client, stage, version, objects, feeds, verify=verify_live):
    # Conditional object creation prevents silently replacing a published version.
    from botocore.exceptions import ClientError
    for path in objects:
        key = f"desktop/{version}/{path.name}"
        try:
            with path.open("rb") as body:
                client.put_object(Bucket=BUCKET, Key=key, Body=body, IfNoneMatch="*",
                    CacheControl="public, max-age=31536000, immutable")
        except ClientError as error:
            if error.response["Error"]["Code"] not in ("PreconditionFailed", "412"):
                raise
        verify(f"{BASE}/{version}/{path.name}", path=path)
    # All artifacts and native reports are public and verified before any feed advances.
    for name, body in feeds.items():
        client.put_object(Bucket=BUCKET, Key=f"desktop/{name}", Body=body,
            ContentType="application/json" if name.endswith(".json") else "application/yaml",
            CacheControl="no-store, max-age=0")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--stage", type=Path)
    args = parser.parse_args()
    version = json.loads((ROOT / "desktop/apps/desktop/package.json").read_text())["version"]
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    stage = args.stage or ROOT / "desktop/release" / version
    objects, feeds = prepare(stage, version, commit)
    for name, body in feeds.items():
        (stage / name).write_bytes(body)
    if args.publish:
        # Publication is only allowed for the exact checked-out, pushed main commit.
        subprocess.run(["git", "fetch", "origin", "main"], cwd=ROOT, check=True)
        main_commit = subprocess.check_output(["git", "rev-parse", "origin/main"], cwd=ROOT, text=True).strip()
        if commit != main_commit or subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip():
            raise ValueError("Publish requires a clean checkout of current origin/main")
        import boto3
        token = os.environ.get("BOXAI_CLOUDFLARE_API_TOKEN") or os.environ["CLOUDFLARE_API_TOKEN"]
        client = boto3.client("s3", endpoint_url=f"https://{ACCOUNT}.r2.cloudflarestorage.com", region_name="auto",
            aws_access_key_id=os.environ["R2_DESKTOP_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_DESKTOP_SECRET_ACCESS_KEY"])
        publish(client, stage, version, objects, feeds)
        request = urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{ZONE}/purge_cache",
            data=json.dumps({"files": [f"{BASE}/{name}" for name in feeds]}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            if not json.load(response).get("success"):
                raise ValueError("Cloudflare feed cache purge failed")
        for name, body in feeds.items():
            verify_live(f"{BASE}/{name}", expected=body)
    print(f"{'PUBLISHED' if args.publish else 'PREPARED'} BoxAI Desktop {version}: {len(objects)} immutable objects; {', '.join(feeds)}")


if __name__ == "__main__":
    main()
