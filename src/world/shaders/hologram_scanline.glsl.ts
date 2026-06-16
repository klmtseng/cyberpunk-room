import * as THREE from 'three';

// CRT-style scanline overlay for the holographic hero-tower front face.
// Mounted as a small Plane in front of the photo face (renderOrder 2 so it
// composites after the additive photo). Output alpha-blended darkening so
// the underlying photo's lit pixels punch through between scan rows —
// reads as a real CRT/projector grille rather than a flat photo.
//
// Layers in the fragment shader:
//   1. Horizontal scanlines (fine grid, ~280 cycles down the height)
//   2. Slow vertical roll undulation (very faint, 0.25Hz)
//   3. Periodic darker band sweep moving down the face (signal interlock)
//
// Uniforms:
//   uTime       — seconds, continuously
//   uIntensity  — 0..1, opacity of the scanline darkening
//   uScroll     — scanline scroll rate (radians/sec along Y)
//   uTint       — colour of the CRT phosphor (cyan-blue by default)

export interface ScanlineHandle {
  material: THREE.ShaderMaterial;
  tick: (t: number) => void;
}

export function buildScanlineMaterial(): ScanlineHandle {
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0.55 },
    uScroll: { value: 12.0 },
    uTint: { value: new THREE.Color(0x88c8ff) },
  };

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = /* glsl */ `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 vUv;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uScroll;
    uniform vec3  uTint;

    void main() {
      // 1) Fine horizontal scanlines (sin-modulated brightness band)
      float scan = 0.5 + 0.5 * sin(vUv.y * 280.0 - uTime * uScroll);
      // We want DARK lines, not bright — invert
      float scanDark = 1.0 - scan;

      // 2) Slow vertical roll (very faint waviness in lightness)
      float roll = 0.5 + 0.5 * sin(vUv.y * 3.5 - uTime * 0.25);

      // 3) Periodic wider sweep band (signal interlock); moves down at 0.16/s
      float sweepY = fract(vUv.y + uTime * 0.16);
      float sweep = smoothstep(0.93, 1.0, sweepY) * (1.0 - smoothstep(1.0, 1.04, sweepY));

      // Composite alpha: scanline grille is the main darkening, sweep is a
      // momentary brighter band that READS as scanning beam refresh
      float alpha = scanDark * 0.45 * uIntensity   // grille
                  + sweep * 0.35                    // sweep band
                  + (1.0 - roll) * 0.04;            // very faint roll undulation
      alpha = clamp(alpha, 0.0, 0.8);

      // Colour: phosphor blue, slightly warmer in the sweep band
      vec3 col = mix(vec3(0.0), uTint, sweep * 0.8 + 0.05);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
  material.name = 'HologramScanline';

  return {
    material,
    tick: (t) => { uniforms.uTime.value = t; },
  };
}
