"""Procedural Turkish mosaic stained-glass texture for the bar lantern.

Renders a 2048x1024 equirectangular PNG modeled after IMG_5714/IMG_5715:
warm-white grout + irregular chips with rosette star clusters in red, orange,
amber and the rare turquoise accent. Same texture drives both base colour
(when lantern is off) and emissive (when on); the lit look comes from
brightness shift + an inner point light, exactly like real stained glass.

Output:
    public/assets/textures/lantern_mosaic.png  (sRGB color)
    public/assets/textures/lantern_mosaic_rough.png (roughness, optional)
"""
from __future__ import annotations
import math, random, os, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

W, H = 2048, 1024
HERE = Path(__file__).resolve().parent
OUT_COLOR = HERE.parent.parent / "public/assets/textures/lantern_mosaic.png"
OUT_ROUGH = HERE.parent.parent / "public/assets/textures/lantern_mosaic_rough.png"

GROUT = (236, 226, 198)   # warm cream, real lantern shows yellowish grout
WHITE = (248, 240, 222)
RED   = (210, 38, 38)
ORANGE= (236, 102, 30)
AMBER = (244, 174, 52)
DEEP  = (158, 28, 32)
TURQ  = (52, 168, 192)    # rare accent
CHIP_WHITES = [(248, 240, 222), (244, 232, 208), (252, 246, 232), (238, 222, 196)]

random.seed(20770613)

img = Image.new("RGB", (W, H), GROUT)
draw = ImageDraw.Draw(img, "RGBA")


def jitter_quad(cx, cy, w, h, j=0.18):
    """Slightly irregular quadrilateral around (cx,cy) — that mosaic chip look."""
    hx, hy = w/2, h/2
    pts = [
        (cx - hx + random.uniform(-j*w, j*w), cy - hy + random.uniform(-j*h, j*h)),
        (cx + hx + random.uniform(-j*w, j*w), cy - hy + random.uniform(-j*h, j*h)),
        (cx + hx + random.uniform(-j*w, j*w), cy + hy + random.uniform(-j*h, j*h)),
        (cx - hx + random.uniform(-j*w, j*w), cy + hy + random.uniform(-j*h, j*h)),
    ]
    return pts


def chip(cx, cy, w, h, color, j=0.18):
    draw.polygon(jitter_quad(cx, cy, w, h, j), fill=color)


def diamond(cx, cy, r, color, rot=0.0):
    # 4-point diamond
    pts = []
    for i in range(4):
        a = rot + i * math.pi/2
        pts.append((cx + math.cos(a)*r, cy + math.sin(a)*r))
    draw.polygon(pts, fill=color)


def eight_star(cx, cy, r_outer, r_inner, color):
    pts = []
    for i in range(16):
        a = -math.pi/2 + i * math.pi/8
        r = r_outer if i % 2 == 0 else r_inner
        pts.append((cx + math.cos(a)*r, cy + math.sin(a)*r))
    draw.polygon(pts, fill=color)


def small_chips_band(y0, y1, density=0.85):
    """Fill a band with white-ish irregular chips so the grout feels grouted."""
    cell = 18
    for y in range(y0, y1, cell):
        for x in range(0, W, cell):
            if random.random() > density:
                continue
            cx = x + cell/2 + random.uniform(-3, 3)
            cy = y + cell/2 + random.uniform(-3, 3)
            w = cell - random.uniform(3, 6)
            h = cell - random.uniform(3, 6)
            base = random.choice(CHIP_WHITES)
            chip(cx, cy, w, h, base, j=0.22)


def rosette(cx, cy, R):
    """One Turkish mosaic rosette: petal ring around an 8-point star."""
    # outer ring of red triangle petals
    n = 8
    for i in range(n):
        a = i * 2*math.pi/n
        px = cx + math.cos(a) * R * 0.86
        py = cy + math.sin(a) * R * 0.86
        # red elongated diamond pointing outward
        ux, uy = math.cos(a), math.sin(a)
        vx, vy = -uy, ux
        long_, wide = R*0.36, R*0.18
        pts = [
            (cx + ux*R, cy + uy*R),                  # outer tip
            (px + vx*wide, py + vy*wide),
            (cx + ux*R*0.55, cy + uy*R*0.55),        # inner tip
            (px - vx*wide, py - vy*wide),
        ]
        col = RED if i % 2 == 0 else DEEP
        draw.polygon(pts, fill=col)

    # middle band of orange chips
    n2 = 12
    for i in range(n2):
        a = i * 2*math.pi/n2 + math.pi/n2
        r = R * 0.5
        x = cx + math.cos(a) * r
        y = cy + math.sin(a) * r
        chip(x, y, R*0.16, R*0.16, ORANGE, j=0.3)

    # amber 8-point star core
    eight_star(cx, cy, R*0.36, R*0.16, AMBER)
    # red dot in middle
    draw.ellipse(
        (cx - R*0.08, cy - R*0.08, cx + R*0.08, cy + R*0.08), fill=RED)

    # diamond accents in 4 cardinal directions outside the petal ring
    for i in range(4):
        a = i * math.pi/2 + math.pi/4
        x = cx + math.cos(a) * R * 1.12
        y = cy + math.sin(a) * R * 1.12
        diamond(x, y, R*0.13, ORANGE, rot=a)


# ---- assemble ----
# baseline white-chip background
small_chips_band(0, H, density=0.92)

# rosette grid — wraps horizontally so the equirect texture seams hide
COLS = 6   # 6 rosettes around the equator
ROWS = 2   # two latitudinal bands
R = 90
for r in range(ROWS):
    cy = int(H * (0.28 + 0.42 * r))
    for c in range(COLS):
        # alternate rows offset half-cell so the pattern interlocks
        offset = (W/COLS)/2 if r % 2 else 0
        cx = int(c * W/COLS + offset + W/COLS/2)
        rosette(cx, cy, R)
        # wrap copy at horizontal edges so the seam blends
        if cx < R*2:
            rosette(cx + W, cy, R)
        elif cx > W - R*2:
            rosette(cx - W, cy, R)

# horizontal bands at top and bottom — narrow accent strips, common on Turkish lamps
def accent_band(y_center, height, color, dash=14):
    for x in range(0, W, dash):
        chip(x + dash/2, y_center, dash*0.78, height, color, j=0.15)

accent_band(int(H*0.08), 18, ORANGE)
accent_band(int(H*0.92), 18, ORANGE)
accent_band(int(H*0.13), 12, RED)
accent_band(int(H*0.87), 12, RED)

# rare turquoise accents — about 1 per 80 chips, gives the magic-lantern variety
for _ in range(50):
    x = random.randint(0, W)
    y = random.randint(0, H)
    chip(x, y, 14, 14, TURQ, j=0.25)

# soft grout lines: faint shadow between chips for relief
shadow = img.filter(ImageFilter.GaussianBlur(0.8))
img = Image.blend(img, shadow, 0.18)

img.save(OUT_COLOR, "PNG", optimize=True)
print(f"wrote {OUT_COLOR} ({OUT_COLOR.stat().st_size//1024} KB)")

# roughness: chips are ~0.25 glossy, grout ~0.7 matte. Derive from luminance.
import numpy as np
arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
# grout is bright cream, chips are saturated darker — invert + boost contrast
rough = 0.35 + (1.0 - arr) * 0.5
rough = (np.clip(rough, 0.2, 0.85) * 255).astype(np.uint8)
Image.fromarray(rough).save(OUT_ROUGH, "PNG", optimize=True)
print(f"wrote {OUT_ROUGH} ({OUT_ROUGH.stat().st_size//1024} KB)")
