// GPU rain tech: THREE.Points streaks + splashes, fall DOWN, static buffers.
// Run: npm run test:weather

import * as THREE from 'three';
import { buildRain, rainFallY, RAIN_Y_MAX, RAIN_RANGE } from '../../src/world/weather.ts';
import { createRainSystem } from '../../src/rain/system.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

const COUNT = 24;
const scene = new THREE.Scene();
const rig = buildRain({
  scene,
  settings: { rainCount: COUNT },
} as any);

ok(rig.rain instanceof THREE.Group, 'rig.rain is a Group');
ok(rig.rain.name === 'Rain', 'group is named Rain');
ok(scene.children.includes(rig.rain), 'group is added to the scene');

const names = rig.rain.children.map((c) => c.name).sort();
ok(names.includes('RainPoints'), 'has RainPoints');
ok(names.includes('RainSplashes'), 'has RainSplashes (ground contact)');
ok(!names.some((n) => n.startsWith('RainCurtain')), 'no hash-curtain quads');

const points = rig.rain.getObjectByName('RainPoints') as THREE.Points;
ok(points instanceof THREE.Points, 'streaks are THREE.Points');
const splashes = rig.rain.getObjectByName('RainSplashes') as THREE.Points;
ok(splashes instanceof THREE.Points, 'splashes are THREE.Points');
ok(points.geometry === splashes.geometry, 'streaks and splashes share geometry');

const geom = points.geometry;
ok(geom.getAttribute('position').count === COUNT, `position count is ${COUNT}`);
ok(!!geom.getAttribute('aSpeed'), 'aSpeed attribute present');
ok(!!geom.getAttribute('aPhase'), 'aPhase attribute present');
ok(!!geom.getAttribute('aSize'), 'aSize attribute present');

const pos = geom.getAttribute('position') as THREE.BufferAttribute;
const before = new Float32Array(pos.array as Float32Array);
const versionBefore = pos.version;
for (let i = 0; i < 12; i++) rig.update(1 / 60);
const after = pos.array as Float32Array;
let same = before.length === after.length;
if (same) {
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) { same = false; break; }
  }
}
ok(same, 'update() does not rewrite position buffer');
ok(pos.version === versionBefore, 'update() does not bump position.version');

const mat = points.material as THREE.ShaderMaterial;
ok(mat.uniforms.uTime.value > 0, 'uTime advances on update');
ok(mat.vertexShader.includes('uYMax - cycle * range'), 'shader subtracts cycle so y falls');
ok(!mat.vertexShader.includes('+ cycle * range'), 'shader does not add cycle (that climbed)');

const splashMat = splashes.material as THREE.ShaderMaterial;
ok(splashMat.uniforms === mat.uniforms, 'both draws share uniforms');

const y0 = rainFallY(0.25, 0, 20);
const y1 = rainFallY(0.25, 1, 20);
ok(y1 < y0, `time up → y down (${y0.toFixed(2)} → ${y1.toFixed(2)})`);
ok(y0 <= RAIN_Y_MAX && y1 >= RAIN_Y_MAX - RAIN_RANGE, 'fall stays inside the rain column');
ok(rainFallY(0, 0, 20) === RAIN_Y_MAX, 'phase 0 at t=0 sits at the top');

rig.setIntensity(1.9);
ok(Math.abs(mat.uniforms.uIntensity.value - 1.9) < 1e-6, 'setIntensity(1.9) writes the uniform');
rig.setIntensity(-4);
ok(mat.uniforms.uIntensity.value === 0, 'setIntensity clamps below 0');
rig.setIntensity(99);
ok(mat.uniforms.uIntensity.value === 3, 'setIntensity clamps above 3');

const lab = createRainSystem({ count: 8, yMax: 10, yMin: 0, xSpan: 4, z0: -2, z1: 2 });
ok(lab.group.children.length === 2, 'lab system also has streak + splash');
const labMat = (lab.group.getObjectByName('RainPoints') as THREE.Points).material as THREE.ShaderMaterial;
ok(Math.abs(labMat.uniforms.uYMax.value - 10) < 1e-6, 'lab column height is parameterized');
ok(Math.abs(labMat.uniforms.uRange.value - 10) < 1e-6, 'lab range follows yMax - yMin');
lab.setWind(0.5, 0.2);
ok(Math.abs(labMat.uniforms.uWind.value.x - 0.5) < 1e-6, 'setWind writes shared wind');
lab.dispose();

ok(rig.rain.visible === true, 'CONTROL: group starts visible');
rig.rain.visible = false;
ok(rig.rain.visible === false, 'main.ts can hide the whole rain with .visible');

console.log(`\nweather_gpu test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
