import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

/**
 * Three.js particle rain — WebGL `THREE.Points`, one draw.
 *
 * Official cousins: examples/webgl_points_sprites, webgl_points_billboards.
 * The only official *rain* example (webgpu_compute_particles_rain) is
 * WebGPU compute + TSL; this room is WebGLRenderer + postprocessing, so
 * we stay on Points and wrap in the vertex shader instead.
 *
 * Fall is GPU-only and MUST go down:
 *   cycle = fract(phase + time * speed / RANGE)
 *   y     = Y_MAX - cycle * RANGE
 * Time up → y down. Position buffer is static after boot.
 */

export interface WeatherRig {
  rain: THREE.Group;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
}

export const RAIN_Y_MAX = 38;
export const RAIN_Y_MIN = -24;
export const RAIN_RANGE = RAIN_Y_MAX - RAIN_Y_MIN; // 62

const AREA_X = 72;
const AREA_Z0 = 8.2;
const AREA_Z1 = 52;

/** Pure fall function — same formula as the vertex shader. Exported so
 *  tests can lock "time up → y down" without a GPU. */
export function rainFallY(phase: number, time: number, speed: number): number {
  const cycle = fract(phase + (time * speed) / RAIN_RANGE);
  return RAIN_Y_MAX - cycle * RAIN_RANGE;
}

function fract(n: number): number {
  return n - Math.floor(n);
}

function rainPointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'RainPoints',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uIntensity: { value: 0.8 },
        uWind: { value: new THREE.Vector2(0.14, 0.03) },
        uColor: { value: new THREE.Color(0xc5ddf5) },
        uStreak: { value: 14 },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aSpeed;
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uIntensity;
      uniform vec2 uWind;
      uniform float uStreak;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        float cycle = fract(aPhase + uTime * aSpeed / ${RAIN_RANGE.toFixed(1)});
        // FALL DOWN: cycle 0 = top, 1 = bottom. Do not add cycle to Y.
        float y = ${RAIN_Y_MAX.toFixed(1)} - cycle * ${RAIN_RANGE.toFixed(1)};
        vec3 transformed = vec3(
          position.x + uWind.x * cycle * 7.0,
          y,
          position.z + uWind.y * cycle * 3.0
        );
        // Light rain shows a subset; heavy uses the whole cloud.
        float gate = step(aPhase, mix(0.32, 1.0, clamp(uIntensity / 1.9, 0.0, 1.0)));
        vAlpha = gate * (0.18 + 0.55 * clamp(uIntensity, 0.0, 1.9) / 1.9);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float dist = max(-mvPosition.z, 1.0);
        gl_PointSize = clamp(uStreak * aSize * (18.0 / dist), 3.0, 48.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        if (vAlpha < 0.01) discard;
        vec2 pc = gl_PointCoord - vec2(0.5, 0.0);
        float x = abs(pc.x);
        // Thin vertical streak; brighter at the bottom (leading edge).
        float core = 1.0 - smoothstep(0.025, 0.11, x);
        if (core < 0.02) discard;
        float head = mix(0.08, 1.0, gl_PointCoord.y);
        float alpha = core * head * vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.NormalBlending,
  });
}

export function buildRain(ctx: EngineCtx): WeatherRig {
  const count = Math.max(0, Math.floor(ctx.settings.rainCount));
  const group = new THREE.Group();
  group.name = 'Rain';

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const z = AREA_Z0 + Math.random() * (AREA_Z1 - AREA_Z0);
    const near = 1.0 - (z - AREA_Z0) / (AREA_Z1 - AREA_Z0);
    positions[i * 3] = (Math.random() - 0.5) * AREA_X;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = z;
    speeds[i] = 16 + Math.random() * 10 + near * 4;
    phases[i] = Math.random();
    sizes[i] = 0.7 + Math.random() * 0.7 + near * 0.35;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  // Y is computed in-shader across the full column, so the rest pose
  // (y=0) must not frustum-cull the cloud.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 7, 28), 70);
  geom.boundingBox = new THREE.Box3(
    new THREE.Vector3(-AREA_X / 2, RAIN_Y_MIN, AREA_Z0),
    new THREE.Vector3(AREA_X / 2, RAIN_Y_MAX, AREA_Z1),
  );

  const mat = rainPointsMaterial();
  const points = new THREE.Points(geom, mat);
  points.name = 'RainPoints';
  points.frustumCulled = false;
  group.add(points);
  ctx.scene.add(group);

  let time = 0;

  const setIntensity = (k: number) => {
    mat.uniforms.uIntensity.value = Math.max(0, Math.min(3, k));
  };

  return {
    rain: group,
    update: (dt: number) => {
      time += dt;
      mat.uniforms.uTime.value = time;
    },
    setIntensity,
  };
}
