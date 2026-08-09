#!/usr/bin/env python3
"""Convert selected project textures to WebP.

Run from the project root:
    python3 tools/webp_convert.py

Originals are preserved; .webp files are written alongside them.
Parameters are locked per 2026-08-09 HN-launch prep spec.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent.parent  # project root

CONVERSIONS = [
    # (relative_path, target_width_or_None, quality)
    ("public/assets/textures/desk_lantern_mosaic.png",       None, 90),
    ("public/assets/textures/lantern_mosaic.png",            None, 90),
    ("public/assets/textures/desk_lantern_mosaic_rough.png", None, 85),
    ("public/assets/textures/lantern_mosaic_rough.png",      None, 85),
    ("public/assets/textures/sofa/leather_white_diff_1k.jpg",   512, 90),
    ("public/assets/textures/sofa/leather_white_rough_1k.jpg",  512, 85),
    ("public/assets/textures/sofa/leather_white_nor_gl_1k.jpg", 512, 95),
]


def convert(rel_src: str, target_width, quality: int) -> None:
    src = ROOT / rel_src
    dst = src.with_suffix(".webp")

    with Image.open(src) as im:
        if target_width is not None and im.width != target_width:
            target_height = round(im.height * target_width / im.width)
            im = im.resize((target_width, target_height), Image.LANCZOS)

        # Preserve grayscale; convert palette to RGB(A) if needed
        if im.mode == "L":
            pass  # keep as-is
        elif im.mode == "P":
            im = im.convert("RGBA")
        elif im.mode not in ("RGB", "RGBA", "L"):
            im = im.convert("RGB")

        im.save(dst, "WEBP", quality=quality, method=6)

    src_kb = src.stat().st_size / 1024
    dst_kb = dst.stat().st_size / 1024
    print(f"  {src.name:45s}  {src_kb:7.1f} KB  ->  {dst_kb:7.1f} KB  (q={quality})")


if __name__ == "__main__":
    print("Converting textures to WebP...\n")
    for rel, width, q in CONVERSIONS:
        convert(rel, width, q)
    print("\nDone. Originals preserved.")
