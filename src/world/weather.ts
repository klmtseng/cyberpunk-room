import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

/**
 * GPU rain. CPU used to rewrite every LineSegments vertex each frame
 * (up to 30k drops × 6 floats, uploaded every tick). That both starved
 * the main thread and still looked like a cyan wireframe.
 *
 * Now:
 *   1. Streaks — one LineSegments draw, positions static, vertex shader
 *      wraps them in Y from aPhase/aSpeed + uTime. Wind slant + head/tail
 *      fade live in the shader. Zero buffer uploads after boot.
 *   2. Curtains — two cheap quads outside the window with a scrolling
 *      hash-streak fragment. This is what makes the volume read as rain
 *      instead of a handful of needles; overdraw is two fullscreen-ish
 *      transparent passes, not tens of thousands of CPU verts.
 *
 * WeatherRig.rain is the group so `rain.visible = false` still kills both.
 */
export interface WeatherRig {
  rain: THREE.Group;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
}

const AREA_X = 90;
const AREA_Z0 = 7.5;
const AREA_Z1 = 70;
const AREA_Y = 40;
const Y_MIN = -25;
const RANGE = AREA_Y - Y_MIN; // 65

function rainStreakMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'RainStreaks',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uWind: { value: new THREE.Vector2(0.18, 0.05) },
        uColor: { value: new THREE.Color(0xc8e8ff) },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aSpeed;
      attribute float aPhase;
      uniform float uTime;
      uniform float uIntensity;
      uniform vec2 uWind;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        float gust = 1.0 + 0.35 * sin(uTime * 0.63 + aPhase * 6.283185);
        float cycle = fract(aPhase + uTime * aSpeed / ${RANGE.toFixed(1)});
        vec3 transformed = vec3(
          position.x + uWind.x * gust * (1.0 - cycle) * 10.0,
          ${Y_MIN.toFixed(1)} + cycle * ${RANGE.toFixed(1)} + position.y,
          position.z + uWind.y * gust * (1.0 - cycle) * 5.0
        );
        float along = clamp(-position.y / 2.4, 0.0, 1.0);
        vAlpha = mix(0.95, 0.06, along) * clamp(uIntensity, 0.0, 3.0);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColor, clamp(vAlpha, 0.0, 1.0));
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

function rainCurtainMaterial(scale: number, speed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'RainCurtain',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uScale: { value: scale },
        uSpeed: { value: speed },
        uColor: { value: new THREE.Color(0xb7dcff) },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vViewZ;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 transformed = position;
        vec4 world = modelMatrix * vec4(transformed, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        vViewZ = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uScale;
      uniform float uSpeed;
      uniform vec3 uColor;
      varying vec3 vWorld;
      varying float vViewZ;
      #include <common>
      #include <fog_pars_fragment>

      float hash11(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // Two stacked hash grids: sparse long streaks + a finer mist.
        vec2 uvA = vec2(vWorld.x * 0.42 * uScale, vWorld.y * 0.18 - uTime * uSpeed);
        vec2 uvB = vec2(vWorld.x * 0.95 * uScale + 17.3, vWorld.y * 0.34 - uTime * uSpeed * 1.35);
        vec2 cellA = floor(uvA * vec2(28.0, 9.0));
        vec2 cellB = floor(uvB * vec2(54.0, 16.0));
        float idA = hash11(dot(cellA, vec2(19.1, 7.3)));
        float idB = hash11(dot(cellB, vec2(11.7, 31.9)));
        float dropA = step(0.82, idA);
        float dropB = step(0.90, idB);
        float headA = fract(uvA.y);
        float headB = fract(uvB.y);
        float streakA = dropA * smoothstep(0.0, 0.12, headA) * smoothstep(1.0, 0.45, headA);
        float streakB = dropB * smoothstep(0.0, 0.18, headB) * smoothstep(1.0, 0.55, headB) * 0.55;
        float rain = (streakA + streakB) * clamp(uIntensity, 0.0, 3.0);
        // Distant curtain is quieter so the near one carries the silhouette.
        float distFade = smoothstep(80.0, 14.0, vViewZ);
        float alpha = rain * 0.28 * distFade;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
}

export function buildRain(ctx: EngineCtx): WeatherRig {
  const count = ctx.settings.rainCount;
  const group = new THREE.Group();
  group.name = 'Rain';

  const positions = new Float32Array(count * 6);
  const speeds = new Float32Array(count * 2);
  const phases = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * AREA_X;
    const z = AREA_Z0 + Math.random() * (AREA_Z1 - AREA_Z0);
    // Near drops are longer and a little faster so they read as volume
    // close to the glass; far drops stay short needles.
    const near = 1.0 - (z - AREA_Z0) / (AREA_Z1 - AREA_Z0);
    const len = 0.7 + Math.random() * 0.9 + near * 0.8;
    const slant = 0.04 + Math.random() * 0.10;
    positions[i * 6]     = x;
    positions[i * 6 + 1] = 0;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x + slant;
    positions[i * 6 + 4] = -len;
    positions[i * 6 + 5] = z;
    const speed = 22 + Math.random() * 16 + near * 6;
    const phase = Math.random();
    speeds[i * 2] = speed;
    speeds[i * 2 + 1] = speed;
    phases[i * 2] = phase;
    phases[i * 2 + 1] = phase;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const streakMat = rainStreakMaterial();
  const streaks = new THREE.LineSegments(geom, streakMat);
  streaks.name = 'RainStreaks';
  streaks.frustumCulled = false;
  group.add(streaks);

  const curtainNear = new THREE.Mesh(
    new THREE.PlaneGeometry(72, 48),
    rainCurtainMaterial(1.0, 3.4),
  );
  curtainNear.name = 'RainCurtainNear';
  curtainNear.position.set(0, 6, 14);
  group.add(curtainNear);

  const curtainFar = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 62),
    rainCurtainMaterial(0.55, 2.2),
  );
  curtainFar.name = 'RainCurtainFar';
  curtainFar.position.set(0, 4, 36);
  group.add(curtainFar);

  ctx.scene.add(group);

  const mats = [
    streakMat,
    curtainNear.material as THREE.ShaderMaterial,
    curtainFar.material as THREE.ShaderMaterial,
  ];

  let time = 0;

  const setIntensity = (k: number) => {
    const intensity = Math.max(0, Math.min(3, k));
    for (const m of mats) m.uniforms.uIntensity.value = intensity;
  };

  return {
    rain: group,
    update: (dt: number) => {
      time += dt;
      for (const m of mats) m.uniforms.uTime.value = time;
    },
    setIntensity,
  };
}
