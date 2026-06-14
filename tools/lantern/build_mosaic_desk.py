"""Mosaic texture for the desk-lantern (the second, more detailed Turkish lamp).

Reference: IMG_5728-31. Pattern characteristics:
  - WHITE-dominated grout + mostly clear/white chip background
  - Centre: large mauve/pink 8-point star with dark-violet inner diamonds
  - 4-5 smaller stars around the centre (same star pattern, scaled down)
  - Dense ROUND-BEAD clusters filling between stars — alternating red, orange,
    cobalt, fuchsia by horizontal swath (each lamp face has different beads;
    we mix all four families across the equirect texture for variety)
  - Top + bottom narrow trim band: silver mirror chips
Outputs:
    public/assets/textures/desk_lantern_mosaic.png
    public/assets/textures/desk_lantern_mosaic_rough.png
"""
from __future__ import annotations
import math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
OUT_COLOR = HERE.parent.parent / "public/assets/textures/desk_lantern_mosaic.png"
OUT_ROUGH = HERE.parent.parent / "public/assets/textures/desk_lantern_mosaic_rough.png"

W, H = 2048, 1024
WHITE = (250, 248, 242)
GROUT = (240, 236, 226)
MIRROR = (218, 222, 230)
MAUVE = (200, 170, 198)
DARK_VIOLET = (90, 50, 90)
PURPLE_DARK = (74, 36, 76)
RED = (210, 38, 38)
DEEP_RED = (148, 26, 30)
ORANGE = (228, 92, 38)
COBALT = (44, 96, 200)
FUCHSIA = (218, 60, 140)
AMBER = (244, 174, 52)

random.seed(20770614)

img = Image.new("RGB", (W, H), GROUT)
draw = ImageDraw.Draw(img, "RGBA")


def jitter_quad(cx, cy, w, h, j=0.18):
    hx, hy = w/2, h/2
    return [
        (cx - hx + random.uniform(-j*w, j*w), cy - hy + random.uniform(-j*h, j*h)),
        (cx + hx + random.uniform(-j*w, j*w), cy - hy + random.uniform(-j*h, j*h)),
        (cx + hx + random.uniform(-j*w, j*w), cy + hy + random.uniform(-j*h, j*h)),
        (cx - hx + random.uniform(-j*w, j*w), cy + hy + random.uniform(-j*h, j*h)),
    ]


def chip(cx, cy, w, h, color, j=0.18):
    draw.polygon(jitter_quad(cx, cy, w, h, j), fill=color)


def diamond(cx, cy, r, color, rot=0.0, aspect=1.0):
    pts = []
    for i in range(4):
        a = rot + i * math.pi/2
        rx = r if i % 2 == 0 else r * aspect
        pts.append((cx + math.cos(a)*rx, cy + math.sin(a)*rx))
    draw.polygon(pts, fill=color)


def eight_star(cx, cy, R_outer, R_inner, color, fine=False):
    """A pointed 8-spike star. The lamp's center motif."""
    pts = []
    n = 16
    for i in range(n):
        a = -math.pi/2 + i * math.tau/n
        r = R_outer if i % 2 == 0 else R_inner
        pts.append((cx + math.cos(a)*r, cy + math.sin(a)*r))
    draw.polygon(pts, fill=color)


def six_star_kite(cx, cy, R, palette):
    """Centre rose: 6 elongated kite/diamond petals + a small central core.

    The reference lamps look more like 6-fold (sometimes 8) starfish made of
    elongated lozenges that meet at a point in the middle, with dark-violet
    inner pieces and lighter mauve outer pieces.
    """
    mauve, dark, core = palette
    petals = 8
    for i in range(petals):
        a = i * math.tau / petals - math.pi/2
        # outer point
        ox = cx + math.cos(a) * R
        oy = cy + math.sin(a) * R
        # two side wings
        a_l = a + math.pi/petals
        a_r = a - math.pi/petals
        lx = cx + math.cos(a_l) * R * 0.42
        ly = cy + math.sin(a_l) * R * 0.42
        rx = cx + math.cos(a_r) * R * 0.42
        ry = cy + math.sin(a_r) * R * 0.42
        # split each petal into outer mauve + inner dark
        draw.polygon([(cx, cy), (lx, ly), (ox, oy), (rx, ry)], fill=mauve)
        # dark inner triangle (the violet wedge along the spine)
        mx = cx + math.cos(a) * R * 0.55
        my = cy + math.sin(a) * R * 0.55
        draw.polygon([
            (cx + math.cos(a_l) * R * 0.18, cy + math.sin(a_l) * R * 0.18),
            (mx, my),
            (cx + math.cos(a_r) * R * 0.18, cy + math.sin(a_r) * R * 0.18),
        ], fill=dark)
    # white center hexagon
    cpts = []
    for i in range(8):
        a = i * math.tau / 8 - math.pi/8
        cpts.append((cx + math.cos(a) * R * 0.16, cy + math.sin(a) * R * 0.16))
    draw.polygon(cpts, fill=core)


def bead_cluster(cx, cy, rx, ry, palette, density=0.85, bead_r=6):
    """Round-bead fill of an ellipse area.

    palette is a tuple of (color_a, color_b) — beads alternate between the two
    so the dense field has variety (like the real lamp's clusters).
    """
    color_a, color_b = palette
    n_x = int(rx * 2 / (bead_r * 2 + 1)) + 1
    n_y = int(ry * 2 / (bead_r * 2 + 1)) + 1
    for j in range(-n_y, n_y + 1):
        for i in range(-n_x, n_x + 1):
            jit = (random.random() - 0.5) * 2
            x = cx + i * (bead_r * 2 + 1) + jit
            y = cy + j * (bead_r * 2 + 1) + jit + (i % 2) * (bead_r)
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0:
                continue
            if random.random() > density:
                continue
            r = bead_r + random.uniform(-1, 1)
            color = color_a if random.random() > 0.35 else color_b
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
            inner = tuple(min(255, c + 60) for c in color[:3])
            draw.ellipse([x - r*0.45, y - r*0.45, x + r*0.45, y + r*0.45], fill=inner)


# ============================================================
# 1. baseline white chip background
# ============================================================
cell = 20
for y in range(0, H, cell):
    for x in range(0, W, cell):
        if random.random() > 0.92:
            continue
        cx_ = x + cell/2 + random.uniform(-3, 3)
        cy_ = y + cell/2 + random.uniform(-3, 3)
        w = cell - random.uniform(3, 6)
        h = cell - random.uniform(3, 6)
        base = WHITE if random.random() > 0.18 else MIRROR
        chip(cx_, cy_, w, h, base, j=0.22)

# ============================================================
# 2. central rose motifs (one per "face" of the lamp, ×6 wraps)
# ============================================================
COLS = 6
ROW_Y = H * 0.52
R = 130
for c in range(COLS):
    cx = int(W / COLS * (c + 0.5))
    cy = int(ROW_Y)
    # bead "cloud" first so star sits on top
    bead_color_options = [
        ((COBALT, FUCHSIA), 8),
        ((RED, DEEP_RED), 8),
        ((ORANGE, AMBER), 8),
        ((FUCHSIA, RED), 8),
        ((COBALT, MIRROR), 8),
        ((ORANGE, DEEP_RED), 8),
    ]
    bead_pal, br = bead_color_options[c % len(bead_color_options)]
    bead_cluster(cx - R * 1.05, cy, R * 0.7, R * 0.55, bead_pal, density=0.92, bead_r=br)
    bead_cluster(cx + R * 1.05, cy, R * 0.7, R * 0.55, bead_pal, density=0.92, bead_r=br)
    # 4 small satellite stars (top-left, top-right, bottom-left, bottom-right)
    for dx, dy in [(-0.65, -0.55), (0.65, -0.55), (-0.65, 0.55), (0.65, 0.55)]:
        sx = cx + R * dx
        sy = cy + R * dy
        six_star_kite(sx, sy, R * 0.32, (MAUVE, DARK_VIOLET, WHITE))
    # central big rose
    six_star_kite(cx, cy, R * 0.85, (MAUVE, PURPLE_DARK, WHITE))
    # wrap copies at horizontal edges
    if cx < R * 2:
        six_star_kite(cx + W, cy, R * 0.85, (MAUVE, PURPLE_DARK, WHITE))
    elif cx > W - R * 2:
        six_star_kite(cx - W, cy, R * 0.85, (MAUVE, PURPLE_DARK, WHITE))

# ============================================================
# 3. trim bands at top/bottom of the body — mirror chips
# ============================================================
def trim_band(y_center, height, color, dash=18):
    for x in range(0, W, dash):
        chip(x + dash/2, y_center, dash * 0.82, height, color, j=0.12)

trim_band(int(H * 0.08), 16, MIRROR)
trim_band(int(H * 0.92), 16, MIRROR)
trim_band(int(H * 0.14), 10, ORANGE)
trim_band(int(H * 0.86), 10, COBALT)

# ============================================================
# 4. soft grout shadow (gives the chips a sunken-into-grout look)
# ============================================================
shadow = img.filter(ImageFilter.GaussianBlur(0.8))
img = Image.blend(img, shadow, 0.16)

img.save(OUT_COLOR, "PNG", optimize=True)
print(f"wrote {OUT_COLOR} ({OUT_COLOR.stat().st_size//1024} KB)")

# roughness: round beads = glossy (low rough), white chips = matte
import numpy as np
arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
# bright (white background) → matte 0.75; saturated darker chips → glossy 0.25
rough = 0.30 + (arr - 0.5) * 0.6   # bright-ish→rougher
rough = np.clip(rough, 0.20, 0.80) * 255
Image.fromarray(rough.astype(np.uint8)).save(OUT_ROUGH, "PNG", optimize=True)
print(f"wrote {OUT_ROUGH} ({OUT_ROUGH.stat().st_size//1024} KB)")
