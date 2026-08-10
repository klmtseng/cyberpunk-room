/**
 * probe.mjs — standing diagnostic for the wall-placement gate.
 *
 * Lists every mesh whose world AABB intersects a wall slab, with penetration
 * depth past the inner face, the penetrated fraction of the mesh's own span,
 * geometry type, world size/centre and visibility.
 *
 * This is NOT the gate — it never exits non-zero and asserts nothing. It is the
 * tool you run when the gate reports something and you need to understand the
 * geometry behind it, e.g.:
 *
 *   node --experimental-strip-types --loader ./tools/gate/ts-loader.mjs \
 *        --import ./tools/gate/headless-globals.mjs ./tools/gate/probe.mjs
 *
 * Kept in version control deliberately: its output is the evidence base for why
 * check_wall_clip.mjs uses a baseline instead of a depth or fraction threshold.
 * Buried props penetrate 0.075–0.219 while legal architecture reaches 0.725, and
 * the fraction ranges overlap too — run this to re-derive that if the scene
 * changes enough to make a simple threshold viable again.
 */
import * as THREE from 'three';
import { buildRoom }  from '../../src/world/room.ts';
import { buildProps } from '../../src/world/props.ts';
import { WALL_SLABS } from '../../src/dev/placement_audit.ts';

const scene = new THREE.Scene();
const fakeCtx = {
  renderer: {
    capabilities: { isWebGL2: true, maxTextureSize: 4096, getMaxAnisotropy: () => 16 },
    getPixelRatio: () => 1, setPixelRatio: () => {}, setSize: () => {},
    setAnimationLoop: () => {},
    shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
    outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1, compile: () => {}, extensions: { get: () => null },
    info: { render: { triangles: 0 } },
  },
  scene, camera: new THREE.PerspectiveCamera(75, 16/9, 0.1, 100),
  composer: null, clock: new THREE.Clock(),
  settings: { preset: 'high', pixelRatio: 1, enableShadows: false, enableBloom: false,
    enableSSAO: false, enableHeightFog: false, ssaoRadius: 0, ssaoIntensity: 0,
    bloomStrength: 0, bloomRadius: 0, bloomThreshold: 0 },
  applyQuality: () => {}, setBloomExposure: () => {}, setHeightFog: () => {},
  setTonemap: () => {},
};

const room = buildRoom(fakeCtx);
const props = buildProps(fakeCtx);

// Inner faces: left x=-5.875, right x=+5.875, back z=-6.875, front z=+6.875
const FACES = [
  { name: 'left',  axis: 'x', inner: -5.875, sign: -1 },
  { name: 'right', axis: 'x', inner:  5.875, sign:  1 },
  { name: 'back',  axis: 'z', inner: -6.875, sign: -1 },
  { name: 'front', axis: 'z', inner:  6.875, sign:  1 },
];

const rows = [];
for (const r of [room.group, props.group]) r.traverse((o) => {
  const m = o;
  if (!m.isMesh) return;
  const box = new THREE.Box3().setFromObject(m);
  if (!isFinite(box.min.x)) return;
  for (const slab of WALL_SLABS) {
    if (!box.intersectsBox(slab)) continue;
    // depth past inner face
    for (const f of FACES) {
      const lo = f.axis === 'x' ? box.min.x : box.min.z;
      const hi = f.axis === 'x' ? box.max.x : box.max.z;
      const depth = f.sign > 0 ? hi - f.inner : f.inner - lo;
      if (depth <= 0) continue;
      const span = hi - lo;
      const c = new THREE.Vector3(); box.getCenter(c);
      const s = new THREE.Vector3(); box.getSize(s);
      rows.push({
        name: m.name || '(anon)',
        geo: m.geometry?.type,
        face: f.name,
        depth: depth.toFixed(3),
        span: span.toFixed(3),
        frac: (depth / Math.max(span, 1e-9)).toFixed(3),
        ctr: [c.x, c.y, c.z].map(v => v.toFixed(2)).join(','),
        size: [s.x, s.y, s.z].map(v => v.toFixed(2)).join(','),
        vis: m.visible,
        pos: m.position.toArray().map(v => v.toFixed(2)).join(','),
      });
    }
    break;
  }
});

rows.sort((a, b) => Number(b.depth) - Number(a.depth));
console.log(`TOTAL intersecting rows: ${rows.length}`);
for (const r of rows) {
  console.log(
    `${r.depth.padStart(7)} frac=${r.frac.padStart(6)} span=${r.span.padStart(7)} ` +
    `${r.face.padEnd(5)} vis=${r.vis?1:0} ${String(r.geo).padEnd(16)} ` +
    `sz=${r.size.padEnd(20)} ctr=${r.ctr.padEnd(22)} pos=${r.pos.padEnd(22)} ${r.name}`
  );
}
