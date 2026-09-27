"""Offline contract tests. Fixtures are not native acceptance reports."""
import base64
import copy
import json
import pathlib
import re
import subprocess
import tempfile
import unittest

import make_release as release


class ReleaseContract(unittest.TestCase):
    def setUp(self):
        self.metadata = json.loads(release.METADATA_PATH.read_text())

    def test_metadata_and_compiled_trust_anchor(self):
        release.validate_metadata(self.metadata)
        source = (release.ROOT / "internal/update/update.go").read_text()
        key = re.search(r'const PublicKey = "([0-9a-f]+)"', source).group(1)
        self.assertEqual(key, self.metadata["update_public_key"])
        for field, bad in (("update_feed_url", "https://usemagpie.ai/api/latest"),
                           ("signed", True), ("macos_go_target", "darwin/amd64"),
                           ("windows_go_target", "windows/arm64")):
            metadata = copy.deepcopy(self.metadata)
            metadata[field] = bad
            with self.subTest(field=field), self.assertRaises(SystemExit):
                release.validate_metadata(metadata)

    def test_artifact_contract(self):
        specs = release.artifact_specs(self.metadata)
        self.assertEqual([s["platform_key"] for s in specs], ["darwin-arm64", "win32-x64"])
        self.assertEqual([s["filename"] for s in specs], [
            "BoxAI-Connect-2.0.0-macos-arm64.dmg",
            "BoxAI-Connect-2.0.0-windows-x64-setup.exe"])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit):
                release.native_assertion(pathlib.Path(directory), specs[0], "a" * 64, "2.0.0")

    def test_signs_exact_bytes_not_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            key, public, artifact, signature = [root / n for n in ("key", "public", "artifact", "signature")]
            subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(key)], check=True, capture_output=True)
            public.write_bytes(release.run_openssl(["pkey", "-in", str(key), "-pubout"]))
            artifact.write_bytes(b"non-native test bytes, never an acceptance artifact")
            signature.write_bytes(base64.b64decode(release.sign_artifact(key, artifact)))
            command = ["openssl", "pkeyutl", "-verify", "-rawin", "-pubin", "-inkey", str(public), "-in", str(artifact), "-sigfile", str(signature)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            artifact.write_bytes(b"changed test bytes")
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
