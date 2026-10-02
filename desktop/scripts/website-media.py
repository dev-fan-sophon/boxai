#!/usr/bin/env python3
"""Export reviewed, real BoxAI Desktop captures. Requires ffmpeg and ffprobe."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile


SCENES = ("agent", "plan", "subagents", "models", "plugins", "review", "agent-vi", "models-vi")
DOCS = ("login", "models", "settings", "updates", "permissions", "project-session")
VIDEOS = ("overview", "getting-started")
WIDTHS = (480, 960, 1536)
PUBLIC = Path(__file__).resolve().parents[2] / "web/default/public"
MAX_BYTES = 8_000_000


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def probe(path):
    return json.loads(run("ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)))


def frame_info(path):
    streams = probe(path)["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    if video["width"] * 10 != video["height"] * 16:
        raise ValueError(f"{path}: expected 16:10; crop deliberately before exporting")
    return video


def webp(source, output, width):
    info = frame_info(source)
    if info["width"] < width:
        raise ValueError(f"{source}: refusing to upscale {info['width']} to {width}")
    output.parent.mkdir(parents=True, exist_ok=True)
    run("ffmpeg", "-v", "error", "-y", "-i", str(source), "-frames:v", "1",
        "-vf", f"scale={width}:{width * 10 // 16}:flags=lanczos", "-c:v", "libwebp",
        "-quality", "86", "-compression_level", "6", "-map_metadata", "-1", str(output))


def images(source, output):
    inputs = [(source / f"{name}.png", name, False) for name in SCENES]
    inputs += [(source / "docs" / f"{name}.png", name, True) for name in DOCS]
    # Validate the entire set before writing any public assets.
    for path, _, _ in inputs:
        if frame_info(path)["width"] < 1536:
            raise ValueError(f"{path}: capture at least 1536×960")
    for path, name, doc in inputs:
        for width in ((1536,) if doc else WIDTHS):
            destination = output / "desktop-screenshots" / (f"docs/{name}.webp" if doc else f"{name}-{width}.webp")
            webp(path, destination, width)


def videos(source, output):
    destination = output / "desktop-videos"
    destination.mkdir(parents=True, exist_ok=True)
    for name in VIDEOS:
        movie = source / f"{name}.mov"
        frame_info(movie)
        duration = float(probe(movie)["format"]["duration"])
        if not 45 <= duration <= 75:
            raise ValueError(f"{movie}: expected 45–75 seconds, got {duration}")
        # Reserve 10% for container overhead and bitrate variation.
        bitrate = int(MAX_BYTES * 0.9 * 8 / duration)
        for extension, codec in (("mp4", "libx264"), ("webm", "libvpx-vp9")):
            target = destination / f"{name}.{extension}"
            with tempfile.TemporaryDirectory(prefix="boxai-encode-") as scratch:
                for pass_number in (1, 2):
                    args = ["ffmpeg", "-v", "error", "-y", "-i", str(movie),
                            "-map", "0:v:0", "-an", "-vf", "scale=1536:960:flags=lanczos,fps=24",
                            "-c:v", codec, "-b:v", str(bitrate), "-pix_fmt", "yuv420p",
                            "-pass", str(pass_number), "-passlogfile", str(Path(scratch) / "pass"),
                            "-map_metadata", "-1"]
                    if extension == "mp4":
                        args += ["-preset", "slow", "-movflags", "+faststart"]
                    else:
                        args += ["-deadline", "good", "-cpu-used", "2", "-row-mt", "1"]
                    args += [str(target)] if pass_number == 2 else ["-f", "null", "-"]
                    run(*args)
            if target.stat().st_size >= MAX_BYTES:
                raise ValueError(f"{target}: exceeds 8 MB; shorten or simplify the edit")
        # A deliberately selected, reviewed source frame, not an arbitrary login frame.
        webp(source / f"{name}-poster.png", destination / f"{name}-poster.webp", 1536)


def verify(output):
    expected = [(output / f"desktop-screenshots/{name}-{width}.webp", width, "webp")
                for name in SCENES for width in WIDTHS]
    expected += [(output / f"desktop-screenshots/docs/{name}.webp", 1536, "webp") for name in DOCS]
    for name in VIDEOS:
        expected.append((output / f"desktop-videos/{name}-poster.webp", 1536, "webp"))
        expected += [(output / f"desktop-videos/{name}.{ext}", 1536, codec)
                     for ext, codec in (("mp4", "h264"), ("webm", "vp9"))]
    for path, width, codec in expected:
        metadata = probe(path)
        info = frame_info(path)
        if (info["width"], info["codec_name"]) != (width, codec):
            raise ValueError(f"{path}: unexpected dimensions or codec")
        if codec != "webp":
            if not 45 <= float(metadata["format"]["duration"]) <= 75.1:
                raise ValueError(f"{path}: duration outside 45–75 seconds")
            if any(s["codec_type"] == "audio" for s in metadata["streams"]):
                raise ValueError(f"{path}: audio track must be removed")
            if path.stat().st_size >= MAX_BYTES:
                raise ValueError(f"{path}: exceeds 8 MB")
        print(f"OK {path.relative_to(output)} {path.stat().st_size:,} bytes")
    print(f"PASS: {len(expected)} assets; dimensions, codecs, durations, silence, and size verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("images", "videos", "verify"))
    parser.add_argument("--source", type=Path, help="private directory of reviewed PNG/MOV sources")
    parser.add_argument("--output", type=Path, default=PUBLIC)
    args = parser.parse_args()
    if args.command != "verify" and not args.source:
        parser.error("images/videos require --source")
    try:
        if args.command == "verify":
            verify(args.output)
        else:
            globals()[args.command](args.source.resolve(), args.output.resolve())
    except subprocess.CalledProcessError as error:
        parser.exit(1, error.stderr)
