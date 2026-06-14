"""Build the flip-mosaic art cache.

Three sources, all bundled to public/ so the room never depends on a live
external API at runtime:
  1. Met Open Access — keyless landscape works that mosaic-tessellate well
     (Hokusai, Hiroshige, Klimt, Van Gogh, Mucha, Monet). If the network is
     down we fall back to a procedural Klimt-gold panel so the slot is filled.
  2. Procedural cat portraits referencing the in-room 夜貓 (dark-blue body,
     green slit eyes, neon-sign aesthetic).
  3. Procedural abstracts (Mondrian / Memphis / Bauhaus / Vasarely).

Output:
    public/assets/textures/mosaic_art/<id>.png  (1792x320 each, splash aspect)
    public/assets/textures/mosaic_art/manifest.json
"""
from __future__ import annotations
import json, os, math, random, urllib.request, urllib.parse, sys
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public/assets/textures/mosaic_art"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1792, 320  # matches the 4.6m x 0.8m backsplash aspect
random.seed(20770613)

manifest: list[dict] = []


def save(id_: str, img: Image.Image, label: str, source: str):
    img = img.convert("RGB")
    p = OUT / f"{id_}.png"
    img.save(p, "PNG", optimize=True)
    manifest.append({"id": id_, "label": label, "src": f"assets/textures/mosaic_art/{id_}.png", "source": source})
    print(f"  ✓ {id_}  ({p.stat().st_size//1024} KB)  — {label}")


def fit_cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Cover-fit: scale to fill, center crop."""
    src_ar = img.width / img.height
    dst_ar = w / h
    if src_ar > dst_ar:
        nh = h
        nw = round(img.width * h / img.height)
    else:
        nw = w
        nh = round(img.height * w / img.width)
    img = img.resize((nw, nh), Image.LANCZOS)
    x0 = (nw - w) // 2
    y0 = (nh - h) // 2
    return img.crop((x0, y0, x0 + w, y0 + h))


# ============================================================
# Source 1 — Met Open Access (curated landscape-friendly searches)
# ============================================================
MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1"


def http_get_json(url: str, timeout: int = 10):
    req = urllib.request.Request(url, headers={"User-Agent": "NeonLoft/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def http_get_bytes(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "NeonLoft/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()


def met_grab(query: str, prefer_landscape: bool = True, scanned: set[int] | None = None):
    """Returns (Image, title, artist) for the first public-domain landscape match, or None."""
    try:
        url = f"{MET_BASE}/search?{urllib.parse.urlencode({'q': query, 'hasImages': 'true'})}"
        r = http_get_json(url, timeout=10)
        ids = r.get("objectIDs") or []
        # randomize within the first chunk for variety across runs (with a fixed seed)
        ids = ids[:40]
        random.Random(hash(query) & 0xffff).shuffle(ids)
        for oid in ids:
            if scanned is not None and oid in scanned:
                continue
            if scanned is not None:
                scanned.add(oid)
            try:
                obj = http_get_json(f"{MET_BASE}/objects/{oid}", timeout=10)
                if not obj.get("isPublicDomain"):
                    continue
                u = obj.get("primaryImageSmall") or obj.get("primaryImage")
                if not u:
                    continue
                img = Image.open(BytesIO(http_get_bytes(u, timeout=20)))
                if prefer_landscape and img.width < img.height * 0.9:
                    continue
                return img, obj.get("title", query), obj.get("artistDisplayName", "")
            except Exception as e:
                print(f"    skip {oid}: {e}")
                continue
    except Exception as e:
        print(f"  search '{query}' failed: {e}")
    return None


MET_QUERIES = [
    ("met-hokusai", "Hokusai"),
    ("met-hiroshige", "Hiroshige"),
    ("met-vangogh", "Vincent van Gogh"),
    ("met-monet", "Claude Monet"),
    ("met-klimt", "Gustav Klimt"),
    ("met-cezanne", "Paul Cezanne"),
]

print("Source 1 — Met Open Access (downloads on every cache rebuild)")
scanned: set[int] = set()
for id_, q in MET_QUERIES:
    print(f"  searching: {q}")
    result = met_grab(q, prefer_landscape=True, scanned=scanned)
    if result is None:
        print(f"    no result, will substitute procedural")
        continue
    img, title, artist = result
    img = fit_cover(img, W, H)
    label = f"{title or q} — {artist or 'Met'}".strip(" —")
    save(id_, img, label, "met")


# ============================================================
# Source 2 — Procedural cat portraits (夜貓 references)
# ============================================================
CAT_BODY = (35, 35, 48)       # 0x232330 from props.ts
CAT_EYE = (57, 255, 136)      # 0x39ff88 green slit


def draw_cat(d: ImageDraw.ImageDraw, cx: float, cy: float, scale: float,
             body_color, eye_color, ear_color=None):
    if ear_color is None:
        ear_color = body_color
    s = scale
    # body (oval)
    d.ellipse([cx - 95*s, cy + 30*s, cx + 95*s, cy + 120*s], fill=body_color)
    # tail curl
    for t in range(20):
        ang = -math.pi/4 + t * math.pi/30
        r = 60*s + t*1.6*s
        x = cx + 95*s + math.cos(ang) * r * 0.4
        y = cy + 80*s + math.sin(ang) * r * 0.4
        d.ellipse([x - 6*s, y - 6*s, x + 6*s, y + 6*s], fill=body_color)
    # head
    d.ellipse([cx - 60*s, cy - 50*s, cx + 60*s, cy + 50*s], fill=body_color)
    # ears
    d.polygon([(cx - 50*s, cy - 25*s), (cx - 30*s, cy - 75*s), (cx - 10*s, cy - 28*s)], fill=ear_color)
    d.polygon([(cx + 50*s, cy - 25*s), (cx + 30*s, cy - 75*s), (cx + 10*s, cy - 28*s)], fill=ear_color)
    # eye slits (horizontal lozenges)
    for ex in [-22, 22]:
        d.polygon([
            (cx + ex*s - 14*s, cy - 5*s),
            (cx + ex*s, cy - 10*s),
            (cx + ex*s + 14*s, cy - 5*s),
            (cx + ex*s, cy + 0*s),
        ], fill=eye_color)
    # nose
    d.polygon([(cx - 5*s, cy + 12*s), (cx + 5*s, cy + 12*s), (cx, cy + 18*s)], fill=eye_color)


def cat_warhol_quad():
    """4 cat panels in clashing Warhol colors."""
    img = Image.new("RGB", (W, H), (8, 6, 18))
    d = ImageDraw.Draw(img)
    palettes = [
        ((192, 60, 200), (255, 220, 80), (180, 50, 190)),  # purple+yellow
        ((40, 200, 200), (255, 90, 50), (30, 180, 180)),   # cyan+orange
        ((255, 60, 130), (40, 200, 80), (220, 50, 120)),   # pink+green
        ((255, 200, 80), (60, 80, 200), (220, 170, 60)),   # gold+blue
    ]
    panel_w = W // 4
    for i, (bg, fg, ear) in enumerate(palettes):
        x0 = i * panel_w
        d.rectangle([x0, 0, x0 + panel_w, H], fill=bg)
        draw_cat(d, x0 + panel_w/2, H/2 - 20, 1.45, fg, bg, ear_color=ear)
    save("cat-warhol", img, "夜貓 ×4 — Warhol 變奏", "procedural")


def cat_neon_silhouette():
    """One huge cat silhouette in dark blue against magenta-cyan gradient."""
    img = Image.new("RGB", (W, H), (0, 0, 0))
    for y in range(H):
        t = y / H
        rgb = (
            int(180 + (40 - 180) * t),
            int(40 + (10 - 40) * t),
            int(140 + (90 - 140) * t),
        )
        ImageDraw.Draw(img).line([(0, y), (W, y)], fill=rgb)
    # scanlines for crt vibe
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 3):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 60))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    d = ImageDraw.Draw(img)
    # huge centered cat
    draw_cat(d, W/2, H/2 + 30, 2.4, (8, 8, 24), CAT_EYE)
    # neon ring around it
    cx, cy = W/2, H/2 + 30
    for r in range(180, 200):
        d.ellipse([cx - r, cy - r*0.55, cx + r, cy + r*0.55], outline=(255, 100, 220), width=1)
    save("cat-neon", img, "夜貓 NEON — 霓虹剪影", "procedural")


def cat_pixel_8bit():
    """8-bit chunky pixel cat tiled across the wall."""
    sprite_w, sprite_h = 22, 16
    # design the cat pixel by pixel (1 char per pixel; ' ' = transparent)
    art = [
        "  ##              ##  ",
        " #..#            #..# ",
        " #...############...# ",
        "  #..................#",
        "  #.G..G......G..G..# ",
        "  #....##........... #",
        "  #..................#",
        "  #..................#",
        "  #..................#",
        "   #................# ",
        "    ################  ",
        "    #     #    #    # ",
        "    #     #    #    # ",
        "    #     #    #    # ",
        "    #######    ###### ",
        "                      ",
    ]
    palettes = [
        ("#", (38, 32, 58), "G", (57, 255, 136), "BG", (16, 12, 28)),
        ("#", (192, 60, 200), "G", (40, 200, 240), "BG", (24, 16, 36)),
        ("#", (255, 200, 80), "G", (220, 40, 80), "BG", (32, 20, 16)),
    ]
    img = Image.new("RGB", (W, H), (10, 8, 22))
    d = ImageDraw.Draw(img)
    px = 16  # pixel size
    sprite_total_w = sprite_w * px
    cols = (W + sprite_total_w - 1) // sprite_total_w + 1
    rows = (H + sprite_h * px - 1) // (sprite_h * px) + 1
    for cy in range(rows):
        for cxi in range(cols):
            pal = palettes[(cxi + cy) % len(palettes)]
            body = pal[1]; eye = pal[3]; bg = pal[5]
            ox = cxi * sprite_total_w - sprite_total_w//2
            oy = cy * sprite_h * px - sprite_h * px // 2 + (cxi % 2) * (px * 2)
            d.rectangle([ox, oy, ox + sprite_total_w, oy + sprite_h * px], fill=bg)
            for yy, row in enumerate(art):
                for xx, ch in enumerate(row):
                    if ch == "#":
                        d.rectangle([ox + xx*px, oy + yy*px, ox + (xx+1)*px, oy + (yy+1)*px], fill=body)
                    elif ch == "G":
                        d.rectangle([ox + xx*px, oy + yy*px, ox + (xx+1)*px, oy + (yy+1)*px], fill=eye)
                    elif ch == ".":
                        d.rectangle([ox + xx*px, oy + yy*px, ox + (xx+1)*px, oy + (yy+1)*px], fill=body)
    save("cat-pixel", img, "夜貓 8-bit — 像素街機", "procedural")


def cat_egyptian():
    """Sand-color repeating Egyptian-style cat silhouette frieze."""
    sand = (228, 198, 132)
    img = Image.new("RGB", (W, H), sand)
    d = ImageDraw.Draw(img)
    # papyrus stripes
    for y in range(0, H, 12):
        d.line([(0, y), (W, y)], fill=(218, 188, 122))
    # hieroglyph border top/bottom
    d.rectangle([0, 0, W, 28], fill=(170, 130, 60))
    d.rectangle([0, H-28, W, H], fill=(170, 130, 60))
    for x in range(0, W, 24):
        d.polygon([(x+6, 6), (x+18, 6), (x+12, 22)], fill=(228, 198, 132))
        d.polygon([(x+6, H-22), (x+18, H-22), (x+12, H-6)], fill=(228, 198, 132))
    # cat figures (Bastet) in profile, repeating
    profile = (40, 26, 12)
    step = 220
    for i, cx in enumerate(range(110, W, step)):
        cy = H/2 + 25
        # body
        d.rectangle([cx - 18, cy - 30, cx + 18, cy + 70], fill=profile)
        # head
        d.polygon([
            (cx - 18, cy - 30),
            (cx + 18, cy - 30),
            (cx + 22, cy - 70),
            (cx + 4, cy - 95),
            (cx - 14, cy - 80),
        ], fill=profile)
        # ears
        d.polygon([(cx + 4, cy - 95), (cx + 18, cy - 110), (cx + 14, cy - 92)], fill=profile)
        # tail curving up
        for t in range(40):
            r = t * 1.4
            x = cx - 18 + math.cos(math.pi * 1.2 + t*0.05) * r
            y = cy + 60 + math.sin(math.pi * 1.2 + t*0.05) * r
            d.ellipse([x-3, y-3, x+3, y+3], fill=profile)
        # eye (gold)
        d.ellipse([cx + 8, cy - 75, cx + 14, cy - 71], fill=(248, 200, 60))
    save("cat-egyptian", img, "夜貓 Bastet — 古埃及壁畫", "procedural")


print("\nSource 2 — Procedural cat portraits")
cat_warhol_quad()
cat_neon_silhouette()
cat_pixel_8bit()
cat_egyptian()


# ============================================================
# Source 3 — Procedural abstracts
# ============================================================
def abstract_mondrian():
    img = Image.new("RGB", (W, H), (244, 240, 232))
    d = ImageDraw.Draw(img)
    # random partition into rectangles, fill with primary colors / white
    rects = [(0, 0, W, H)]
    palette = [(228, 32, 28), (32, 60, 200), (252, 220, 40), (244, 240, 232), (244, 240, 232)]
    rng = random.Random(7)
    for _ in range(28):
        i = rng.randrange(len(rects))
        x0, y0, x1, y1 = rects.pop(i)
        if (x1 - x0) < 80 or (y1 - y0) < 60:
            rects.append((x0, y0, x1, y1))
            continue
        if (x1 - x0) > (y1 - y0):
            xm = rng.randint(x0 + 60, x1 - 60)
            rects += [(x0, y0, xm, y1), (xm, y0, x1, y1)]
        else:
            ym = rng.randint(y0 + 40, y1 - 40)
            rects += [(x0, y0, x1, ym), (x0, ym, x1, y1)]
    for x0, y0, x1, y1 in rects:
        d.rectangle([x0, y0, x1, y1], fill=rng.choice(palette))
    # bold black grid lines
    for x0, y0, x1, y1 in rects:
        d.rectangle([x0, y0, x1, y1], outline=(8, 8, 12), width=10)
    d.rectangle([0, 0, W-1, H-1], outline=(8, 8, 12), width=16)
    save("abs-mondrian", img, "Mondrian 變奏 — 原色矩形", "procedural")


def abstract_memphis():
    bg = (28, 22, 56)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    rng = random.Random(11)
    pal = [(255, 100, 180), (50, 220, 220), (255, 220, 60), (220, 40, 80), (40, 200, 120)]
    # squiggles
    for _ in range(80):
        x = rng.randint(0, W); y = rng.randint(0, H)
        col = rng.choice(pal)
        for k in range(60):
            d.ellipse([x-4, y-4, x+4, y+4], fill=col)
            x += math.cos(k*0.4) * 5
            y += math.sin(k*0.4) * 4 + (rng.random()-0.5)*3
    # confetti rectangles
    for _ in range(60):
        x = rng.randint(0, W); y = rng.randint(0, H)
        w = rng.randint(30, 90); h = rng.randint(20, 60)
        col = rng.choice(pal)
        d.rectangle([x, y, x+w, y+h], fill=col)
    # triangles
    for _ in range(40):
        x = rng.randint(0, W); y = rng.randint(0, H)
        r = rng.randint(20, 60)
        col = rng.choice(pal)
        d.polygon([(x, y - r), (x + r, y + r), (x - r, y + r)], fill=col)
    save("abs-memphis", img, "Memphis 派對 — 80s 拼貼", "procedural")


def abstract_bauhaus():
    img = Image.new("RGB", (W, H), (236, 226, 198))
    d = ImageDraw.Draw(img)
    pal = [(220, 38, 38), (32, 60, 200), (252, 200, 40), (18, 18, 18)]
    rng = random.Random(13)
    # big circles + arcs + bars
    for _ in range(14):
        cx = rng.randint(0, W); cy = rng.randint(0, H)
        r = rng.randint(40, 160)
        col = rng.choice(pal)
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col)
    for _ in range(8):
        y = rng.randint(20, H-40)
        h = rng.randint(20, 50)
        col = rng.choice(pal)
        d.rectangle([0, y, W, y+h], fill=col)
    for _ in range(6):
        x = rng.randint(0, W); y = rng.randint(0, H)
        r = rng.randint(40, 100)
        col = rng.choice(pal)
        d.polygon([(x, y-r), (x+r, y+r), (x-r, y+r)], fill=col)
    save("abs-bauhaus", img, "Bauhaus 基本形 — 紅黃藍", "procedural")


def abstract_vasarely():
    """Op-art gradient checkerboard with concentric distortion."""
    img = Image.new("RGB", (W, H), (10, 10, 20))
    d = ImageDraw.Draw(img)
    cx, cy = W/2, H/2
    cell = 28
    for r in range(-2, H//cell + 3):
        for c in range(-2, W//cell + 3):
            x = c * cell; y = r * cell
            dx = x - cx; dy = y - cy
            dist = math.sqrt(dx*dx + dy*dy)
            t = (math.sin(dist / 28) + 1) / 2
            r1 = int(40 + 200 * t); g1 = int(40 + 180 * (1-t)); b1 = int(120 + 120 * t)
            if (r + c) % 2 == 0:
                col = (r1, g1, b1)
            else:
                col = (255 - r1, 255 - g1, 255 - b1)
            # warp size by distance for Op-art zoom feel
            sz = cell - max(0, min(cell-6, dist // 60))
            d.rectangle([x, y, x + sz, y + sz], fill=col)
    save("abs-vasarely", img, "Vasarely Op-Art — 視覺漩渦", "procedural")


print("\nSource 3 — Procedural abstracts")
abstract_mondrian()
abstract_memphis()
abstract_bauhaus()
abstract_vasarely()


# ============================================================
# Manifest
# ============================================================
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
print(f"\nwrote manifest with {len(manifest)} entries → {OUT / 'manifest.json'}")
