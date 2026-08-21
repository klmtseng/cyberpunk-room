import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

/**
 * Rain VFX parked.
 *
 * The GPU LineSegments + hash-curtain pass read as noise and the Y wrap
 * ran the wrong way (drops climbed). Window overlay is gated off via
 * quality.windowRainShader. WeatherRig stays so main.ts / terminal / E
 * on the window keep compiling; visuals are a no-op until we plug a
 * Three.js-native replacement (see commit notes).
 */
export interface WeatherRig {
  rain: THREE.Group;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
}

export function buildRain(ctx: EngineCtx): WeatherRig {
  const group = new THREE.Group();
  group.name = 'Rain';
  group.visible = false;
  ctx.scene.add(group);

  return {
    rain: group,
    update: (_dt: number) => {},
    setIntensity: (_k: number) => {},
  };
}
