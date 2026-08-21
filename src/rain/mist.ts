import * as THREE from 'three';

/** Slow, large, soft discs — haze, not rain. One Points draw. */

export interface MistSystem {
  group: THREE.Group;
  update: (dt: number) => void;
  setDensity: (k: number) => void;
  dispose: () => void;
}

export function createMist(opts?: {
  count?: number;
  xSpan?: number;
  z0?: number;
  z1?: number;
  y0?: number;
  y1?: number;
}): MistSystem {
  const count = opts?.count ?? 140;
  const xSpan = opts?.xSpan ?? 22;
  const z0 = opts?.z0 ?? 4;
  const z1 = opts?.z1 ?? 40;
  const y0 = opts?.y0 ?? 0.4;
  const y1 = opts?.y1 ?? 6;
  const zSpan = Math.max(0.01, z1 - z0);
  const group = new THREE.Group();
  group.name = 'Mist';

  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * xSpan;
    pos[i * 3 + 1] = y0 + Math.random() * (y1 - y0);
    pos[i * 3 + 2] = z0 + Math.random() * zSpan;
    phase[i] = Math.random();
    size[i] = 0.7 + Math.random() * 1.4;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDensity: { value: 0.55 },
      uColor: { value: new THREE.Color(0x8aa6c4) },
      uZ0: { value: z0 },
      uZSpan: { value: zSpan },
    },
  ]);

  const mat = new THREE.ShaderMaterial({
    name: 'MistPoints',
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uDensity;
      uniform float uZ0;
      uniform float uZSpan;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.07 + aPhase * 6.2832) * 0.8;
        p.z += uTime * 0.12;
        p.z = uZ0 + mod(p.z - uZ0, uZSpan);
        vAlpha = uDensity * (0.045 + 0.06 * aPhase);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float dist = max(-mvPosition.z, 1.0);
        gl_PointSize = clamp(aSize * (90.0 / dist), 12.0, 160.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        float a = (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha;
        if (a < 0.008) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }
    `,
  });

  const points = new THREE.Points(geom, mat);
  points.name = 'MistPoints';
  points.frustumCulled = false;
  group.add(points);

  let time = 0;
  return {
    group,
    update: (dt) => {
      time += dt;
      uniforms.uTime.value = time;
    },
    setDensity: (k) => {
      uniforms.uDensity.value = Math.max(0, Math.min(1.4, k));
      group.visible = k > 0.02;
    },
    dispose: () => {
      geom.dispose();
      mat.dispose();
    },
  };
}
