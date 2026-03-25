"""
Generate square 1024x1024 Expo / Android icon assets from existing sources.
Run from repo root: python scripts/generate-square-icons.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
OUT_SIZE = 1024
# Android adaptive icon: keep foreground content within ~62% of canvas (safe zone margin).
SAFE_FRACTION = 0.62
# Match app.json android.adaptiveIcon.backgroundColor
ADAPTIVE_BG = (0xE6, 0xF4, 0xFE, 255)


def sample_bg_color_rgba(img: Image.Image) -> tuple[int, int, int, int]:
    """Sample corner pixels for pad color (main icon has solid-ish edges)."""
    assert img.mode == "RGBA"
    w, h = img.size
    samples = [
        img.getpixel((0, 0)),
        img.getpixel((w - 1, 0)),
        img.getpixel((0, h - 1)),
        img.getpixel((w - 1, h - 1)),
    ]
    r = sum(p[0] for p in samples) // 4
    g = sum(p[1] for p in samples) // 4
    b = sum(p[2] for p in samples) // 4
    a = sum(p[3] for p in samples) // 4
    return (r, g, b, a)


def make_square_icon(src: Path, dest: Path) -> None:
    img = Image.open(src).convert("RGBA")
    img.load()
    w, h = img.size
    side = max(w, h)
    bg = sample_bg_color_rgba(img)
    square = Image.new("RGBA", (side, side), bg)
    square.paste(img, ((side - w) // 2, (side - h) // 2), img)
    square = square.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
    square.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {square.size}")


def fit_foreground_safe(src: Path, dest: Path) -> None:
    img = Image.open(src).convert("RGBA")
    img.load()
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit(f"No opaque content in {src}")
    cropped = img.crop(bbox)
    cw, ch = cropped.size
    max_dim = int(OUT_SIZE * SAFE_FRACTION)
    scale = min(max_dim / cw, max_dim / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (0, 0, 0, 0))
    ox = (OUT_SIZE - nw) // 2
    oy = (OUT_SIZE - nh) // 2
    canvas.paste(scaled, (ox, oy), scaled)
    canvas.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {canvas.size}")


def solid_background(dest: Path) -> None:
    img = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), ADAPTIVE_BG)
    img.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {img.size}")


def monochrome_from_foreground(foreground_path: Path, dest: Path) -> None:
    """White silhouette on transparent — standard for Android themed / monochrome layer."""
    img = Image.open(foreground_path).convert("RGBA")
    img.load()
    r, g, b, a = img.split()
    white = Image.new("L", img.size, 255)
    out = Image.merge("RGBA", (white, white, white, a))
    bbox = out.getbbox()
    if not bbox:
        raise SystemExit("Monochrome: empty alpha")
    cropped = out.crop(bbox)
    cw, ch = cropped.size
    max_dim = int(OUT_SIZE * SAFE_FRACTION)
    scale = min(max_dim / cw, max_dim / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (0, 0, 0, 0))
    ox = (OUT_SIZE - nw) // 2
    oy = (OUT_SIZE - nh) // 2
    canvas.paste(scaled, (ox, oy), scaled)
    canvas.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {canvas.size}")


def main() -> None:
    make_square_icon(ASSETS / "icon.png", ASSETS / "icon.png")
    fit_foreground_safe(ASSETS / "android-icon-foreground.png", ASSETS / "android-icon-foreground.png")
    solid_background(ASSETS / "android-icon-background.png")
    monochrome_from_foreground(ASSETS / "android-icon-foreground.png", ASSETS / "android-icon-monochrome.png")

    for name in (
        "icon.png",
        "android-icon-foreground.png",
        "android-icon-background.png",
        "android-icon-monochrome.png",
    ):
        im = Image.open(ASSETS / name)
        w, h = im.size
        assert w == h == OUT_SIZE, f"{name} expected {OUT_SIZE}x{OUT_SIZE}, got {w}x{h}"
    print("All assets verified square", OUT_SIZE, "x", OUT_SIZE)


if __name__ == "__main__":
    main()
