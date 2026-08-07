# Tonemapping: ACES Filmic → AgX

Change: `src/engine/renderer.ts`, `ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })`
→ `ToneMappingMode.AGX`. One enum value; `postprocessing` 6.39.1 already ships AgX
(`ToneMappingMode.AGX = 7`), so nothing was added to the bundle and the pass count is unchanged.

Note that this project sets `renderer.toneMapping = THREE.NoToneMapping` and does all
tonemapping in the post chain, so `THREE.AgXToneMapping` is not the knob here.

## How the comparison was made

Single Firefox session on the dev server, `low` preset, Intel HD 4000. Same two camera
poses, same three light moods, captured through the dev remote-shutter channel
(`/tmp/neon-shot-request`) before and after the one-line change — no other edit in between,
no server restart, no browser restart.

- Pose A `(0, 1.7, 2.6)` yaw π — window + city (highlight test)
- Pose B `(0.6, 1.7, 5.4)` yaw 0.35 — interior loft (shadow test)
- Moods 標準 / 影院 / 派對

12 captures total, 6 pairs. All 6 pairs verified to actually differ before any claim was
made (mean abs diff 9.0–16.4 / 255, max 104–233).

## What changed, measured

| pair | near-black %<br>(max ch < 0.02) | stddev of darkest 40% | highlight sat<br>(top 2% luma) |
|---|---|---|---|
| 標準 A | 6.0 → **1.8** | 6.02 → **10.25** | 0.260 → 0.221 |
| 標準 B | 15.0 → **0.0** | 1.17 → **3.69** | 0.541 → 0.376 |
| 影院 A | 6.2 → **2.6** | 5.17 → **8.85** | 0.311 → 0.257 |
| 影院 B | 3.3 → **0.0** | 3.48 → **4.10** | 0.569 → 0.394 |
| 派對 A | 7.3 → **2.5** | 5.79 → **9.39** | 0.278 → 0.240 |
| 派對 B | 14.0 → **0.0** | 1.46 → **3.36** | 0.548 → 0.375 |

Hue drift between the two tonemappers, measured on bright still-coloured pixels
(top 2% luminance, chroma > 0.05 in both): median **0.9°–2.1°**, p90 2.4°–11.9°.

## Reading of the numbers

**The win is the low end, and only the low end.** In the interior pose ACES leaves 14–15% of
the frame at effectively pure black — the loft structure, wardrobe, sofa and stair geometry
are simply not there. AgX's longer toe takes that to 0.0% and roughly triples the stddev of
the dark region, which is what "you can see your stuff" means numerically.

**The commonly-cited AgX advantage did not appear.** AgX is usually sold on "no hue skew in
saturated highlights, unlike ACES". Measured hue drift here is 1–2° median — i.e. neither
tonemapper is skewing hue in this scene, because this scene never pushes highlights hard
enough to reach the region where ACES misbehaves. Do not repeat that claim for this project.

**AgX desaturates highlights more, not less** (0.541 → 0.376 on the interior pose). If the
neon reads too milky after this change, that is the cause, and the fix is upstream exposure
or emissive intensity, not a different tonemapper.

## Images

Top half of each = ACES (before), bottom half = AgX (after).

- `tonemap-agx-standard-A.jpg` — 標準, window/city
- `tonemap-agx-standard-B.jpg` — 標準, interior (the clearest case)
- `tonemap-agx-cinema-B.jpg` — 影院, interior
- `tonemap-agx-party-A.jpg` — 派對, window/city

派對 mode runs a slow hue sweep on the accent fixtures, so its pair is not frame-exact;
its numbers are directionally consistent with the other two moods and are not relied on alone.

## Reverting

One line, `ToneMappingMode.AGX` → `ToneMappingMode.ACES_FILMIC`. No other code depends on it.
