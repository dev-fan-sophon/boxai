import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

import yaml
from botocore.exceptions import ClientError
from desktop_release import prepare, publish


class DesktopReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.stage = Path(self.temp.name)
        self.artifacts = []
        for platform, arch, suffix, payload in [
            ("darwin", "arm64", "macos-arm64.dmg", b"mac installer bytes"),
            ("win32", "x64", "windows-x64-setup.exe", b"windows installer bytes - different"),
        ]:
            artifact = self.stage / f"BoxAI-Desktop-0.2.0-{suffix}"
            artifact.write_bytes(payload)
            self.artifacts.append(artifact)
            report = dict(schema=1, version="0.2.0", platform=platform, arch=arch,
                filename=artifact.name, sha256=hashlib.sha256(payload).hexdigest(),
                commit="test-commit", signed=False, installed=True,
                boot=dict(ok=True, version="0.2.0", appName="BoxAI Desktop", platform=platform,
                          projectRemove=dict(ok=True), ctrlRBlocked=True))
            Path(f"{artifact}.assertion.json").write_text(json.dumps(report))
        Path(f"{self.artifacts[1]}.blockmap").write_bytes(b"block map")

    def test_exact_bytes_feed_and_website_contract(self):
        objects, feeds = prepare(self.stage, "0.2.0", "test-commit")
        self.assertEqual(len(objects), 5)
        manifest = json.loads(feeds["releases.json"])
        self.assertEqual([item["arch"] for item in manifest["downloads"]], ["arm64", "x86_64"])
        for artifact, name, download in zip(self.artifacts, ["latest-mac.yml", "latest.yml"], manifest["downloads"]):
            file = yaml.safe_load(feeds[name])["files"][0]
            payload = artifact.read_bytes()
            self.assertEqual(file["sha512"], base64.b64encode(hashlib.sha512(payload).digest()).decode())
            self.assertEqual(file["size"], len(payload))
            self.assertEqual(download["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(file["url"], f"https://dl.you-box.com/desktop/0.2.0/{artifact.name}")
            self.assertFalse(download["signed"])
        self.assertNotIn("latest.json", feeds)

    def test_corrupt_artifact_and_wrong_commit_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "commit"):
            prepare(self.stage, "0.2.0", "different-commit")
        self.artifacts[1].write_bytes(b"modified after assertion")
        with self.assertRaisesRegex(ValueError, "sha256"):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_missing_native_platform_or_blockmap_fails_closed(self):
        blockmap = Path(f"{self.artifacts[1]}.blockmap")
        blockmap.unlink()
        with self.assertRaisesRegex(ValueError, "blockmap"):
            prepare(self.stage, "0.2.0", "test-commit")
        self.artifacts[1].unlink()
        with self.assertRaises(FileNotFoundError):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_signed_claim_without_notarization_fails(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        report = json.loads(path.read_text())
        report["signed"] = True
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, "notarization"):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_signed_mac_feed_prefers_verified_zip_not_dmg(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        report = json.loads(path.read_text())
        archive = self.artifacts[0].with_suffix(".zip")
        archive.write_bytes(b"signed application ZIP bytes")
        report.update(signed=True, notarized=True, zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        path.write_text(json.dumps(report))
        objects, feeds = prepare(self.stage, "0.2.0", "test-commit")
        self.assertIn(archive, objects)
        mac = yaml.safe_load(feeds["latest-mac.yml"])
        self.assertTrue(mac["files"][0]["url"].endswith(".zip"))
        self.assertEqual(mac["files"][0]["sha512"], base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode())
        self.assertTrue(json.loads(feeds["releases.json"])["downloads"][0]["signed"])
        archive.write_bytes(b"changed ZIP")
        with self.assertRaisesRegex(ValueError, "ZIP"):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_all_immutable_objects_verified_before_any_feed(self):
        objects, feeds = prepare(self.stage, "0.2.0", "test-commit")
        events = []
        client = Mock()
        client.put_object.side_effect = lambda **kwargs: events.append(("put", kwargs["Key"], kwargs.get("IfNoneMatch")))
        publish(client, self.stage, "0.2.0", objects, feeds,
                verify=lambda url, **kwargs: events.append(("verify", url)))
        self.assertEqual([event[0] for event in events[:10]], ["put", "verify"] * 5)
        self.assertTrue(all(event[2] == "*" for event in events[:10:2]))
        self.assertEqual([event[1] for event in events[10:]], [f"desktop/{name}" for name in feeds])

    def test_existing_object_with_wrong_bytes_never_advances_feed(self):
        objects, feeds = prepare(self.stage, "0.2.0", "test-commit")
        client = Mock()
        client.put_object.side_effect = ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        with self.assertRaisesRegex(ValueError, "different bytes"):
            publish(client, self.stage, "0.2.0", objects, feeds,
                    verify=Mock(side_effect=ValueError("different bytes")))
        self.assertEqual(client.put_object.call_count, 1)
