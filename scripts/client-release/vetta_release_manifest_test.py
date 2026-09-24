#!/usr/bin/env python3
"""The website manifest must describe unsigned BoxAI Vetta installers only."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "client-release" / "vetta_release_manifest.py"


class VettaReleaseManifestTest(unittest.TestCase):
    def test_writes_unsigned_downloads_for_staged_installers(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            dist = pathlib.Path(raw)
            (dist / "BoxAI-0.5.59-macos-arm64.dmg").write_bytes(b"mac")
            (dist / "BoxAI-0.5.59-windows-x64-setup.exe").write_bytes(b"win")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--version",
                    "v0.5.59",
                    "--dist",
                    str(dist),
                    "--notes",
                    "BoxAI Desktop",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("2 downloads", completed.stdout)
            manifest = json.loads((dist / "releases.json").read_text())
            self.assertEqual(manifest["version"], "0.5.59")
            self.assertEqual(
                [item["filename"] for item in manifest["downloads"]],
                [
                    "BoxAI-0.5.59-macos-arm64.dmg",
                    "BoxAI-0.5.59-windows-x64-setup.exe",
                ],
            )
            self.assertTrue(all(item["signed"] is False for item in manifest["downloads"]))
            self.assertTrue(
                all(
                    item["url"].startswith("https://dl.you-box.com/desktop/0.5.59/")
                    for item in manifest["downloads"]
                )
            )

    def test_refuses_an_empty_stage(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--version", "0.5.59", "--dist", raw],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertIn("no BoxAI Vetta installers", completed.stderr)


if __name__ == "__main__":
    unittest.main()
