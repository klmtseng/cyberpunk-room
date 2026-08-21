import type { EngineCtx } from '../engine/renderer';
import {
  createRainSystem,
  rainFallY,
  RAIN_RANGE,
  RAIN_Y_MAX,
  RAIN_Y_MIN,
  type RainSystem,
} from '../rain/system';

export { rainFallY, RAIN_RANGE, RAIN_Y_MAX, RAIN_Y_MIN };

/**
 * Loft weather adapter. Rain *tech* lives in src/rain/system.ts.
 * Volume sits outside the window wall (z ≈ 7).
 */
export interface WeatherRig {
  rain: RainSystem['group'];
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
}

export function buildRain(ctx: EngineCtx): WeatherRig {
  const sys = createRainSystem({
    count: ctx.settings.rainCount,
    yMax: RAIN_Y_MAX,
    yMin: RAIN_Y_MIN,
    xSpan: 72,
    z0: 8.2,
    z1: 52,
  });
  ctx.scene.add(sys.group);
  return {
    rain: sys.group,
    update: sys.update,
    setIntensity: sys.setIntensity,
  };
}
