import base64
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import yaml
from botocore.exceptions import ClientError
from desktop_release import prepare, publish, verify_live


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
                          account=dict(connected=False), providerCount=0, loginGateVisible=True,
                          ctrlRBlocked=True))
            if platform == "darwin":
                report["macVerification"] = dict(codesignStrict=True,
                    spctl=dict(status=3, stdout="", stderr="rejected\nsource=no usable signature"))
            Path(f"{artifact}.assertion.json").write_text(json.dumps(report))
        Path(f"{self.artifacts[1]}.blockmap").write_bytes(b"block map")

    def test_live_verifier_identifies_itself_and_still_rejects_wrong_bytes(self):
        url = "https://dl.you-box.com/desktop/latest.yml"
        payload = b"verified public feed bytes"
        for actual in (payload, payload[:-1] + b"!"):
            with self.subTest(actual=actual), patch(
                "desktop_release.urllib.request.urlopen", return_value=io.BytesIO(actual)
            ) as open_url:
                if actual == payload:
                    verify_live(url, expected=payload)
                else:
                    with self.assertRaisesRegex(ValueError, "Live bytes differ"):
                        verify_live(url, expected=payload)
                request = open_url.call_args.args[0]
                self.assertEqual(request.full_url, url)
                self.assertEqual(request.get_method(), "GET")
                self.assertEqual(request.get_header("User-agent"), "BoxAI-Desktop-Publisher/1.0")
                self.assertIsNone(request.get_header("Authorization"))
                self.assertEqual(open_url.call_args.kwargs["timeout"], 120)

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

    def test_missing_login_gate_or_inherited_account_fails(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        original = json.loads(path.read_text())
        for patch in [dict(account=dict(connected=True)), dict(providerCount=1), dict(loginGateVisible=False)]:
            with self.subTest(patch=patch):
                report = {**original, "boot": {**original["boot"], **patch}}
                path.write_text(json.dumps(report))
                with self.assertRaisesRegex(ValueError, "boot assertion"):
                    prepare(self.stage, "0.2.0", "test-commit")

    def test_signed_claim_without_notarization_fails(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        report = json.loads(path.read_text())
        report["signed"] = True
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, "notarization"):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_mac_integrity_and_assessment_required_even_without_developer_id(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        original = json.loads(path.read_text())
        for evidence in [{}, dict(codesignStrict=False, spctl=original["macVerification"]["spctl"]),
                         dict(codesignStrict=True, spctl=dict(status=1, stdout="", stderr="assessment error")),
                         dict(codesignStrict=True, spctl=dict(status=False, stdout="", stderr=""))]:
            with self.subTest(evidence=evidence):
                path.write_text(json.dumps({**original, "macVerification": evidence}))
                with self.assertRaisesRegex(ValueError, "signature integrity"):
                    prepare(self.stage, "0.2.0", "test-commit")
        report = {**original, "signed": True, "notarized": True}
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, "signature integrity"):
            prepare(self.stage, "0.2.0", "test-commit")

    def test_signed_mac_feed_prefers_verified_zip_not_dmg(self):
        path = Path(f"{self.artifacts[0]}.assertion.json")
        report = json.loads(path.read_text())
        archive = self.artifacts[0].with_suffix(".zip")
        archive.write_bytes(b"signed application ZIP bytes")
        report.update(signed=True, notarized=True, zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        report["macVerification"]["spctl"] = dict(status=0, stdout="", stderr="accepted")
        dmg = dict(codesignStrict=True, teamId="9UUWCMKMDH", stapled=True,
                   spctl=dict(status=0, stdout="", stderr="accepted\nsource=Notarized Developer ID"))
        for evidence in [{}, {**dmg, "codesignStrict": False}, {**dmg, "teamId": "WRONGTEAM"},
                         {**dmg, "stapled": False},
                         {**dmg, "spctl": dict(status=3, stdout="", stderr="no usable signature")},
                         {**dmg, "spctl": dict(status=False, stdout="", stderr="accepted")}]:
            with self.subTest(dmg=evidence):
                report["macVerification"]["dmg"] = evidence
                path.write_text(json.dumps(report))
                with self.assertRaisesRegex(ValueError, "Signed DMG"):
                    prepare(self.stage, "0.2.0", "test-commit")
        report["macVerification"]["dmg"] = dmg
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
