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
// Visual layers (cheap because they composite, no extra draw calls):
//   1) rivulet channels — vertical hash columns that water actually runs in
//   2) fine voronoi drops + trails (two scales)
//   3) fat slow drops with a bright meniscus
//   4) periodic gust streaks
//   5) condensation band + a thin wet-film so the pane reads as glass, not air
//
// Output stays readable: city through the glass, water sitting ON it.

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
      vec2 uv = vec2(vUv.x, vUv.y * 0.62);
      float rainK = clamp(uRainAmt, 0.0, 1.0);
      float curtainK = 1.0 - uCurtainAmt * 0.9;
      float gate = rainK * curtainK;

      // ------- rivulets: water follows a few vertical channels -------
      float col = floor(vUv.x * 20.0);
      float colR = hash11(col * 13.17);
      float xDist = abs(fract(vUv.x * 20.0 + 0.07 * sin(uTime * 0.4 + colR * 6.0)) - 0.5);
      float channel = smoothstep(0.16, 0.03, xDist);
      float run = fract(vUv.y * (0.55 + 0.35 * colR) - uTime * (0.11 + 0.22 * colR) * (0.65 + 0.7 * rainK));
      float slug = smoothstep(0.10, 0.0, abs(run - 0.78)) * (0.55 + 0.45 * rainK);
      float rivulet = channel * (0.22 + slug);

      // ------- two scales of voronoi drops (heads + trails) -------
      vec3 v0 = voronoiCell(uv * vec2(12.0, 6.2), uTime * (0.16 + 0.10 * rainK));
      vec3 v1 = voronoiCell(uv * vec2(24.0, 13.5) + 19.7, uTime * (0.24 + 0.12 * rainK));
      float head0 = smoothstep(0.16, 0.018, v0.x) * step(0.48, v0.y);
      float head1 = smoothstep(0.11, 0.010, v1.x) * step(0.55, v1.y);
      float trail0 = smoothstep(0.32, 0.03, v0.x) * step(0.48, v0.y) * 0.42;
      float trail1 = smoothstep(0.22, 0.02, v1.x) * step(0.55, v1.y) * 0.32;

      // fat, slower drops — fewer, with a bright meniscus ring
      vec3 v2 = voronoiCell(uv * vec2(6.5, 3.4) + 4.1, uTime * 0.09);
      float fatCore = smoothstep(0.22, 0.04, v2.x) * step(0.72, v2.y);
      float fatRim  = smoothstep(0.28, 0.18, v2.x) * smoothstep(0.10, 0.20, v2.x) * step(0.72, v2.y);

      float drops = head0 + head1 * 0.75 + trail0 + trail1 + fatCore * 1.15 + fatRim * 0.7 + rivulet;

      // ------- gust smear (more frequent when heavy) -------
      float gustPhase = uTime * (0.11 + 0.08 * rainK);
      float gust = smoothstep(0.90, 1.0, fract(gustPhase));
      float gustY = hash11(floor(gustPhase));
      float gustBand = smoothstep(0.055, 0.0, abs(vUv.y - gustY));
      float gustStreak = gust * gustBand * (0.40 + 0.25 * rainK);

      // ------- condensation + wet film -------
      float grazing = clamp(1.0 - max(dot(vViewDir, vWorldNormal), 0.0), 0.0, 1.0);
      float sillBand = (1.0 - smoothstep(0.0, 0.38, vUv.y)) * 0.75 + smoothstep(0.38, 0.08, vUv.y) * 0.4;
      float condense = sillBand * (0.40 + 0.60 * grazing) * uCondensation;
      float film = (0.06 + 0.10 * rainK) * (0.45 + 0.55 * grazing);

      drops *= gate;
      gustStreak *= gate;
      film *= curtainK;
      condense *= 0.60 + 0.40 * rainK;

      vec3 dropCol = uTint * (1.35 + drops * 0.55);
      vec3 condCol = vec3(0.86, 0.93, 1.06);
      vec3 filmCol = vec3(0.72, 0.82, 0.95);

      float wetA  = drops + gustStreak;
      float condA = condense * 0.58;
      vec3  rgb   = dropCol * wetA + condCol * condA + filmCol * film;
      float alpha = clamp(wetA * 0.97 + condA + film, 0.0, 0.92);

      float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
      rgb = mix(rgb, vec3(lum), 0.28 * wetA);

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
      const k = level01 < 0.001 ? 0 : Math.min(1.0, 0.50 + 0.50 * Math.min(1, level01 / 1.9));
      uniforms.uRainAmt.value = k;
      // condensation persists even when rain dialled down — humid window
      uniforms.uCondensation.value = level01 < 0.001 ? 0.0 : 0.55 + 0.40 * Math.min(1, level01 / 1.9);
    },
    setCurtain: (k01) => {
      uniforms.uCurtainAmt.value = Math.max(0, Math.min(1, k01));
    },
    tick: (t) => { uniforms.uTime.value = t; },
  };
}
