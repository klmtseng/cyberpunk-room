// Headless regression: rain must stay GPU-driven.
// Run: npm run test:weather
//
// Guards the old CPU path (weather.ts used to rewrite every LineSegments
// vertex and set needsUpdate every frame). After the GPU rewrite, positions
// are static, aSpeed/aPhase exist, and update() only advances uniforms.

import * as THREE from 'three';
import { buildRain } from '../../src/world/weather.ts';

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

ok(rig.rain instanceof THREE.Group, 'rig.rain is a Group (streaks + curtains)');
ok(rig.rain.name === 'Rain', 'group is named Rain so main.ts visibility toggle still works');
ok(scene.children.includes(rig.rain), 'group is added to the scene');

const names = rig.rain.children.map((c) => c.name).sort();
ok(names.includes('RainStreaks'), 'has RainStreaks');
ok(names.includes('RainCurtainNear'), 'has RainCurtainNear');
ok(names.includes('RainCurtainFar'), 'has RainCurtainFar');

const streaks = rig.rain.getObjectByName('RainStreaks') as THREE.LineSegments;
ok(streaks instanceof THREE.LineSegments, 'streaks are LineSegments');
const geom = streaks.geometry;
ok(geom.getAttribute('position').count === COUNT * 2, `position count is ${COUNT * 2}`);
ok(!!geom.getAttribute('aSpeed'), 'aSpeed attribute present (GPU fall speed)');
ok(!!geom.getAttribute('aPhase'), 'aPhase attribute present (GPU wrap phase)');

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
ok(pos.version === versionBefore, 'update() does not bump position.version (no GPU upload)');

const mat = streaks.material as THREE.ShaderMaterial;
ok(mat.uniforms.uTime.value > 0, 'uTime advances on update');
rig.setIntensity(1.9);
ok(Math.abs(mat.uniforms.uIntensity.value - 1.9) < 1e-6, 'setIntensity(1.9) writes the streak uniform');
rig.setIntensity(-4);
ok(mat.uniforms.uIntensity.value === 0, 'setIntensity clamps below 0');
rig.setIntensity(99);
ok(mat.uniforms.uIntensity.value === 3, 'setIntensity clamps above 3');

const nearMat = (rig.rain.getObjectByName('RainCurtainNear') as THREE.Mesh).material as THREE.ShaderMaterial;
ok(Math.abs(nearMat.uniforms.uIntensity.value - 3) < 1e-6, 'intensity is shared with curtains');
ok(nearMat.uniforms.uTime.value === mat.uniforms.uTime.value, 'curtain time tracks streak time');

ok(rig.rain.visible === true, 'CONTROL: group starts visible');
rig.rain.visible = false;
ok(rig.rain.visible === false, 'main.ts can hide the whole rain with .visible');

console.log(`\nweather_gpu test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
