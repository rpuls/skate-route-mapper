#!/usr/bin/env python3
"""Generate every app-icon file in the repo from the one source artwork.

Input:  brand/app-icon.png
Output: brand/ masters, mobile/assets/ (Expo) and admin/public/ (favicons).

The source is a square illustration drawn inside a rounded shape on a white
field. Nothing here is hard-coded to that shape: the script measures where the
white field ends, so replacing brand/app-icon.png with a differently rounded
drawing still produces correct masks and crops.

Needs Pillow:  pip install pillow
Run from the repo root:  python scripts/build-brand-assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover - developer convenience
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "brand" / "app-icon.png"

# A pixel this bright in every channel is the white field around the drawing,
# not part of it. Chosen above the field's own noise (it is ~251, not 255) and
# below the lightest tones inside the artwork.
WHITE_THRESHOLD = 244

# Android masks an adaptive icon to the middle ~66% of the layer, and the mask
# can be a circle. This is the drawing's width on the 1024 foreground, small
# enough that a circular mask takes only the rounded corners.
ADAPTIVE_MARK = 620


def load_source() -> Image.Image:
    if not SOURCE.exists():
        sys.exit(f"missing source artwork: {SOURCE.relative_to(ROOT)}")
    return Image.open(SOURCE).convert("RGB")


def outside_mask(image: Image.Image) -> list[list[bool]]:
    """Mark the white field around the drawing.

    Scans inward from all four edges rather than testing brightness alone, so
    white *inside* the drawing (the boot, the road markings, the speed lines)
    stays part of the artwork.
    """
    width, height = image.size
    pixel = image.load()

    def is_field(x: int, y: int) -> bool:
        red, green, blue = pixel[x, y]
        return red >= WHITE_THRESHOLD and green >= WHITE_THRESHOLD and blue >= WHITE_THRESHOLD

    outside = [[False] * width for _ in range(height)]
    for y in range(height):
        x = 0
        while x < width and is_field(x, y):
            outside[y][x] = True
            x += 1
        x = width - 1
        while x >= 0 and is_field(x, y):
            outside[y][x] = True
            x -= 1
    for x in range(width):
        y = 0
        while y < height and is_field(x, y):
            outside[y][x] = True
            y += 1
        y = height - 1
        while y >= 0 and is_field(x, y):
            outside[y][x] = True
            y -= 1
    return outside


def cut_out(image: Image.Image, outside: list[list[bool]]) -> Image.Image:
    """The drawing with the white field replaced by transparency."""
    width, height = image.size
    mask = Image.new("L", (width, height), 0)
    mask.putdata([0 if outside[y][x] else 255 for y in range(height) for x in range(width)])
    # Pull the edge in by a pixel before softening it, so the field's own
    # anti-aliased fringe is cut away instead of blurred into a white halo.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    cut = image.convert("RGBA")
    cut.putalpha(mask)
    return cut


def content_inset(outside: list[list[bool]], size: int) -> int:
    """The smallest even crop from every side that contains no white field.

    This is what makes an opaque square icon possible: iOS and the app stores
    want a full-bleed square, and the corners of the source are field, not
    drawing.
    """

    def clean(inset: int) -> bool:
        return not any(any(outside[y][inset : size - inset]) for y in range(inset, size - inset))

    low, high = 0, size // 2
    while low < high:
        middle = (low + high) // 2
        if clean(middle):
            high = middle
        else:
            low = middle + 1
    return low


def write(image: Image.Image, relative: str) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "PNG", optimize=True)
    print(f"  {relative}  {image.size[0]}x{image.size[1]}  {target.stat().st_size // 1024} KB")


def scaled(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    source = load_source()
    width, height = source.size
    if width != height:
        sys.exit(f"source artwork must be square, got {width}x{height}")

    outside = outside_mask(source)
    cut = cut_out(source, outside)
    inset = content_inset(outside, width)
    square = source.crop((inset, inset, width - inset, height - inset))
    print(f"source {width}x{height}, drawing fills {width - 2 * inset}px square")

    print("brand masters:")
    write(scaled(cut, 1024), "brand/app-icon-rounded-1024.png")
    write(scaled(cut, 512), "brand/app-icon-rounded-512.png")
    write(scaled(square, 1024), "brand/app-icon-square-1024.png")

    print("mobile (expo):")
    # iOS and the stores want an opaque square; both platforms round it
    # themselves, and their corners cut inside the drawing's own.
    write(scaled(square, 1024), "mobile/assets/icon.png")
    # Android composites this over adaptiveIcon.backgroundColor and masks the
    # result, so the drawing sits inside the safe area on a transparent layer.
    foreground = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    offset = (1024 - ADAPTIVE_MARK) // 2
    foreground.paste(scaled(cut, ADAPTIVE_MARK), (offset, offset))
    write(foreground, "mobile/assets/adaptive-icon.png")
    write(scaled(cut, 1024), "mobile/assets/splash-icon.png")
    write(scaled(cut, 64), "mobile/assets/favicon.png")

    print("admin:")
    write(scaled(cut, 64), "admin/public/favicon.png")
    write(scaled(cut, 180), "admin/public/apple-touch-icon.png")


if __name__ == "__main__":
    main()
