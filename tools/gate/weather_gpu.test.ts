// Rain VFX is parked (noise + inverted fall). The rig must stay a named
// empty Group so main.ts visibility / setIntensity / update keep compiling.
// Run: npm run test:weather

import * as THREE from 'three';
import { buildRain } from '../../src/world/weather.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

const scene = new THREE.Scene();
const rig = buildRain({
  scene,
  settings: { rainCount: 24 },
} as any);

ok(rig.rain instanceof THREE.Group, 'rig.rain is a Group');
ok(rig.rain.name === 'Rain', 'group is named Rain so main.ts visibility toggle still works');
ok(scene.children.includes(rig.rain), 'group is added to the scene');
ok(rig.rain.children.length === 0, 'no streak / curtain children while VFX is parked');
ok(rig.rain.visible === false, 'parked rain starts hidden');

ok(typeof rig.update === 'function', 'update is a no-op function');
ok(typeof rig.setIntensity === 'function', 'setIntensity is a no-op function');
rig.update(1 / 60);
rig.setIntensity(1.9);
ok(rig.rain.children.length === 0, 'update / setIntensity do not spawn meshes');

console.log(`\nweather_gpu test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
