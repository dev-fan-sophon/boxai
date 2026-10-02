"""Codec integration checks; synthetic media stays in temporary directories."""

import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("media", Path(__file__).with_name("website-media.py"))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaTest(unittest.TestCase):
    def test_real_image_export_and_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "docs").mkdir()
            frame = source / "agent.png"
            media.run("ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                      "color=c=blue:s=1536x960", "-frames:v", "1", str(frame))
            for scene in media.SCENES[1:]:
                shutil.copyfile(frame, source / f"{scene}.png")
            for scene in media.DOCS:
                shutil.copyfile(frame, source / "docs" / f"{scene}.png")
            output = root / "public"
            media.images(source, output)
            self.assertEqual(len(list(output.rglob("*.webp"))), 30)
            for width, height in ((480, 300), (960, 600), (1536, 960)):
                info = media.frame_info(output / f"desktop-screenshots/agent-vi-{width}.webp")
                self.assertEqual((info["width"], info["height"], info["codec_name"]), (width, height, "webp"))
            with self.assertRaisesRegex(ValueError, "refusing to upscale"):
                media.webp(output / "desktop-screenshots/agent-480.webp", root / "bad.webp", 960)
            media.run("ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                      "color=s=1536x864", "-frames:v", "1", str(root / "wide.png"))
            with self.assertRaisesRegex(ValueError, "expected 16:10"):
                media.webp(root / "wide.png", root / "bad.webp", 480)

    def test_video_pipeline_removes_audio_and_encodes_both_formats(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media.run("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1536x960:r=24",
                      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "45", "-c:v", "libx264",
                      "-preset", "ultrafast", "-c:a", "aac", str(root / "overview.mov"))
            media.run("ffmpeg", "-v", "error", "-i", str(root / "overview.mov"),
                      "-frames:v", "1", str(root / "overview-poster.png"))
            original = media.VIDEOS
            try:
                media.VIDEOS = ("overview",)
                media.videos(root, root / "public")
            finally:
                media.VIDEOS = original
            for extension, codec in (("mp4", "h264"), ("webm", "vp9")):
                movie = root / f"public/desktop-videos/overview.{extension}"
                metadata = media.probe(movie)
                self.assertEqual(len(metadata["streams"]), 1)
                self.assertEqual(metadata["streams"][0]["codec_name"], codec)
                self.assertEqual(metadata["streams"][0]["width"], 1536)
                self.assertAlmostEqual(float(metadata["format"]["duration"]), 45, places=1)
                self.assertLess(movie.stat().st_size, 8_000_000)
            data = (root / "public/desktop-videos/overview.mp4").read_bytes()
            self.assertLess(data.index(b"moov"), data.index(b"mdat"))


if __name__ == "__main__":
    unittest.main()
