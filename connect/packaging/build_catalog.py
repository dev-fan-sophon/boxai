#!/usr/bin/env python3
"""Build and verify deterministic BoxAI Connect Skill catalog archives."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog.json"
SKILLS_ROOT = ROOT / "skills"
DEFAULT_OUTPUT = ROOT / "dist" / "catalog"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,62}[A-Za-z0-9]$")
ARCHIVE_PREFIX = "https://dl.you-box.com/connect/catalog/skills"
ZIP_TIME = (2026, 1, 1, 0, 0, 0)


def fail(message: str) -> None:
    raise SystemExit(f"catalog error: {message}")


def load_catalog() -> dict[str, object]:
    try:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"could not read {CATALOG_PATH}: {error}")
    if not isinstance(catalog, dict) or set(catalog) != {"mcp_servers", "skills"}:
        fail("catalog.json must contain only mcp_servers and skills")
    if not isinstance(catalog["mcp_servers"], list) or not isinstance(catalog["skills"], list):
        fail("mcp_servers and skills must be arrays")
    return catalog


def frontmatter(skill_file: pathlib.Path) -> tuple[str, str]:
    text = skill_file.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    if match is None:
        fail(f"{skill_file} has no YAML frontmatter")
    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key.strip()] = value.strip().strip('"\'')
    name = values.get("name", "")
    description = values.get("description", "")
    if not name or not description:
        fail(f"{skill_file} frontmatter requires name and description")
    return name, description


def skill_files(source: pathlib.Path) -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for path in sorted(source.rglob("*")):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            fail(f"Skill source must not contain symlinks: {path}")
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            fail(f"Skill source contains a special file: {path}")
        files.append(path)
    if not files or source / "SKILL.md" not in files:
        fail(f"{source} must contain SKILL.md")
    return files


def build_archive(source: pathlib.Path, destination: pathlib.Path) -> tuple[str, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".zip.tmp")
    temporary.unlink(missing_ok=True)
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
        for path in skill_files(source):
            relative = path.relative_to(source).as_posix()
            info = zipfile.ZipInfo(relative, ZIP_TIME)
            info.create_system = 3
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, path.read_bytes())
    os.replace(temporary, destination)
    data = destination.read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data)


def validate_mcp(catalog: dict[str, object]) -> None:
    servers = catalog["mcp_servers"]
    if servers != [
        {
            "id": "boxai-media",
            "name": "BoxAI Media",
            "url": "https://you-box.com/mcp",
            "authorization": "connection_bearer",
            "description": "Generate images and asynchronous videos with BoxAI models, then poll video tasks until completion.",
        }
    ]:
        fail("mcp_servers must contain the canonical BoxAI Media descriptor")


def build_catalog(output: pathlib.Path, update: bool) -> None:
    catalog = load_catalog()
    validate_mcp(catalog)
    skills = catalog["skills"]
    seen: set[str] = set()
    changed = False
    for skill in skills:
        if not isinstance(skill, dict) or set(skill) != {"id", "name", "version", "archive"}:
            fail("every Skill descriptor must contain id, name, version, and archive")
        skill_id = skill["id"]
        version = skill["version"]
        if not isinstance(skill_id, str) or ID_RE.fullmatch(skill_id) is None:
            fail(f"invalid Skill id: {skill_id!r}")
        if skill_id in seen:
            fail(f"duplicate Skill id: {skill_id}")
        seen.add(skill_id)
        if not isinstance(version, str) or VERSION_RE.fullmatch(version) is None:
            fail(f"invalid Skill version for {skill_id}: {version!r}")
        source = SKILLS_ROOT / skill_id
        if not source.is_dir():
            fail(f"missing Skill source directory: {source}")
        metadata_name, description = frontmatter(source / "SKILL.md")
        if metadata_name != skill_id:
            fail(f"{source}/SKILL.md name must match its directory")
        if len(description) > 1024:
            fail(f"{source}/SKILL.md description exceeds 1024 characters")

        archive = skill["archive"]
        if not isinstance(archive, dict) or set(archive) != {
            "url",
            "sha256",
            "size_bytes",
            "format",
            "authorization",
        }:
            fail(f"invalid archive descriptor for {skill_id}")
        expected_url = f"{ARCHIVE_PREFIX}/{skill_id}/{version}.zip"
        if archive["url"] != expected_url or archive["format"] != "zip" or archive["authorization"] != "none":
            fail(f"invalid immutable archive contract for {skill_id}")

        destination = output / "skills" / skill_id / f"{version}.zip"
        digest, size = build_archive(source, destination)
        if archive["sha256"] != digest or archive["size_bytes"] != size:
            if not update:
                fail(
                    f"{skill_id} archive metadata is stale: expected sha256={digest} size_bytes={size}; "
                    "run build_catalog.py --update"
                )
            archive["sha256"] = digest
            archive["size_bytes"] = size
            changed = True
        if SHA256_RE.fullmatch(str(archive["sha256"])) is None or int(archive["size_bytes"]) <= 0:
            fail(f"invalid generated archive metadata for {skill_id}")

    source_directories = {path.name for path in SKILLS_ROOT.iterdir() if path.is_dir()}
    if source_directories != seen:
        fail(
            "catalog and Skill directories differ: "
            f"catalog={sorted(seen)}, directories={sorted(source_directories)}"
        )
    if update and changed:
        CATALOG_PATH.write_text(
            json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    (output / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    action = "updated" if changed else "verified"
    print(f"{action} {len(skills)} deterministic Skill archives in {output}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--update",
        action="store_true",
        help="write rebuilt archive digests and sizes back to connect/catalog.json",
    )
    args = parser.parse_args()
    build_catalog(args.output.resolve(), args.update)
    return 0


if __name__ == "__main__":
    sys.exit(main())
