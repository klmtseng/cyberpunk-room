// Headless unit test for the height-fog optical-depth formula.
// Run: node --experimental-strip-types src/world/height_fog.test.ts
//
// SCOPE / WHAT THIS DOES NOT PROVE.
// The GLSL in height_fog.ts and the TypeScript `opticalDepth()` exercised here
// are TWO SEPARATE IMPLEMENTATIONS of the same closed-form integral, kept in
// sync by hand. This test protects the NUMERICAL BEHAVIOUR OF THE FORMULA —
// the removable singularity at y1 == y0, monotonicity, the dist = 0 identity.
// It does NOT compile, run, or in any way validate the shader: it cannot catch
// a GLSL syntax error, a precision difference on a given GPU, a varying that
// was never assigned, or a divergence introduced by editing one copy and not
// the other. Shader correctness is only ever established by rendering in a real
// browser and reading the shaderErrors beacon.

import { opticalDepth, FOG_BASE_Y, DEFAULT_PARAMS, setHeightFogEnabled, isHeightFogInstalled, FOG_DEFINE, _STOCK_CHUNKS_FOR_TEST } from './height_fog.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}
function finite(v: number) { return Number.isFinite(v); }

const D = DEFAULT_PARAMS.density;
const K = DEFAULT_PARAMS.k;

// (a) perfectly horizontal ray — the 0/0 case — must be finite and must equal
//     the degenerate uniform-slab form exactly.
{
  const y = FOG_BASE_Y + 40;
  const dist = 120;
  const tau = opticalDepth(dist, y, y, D, K);
  const expected = D * dist * Math.exp(-K * (y - FOG_BASE_Y));
  ok(finite(tau), 'horizontal ray returns a finite tau');
  ok(Math.abs(tau - expected) < 1e-12, 'horizontal ray equals degenerate form');

  // same at the base plane and far above it
  for (const h of [0, 5, 150, 400]) {
    const yy = FOG_BASE_Y + h;
    const t = opticalDepth(dist, yy, yy, D, K);
    ok(finite(t) && t >= 0, `horizontal ray finite & non-negative at h=${h}`);
    ok(Math.abs(t - D * dist * Math.exp(-K * h)) < 1e-12, `horizontal degenerate exact at h=${h}`);
  }
}

// (b) near-degenerate: tiny height differences must not blow up, and must agree
//     with the degenerate form. 1e-7 is well inside the branch threshold;
//     1e-2 is outside it and exercises the true analytic quotient, which is
//     where a bad threshold would show up as a discontinuity.
{
  const y0 = FOG_BASE_Y + 40;
  const dist = 120;
  const degenerate = D * dist * Math.exp(-K * (y0 - FOG_BASE_Y));
  // The brief asks for "< 1e-4" at dy = 1e-7; that holds with room to spare
  // (it is exact there). For the larger dy values the meaningful bound is a
  // RELATIVE one: the degenerate form is the dh → 0 limit, so its error grows
  // linearly in dh (next Taylor term ~ k*dh/2). Since tau here is O(1), an
  // absolute 1e-4 bound would be an assertion about the size of tau rather
  // than about the approximation, and fails at dy = 1e-2 purely for that
  // reason. Relative tolerance is what actually characterises the branch.
  for (const dy of [1e-7, -1e-7, 1e-5, 1e-3]) {
    const tau = opticalDepth(dist, y0, y0 + dy, D, K);
    ok(finite(tau), `dy=${dy} produces no NaN/Inf`);
    ok(Math.abs(tau - degenerate) < 1e-4, `dy=${dy} within absolute 1e-4 of degenerate form`);
  }
  for (const dy of [1e-2, -1e-2, 0.1, -0.1]) {
    const tau = opticalDepth(dist, y0, y0 + dy, D, K);
    ok(finite(tau), `dy=${dy} produces no NaN/Inf`);
    const rel = Math.abs(tau - degenerate) / degenerate;
    ok(rel < 1e-3, `dy=${dy} within 1e-3 relative of degenerate form (got ${rel.toExponential(2)})`);
  }

  // Continuity across the branch boundary (|k*dh| == 1e-4). The two branches
  // are different expressions, so a small step is expected; it must be far
  // below anything renderable (8-bit output quantises at ~4e-3 of unity).
  const boundary = 1e-4 / K;
  const lo = opticalDepth(dist, y0, y0 + boundary * 0.999, D, K);
  const hi = opticalDepth(dist, y0, y0 + boundary * 1.001, D, K);
  const step = Math.abs(lo - hi) / degenerate;
  ok(step < 1e-4, `branch boundary step is imperceptible (relative ${step.toExponential(2)})`);
}

// (c) monotonic in y1: raising the far endpoint means more of the ray sits in
//     thinner air, so tau must strictly decrease.
{
  const y0 = FOG_BASE_Y + 10;
  const dist = 200;
  let prev = Infinity;
  let monotonic = true;
  for (let h = 0; h <= 400; h += 10) {
    const tau = opticalDepth(dist, y0, FOG_BASE_Y + h, D, K);
    if (!finite(tau)) { monotonic = false; break; }
    if (h > 0 && tau >= prev) { monotonic = false; break; }
    prev = tau;
  }
  ok(monotonic, 'tau strictly decreases as the far endpoint rises');
}

// (d) zero-length ray scatters nothing, at any height incl. the degenerate case.
{
  ok(opticalDepth(0, 0, 0, D, K) === 0, 'dist=0 gives tau=0 (degenerate branch)');
  ok(opticalDepth(0, FOG_BASE_Y, FOG_BASE_Y + 300, D, K) === 0, 'dist=0 gives tau=0 (analytic branch)');
}

// (e) sanity of the actual tuning: the loft interior must be nearly clear while
//     the street canyon must be genuinely thick. These are the numbers the art
//     direction depends on, so pin them.
{
  const eyeY = 1.7;
  // 6m across the room, horizontal
  const interior = opticalDepth(6, eyeY, eyeY, D, K);
  ok(1 - Math.exp(-interior) < 0.02, `interior 6m stays under 2% fog (got ${(1 - Math.exp(-interior)).toFixed(4)})`);

  // 250m out to the far canyon floor
  const canyon = opticalDepth(250, eyeY, FOG_BASE_Y + 5, D, K);
  ok(1 - Math.exp(-canyon) > 0.35, `250m canyon floor exceeds 35% fog (got ${(1 - Math.exp(-canyon)).toFixed(4)})`);

  // an equally distant tower TOP must be clearly less fogged than the floor
  const towerTop = opticalDepth(250, eyeY, FOG_BASE_Y + 260, D, K);
  ok(canyon > towerTop * 1.5, `canyon floor at least 1.5x the tau of a tower top (${canyon.toFixed(3)} vs ${towerTop.toFixed(3)})`);
}

// (f) Chunk restoration: after enable → disable, all four ShaderChunks must be
//     byte-for-byte identical to the stock strings captured at module load time.
//     This is the strongest guarantee that "disable = identical to pre-height-fog".
{
  // We need a THREE import to inspect ShaderChunk. Import it the same way the module does.
  const THREE = await import('three');

  // First enable height-fog (no scene — chunk write only)
  setHeightFogEnabled(true);
  ok(isHeightFogInstalled(), 'chunk test: installed === true after enable');

  // Now disable — must restore stock strings
  setHeightFogEnabled(false);
  ok(!isHeightFogInstalled(), 'chunk test: installed === false after disable');

  ok(
    THREE.ShaderChunk.fog_pars_vertex === _STOCK_CHUNKS_FOR_TEST.fog_pars_vertex,
    'chunk restore: fog_pars_vertex byte-identical to stock',
  );
  ok(
    THREE.ShaderChunk.fog_vertex === _STOCK_CHUNKS_FOR_TEST.fog_vertex,
    'chunk restore: fog_vertex byte-identical to stock',
  );
  ok(
    THREE.ShaderChunk.fog_pars_fragment === _STOCK_CHUNKS_FOR_TEST.fog_pars_fragment,
    'chunk restore: fog_pars_fragment byte-identical to stock',
  );
  ok(
    THREE.ShaderChunk.fog_fragment === _STOCK_CHUNKS_FOR_TEST.fog_fragment,
    'chunk restore: fog_fragment byte-identical to stock',
  );
}

// (g) Program-cache busting. Swapping the global fog ShaderChunks does NOT
//     change three's program cache key, so `needsUpdate` alone hands back the
//     already-compiled program and the runtime toggle is a silent no-op. This
//     was measured, not theorised: in Firefox at the window pose with rain off,
//     boot-time install moved the frame 7.65/255 MAD while the runtime toggle
//     moved it 1.98, inside the 1.2-1.9 noise floor. The fix writes a
//     parameter-derived variant tag into material.defines, which IS part of the
//     cache key (three.cjs getProgramCacheKey). These tests pin that contract.
{
  const THREE = await import('three');

  const mkScene = () => {
    const scene = new THREE.Scene();
    const fogged = new THREE.Mesh(
      new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ fog: true }));
    // The sky shell and additive holograms opt out of fog and must never be
    // touched by the override — same control used in the rendered measurements.
    const unfogged = new THREE.Mesh(
      new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ fog: false }));
    scene.add(fogged, unfogged);
    return { scene, fogged, unfogged };
  };

  const defs = (m: THREE.Mesh) =>
    ((m.material as THREE.Material).defines ?? {}) as Record<string, unknown>;

  {
    const { scene, fogged, unfogged } = mkScene();
    // `needsUpdate` is a write-only setter on Material — it bumps `version`,
    // which is what the renderer actually reads. Assert on the observable.
    const v0 = (fogged.material as THREE.Material).version;
    const u0 = (unfogged.material as THREE.Material).version;
    setHeightFogEnabled(true, scene);
    ok(typeof defs(fogged)[FOG_DEFINE] === 'string',
       'cache bust: enable writes a variant tag onto the fog material');
    ok((fogged.material as THREE.Material).version > v0,
       'cache bust: enable bumps material.version (= needsUpdate) on the fog material');
    ok((unfogged.material as THREE.Material).version === u0,
       'cache bust: fog:false material is not invalidated');
    ok(defs(unfogged)[FOG_DEFINE] === undefined,
       'cache bust: fog:false material is never given the define');

    const onTag = defs(fogged)[FOG_DEFINE];
    setHeightFogEnabled(false, scene);
    ok(defs(fogged)[FOG_DEFINE] === undefined,
       'cache bust: disable removes the define (back to the stock cache key)');

    // Bounded cache: toggling back on with the same params must reproduce the
    // same tag, so three reuses the program instead of minting a new one.
    setHeightFogEnabled(true, scene);
    ok(defs(fogged)[FOG_DEFINE] === onTag,
       'cache bust: same params → same tag, so re-enabling reuses the program');
    setHeightFogEnabled(false, scene);
  }

  {
    // Different parameters must NOT collide, otherwise a dev retune would show
    // the previous look because the cached program is still keyed the same.
    const a = mkScene();
    setHeightFogEnabled(true, a.scene);
    const tagDefault = defs(a.fogged)[FOG_DEFINE];
    setHeightFogEnabled(false, a.scene);

    const b = mkScene();
    setHeightFogEnabled(true, b.scene, { density: DEFAULT_PARAMS.density * 2 });
    const tagDenser = defs(b.fogged)[FOG_DEFINE];
    setHeightFogEnabled(false, b.scene);

    ok(tagDefault !== tagDenser,
       'cache bust: different params → different tag');
  }

  {
    // The whole point is that the toggle survives being called on a scene whose
    // materials were compiled earlier; nothing here may throw on a material
    // that has no `defines` object at all.
    const { scene, fogged } = mkScene();
    delete (fogged.material as THREE.Material).defines;
    let threw = false;
    try { setHeightFogEnabled(true, scene); } catch { threw = true; }
    ok(!threw && typeof defs(fogged)[FOG_DEFINE] === 'string',
       'cache bust: material with no defines object is handled');
    setHeightFogEnabled(false, scene);
  }
}

console.log(`height_fog: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
