import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

export interface LightRig {
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  moon: THREE.DirectionalLight;
  fixtures: THREE.PointLight[];          // pendant, stair, kitchen, desk, bedside, …
  baseIntensities: number[];             // fixture base values for mood scaling
  ambientBase: number;
  hemiBase: number;
}

// Light fixtures matched to visible sources in the room (per reference photos):
// pendant lamps over the sofa, kitchen tube under the mezzanine, under-stair
// purple wash, desk monitor spill, warm bedside lamp upstairs.
export function installLighting(ctx: EngineCtx): LightRig {
  const { scene, settings } = ctx;
  const lowEnd = settings.preset === 'low';

  // three r155+ physical light units: point intensities are candela —
  // real fixtures need tens of cd, not single digits
  const ambient = new THREE.AmbientLight(0x2d3854, 2.4);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x5a3aaf, 0x141226, 1.1);
  scene.add(hemi);

  // city sky fill through the big window
  const moon = new THREE.DirectionalLight(0x7da4ff, 1.1);
  moon.position.set(-14, 24, 30); // outside, above, in front of the window
  if (settings.enableShadows && settings.shadowMapSize > 0) {
    moon.castShadow = true;
    moon.shadow.mapSize.setScalar(settings.shadowMapSize);
    Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 80 });
    moon.shadow.bias = -0.0008;
  }
  scene.add(moon);

  const fixtures: THREE.PointLight[] = [];
  const add = (color: number, intensity: number, dist: number, decay: number,
               x: number, y: number, z: number) => {
    const l = new THREE.PointLight(color, intensity, dist, decay);
    l.position.set(x, y, z);
    scene.add(l);
    fixtures.push(l);
    return l;
  };

  add(0xffd9b0, 55, 13, 1.7, 0.4, 4.1, 3.2);     // [0] pendants over living area
  add(0xb44dff, 38, 11, 1.7, -5.0, 1.6, -0.2);   // [1] under-stair purple wash
  add(0xfff4e0, 32, 10, 1.7, -2.0, 2.5, -5.0);   // [2] kitchen tube under mezzanine
  add(0x5af2ff, 26, 9, 1.7, 4.2, 1.5, 3.4);      // [3] desk monitor spill
  add(0xffc6a0, 22, 9, 1.7, -2.6, 4.0, -5.8);    // [4] bedside lamp on mezzanine

  if (!lowEnd) {
    add(0xff2bdb, 16, 7, 1.8, -4.6, 1.5, 4.7);   // [5] arcade glow
    add(0xb44dff, 12, 7, 1.8, -3.6, 3.4, -5.6);  // [6] bed underglow bounce
  }

  return {
    ambient, hemi, moon, fixtures,
    baseIntensities: fixtures.map((f) => f.intensity),
    ambientBase: ambient.intensity,
    hemiBase: hemi.intensity,
  };
}
