import * as THREE from 'three';

/**
 * GPU rain as Three.js particles (WebGL).
 *
 * Primitive: THREE.Points (official WebGL particle path —
 * examples/webgl_points_sprites). Two draws share one BufferGeometry:
 *   1. RainPoints  — falling streaks
 *   2. RainSplashes — brief discs at yMin when a drop wraps
 *
 * Fall (must stay this sign):
 *   cycle = fract(phase + time * speed / range)
 *   y     = yMax - cycle * range
 * Time up → y down. Positions never uploaded after boot.
 */

export const RAIN_Y_MAX = 38;
export const RAIN_Y_MIN = -24;
export const RAIN_RANGE = RAIN_Y_MAX - RAIN_Y_MIN;

export interface RainOptions {
  count: number;
  yMax?: number;
  yMin?: number;
  xSpan?: number;
  z0?: number;
  z1?: number;
  wind?: THREE.Vector2;
  color?: THREE.Color;
}

export interface RainSystem {
  group: THREE.Group;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
  setWind: (x: number, z: number) => void;
  setStreak: (px: number) => void;
  dispose: () => void;
}

export function rainFallY(
  phase: number,
  time: number,
  speed: number,
  yMax = RAIN_Y_MAX,
  range = RAIN_RANGE,
): number {
  const cycle = fract(phase + (time * speed) / range);
  return yMax - cycle * range;
}

function fract(n: number): number {
  return n - Math.floor(n);
}

const STREAK_VERT = /* glsl */ `
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uYMax;
  uniform float uRange;
  uniform vec2 uWind;
  uniform float uStreak;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    float range = max(uRange, 0.001);
    float cycle = fract(aPhase + uTime * aSpeed / range);
    float y = uYMax - cycle * range;
    vec3 transformed = vec3(
      position.x + uWind.x * cycle * 6.0,
      y,
      position.z + uWind.y * cycle * 2.5
    );
    float gate = step(aPhase, mix(0.30, 1.0, clamp(uIntensity / 1.9, 0.0, 1.0)));
    vAlpha = gate * (0.22 + 0.50 * clamp(uIntensity, 0.0, 1.9) / 1.9);
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(-mvPosition.z, 0.8);
    gl_PointSize = clamp(uStreak * aSize * (16.0 / dist), 2.5, 42.0);
    #include <fog_vertex>
  }
`;

const STREAK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha < 0.01) discard;
    float x = abs(gl_PointCoord.x - 0.5);
    float core = 1.0 - smoothstep(0.02, 0.10, x);
    if (core < 0.02) discard;
    float head = mix(0.10, 1.0, gl_PointCoord.y);
    float alpha = core * head * vAlpha;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <fog_fragment>
  }
`;

const SPLASH_VERT = /* glsl */ `
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uYMax;
  uniform float uRange;
  uniform float uYMin;
  uniform vec2 uWind;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    float range = max(uRange, 0.001);
    float cycle = fract(aPhase + uTime * aSpeed / range);
    float gate = step(aPhase, mix(0.30, 1.0, clamp(uIntensity / 1.9, 0.0, 1.0)));
    // Burst in the last 6% of the fall, then wrap back to the top.
    float k = smoothstep(0.94, 0.97, cycle) * (1.0 - smoothstep(0.97, 1.0, cycle));
    vAlpha = gate * k * (0.35 + 0.40 * clamp(uIntensity, 0.0, 1.9) / 1.9);
    vec3 transformed = vec3(
      position.x + uWind.x * 6.0,
      uYMin + 0.04,
      position.z + uWind.y * 2.5
    );
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(-mvPosition.z, 0.8);
    gl_PointSize = clamp(k * aSize * (28.0 / dist) * (0.6 + 8.0 * (cycle - 0.94)), 0.0, 36.0);
    #include <fog_vertex>
  }
`;

const SPLASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha < 0.01) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float ring = smoothstep(1.0, 0.55, r) * smoothstep(0.15, 0.45, r);
    float alpha = ring * vAlpha;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <fog_fragment>
  }
`;

function makeUniforms(opts: {
  yMax: number;
  yMin: number;
  range: number;
  wind: THREE.Vector2;
  color: THREE.Color;
}) {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uIntensity: { value: 0.8 },
      uYMax: { value: opts.yMax },
      uYMin: { value: opts.yMin },
      uRange: { value: opts.range },
      uWind: { value: opts.wind.clone() },
      uColor: { value: opts.color.clone() },
      uStreak: { value: 12 },
    },
  ]);
}

export function createRainSystem(opts: RainOptions): RainSystem {
  const count = Math.max(0, Math.floor(opts.count));
  const yMax = opts.yMax ?? RAIN_Y_MAX;
  const yMin = opts.yMin ?? RAIN_Y_MIN;
  const range = yMax - yMin;
  const xSpan = opts.xSpan ?? 72;
  const z0 = opts.z0 ?? 8.2;
  const z1 = opts.z1 ?? 52;
  const wind = opts.wind ?? new THREE.Vector2(0.14, 0.03);
  const color = opts.color ?? new THREE.Color(0xc5ddf5);

  const group = new THREE.Group();
  group.name = 'Rain';

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const z = z0 + Math.random() * Math.max(0.01, z1 - z0);
    const near = 1.0 - (z - z0) / Math.max(0.01, z1 - z0);
    positions[i * 3] = (Math.random() - 0.5) * xSpan;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = z;
    speeds[i] = 14 + Math.random() * 10 + near * 4;
    phases[i] = Math.random();
    sizes[i] = 0.65 + Math.random() * 0.7 + near * 0.3;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, (yMax + yMin) * 0.5, (z0 + z1) * 0.5),
    Math.hypot(xSpan * 0.5, range * 0.5, (z1 - z0) * 0.5) + 8,
  );

  const uniforms = makeUniforms({ yMax, yMin, range, wind, color });
  // Splash shares the same uniform object so setIntensity/time stay in sync.
  const streakMat = new THREE.ShaderMaterial({
    name: 'RainPoints',
    uniforms,
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.NormalBlending,
  });
  const splashMat = new THREE.ShaderMaterial({
    name: 'RainSplashes',
    uniforms,
    vertexShader: SPLASH_VERT,
    fragmentShader: SPLASH_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geom, streakMat);
  points.name = 'RainPoints';
  points.frustumCulled = false;
  const splashes = new THREE.Points(geom, splashMat);
  splashes.name = 'RainSplashes';
  splashes.frustumCulled = false;
  group.add(points);
  group.add(splashes);

  let time = 0;

  return {
    group,
    update: (dt: number) => {
      time += dt;
      uniforms.uTime.value = time;
    },
    setIntensity: (k: number) => {
      uniforms.uIntensity.value = Math.max(0, Math.min(3, k));
    },
    setWind: (x: number, z: number) => {
      uniforms.uWind.value.set(x, z);
    },
    setStreak: (px: number) => {
      uniforms.uStreak.value = Math.max(2, Math.min(28, px));
    },
    dispose: () => {
      geom.dispose();
      streakMat.dispose();
      splashMat.dispose();
    },
  };
}
