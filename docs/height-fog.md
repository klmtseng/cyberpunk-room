# Height-attenuated volumetric fog + aerial perspective

Replaces the stock `FogExp2(0x0c1224, 0.0058)` with a fog whose density falls
off exponentially with world height, integrated analytically along the view ray.

## Why

The vista is a ~250 m deep street canyon seen from a loft ~150 m above it. With
uniform density the canyon floor and the tower tops are equally hazy, so the
city reads as one flat painted card. Real cities do the opposite: particulate
and neon light pollution pool at street level and thin out with altitude. That
vertical gradient *is* the depth cue.

## The maths

Density decays with height above a base plane:

```
density(y) = density0 · exp(-k · (y - baseY))
```

Integrating that along a ray from the eye (height `h0`) to the shaded fragment
(height `h1`), where `h = y - baseY`, over path length `dist`:

```
tau = density0 · dist · (exp(-k·h0) - exp(-k·h1)) / (k · (h1 - h0))
fogFactor = 1 - exp(-tau)
```

### The singularity (this is the part that bites)

As `h1 → h0` the quotient is `0/0`. The limit is `exp(-k·h0)`, i.e. the uniform
slab result `density0 · dist · exp(-k·h0)`. **A perfectly horizontal view ray
hits this exactly**, and looking straight out of a window is about as horizontal
as it gets. Unhandled it yields NaN, and `mix(color, fogColor, NaN)` renders as
a fully black or fully white frame depending on the driver.

Both the GLSL and the TypeScript oracle branch to the degenerate form when
`|k·dh| < 1e-4`. The truncation error of that branch is the next Taylor term,
`~k·dh/2`, which at the branch boundary is ~5e-5 relative — far below 8-bit
quantisation (~4e-3 of unity).

## Chosen parameters

| Parameter | Value | Reasoning |
|---|---|---|
| `FOG_BASE_Y` | `-150` | Street level; must track `GROUND_Y` in `world/city.ts`. Anchoring at `y=0` would put the loft at the bottom of the smog column and grey out the whole interior. |
| `density` | `0.021` | Extinction *at street level only*. Much higher than the old `0.0058` because that constant applied everywhere, whereas this one decays away with altitude. |
| `k` | `0.016` | e-folding height ≈ 62 m. The canyon bottom sits deep in the dense layer; the loft at +152 m is at `exp(-2.43)` ≈ 8.8 % of base density, so the interior stays essentially clear. |
| `NEAR_HAZE` | `0x0c1224` | Deliberately the **old fog colour** — the cool near-black blue the room was already art-directed against, so interior surfaces do not shift. |
| `FAR_GLOW` | `0x6a4a72` | Desaturated purple-grey: the city's magenta `0xff2bdb` and cyan `0x5af2ff` mixed and knocked well down in saturation. Using raw magenta turns the skyline into cotton candy. |
| `glowStart` / `glowEnd` | `0.12` / `0.55` | The city glow only appears once the ray is already meaningfully fogged, i.e. past the room. Anything nearer sees pure `NEAR_HAZE`. **This split is the single thing keeping the interior untinted.** Was `0.42`/`0.95`; see "The dead-glow bug" below. |
| `glowCeiling` / `glowFloor` | `190` / `0.22` | Looking upward there is no lit street below the sightline, so inscatter fades toward a 22 % floor with the ray's mid-height. |

## Implementation notes

Implemented as a **global override of three's four fog `ShaderChunk`s**
(`fog_pars_vertex`, `fog_vertex`, `fog_pars_fragment`, `fog_fragment`) rather
than per-material `onBeforeCompile`. Every `fog: true` material picks it up
automatically; the additive holograms and sky shell (`fog: false`) are untouched.

Two details that are easy to get wrong:

- **World position is recomputed, not borrowed.** three's `worldPosition` is
  only declared under specific defines (envmap / shadowmap / transmission /
  spot lights), so it cannot be assumed to exist. We rebuild it from
  `transformed` — *including the batching and instancing matrices*, mirroring
  three's own `worldpos_vertex`. The city's towers, signs, cars and pedestrians
  are all `InstancedMesh`; omitting `instanceMatrix` collapses every instance
  onto its prototype position near the origin and fogs the entire skyline at
  street density.
- **Tuning constants are baked into the GLSL as `const`, not uniforms.** three's
  `refreshFogUniforms` only feeds `fogColor` / `fogDensity` / `fogNear` /
  `fogFar`; there is no global feeding path for custom fog uniforms.
  `configureHeightFog(params, scene)` rewrites the chunk strings and flags every
  fog material `needsUpdate` for live retuning from the dev console.

The `FogExp2` object stays on the scene because three keys `USE_FOG` and the
`FOG_EXP2` define off its presence.

## The dead-glow bug (found after the first landing, fixed in the follow-up)

The first version shipped `glowStart 0.42` / `glowEnd 0.95`, and with those
values **the aerial-perspective half of this effect never ran at all**. It was
doing pure extinction toward a near-black haze — i.e. it just made the city
dimmer, which is the opposite of a depth cue.

Worked through for the mid-distance towers that dominate the window (~250 m out,
tower face around `y = -50`):

```
fogFactor  = 0.514
smoothstep(0.42, 0.95, 0.514)      = 0.035
altitude term (midH 126 m)          × 0.265 → mix(0.22,1,·) = 0.428
glowMix                             = 0.035 × 0.428 = 0.015
```

Two things stack against it. The `smoothstep` window starts above the fog factor
the scene actually reaches, and the altitude term costs another 2.4× because the
camera sits 152 m above the fog base, so *every* ray's mid-height is high. At
`0.12` / `0.55` the same towers land at `glowMix ≈ 0.42`.

Interior safety is unaffected and is **structural, not tuned**: a 4 m interior
wall has `fogFactor = 0.007`, below `glowStart` under either setting, so its
`glowMix` is exactly `0.000` either way.

### How it was missed the first time

The "window" camera pose used for the original acceptance shots,
`(0, 1.7, 2.6)` yaw π, does not actually see the city — at that distance from
the glass the frame is dominated by the interior wall and its neon sign. Every
"windowA" number in the first round was measured on a wall. The correct pose is
**`(0, 1.7, 6.0)` yaw π**, right at the glass (the window wall is `D/2 = 7`,
see `world/room.ts:62`).

Lesson worth keeping: a per-pixel diff that is "small but the right sign" is not
evidence the feature works. Ablating hard — a 10× density probe — was what
separated "plumbing is broken" from "tuning is too timid" here, and it showed
the plumbing was fine.

## Measurements

All captures: Firefox 153, Intel HD Graphics, `low` preset, 標準 lighting mood,
same session, same camera poses, only the fog implementation differing.

### Window pose `(0, 1.7, 6.0)` yaw π — the city view

Frame split into 6 horizontal bands, top (sky) to bottom (street floor). `m` is
band mean 0-255, `R−B` is the purple-vs-blue lean.

| | band 0 (sky) | band 3 | band 4 | band 5 (street) |
|---|---|---|---|---|
| fog off | 84.8 / −5.4 | 45.1 / −23.0 | 42.8 / −20.0 | 47.3 / −16.0 |
| `glowStart 0.42` (dead glow) | 83.7 / −5.5 | 41.7 / −28.0 | 39.8 / −23.2 | **43.6 / −17.3** |
| `glowStart 0.12` (shipped) | 84.0 / −5.7 | 46.0 / −27.1 | 45.5 / −21.9 | **54.0 / −14.9** |

Three things to read off it:

- **Band 0 is unchanged across all three** (84.8 / 83.7 / 84.0). The sky shell is
  `fog: false`, so this is the control: it confirms the override is not leaking
  into materials it should not touch.
- **The old setting moved the street the wrong way** — darker and bluer
  (47.3 → 43.6, R−B −16.0 → −17.3). That is the pure-extinction failure mode.
- **The shipped setting lifts the street and warms it** (47.3 → 54.0, R−B
  −16.0 → −14.9) while leaving the sky alone. Monotone with height, which is
  the whole point.

Per-pixel diff at this pose is **not** a usable statistic: the animation noise
floor here is 3.7-4.1 / 255 (rain, cycling signs), measured from three
consecutive captures with no code change. The band statistics above are stable
across those same three captures and are what the claims rest on.

Image: `height-fog-city.jpg` — off / dead-glow / shipped, top to bottom.

### Interior pose `(0.6, 1.7, 5.4)` yaw 0.35 — the tint budget

| vs fog off | mean abs diff | R−B shift (mean) | R−B shift (p99) |
|---|---|---|---|
| `glowStart 0.42` | 2.524 | +0.811 | +10.00 |
| `glowStart 0.12` (shipped) | **1.749** | **+0.590** | **+5.00** |

Budget is 12 / 255. The shipped setting is not only inside it, it disturbs the
interior *less* than the version it replaces, and its 1.749 sits below the
interior animation noise floor of 2.090 — the near field is effectively
untouched, which is exactly the requirement.

### Older measurements (superseded)

**Gates**

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run build` | exit 0 |
| `height_fog.test.ts` | 33 passed, 0 failed, exit 0 |
| Firefox beacon | `shaderErrors: 0`, `contextLost: false`, fps 10.4 |

**Frame differences (mean abs diff, 0-255)**

> ⚠️ The `windowA` row below was measured at pose `(0, 1.7, 2.6)`, which shows an
> interior wall and no city — see "How it was missed the first time". It is kept
> only so the record shows what was actually claimed. Do not cite it.

| Pair | Value |
|---|---|
| `windowA` off vs on *(wrong pose)* | **5.209** |
| `interiorB` off vs on | **2.524** |
| *animation noise floor* (two OFF shots, same pose) | *2.090* |

The interiorB figure is **below the 3/255 bar the task set**, and that is a
property of the pose, not a failure of the change. Broken down by horizontal
band, interiorB shows a clean monotonic depth gradient:

| Band (top → bottom) | mean abs diff |
|---|---|
| 0 (far wall / window / city beyond) | 5.805 |
| 1 | 2.088 |
| 2 | 1.297 |
| 3 (near floor & furniture) | 0.918 |

Interior pose B is a 4-10 m room. Analytically the fog factor over that range
changes by only 0.007-0.015 — under one 8-bit level on a typical surface, i.e.
below quantisation. The whole-frame mean is dragged to 2.524 by near geometry
that is *designed* not to change. A uniform 3/255 threshold applied to pose B is
in direct tension with acceptance criterion 6, which requires the near field to
stay put; both cannot be satisfied at the same pose. The window pose, where
there is actual depth to fog, clears the bar at 5.209 with 29.6 % of pixels
moving more than 3 levels.

**Near-field colour (interiorB, bottom quarter) — AC6**

| | R | G | B | (R−B) |
|---|---|---|---|---|
| off | 7.625 | 7.327 | 17.836 | −10.210 |
| on | 7.792 | 7.338 | 17.777 | −9.985 |

Hue shift **0.226 / 255** against a 12 / 255 budget. The `NEAR_HAZE` /
`FAR_GLOW` split is doing its job: no city magenta reaches the furniture.

## Where this most likely breaks

1. **`FOG_BASE_Y` silently desynchronising from `GROUND_Y`.** They are two
   constants in two files with no compile-time link. If the city is ever moved
   vertically, the fog layer stays behind and the canyon either clears
   completely or drowns. This is the most probable future regression.
2. **A new `InstancedMesh` path three adds (or `BatchedMesh` adoption).** The
   world-position reconstruction mirrors `worldpos_vertex` as of three 0.170;
   if upstream changes that transform chain, instanced geometry fogs at the
   wrong position. Symptom: distant towers uniformly over-fogged.
3. **Custom `ShaderMaterial`s that declare `USE_FOG` but never `#include
   <fog_vertex>`**, or that lack `transformed` / `instanceMatrix` in scope at
   the include point. That is a compile error, so it fails loudly — watch the
   beacon after adding any hand-written material with `fog: true`.
4. **Anything that renders with a camera far from the loft.** `glowCeiling` and
   the `glowStart` split are tuned for an observer ~150 m above the base plane.
   A flythrough down to street level would sit inside the dense layer, where
   `fogFactor` saturates and the near field *would* take the `FAR_GLOW` tint —
   exactly what AC6 forbids for the loft. The current camera is bounded to the
   room, so this is latent rather than active.
5. **Precision on mobile GPUs.** `exp(-k·h)` with `h` up to ~400 and the ratio
   of two nearby exponentials is evaluated at whatever precision the fragment
   stage defaults to. It is well-conditioned at `mediump` for these ranges, but
   an unusually large scene would need a `highp` qualifier.

## Files

- `src/world/height_fog.ts` — chunk override, `configureHeightFog()`, TS oracle
- `src/world/height_fog.test.ts` — headless numerical tests for the formula
- `src/engine/renderer.ts` — installs the override at scene construction

Note the oracle and the GLSL are **two hand-synced implementations of one
formula**. The test protects the formula's numerical behaviour; it cannot catch
a GLSL syntax error or a divergence introduced by editing one copy only. Shader
correctness is established solely by rendering in Firefox and reading the
beacon.
