#!/usr/bin/env python3
"""Regenerate BoxAI brand exports + site/desktop/connect icons from mark-master.png.

Usage (from repo root):
  python3 logo/scripts/build-brand-kit.py

Requires: Pillow, numpy. Optional: vtracer (SVG), iconutil (macOS .icns), rsvg-convert.
"""
from __future__ import annotations

import io
import re
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / "logo"
EXPORTS = LOGO / "exports"
PUB = ROOT / "web/default/public"
DESKTOP_ICONS = ROOT / "desktop/surfaces/gui/src-tauri/icons"
DESKTOP_ASSET = ROOT / "desktop/surfaces/gui/assets/icon.png"
CONNECT_ICONS = ROOT / "connect/src-tauri/icons"

BRAND_PRIMARY = "#E05A3A"  # UI (accessible) — web
MARK_MID = "#F08050"
MARK_CENTER = "#FFF3E0"
INK = "#0B0B0C"

# Product siblings: same mark, distinct hue + plate (Dock / taskbar).
PRODUCTS = {
    "web": {
        "hue_shift": 0.0,
        "sat_mul": 1.0,
        "val_mul": 1.0,
        "plate": None,
        "ui": "#E05A3A",
        "mark_mid": "#F08050",
    },
    "desktop": {
        "hue_shift": 10.0,  # warm peach-coral
        "sat_mul": 1.03,
        "val_mul": 1.01,
        "plate": "#14110F",
        "ui": "#EA6B2F",
        "mark_mid": "#F09048",
        "icons_dir": "desktop/surfaces/gui/src-tauri/icons",
        "asset_icon": "desktop/surfaces/gui/assets/icon.png",
        "tray": True,
    },
    "connect": {
        "hue_shift": -22.0,  # cool rose-coral
        "sat_mul": 1.0,
        "val_mul": 0.98,
        "plate": "#0E1218",
        "ui": "#D4545A",
        "mark_mid": "#E87070",
        "icons_dir": "connect/src-tauri/icons",
        "tray": False,
    },
}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def clean_source_to_master(src: Path, out: Path) -> Image.Image:
    """Despeckle WeChat/AI export and tight-crop to mark-master.png."""
    img = Image.open(src).convert("RGBA")
    arr = np.array(img)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

    clean_a = a.copy()
    clean_a[a < 96] = 0
    warm = (r.astype(np.int16) > g.astype(np.int16) - 20) & (r > 80) & (b < 220)
    center_white = (r > 220) & (g > 200) & (b > 180)
    keep = warm | center_white
    clean_a[~keep] = 0

    alpha_img = Image.fromarray(clean_a, mode="L")
    alpha_img = alpha_img.filter(ImageFilter.MinFilter(3))
    alpha_img = alpha_img.filter(ImageFilter.MaxFilter(5))
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=0.8))
    clean_a = np.array(alpha_img)
    clean_a[clean_a < 40] = 0
    core = (a >= 160) & keep
    clean_a[core] = np.maximum(clean_a[core], a[core])
    clean_a = np.clip(clean_a, 0, 255).astype(np.uint8)

    out_arr = arr.copy()
    out_arr[:, :, 3] = clean_a
    mask = clean_a >= 48
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise SystemExit("no logo content after clean — check source alpha")

    pad = int(0.08 * max(xs.max() - xs.min(), ys.max() - ys.min()))
    x0, y0 = xs.min() - pad, ys.min() - pad
    x1, y1 = xs.max() + pad, ys.max() + pad
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    side = max(x1 - x0, y1 - y0)
    if side % 2:
        side += 1
    half = side // 2
    x0c = max(0, cx - half)
    y0c = max(0, cy - half)
    x1c = min(out_arr.shape[1], cx + half)
    y1c = min(out_arr.shape[0], cy + half)

    cropped = Image.fromarray(out_arr).crop((x0c, y0c, x1c, y1c))
    w, h = cropped.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - w) // 2, (side - h) // 2), cropped)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    print(f"master {out.relative_to(ROOT)} {canvas.size}")
    return canvas


def shift_mark_hsv(
    img: Image.Image, hue_deg: float, sat_mul: float = 1.0, val_mul: float = 1.0
) -> Image.Image:
    """HSV-shift warm mark colors; preserve cream center and alpha."""
    arr = np.array(img).astype(np.float32)
    a = arr[:, :, 3]
    r, g, b = arr[:, :, 0] / 255.0, arr[:, :, 1] / 255.0, arr[:, :, 2] / 255.0
    cream = (arr[:, :, 0] > 230) & (arr[:, :, 1] > 200) & (arr[:, :, 2] > 160) & (a > 40)
    mask = (a > 20) & ~cream
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    diff = mx - mn
    v = mx
    s = np.where(mx == 0, 0, diff / (mx + 1e-8))
    h = np.zeros_like(mx)
    rc = (mx - r) / (diff + 1e-8)
    gc = (mx - g) / (diff + 1e-8)
    bc = (mx - b) / (diff + 1e-8)
    h = np.where((mx == r) & (diff > 0), (bc - gc) / 6.0 % 1.0, h)
    h = np.where((mx == g) & (diff > 0), (2.0 + rc - bc) / 6.0, h)
    h = np.where((mx == b) & (diff > 0), (4.0 + gc - rc) / 6.0, h)
    h2 = (h + hue_deg / 360.0) % 1.0
    s2 = np.clip(s * sat_mul, 0, 1)
    v2 = np.clip(v * val_mul, 0, 1)
    i = np.floor(h2 * 6).astype(np.int32)
    f = h2 * 6 - i
    p = v2 * (1 - s2)
    q = v2 * (1 - f * s2)
    t = v2 * (1 - (1 - f) * s2)
    im = i % 6
    r2 = np.choose(im, [v2, q, p, p, t, v2])
    g2 = np.choose(im, [t, v2, v2, q, p, p])
    b2 = np.choose(im, [p, p, t, v2, v2, q])
    out = arr.copy()
    out[:, :, 0] = np.where(mask, r2 * 255, arr[:, :, 0])
    out[:, :, 1] = np.where(mask, g2 * 255, arr[:, :, 1])
    out[:, :, 2] = np.where(mask, b2 * 255, arr[:, :, 2])
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def resize_mark(master: Image.Image, size: int, pad_ratio: float = 0.08) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - 2 * pad_ratio))
    m = master.resize((inner, inner), Image.Resampling.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(m, (off, off), m)
    return canvas


def app_icon(
    master: Image.Image,
    size: int,
    bg: str = INK,
    radius_ratio: float = 0.22,
    pad_ratio: float = 0.14,
) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=hex_rgb(bg) + (255,))
    mark = resize_mark(master, size, pad_ratio=pad_ratio)
    return Image.alpha_composite(img, mark)


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}²  {path.stat().st_size // 1024}KB")


def write_ico(path: Path, master: Image.Image, sizes: tuple[int, ...] = (16, 32, 48)) -> None:
    images = [
        resize_mark(master, s, pad_ratio=0.04 if s >= 32 else 0.02) for s in sizes
    ]
    entries, blobs = [], []
    offset = 6 + 16 * len(images)
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        data = buf.getvalue()
        w, h = im.size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                w if w < 256 else 0,
                h if h < 256 else 0,
                0,
                0,
                1,
                32,
                len(data),
                offset,
            )
        )
        blobs.append(data)
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(images)))
        for e in entries:
            f.write(e)
        for b in blobs:
            f.write(b)
    print(f"  {path.relative_to(ROOT)}  ico{sizes}  {path.stat().st_size // 1024}KB")


def make_icns(out_path: Path, make_frame) -> None:
    """Write a .icns. `make_frame(size)` must return an RGBA PIL image."""
    with tempfile.TemporaryDirectory() as td:
        iconset = Path(td) / "AppIcon.iconset"
        iconset.mkdir()
        mapping = {
            "icon_16x16.png": 16,
            "diana.k@example.org": 32,
            "icon_32x32.png": 32,
            "ivan.p@example.net": 64,
            "icon_128x128.png": 128,
            "wendy.h@example.net": 256,
            "icon_256x256.png": 256,
            "wendy.h@example.net": 512,
            "icon_512x512.png": 512,
            "walt.e@example.net": 1024,
        }
        for name, s in mapping.items():
            make_frame(s).save(iconset / name, "PNG")
        r = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(out_path)],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            print(f"  {out_path.relative_to(ROOT)}  icns  {out_path.stat().st_size // 1024}KB")
        else:
            print(f"  skip icns ({out_path.name}): {r.stderr.strip() or 'iconutil failed'}")


def build_og(master: Image.Image) -> Image.Image:
    og = Image.new("RGBA", (1200, 630), hex_rgb(INK) + (255,))
    glow = Image.new("RGBA", (1200, 630), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = 360, 315
    for i, alpha in enumerate([28, 18, 10, 5]):
        rad = 280 + i * 60
        gd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=hex_rgb(MARK_MID) + (alpha,))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    og = Image.alpha_composite(og, glow)
    mark = resize_mark(master, 360, pad_ratio=0.04)
    og.paste(mark, (180, (630 - 360) // 2), mark)

    font = font_sm = None
    for fp in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        if Path(fp).exists():
            try:
                font = ImageFont.truetype(fp, 96)
                font_sm = ImageFont.truetype(fp, 32)
                break
            except OSError:
                continue
    if font is None:
        font = font_sm = ImageFont.load_default()

    draw = ImageDraw.Draw(og)
    draw.text((580, 230), "BoxAI", fill=hex_rgb("#FFFFFF") + (255,), font=font)
    draw.text((580, 350), "Unified AI API Gateway", fill=hex_rgb("#A1A1AA") + (255,), font=font_sm)
    draw.text((580, 400), "you-box.com", fill=hex_rgb(BRAND_PRIMARY) + (255,), font=font_sm)
    return og


def build_svg(master: Image.Image) -> str | None:
    try:
        import vtracer
    except ImportError:
        print("  skip SVG (pip install vtracer)")
        return None

    # Posterize to two fills for a small path count
    arr = np.array(master.resize((512, 512), Image.Resampling.LANCZOS))
    a = arr[:, :, 3]
    mask = a >= 100
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    cream = (r > 230) & (g > 200) & (b > 160) & mask
    out = np.zeros_like(arr)
    out[mask] = (*hex_rgb(MARK_MID), 255)
    out[cream] = (*hex_rgb(MARK_CENTER), 255)
    work = Path(tempfile.mkdtemp()) / "poster.png"
    Image.fromarray(out).save(work)
    svg_path = Path(tempfile.mkdtemp()) / "mark.svg"
    vtracer.convert_image_to_svg_py(
        str(work),
        str(svg_path),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=12,
        color_precision=4,
        layer_difference=48,
        corner_threshold=80,
        length_threshold=5.0,
        max_iterations=10,
        splice_threshold=50,
        path_precision=2,
    )
    src = svg_path.read_text()
    src = re.sub(r"<\?xml[^>]*\?>\s*", "", src)
    src = re.sub(r"<!--.*?-->\s*", "", src, flags=re.S)
    src = re.sub(r'<path d=""[^/]*/>\s*', "", src)
    # Normalize fills toward brand tokens
    src = re.sub(r'fill="#D2[0-9A-F]{4}"', f'fill="{MARK_MID}"', src, flags=re.I)
    src = re.sub(r'fill="#F[DE][0-9A-F]{4}"', f'fill="{MARK_CENTER}"', src, flags=re.I)
    src = src.replace(
        '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="512" height="512">',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-labelledby="title">',
    )
    if "<title" not in src:
        src = src.replace(">", '>\n  <title id="title">BoxAI</title>', 1)
    src = src.replace("<path ", "\n  <path ").replace("</svg>", "\n</svg>\n")
    print(f"  SVG paths={src.count('<path')} bytes={len(src)}")
    return src


def main() -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    master_path = LOGO / "mark-master.png"
    src = LOGO / "WechatIMG179.jpg"
    if not master_path.exists():
        if not src.exists():
            raise SystemExit(f"missing {src} and {master_path}")
        master = clean_source_to_master(src, master_path)
    else:
        master = Image.open(master_path).convert("RGBA")
        print(f"using existing {master_path.relative_to(ROOT)}")

    print("== web public ==")
    save_png(resize_mark(master, 512, 0.06), PUB / "logo.png")
    for s in (1024, 512, 256, 128, 64, 32):
        save_png(resize_mark(master, s, 0.06 if s > 32 else 0.04), EXPORTS / f"logo-{s}.png")
    save_png(resize_mark(master, 32, 0.04), PUB / "favicon-32.png")
    save_png(resize_mark(master, 180, 0.08), PUB / "apple-touch-icon.png")
    save_png(app_icon(master, 512), EXPORTS / "app-icon-512.png")
    save_png(app_icon(master, 1024), EXPORTS / "app-icon-1024.png")

    og = build_og(master)
    save_png(og, PUB / "og-image.png")
    save_png(og, EXPORTS / "og-image.png")

    write_ico(PUB / "favicon.ico", master, (16, 32, 48))
    write_ico(EXPORTS / "favicon.ico", master, (16, 32, 48))

    svg = build_svg(master)
    if svg:
        for p in (
            PUB / "logo.svg",
            PUB / "box-ai-icon.svg",
            EXPORTS / "mark.svg",
            EXPORTS / "logo.svg",
        ):
            p.write_text(svg)
            print(f"  {p.relative_to(ROOT)}")
        mono = re.sub(r'fill="#[^"]+"', 'fill="currentColor"', svg)
        (EXPORTS / "mark-mono.svg").write_text(mono)
        (CONNECT_ICONS / "icon.svg").write_text(
            svg.replace("BoxAI</title>", "BoxAI Connect</title>")
        )

    print("== product siblings (desktop / connect) ==")
    work = master.resize((1024, 1024), Image.Resampling.LANCZOS)
    for key, cfg in PRODUCTS.items():
        if key == "web":
            continue
        print(f"  {key}: hue={cfg['hue_shift']} plate={cfg['plate']} ui={cfg['ui']}")
        mark = shift_mark_hsv(work, cfg["hue_shift"], cfg["sat_mul"], cfg["val_mul"])
        plate = cfg["plate"] or INK
        icons = ROOT / cfg["icons_dir"]

        def frame(s: int, m=mark, p=plate) -> Image.Image:
            return app_icon(m, s, bg=p)

        save_png(mark, EXPORTS / f"mark-{key}.png")
        save_png(frame(512), EXPORTS / f"app-icon-{key}-512.png")
        save_png(frame(1024), icons / "icon.png")
        if cfg.get("asset_icon"):
            save_png(frame(512), ROOT / cfg["asset_icon"])
        for s, name in [
            (32, "32x32.png"),
            (64, "64x64.png"),
            (128, "128x128.png"),
            (256, "128x128@2x.png"),
        ]:
            save_png(frame(s), icons / name)
        for name, size in [
            ("Square30x30Logo.png", 30),
            ("Square44x44Logo.png", 44),
            ("Square71x71Logo.png", 71),
            ("Square89x89Logo.png", 89),
            ("Square107x107Logo.png", 107),
            ("Square142x142Logo.png", 142),
            ("Square150x150Logo.png", 150),
            ("Square284x284Logo.png", 284),
            ("Square310x310Logo.png", 310),
            ("StoreLogo.png", 50),
        ]:
            save_png(app_icon(mark, size, bg=plate, pad_ratio=0.16), icons / name)

        # ICO / ICNS from solid plates
        ico_frames = [frame(s) for s in (16, 32, 48, 64, 128, 256)]
        entries, blobs = [], []
        offset = 6 + 16 * len(ico_frames)
        for im in ico_frames:
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            data = buf.getvalue()
            w, h = im.size
            entries.append(
                struct.pack(
                    "<BBBBHHII",
                    w if w < 256 else 0,
                    h if h < 256 else 0,
                    0,
                    0,
                    1,
                    32,
                    len(data),
                    offset,
                )
            )
            blobs.append(data)
            offset += len(data)
        with open(icons / "icon.ico", "wb") as f:
            f.write(struct.pack("<HHH", 0, 1, len(ico_frames)))
            for e in entries:
                f.write(e)
            for b in blobs:
                f.write(b)
        print(f"  { (icons / 'icon.ico').relative_to(ROOT) }")
        make_icns(icons / "icon.icns", lambda s, m=mark, p=plate: app_icon(m, s, bg=p))

        if svg:
            tinted = svg.replace(MARK_MID, cfg["mark_mid"]).replace(
                "BoxAI</title>", f"BoxAI {key.title()}</title>"
            )
            (EXPORTS / f"mark-{key}.svg").write_text(tinted)
            if key == "connect":
                (icons / "icon.svg").write_text(tinted)

        if cfg.get("tray"):
            tray = app_icon(mark, 44, bg=plate, pad_ratio=0.12)
            save_png(tray, icons / "tray.png")
            (icons / "tray.rgba").write_bytes(np.array(tray.convert("RGBA")).tobytes())
            print(f"  {(icons / 'tray.rgba').relative_to(ROOT)}")

    print("done. web UI primary:", BRAND_PRIMARY)
    print("  desktop UI:", PRODUCTS["desktop"]["ui"], "| connect UI:", PRODUCTS["connect"]["ui"])


if __name__ == "__main__":
    main()
