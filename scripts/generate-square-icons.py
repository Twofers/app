"""
Generate Expo icon, Android adaptive icon, splash, favicon, and in-app mark
assets from the approved transparent penguin-with-orange-bowtie sources.

Run from repo root:
    python scripts/generate-square-icons.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
OUT_SIZE = 1024
MARK_SIZE = 512
WHITE = (255, 255, 255)


def require_size(path: Path, size: tuple[int, int]) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    img.load()
    if img.size != size:
        raise SystemExit(f"{path.relative_to(ROOT)} expected {size}, got {img.size}")
    return img


def write_rgb_app_icon(src: Path, dest: Path) -> None:
    penguin = require_size(src, (OUT_SIZE, OUT_SIZE))
    icon = Image.new("RGB", (OUT_SIZE, OUT_SIZE), WHITE)
    icon.paste(penguin, (0, 0), penguin)
    icon.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {icon.size} RGB")


def write_monochrome_from_alpha(src: Path, dest: Path) -> None:
    foreground = require_size(src, (OUT_SIZE, OUT_SIZE))
    alpha = foreground.getchannel("A")
    white = Image.new("L", foreground.size, 255)
    mono = Image.merge("RGBA", (white, white, white, alpha))
    mono.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {mono.size} RGBA")


def write_resized(src: Path, dest: Path, size: tuple[int, int]) -> None:
    img = Image.open(src).convert("RGBA")
    img.load()
    if img.size != size:
        img = img.resize(size, Image.Resampling.LANCZOS)
    img.save(dest, "PNG", optimize=True)
    print(f"Wrote {dest.relative_to(ROOT)} {img.size} RGBA")


def main() -> None:
    app_source = ASSETS / "penguin-master-transparent-1024.png"
    foreground_source = ASSETS / "adaptive-icon-foreground-1024.png"
    splash_source = ASSETS / "penguin-splash-1024.png"
    mark_source = ASSETS / "penguin-auth-512.png"

    write_rgb_app_icon(app_source, ASSETS / "twofer-icon-1024.png")
    write_resized(
        foreground_source,
        ASSETS / "twofer-adaptive-icon-foreground-1024.png",
        (OUT_SIZE, OUT_SIZE),
    )
    write_monochrome_from_alpha(
        ASSETS / "twofer-adaptive-icon-foreground-1024.png",
        ASSETS / "twofer-adaptive-icon-monochrome-1024.png",
    )
    write_resized(splash_source, ASSETS / "twofer-splash-1024.png", (OUT_SIZE, OUT_SIZE))
    write_resized(mark_source, ASSETS / "twofer-mark-512.png", (MARK_SIZE, MARK_SIZE))
    write_resized(mark_source, ASSETS / "favicon.png", (MARK_SIZE, MARK_SIZE))

    print("All brand assets regenerated from approved penguin sources.")


if __name__ == "__main__":
    main()
