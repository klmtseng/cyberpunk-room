import * as THREE from 'three';

/**
 * Rain on the lab's floor-to-ceiling window.
 *
 * Two cheap layers (not the old dense voronoi overlay — that read as noise):
 *   1. A physical eave. Drips are THREE.Points that hang on the lip, then
 *      fall DOWN (same y = yLip - cycle * range sign as the sky rain).
 *   2. A sparse glass sheet: ~10 fat sliding drops + a bead line under the
 *      eave. UV v=1 is the top; time up → v down.
 *
 * Refs used: Three.js Points (webgl_points_sprites); Ameo transmission
 * pane is static textures — we need motion, so shader + points instead.
 */

export interface WindowWet {
  group: THREE.Group;
  update: (dt: number) => void;
  setIntensity: (k: number) => void;
  dispose: () => void;
}

export function createWindowWet(opts: {
  width: number;
  height: number;
  winZ: number;
  sillY: number;
  headY: number;
  roomH: number;
  roomW: number;
}): WindowWet {
  const group = new THREE.Group();
  group.name = 'WindowWet';

  const eaveOut = 0.58;
  const lipZ = opts.winZ + eaveOut - 0.04;
  const lipY = opts.roomH - 0.09;
  const sillY = opts.sillY + 0.04;
  const fallRange = Math.max(0.4, lipY - sillY);

  const frame = new THREE.MeshStandardMaterial({
    color: 0x2a241c, roughness: 0.38, metalness: 0.4, fog: false,
  });
  const wetTop = new THREE.MeshStandardMaterial({
    color: 0x1a1816, roughness: 0.16, metalness: 0.55, fog: false,
  });

  const eave = new THREE.Mesh(new THREE.BoxGeometry(opts.roomW + 0.12, 0.07, eaveOut + 0.16), wetTop);
  eave.position.set(0, opts.roomH - 0.02, opts.winZ + eaveOut * 0.42);
  eave.name = 'Eave';
  group.add(eave);

  const fascia = new THREE.Mesh(new THREE.BoxGeometry(opts.roomW + 0.12, 0.11, 0.05), frame);
  fascia.position.set(0, lipY - 0.02, lipZ + 0.01);
  group.add(fascia);

  const overlayW = opts.width;
  const overlayH = opts.headY - opts.sillY;
  const uniforms = {
    uTime: { value: 0 },
    uRain: { value: 0.8 },
    uTint: { value: new THREE.Color(0xcfe6f8) },
  };
  const glassMat = new THREE.ShaderMaterial({
    name: 'PaneDrops',
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: PANE_FRAG,
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(overlayW, overlayH), glassMat);
  pane.position.set(0, (opts.sillY + opts.headY) / 2, opts.winZ + 0.03);
  pane.renderOrder = 3;
  pane.name = 'PaneDrops';
  group.add(pane);

  const dripCount = 56;
  const pos = new Float32Array(dripCount * 3);
  const phase = new Float32Array(dripCount);
  const speed = new Float32Array(dripCount);
  const size = new Float32Array(dripCount);
  for (let i = 0; i < dripCount; i++) {
    const x = (i / (dripCount - 1) - 0.5) * (overlayW - 0.15) + (Math.random() - 0.5) * 0.08;
    pos[i * 3] = x;
    pos[i * 3 + 1] = lipY;
    pos[i * 3 + 2] = lipZ - 0.02;
    phase[i] = Math.random();
    speed[i] = 1.6 + Math.random() * 1.4;
    size[i] = 0.7 + Math.random() * 0.8;
  }
  const dripGeom = new THREE.BufferGeometry();
  dripGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dripGeom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  dripGeom.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  dripGeom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const dripUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uIntensity: { value: 0.8 },
      uYLip: { value: lipY },
      uRange: { value: fallRange },
      uHang: { value: 0.22 },
      uColor: { value: new THREE.Color(0xd8eefc) },
    },
  ]);
  const dripMat = new THREE.ShaderMaterial({
    name: 'EaveDrips',
    uniforms: dripUniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: DRIP_VERT,
    fragmentShader: DRIP_FRAG,
  });
  const drips = new THREE.Points(dripGeom, dripMat);
  drips.name = 'EaveDrips';
  drips.frustumCulled = false;
  group.add(drips);

  let time = 0;
  let intensity = 0.8;
  const apply = () => {
    uniforms.uRain.value = intensity;
    dripUniforms.uIntensity.value = intensity;
    pane.visible = intensity > 0.02;
    drips.visible = intensity > 0.02;
  };
  apply();

  return {
    group,
    update: (dt) => {
      time += dt;
      uniforms.uTime.value = time;
      dripUniforms.uTime.value = time;
    },
    setIntensity: (k) => {
      intensity = Math.max(0, k);
      apply();
    },
    dispose: () => {
      pane.geometry.dispose();
      glassMat.dispose();
      dripGeom.dispose();
      dripMat.dispose();
      eave.geometry.dispose();
      fascia.geometry.dispose();
      frame.dispose();
      wetTop.dispose();
    },
  };
}

/** v=1 top of pane. Time up → drop v down. Sparse: 10 fat drops, not a hash field. */
const PANE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uRain;
  uniform vec3 uTint;

  float hash11(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float rainK = clamp(uRain / 1.9, 0.0, 1.0);
    if (rainK < 0.02) discard;

    float drops = 0.0;
    for (int i = 0; i < 10; i++) {
      float id = float(i);
      float px = 0.08 + 0.84 * hash11(id * 3.71);
      float spd = 0.07 + 0.09 * hash11(id * 9.13);
      float ph = hash11(id * 5.29);
      // TOP → BOTTOM: y = 1 - fract(...)
      float y = 1.0 - fract(ph + uTime * spd * (0.55 + 0.7 * rainK));
      vec2 d = (vUv - vec2(px, y)) * vec2(22.0, 11.0);
      float r = length(d);
      float core = smoothstep(0.85, 0.12, r);
      float rim = smoothstep(1.15, 0.72, r) * smoothstep(0.35, 0.78, r);
      float trail = smoothstep(0.045, 0.0, abs(vUv.x - px))
        * step(y, vUv.y)
        * smoothstep(y + 0.18, y + 0.02, vUv.y);
      float alive = step(id, mix(3.0, 10.0, rainK));
      drops += alive * (core * 1.15 + rim * 0.7 + trail * 0.32);
    }

    // Bead line under the eave (top of glass)
    float top = smoothstep(0.07, 0.0, 1.0 - vUv.y);
    float bx = vUv.x * mix(6.0, 14.0, rainK);
    float idb = floor(bx);
    float fx = fract(bx) - 0.5;
    float dripT = fract(uTime * (0.11 + 0.07 * hash11(idb)) + hash11(idb * 4.2));
    float hanging = 1.0 - step(0.28, dripT);
    float bead = hanging * top * smoothstep(0.22, 0.04, length(vec2(fx * 1.6, (1.0 - vUv.y - 0.018) * 14.0)));

    // Thin wet film just under the eave, not a noisy hash
    float film = top * (0.10 + 0.16 * rainK);

    float wet = drops + bead * 1.35;
    float alpha = clamp(wet * 0.82 + film, 0.0, 0.86);
    if (alpha < 0.02) discard;
    vec3 col = mix(uTint * 0.65, vec3(0.97, 0.99, 1.0), clamp(wet, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }
`;

const DRIP_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uYLip;
  uniform float uRange;
  uniform float uHang;
  varying float vAlpha;
  varying float vHang;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    float cycle = fract(aPhase + uTime * aSpeed * 0.12);
    float hang = uHang;
    float falling = step(hang, cycle);
    float t = (cycle - hang) / max(1.0 - hang, 0.001);
    // Time up → y down from the lip.
    float y = uYLip - falling * t * uRange;
    vHang = 1.0 - falling;
    float gate = step(aPhase, mix(0.18, 1.0, clamp(uIntensity / 1.9, 0.0, 1.0)));
    vAlpha = gate * mix(0.55, 0.95, falling);
    vec3 transformed = vec3(position.x, y, position.z);
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(-mvPosition.z, 0.6);
    float sz = mix(14.0, 9.0, falling) * aSize;
    gl_PointSize = clamp(sz * (20.0 / dist), 3.0, 34.0);
    #include <fog_vertex>
  }
`;

const DRIP_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vHang;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha < 0.02) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    // Hanging: round bead. Falling: teardrop (point down = +Y in point coord? gl_PointCoord y=0 top)
    float y = gl_PointCoord.y;
    vec2 q = vec2(p.x * mix(1.0, 1.35, 1.0 - vHang), (p.y + 0.15 * (1.0 - vHang)));
    float r = length(q);
    float core = 1.0 - smoothstep(0.15, 0.85, r);
    float tail = (1.0 - vHang) * (1.0 - y) * (1.0 - smoothstep(0.22, 0.0, abs(p.x)));
    float alpha = (core + tail * 0.45) * vAlpha;
    if (alpha < 0.03) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <fog_fragment>
  }
`;
