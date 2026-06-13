import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

export interface WeatherRig {
  rain: THREE.LineSegments;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
}

export function buildRain(ctx: EngineCtx): WeatherRig {
  const count = ctx.settings.rainCount;
  const positions = new Float32Array(count * 6); // 2 vertices per line
  const velocities = new Float32Array(count);
  // rain falls outside the window wall (z > 7), in front of and below the room
  const AREA_X = 90, AREA_Z0 = 7.5, AREA_Z1 = 70, AREA_Y = 40, Y_MIN = -25;

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * AREA_X;
    const y = Y_MIN + Math.random() * (AREA_Y - Y_MIN);
    const z = AREA_Z0 + Math.random() * (AREA_Z1 - AREA_Z0);
    const len = 0.5 + Math.random() * 0.6;
    positions[i * 6]     = x;       positions[i * 6 + 1] = y;       positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x + 0.05; positions[i * 6 + 4] = y - len; positions[i * 6 + 5] = z;
    velocities[i] = 18 + Math.random() * 14;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x88d4ff, transparent: true, opacity: 0.35, fog: true,
  });
  const rain = new THREE.LineSegments(geom, mat);
  rain.frustumCulled = false;
  rain.name = 'Rain';
  ctx.scene.add(rain);

  let intensity = 1.0;

  const update = (dt: number) => {
    const arr = (geom.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const fall = dt * intensity;
    for (let i = 0; i < count; i++) {
      const baseY = i * 6 + 1;
      const tipY  = i * 6 + 4;
      arr[baseY] -= velocities[i] * fall;
      arr[tipY]  -= velocities[i] * fall;
      if (arr[tipY] < Y_MIN) {
        const newY = AREA_Y + Math.random() * 4;
        const len = arr[baseY] - arr[tipY];
        arr[baseY] = newY;
        arr[tipY]  = newY - len;
        arr[i * 6]     = (Math.random() - 0.5) * AREA_X;
        arr[i * 6 + 2] = AREA_Z0 + Math.random() * (AREA_Z1 - AREA_Z0);
        arr[i * 6 + 3] = arr[i * 6] + 0.05;
        arr[i * 6 + 5] = arr[i * 6 + 2];
      }
    }
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };

  return {
    rain,
    update,
    setIntensity: (k) => { intensity = Math.max(0, Math.min(3, k)); },
  };
}
