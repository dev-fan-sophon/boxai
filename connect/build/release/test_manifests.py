import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile

from manifests import manifests


class FeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.stage = Path(self.temp.name)
        self.commit = "a" * 40
        for platform in ("macos", "windows"):
            (self.stage / f"{platform}-source.txt").write_text(self.commit)
        for name, content in (("BoxAI-Connect-1.1.0-macos-arm64.dmg", b"dmg"),
                              ("BoxAI-Connect-1.1.0-windows-x64-setup.exe", b"installer"),
                              ("magpie-windows-amd64.exe", b"executable")):
            (self.stage / name).write_bytes(content)
        with zipfile.ZipFile(self.stage / "magpie-darwin-arm64.zip", "w") as archive:
            archive.writestr("magpie.app/Contents/MacOS/magpie", "app")

    def generate(self):
        return manifests(self.stage, "1.1.0", self.commit, "notes", "2026-09-27T00:00:00Z")

    def test_contract_and_exact_bytes(self):
        website, updater = self.generate()
        self.assertEqual(set(updater["assets"]), {"magpie-darwin-arm64.zip", "magpie-windows-amd64.exe"})
        self.assertEqual(updater["assets"]["magpie-windows-amd64.exe"]["sha256"],
                         hashlib.sha256(b"executable").hexdigest())
        self.assertEqual(website["downloads"][1]["size"], len(b"installer"))
        self.assertEqual(website["downloads"][0]["url"],
                         "https://dl.you-box.com/connect/1.1.0/BoxAI-Connect-1.1.0-macos-arm64.dmg")
        self.assertTrue(website["downloads"][0]["signed"])
        self.assertFalse(website["downloads"][1]["signed"])

    def test_mixed_source_rejected(self):
        (self.stage / "windows-source.txt").write_text("b" * 40)
        with self.assertRaisesRegex(ValueError, "windows source"):
            self.generate()

    def test_wrong_bundle_and_missing_installer_rejected(self):
        (self.stage / "BoxAI-Connect-1.1.0-windows-x64-setup.exe").unlink()
        with self.assertRaises(FileNotFoundError):
            self.generate()
        with zipfile.ZipFile(self.stage / "magpie-darwin-arm64.zip", "w") as archive:
            archive.writestr("BoxAI Connect.app/Contents/MacOS/magpie", "app")
        with self.assertRaisesRegex(ValueError, "must contain magpie.app"):
            self.generate()


if __name__ == "__main__":
    unittest.main()
