import * as THREE from 'three';

// Rain-on-glass overlay shader. Mounts as a separate plane slightly in front
// of the existing transparent window glass (room.ts:windowPlane), so the
// see-through MeshPhysicalMaterial behind stays intact. Pure-fragment cost;
// runs even on HD 4000.
//
// Uniforms are pushed every frame from main.ts:
//   uTime          — seconds, continuous
//   uRainAmt       — 0..1.9 (matches weather.rainValue): 0=off, 0.8=light, 1.9=heavy
//   uCondensation  — 0..1, condensation band strength (currently driven by curtain)
//   uCurtainAmt    — 0..1 (props.curtain.amount()); when curtain closes, drops fade out
//   uTint          — base streak tint (cyan-pink lerp from city light)
//
// Visual layers (cheap because they composite, no branches):
//   1) bright drop trails — voronoi cell centres slid downward; each cell
//      lights up briefly when the trail passes
//   2) periodic gust streaks — coherent horizontal smear every 6–11s
//   3) condensation band — soft glow rising from sill upward, modulated by
//      grazing-angle factor `1 - dot(viewDir, normal)` (computed from vNormal
//      vs camera direction)
//
// Output is additive-ish (transparent + low alpha base + bright streaks) so
// the city visible through the underlying transparent glass stays readable.

export interface WindowRainHandle {
  material: THREE.ShaderMaterial;
  setRain: (level01: number) => void;     // accepts 0..1.9 (raw rainValue), normalised inside
  setCurtain: (k01: number) => void;
  tick: (t: number) => void;
}

export function buildWindowRainMaterial(): WindowRainHandle {
  const uniforms = {
    uTime: { value: 0 },
    uRainAmt: { value: 0.42 },        // normalised 0..1
    uCondensation: { value: 0.0 },
    uCurtainAmt: { value: 0.0 },
    uTint: { value: new THREE.Color(0x88c2ff) },
  };

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vViewDir = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  // hash + voronoi adapted from common GLSL snippets — small, no textures.
  // Cell IDs slide downward each frame so drops appear to trail.
  const fragmentShader = /* glsl */ `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    uniform float uTime;
    uniform float uRainAmt;
    uniform float uCondensation;
    uniform float uCurtainAmt;
    uniform vec3  uTint;

    float hash11(float n) { return fract(sin(n) * 43758.5453); }
    vec2  hash22(vec2 p)  {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453);
    }

    // a single voronoi cell: returns vec3(distToFeature, cellId, featurePhase)
    vec3 voronoiCell(vec2 uv, float speed) {
      vec2 cell = floor(uv);
      vec2 f = fract(uv);
      float minDist = 1.0; vec2 nearest = vec2(0.0);
      for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 offs = vec2(float(i), float(j));
        vec2 h = hash22(cell + offs);
        // drop centres slide down + slight horizontal jitter
        h.y = fract(h.y - speed * (0.4 + 0.6 * hash11(dot(cell + offs, vec2(7.13, 1.91)))));
        vec2 diff = offs + h - f;
        float d = length(diff);
        if (d < minDist) { minDist = d; nearest = cell + offs; }
      }
      float cellId = hash11(dot(nearest, vec2(31.0, 17.0)));
      return vec3(minDist, cellId, fract(uTime * 0.6 + cellId * 7.0));
    }

    void main() {
      // base UV — make the window taller than wide so drops elongate vertically
      vec2 uv = vec2(vUv.x * 1.0, vUv.y * 0.6);

      // ------- two scales of drops layered (closer drops bigger) -------
      vec3 v0 = voronoiCell(uv * vec2(11.0, 6.0), uTime * 0.18);
      vec3 v1 = voronoiCell(uv * vec2(22.0, 13.0) + 19.7, uTime * 0.26);

      // each drop "lights up" briefly — a trail behind a falling head
      float head0 = smoothstep(0.18, 0.02, v0.x) * step(0.55, v0.y);
      float head1 = smoothstep(0.13, 0.01, v1.x) * step(0.62, v1.y);
      // narrow tail above the head (drips downward, so tail is in -y from head)
      // approximate: the closer to the cell centre AND below it, the brighter
      float trail0 = smoothstep(0.30, 0.04, v0.x) * step(0.55, v0.y) * 0.35;
      float trail1 = smoothstep(0.22, 0.02, v1.x) * step(0.62, v1.y) * 0.28;

      float drops = head0 + head1 * 0.7 + trail0 + trail1;

      // ------- periodic gust streak (every ~8s) -------
      float gustPhase = uTime * 0.12;
      float gust = smoothstep(0.93, 1.0, fract(gustPhase));
      // horizontal smear modulated by a noise band at the gust's y
      float gustY = hash11(floor(gustPhase));
      float gustBand = smoothstep(0.04, 0.0, abs(vUv.y - gustY));
      float gustStreak = gust * gustBand * 0.45;

      // ------- condensation band (bottom + grazing angle) -------
      float grazing = 1.0 - max(dot(vViewDir, vWorldNormal), 0.0);
      grazing = clamp(grazing, 0.0, 1.0);
      float sillBand = smoothstep(0.0, 0.35, vUv.y);
      // 0 at sill → 1 just above, then fades up
      sillBand = (1.0 - sillBand) * 0.7 + smoothstep(0.35, 0.10, vUv.y) * 0.4;
      float condense = sillBand * (0.35 + 0.65 * grazing) * uCondensation;

      // ------- rain intensity gate -------
      float rainK = clamp(uRainAmt, 0.0, 1.0);
      // curtain fully closed → drops fade quickly (rain still falls outside,
      // but you can't see the glass surface)
      float curtainK = 1.0 - uCurtainAmt * 0.9;
      drops *= rainK * curtainK;
      gustStreak *= rainK * curtainK;
      condense *= 0.65 + 0.35 * rainK;  // condensation persists even when rain light

      // colour: drops carry a faint cyan-pink neon tint, condensation is whiter
      vec3 dropCol = uTint * (1.4 + drops * 0.6);
      vec3 condCol = vec3(0.85, 0.92, 1.05);

      float wetA = drops + gustStreak;
      float condA = condense * 0.55;
      // Output: keep base alpha very low so the city behind stays visible,
      // bright wet pixels punch through.
      vec3  rgb   = dropCol * wetA + condCol * condA;
      float alpha = clamp(wetA * 0.95 + condA, 0.0, 0.95);

      // slight desaturation when very wet — water reads neutral, not coloured
      float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(rgb, vec3(lum), 0.35 * wetA);

      gl_FragColor = vec4(rgb, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // additive looks too "burny" against the bloom pass — premultiplied normal
    // blend gives the watery sheen without blowing out
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
  material.name = 'WindowRainShader';

  return {
    material,
    setRain: (level01) => {
      // raw rainValue is 0..1.9; map to 0..1 with a soft knee so heavy reads
      // distinctly stronger than light
      const k = level01 < 0.001 ? 0 : Math.min(1.0, 0.45 + 0.55 * Math.min(1, level01 / 1.9));
      uniforms.uRainAmt.value = k;
      // condensation persists even when rain dialled down — humid window
      uniforms.uCondensation.value = level01 < 0.001 ? 0.0 : 0.45 + 0.4 * Math.min(1, level01 / 1.9);
    },
    setCurtain: (k01) => {
      uniforms.uCurtainAmt.value = Math.max(0, Math.min(1, k01));
    },
    tick: (t) => { uniforms.uTime.value = t; },
  };
}
