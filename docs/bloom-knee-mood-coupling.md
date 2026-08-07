# Bloom knee follows the light mood

`src/main.ts` `applyMood()` → `ctx.setBloomExposure(m.amb)` → `src/engine/renderer.ts`
`setBloomExposure()` sets `bloom.luminanceMaterial.threshold = clamp(0.55 * scale, 0.08, 0.95)`.

## The defect this fixes

`BloomEffect` had a hard-coded `luminanceThreshold: 0.55` while the mood system multiplies
every fixture and the ambient term by 0.12–1.7× (`src/main.ts` `MOODS`). A fixed knee against
a moving exposure means the bloom does the wrong thing at both ends: in 影院 (ambient 0.35)
almost nothing clears 0.55, so the room goes flat and unlit; in 閱讀 (ambient 1.35) too much
clears it and the desk lamps blow out.

## Controlled A/B

Single Firefox session, dev server, `low` preset. **Mood held constant at 影院 for both
captures** — the only difference is whether `applyMood` passes `m.amb` or a hard-coded `1`
to `setBloomExposure`. Same camera pose `(0.6, 1.7, 5.4)` yaw 0.35. This matters: comparing
"標準 with coupling" against "影院 with coupling" would confound the threshold change with
the light-intensity change and prove nothing.

| | knee fixed at 0.55 | knee tracks mood → 0.19 |
|---|---|---|
| frame mean (0–255) | 14.22 | **23.34** |
| top-2% luminance mean | 161.65 | 171.60 |
| pixels above 200 | 0.09% | **0.27%** |

Mean abs diff between the two frames 10.13/255, max 171 — the pair is genuinely different,
checked before drawing any conclusion.

Image: `bloom-knee-cinema.jpg`, top = fixed knee, bottom = mood-tracked knee. The bottom
frame has neon spill reaching the ceiling and the mezzanine underside; the top frame does not.

## Caveat on the mapping

`m.amb` is used as a stand-in for scene exposure. It is not a measured exposure — it is the
mood's ambient multiplier, which correlates with overall brightness but is not the same
thing (fixture multipliers `m.fix` move independently, e.g. 影院 dims the ceiling to 0.12
while pushing accent fixtures to 1.3). A real fix would read back average scene luminance.
This is deliberately the cheap version: zero extra passes, zero readback stalls on an iGPU.
If a future mood ever sets a low `amb` with bright fixtures, the knee will be too low for it.

## Verifying the setter is not a no-op

`bloom.luminanceMaterial.threshold` is a setter that writes `uniforms.threshold.value`,
confirmed by running the library directly rather than reading its source:

```
threshold getter before: 0.55
threshold getter after : 0.19
uniform value          : 0.19
```
