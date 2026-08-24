#!/usr/bin/env python3
"""Verify native artifacts and create BoxAI Connect release/update feeds."""

from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
METADATA_PATH = ROOT / "release-metadata.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
BASE_URL = "https://dl.you-box.com/connect"


def fail(message: str) -> None:
    raise SystemExit(f"release error: {message}")


def run_openssl(arguments: list[str], *, input_bytes: bytes | None = None) -> bytes:
    try:
        process = subprocess.run(
            ["openssl", *arguments],
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as error:
        fail(f"could not run openssl: {error}")
    if process.returncode != 0:
        fail(f"openssl rejected the update signing key or artifact: {process.stderr.decode(errors='replace').strip()}")
    return process.stdout


def public_key_hex(key: pathlib.Path) -> str:
    der = run_openssl(["pkey", "-in", str(key), "-pubout", "-outform", "DER"])
    if len(der) < 32:
        fail("openssl returned a truncated Ed25519 public key")
    return der[-32:].hex()


def sign_artifact(key: pathlib.Path, artifact: pathlib.Path) -> str:
    with tempfile.NamedTemporaryFile() as signature:
        run_openssl(
            [
                "pkeyutl",
                "-sign",
                "-rawin",
                "-inkey",
                str(key),
                "-in",
                str(artifact),
                "-out",
                signature.name,
            ]
        )
        data = pathlib.Path(signature.name).read_bytes()
    if len(data) != 64:
        fail(f"Ed25519 signature for {artifact.name} is not 64 bytes")
    return base64.b64encode(data).decode("ascii")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_specs(metadata: dict[str, object]) -> list[dict[str, str]]:
    version = str(metadata["version"])
    return [
        {
            "platform_key": "darwin-arm64",
            "platform": "macos",
            "arch": "arm64",
            "kind": "dmg",
            "minimum_os": "12.0",
            "filename": str(metadata["macos_artifact"]).replace("{version}", version),
        },
        {
            "platform_key": "win32-x64",
            "platform": "windows",
            "arch": "x86_64",
            "kind": "exe",
            "minimum_os": "10",
            "filename": str(metadata["windows_artifact"]).replace("{version}", version),
        },
    ]


def validate_metadata(metadata: dict[str, object]) -> None:
    version = metadata.get("version")
    if not isinstance(version, str) or VERSION_RE.fullmatch(version) is None:
        fail("release metadata version must be semantic")
    expected = {
        "schema_version": 1,
        "product_name": "BoxAI Connect",
        "binary_name": "boxai-connect",
        "bundle_id": "com.you-box.connect",
        "release_mode": "unsigned-package-signed-updates",
        "signed": False,
        "notarized": False,
        "updater": True,
        "release_feed": True,
        "download_url": "https://you-box.com/connect",
        "update_feed_url": f"{BASE_URL}/native-latest.json",
        "desktop_release_targets": ["macos", "windows"],
        "browser_target": False,
        "macos_target": "macos-arm64",
        "macos_rust_target": "aarch64-apple-darwin",
        "windows_target": "windows-x64",
        "windows_rust_target": "x86_64-pc-windows-msvc",
    }
    for field, value in expected.items():
        if metadata.get(field) != value:
            fail(f"release metadata {field} must be {value!r}")
    public = metadata.get("update_public_key")
    if not isinstance(public, str) or SHA256_RE.fullmatch(public) is None:
        fail("release metadata must contain a 32-byte raw Ed25519 public key")


def native_assertion(stage: pathlib.Path, spec: dict[str, str], digest: str, version: str) -> dict[str, object]:
    report_path = stage / f"{spec['filename']}.assertion.json"
    try:
        report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"missing or invalid native assertion {report_path}: {error}")
    if not isinstance(report, dict):
        fail(f"native assertion for {spec['filename']} must be an object")
    if report.get("platform") != spec["platform_key"] or report.get("version") != version:
        fail(f"native assertion target/version mismatch for {spec['filename']}")
    report_artifact = pathlib.Path(str(report.get("artifact", "")).replace("\\", "/")).name
    if report_artifact != spec["filename"] or str(report.get("artifact_sha256", "")).lower() != digest:
        fail(f"native assertion covers different bytes than {spec['filename']}")
    if report.get("signed") not in (None, False) or report.get("notarized") not in (None, False):
        fail(f"native assertion contradicts unsigned package metadata for {spec['filename']}")
    return report


def make_release(stage: pathlib.Path, key: pathlib.Path, notes: str, published_at: str) -> None:
    try:
        metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"could not read release metadata: {error}")
    validate_metadata(metadata)
    if not key.is_file():
        fail(f"update signing key is required: {key}")
    if public_key_hex(key) != metadata["update_public_key"]:
        fail("update signing key does not match the public key compiled into BoxAI Connect")

    version = str(metadata["version"])
    specs = artifact_specs(metadata)
    expected_files = {
        name
        for spec in specs
        for name in (spec["filename"], f"{spec['filename']}.assertion.json")
    }
    actual_files = {path.name for path in stage.iterdir() if path.is_file()}
    unexpected = actual_files - expected_files - {"releases.json", "native-latest.json"}
    if unexpected:
        fail(f"release stage contains unexpected files: {sorted(unexpected)}")

    downloads: list[dict[str, object]] = []
    platforms: dict[str, dict[str, object]] = {}
    for spec in specs:
        artifact = stage / spec["filename"]
        if not artifact.is_file() or artifact.stat().st_size <= 0:
            fail(f"required native artifact is missing: {artifact}")
        digest = sha256(artifact)
        native_assertion(stage, spec, digest, version)
        size = artifact.stat().st_size
        url = f"{BASE_URL}/{version}/{spec['filename']}"
        signature = sign_artifact(key, artifact)
        platforms[spec["platform_key"]] = {
            "url": url,
            "sha256": digest,
            "size": size,
            "signature": signature,
        }
        downloads.append(
            {
                "platform": spec["platform"],
                "arch": spec["arch"],
                "kind": spec["kind"],
                "signed": False,
                "minimum_os": spec["minimum_os"],
                "url": url,
                "filename": spec["filename"],
                "size": size,
                "sha256": digest,
            }
        )

    releases = {
        "version": version,
        "published_at": published_at,
        "notes": notes,
        "downloads": downloads,
    }
    native = {
        "version": version,
        "pub_date": published_at,
        "notes": notes,
        "platforms": platforms,
    }
    (stage / "releases.json").write_text(json.dumps(releases, indent=2) + "\n", encoding="utf-8")
    (stage / "native-latest.json").write_text(json.dumps(native, indent=2) + "\n", encoding="utf-8")
    print(f"verified, signed, and described {len(specs)} BoxAI Connect {version} artifacts")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=pathlib.Path)
    parser.add_argument("--key", type=pathlib.Path)
    parser.add_argument("--notes", default="")
    parser.add_argument("--published-at")
    args = parser.parse_args()
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    version = str(metadata["version"])
    stage = (args.stage or ROOT / "release" / version).resolve()
    configured_key = os.environ.get("BOXAI_CONNECT_UPDATE_SIGNING_KEY")
    key = args.key or (
        pathlib.Path(configured_key)
        if configured_key
        else pathlib.Path.home() / ".config" / "boxai" / "connect-update-signing.pem"
    )
    published_at = args.published_at or (
        datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    notes = args.notes or f"BoxAI Connect {version}"
    if not stage.is_dir():
        fail(f"release stage does not exist: {stage}")
    make_release(stage, key.expanduser().resolve(), notes, published_at)
    return 0


if __name__ == "__main__":
    sys.exit(main())
