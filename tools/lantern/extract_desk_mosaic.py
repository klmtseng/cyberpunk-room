"""Extract the desk lamp's actual glass-body mosaic from user photos and stitch
into an equirectangular texture.

We have 4 photos of the same lamp rotated to different angles — together they
cover ~360° of the body. For each photo we:
  1. crop the glass-body bounding box (avoiding brass cap/base + room clutter)
  2. apply a soft horizontal mask so neighbouring strips blend at seams
  3. paste into a 2048×1024 panorama as one 512-wide quadrant
The roughness map is derived from luminance (bright white grout = matte,
saturated jewel-bead chips = glossier).

Output:
    public/assets/textures/desk_lantern_mosaic.png
    public/assets/textures/desk_lantern_mosaic_rough.png
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps
import numpy as np

UPLOADS = Path("/home/ai-mac/.claude/uploads/f9a7fe53-f82b-438a-b6cb-6f4fadca8945")
OUT = Path(__file__).resolve().parent.parent.parent / "public/assets/textures"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 2048, 1024
STRIP_W = W // 4   # 512

# Per-photo crop box as (left_frac, top_frac, right_frac, bottom_frac) relative
# to that image's full size. Tuned for the glass-body region only — we want to
# exclude the brass cap above, brass base below, and the wall/pumpkin behind.
# All four photos have the lamp roughly centred horizontally, slightly left of
# centre, body occupying ~y=0.30 to 0.65.
PHOTOS = [
    # Wider crops capturing the FULL body face (mosaic glass region). Body is
    # roughly square in the photos (egg ratio is mild). The crop aspect drives
    # the strip aspect on the sphere — distortion was previously caused by
    # cover-fitting a square photo into a 1:2 strip and stretching vertically.
    ("24070261-IMG_5731.jpeg", (0.27, 0.30, 0.58, 0.68)),  # face A — blue dominant
    ("92ccad55-IMG_5730.jpeg", (0.27, 0.30, 0.58, 0.68)),  # face B — red+orange
    ("cad2214b-IMG_5729.jpeg", (0.27, 0.30, 0.58, 0.68)),  # face C — orange
    ("b4589da5-IMG_5728.jpeg", (0.27, 0.30, 0.58, 0.68)),  # face D — pink+purple
]

# The lamp body covers ~46% of sphere latitude (the egg is trimmed top/bottom
# in the Blender model). So the photo should sit in the EQUATORIAL band of the
# panorama, with grout-coloured fills above/below for the polar regions that
# are anyway hidden by the brass cap and base.
GROUT_PAD = (242, 238, 228)
BODY_BAND_FRAC = (0.18, 0.82)   # body content in y ∈ [0.18·H, 0.82·H]


def crop_body(img: Image.Image, box_frac) -> Image.Image:
    iw, ih = img.size
    l, t, r, b = box_frac
    return img.crop((int(iw*l), int(ih*t), int(iw*r), int(ih*b)))


def vignette_mask(w: int, h: int, edge_blend: float = 0.18) -> Image.Image:
    """Horizontal fade on left+right edges so panorama seams blend smoothly."""
    arr = np.ones((h, w), dtype=np.float32)
    fade = int(w * edge_blend)
    if fade > 0:
        ramp = np.linspace(0, 1, fade) ** 1.5
        arr[:, :fade] *= ramp[None, :]
        arr[:, -fade:] *= ramp[None, ::-1]
    return Image.fromarray((arr * 255).astype(np.uint8))


# ============================================================
# assemble panorama
# ============================================================
panorama = Image.new("RGB", (W, H), GROUT_PAD)
body_top = int(H * BODY_BAND_FRAC[0])
body_bot = int(H * BODY_BAND_FRAC[1])
band_h = body_bot - body_top
for i, (fname, box) in enumerate(PHOTOS):
    p = UPLOADS / fname
    if not p.exists():
        print(f"  ⚠ missing {p}", file=sys.stderr)
        continue
    src = Image.open(p)
    body = crop_body(src, box)
    # ASPECT-FIT (contain) into the strip's body band — never stretch
    cw, ch = body.size
    fit_ar = STRIP_W / band_h
    src_ar = cw / ch
    if src_ar > fit_ar:
        new_w = STRIP_W
        new_h = int(round(STRIP_W / src_ar))
    else:
        new_h = band_h
        new_w = int(round(band_h * src_ar))
    body = body.resize((new_w, new_h), Image.LANCZOS)
    # centre within strip + body band
    x = i * STRIP_W + (STRIP_W - new_w) // 2
    y = body_top + (band_h - new_h) // 2
    # edge-blend mask so seams between adjacent faces hide
    mask = vignette_mask(new_w, new_h, edge_blend=0.10)
    panorama.paste(body, (x, y), mask)
    print(f"  ✓ panel {i}: {fname} fit {new_w}×{new_h} at ({x},{y})")

# Slight saturation boost so the glow-through reads as stained glass
arr = np.asarray(panorama).astype(np.float32) / 255.0
# RGB → HSV-ish saturation bump
mx = arr.max(axis=-1, keepdims=True)
mn = arr.min(axis=-1, keepdims=True)
boost = 1.15
arr = mn + (arr - mn) * boost
arr = np.clip(arr, 0, 1)
panorama = Image.fromarray((arr * 255).astype(np.uint8))

# Final small gaussian to hide tiny seam artifacts
panorama = panorama.filter(ImageFilter.GaussianBlur(0.4))

out_color = OUT / "desk_lantern_mosaic.png"
panorama.save(out_color, "PNG", optimize=True)
print(f"\nwrote {out_color} ({out_color.stat().st_size//1024} KB)")

# Roughness — bright cream grout → matte, jewel beads → glossy. Use saturation
# as the proxy (high saturation = bead, low saturation = grout).
arr = np.asarray(panorama).astype(np.float32) / 255.0
sat = 1 - arr.min(axis=-1) / (arr.max(axis=-1) + 1e-6)
# high sat → low roughness (glossy beads), low sat → high roughness (matte grout)
rough = np.clip(0.78 - sat * 0.55, 0.22, 0.82)
out_rough = OUT / "desk_lantern_mosaic_rough.png"
Image.fromarray((rough * 255).astype(np.uint8)).save(out_rough, "PNG", optimize=True)
print(f"wrote {out_rough} ({out_rough.stat().st_size//1024} KB)")
