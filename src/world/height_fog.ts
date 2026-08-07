import * as THREE from 'three';

// Capture stock three fog chunks before anything overwrites them.
// These are the verbatim strings shipped by three r170 and are what the scene
// falls back to when height-fog is disabled. Captured at module-init time so
// any import order is safe.
const STOCK_CHUNKS = {
  fog_pars_vertex:  THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex:       THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment:     THREE.ShaderChunk.fog_fragment,
} as const;

// ---------------------------------------------------------------------------
// Height-attenuated volumetric fog + aerial perspective.
//
// Replaces three's stock FogExp2 (uniform density everywhere) with a fog whose
// density decays exponentially with world height, integrated analytically along
// the view ray. Why: the vista is a 250m-deep street canyon seen from ~150m up.
// With uniform density the canyon floor and the tower tops are equally hazy, so
// the city reads as one flat painted card. With height falloff the street floor
// silts up with neon-lit smog while the tower tops stay crisp — that vertical
// gradient IS the depth cue.
//
// IMPLEMENTATION NOTE — global ShaderChunk override.
// We overwrite three's four fog chunks rather than patching materials one by
// one via onBeforeCompile. Consequence (intended): EVERY material with
// `fog: true` picks this up automatically — interior, city, signs — while the
// additive holograms and the sky backdrop shell (`fog: false`) are untouched.
//
// COORDINATE ANCHOR. Street level in this scene is GROUND_Y = -150 (see
// world/city.ts) and the loft sits at y ≈ +1.7, i.e. the camera is ~152m ABOVE
// the fog's dense layer. The falloff is therefore anchored at FOG_BASE_Y, not
// at y = 0; anchoring at 0 would place the room itself at the bottom of the
// smog column and grey out the entire interior.
//
// WORLD POSITION. We do not rely on three's `worldPosition`: it is only
// declared under specific defines (envmap / shadowmap / transmission / spot
// lights) so it cannot be assumed to exist. We recompute it from `transformed`,
// mirroring three's own worldpos_vertex chunk INCLUDING the batching and
// instancing matrices — the city's towers, signs, cars and pedestrians are all
// InstancedMesh, and skipping instanceMatrix would collapse every instance onto
// its prototype position near the origin and fog them all at street density.
// ---------------------------------------------------------------------------

/** Street level in world units (must match GROUND_Y in world/city.ts). */
export const FOG_BASE_Y = -150;

export interface HeightFogParams {
  /** Extinction coefficient at the base plane, per world unit. */
  density: number;
  /** Height falloff rate, per world unit. Larger = thinner layer hugging the base. */
  k: number;
  /** Near-field haze tint — neutral cool, must NOT carry city colour. */
  nearHaze: THREE.ColorRepresentation;
  /** Far-field glow tint — the city's own light pollution. */
  farGlow: THREE.ColorRepresentation;
  /** fogFactor at which inscatter starts blending toward farGlow. */
  glowStart: number;
  /** fogFactor at which inscatter is fully farGlow. */
  glowEnd: number;
  /** Height above base at which the upward inscatter dimming reaches its floor. */
  glowCeiling: number;
  /** Residual inscatter strength when looking well above the glow ceiling. */
  glowFloor: number;
}

// --- chosen values -------------------------------------------------------
// density 0.021: extinction at street level. Much higher than the old FogExp2
//   0.0058 because that constant applied everywhere, whereas this one applies
//   only at the very bottom of the column and decays away fast.
// k 0.016: e-folding height ~62m. Street canyon (bottom ~40m) sits deep in the
//   dense layer; the loft at +150m above base is at exp(-2.43) ≈ 8.8% density,
//   so the interior stays essentially clear.
// nearHaze 0x0c1224: deliberately the OLD fog colour — the cool near-black blue
//   the room was already tuned against, so interior surfaces do not shift.
// farGlow 0x6a4a72: desaturated purple-grey, the magenta 0xff2bdb and cyan
//   0x5af2ff mixed and heavily knocked down in saturation. Using the raw
//   magenta here turns the skyline into cotton candy.
// glowStart 0.12 / glowEnd 0.55: the city glow only appears once the ray is
//   already meaningfully fogged, i.e. past the room. Anything nearer sees pure
//   nearHaze. This split is what keeps the interior from being tinted.
//   These were originally 0.42/0.95, which was measured to be a dead setting:
//   the mid-distance towers that dominate the window reach fogFactor ≈ 0.51,
//   and smoothstep(0.42, 0.95, 0.51) ≈ 0.03 — then the altitude term below
//   knocks that down another 2.6×, leaving glowMix ≈ 0.035. So the aerial-
//   perspective half of this effect never ran, and the fog was doing pure
//   extinction toward a near-black haze (i.e. it just made the city dimmer).
//   At 0.12/0.55 the same towers land at glowMix ≈ 0.42 while a 4m interior
//   wall stays at exactly 0.000, because its fogFactor (0.007) is below
//   glowStart in both settings. The interior safety is structural, not tuned.
export const DEFAULT_PARAMS: HeightFogParams = {
  density: 0.021,
  k: 0.016,
  nearHaze: 0x0c1224,
  farGlow: 0x6a4a72,
  glowStart: 0.12,
  glowEnd: 0.55,
  glowCeiling: 190,
  glowFloor: 0.22,
};

/**
 * Optical depth along a ray, with density decaying exponentially in height.
 *
 *   density(y) = density0 * exp(-k * (y - baseY))
 *   tau = density0 * dist * (exp(-k*h0) - exp(-k*h1)) / (k * (h1 - h0))
 *
 * where h = y - baseY. As h1 → h0 the quotient is 0/0; the limit is
 * exp(-k*h0), giving the uniform-slab result density0 * dist * exp(-k*h0).
 * A horizontal view ray hits exactly that singularity, so it must be handled
 * explicitly or the whole frame goes NaN.
 *
 * This TypeScript copy exists so the numerical behaviour of the formula can be
 * unit-tested headlessly; see height_fog.test.ts.
 */
export function opticalDepth(
  dist: number, y0: number, y1: number,
  density: number, k: number, baseY: number = FOG_BASE_Y,
): number {
  const h0 = y0 - baseY;
  const h1 = y1 - baseY;
  const dh = h1 - h0;
  const e0 = Math.exp(-k * h0);
  // Threshold chosen so that the Taylor error of the degenerate branch stays
  // far below float32 precision: the next term is (k*dh/2), i.e. ~8e-6 relative
  // at dh = 1e-3, k = 0.016.
  if (Math.abs(k * dh) < 1e-4) return density * dist * e0;
  const e1 = Math.exp(-k * h1);
  return density * dist * (e0 - e1) / (k * dh);
}

function hex(c: THREE.ColorRepresentation): THREE.Color {
  return new THREE.Color(c);
}

function glsl(p: HeightFogParams): { parsVertex: string; vertex: string; parsFragment: string; fragment: string } {
  const near = hex(p.nearHaze), far = hex(p.farGlow);
  const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

  const parsVertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
#endif
`;

  // Mirrors three's worldpos_vertex transform chain so instanced/batched
  // geometry lands at its real world position.
  const vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vec4 fogWorldPos = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		fogWorldPos = batchingMatrix * fogWorldPos;
	#endif
	#ifdef USE_INSTANCING
		fogWorldPos = instanceMatrix * fogWorldPos;
	#endif
	fogWorldPos = modelMatrix * fogWorldPos;
	vFogWorldPos = fogWorldPos.xyz;
#endif
`;

  const parsFragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif

	const float HF_BASE_Y = ${f(FOG_BASE_Y)};
	const float HF_DENSITY = ${f(p.density)};
	const float HF_K = ${f(p.k)};
	const vec3  HF_NEAR_HAZE = vec3( ${near.r.toFixed(4)}, ${near.g.toFixed(4)}, ${near.b.toFixed(4)} );
	const vec3  HF_FAR_GLOW  = vec3( ${far.r.toFixed(4)}, ${far.g.toFixed(4)}, ${far.b.toFixed(4)} );
	const float HF_GLOW_START = ${f(p.glowStart)};
	const float HF_GLOW_END = ${f(p.glowEnd)};
	const float HF_GLOW_CEILING = ${f(p.glowCeiling)};
	const float HF_GLOW_FLOOR = ${f(p.glowFloor)};

	// Analytic integral of exp(-k*h) density along the ray. The degenerate
	// branch handles a horizontal ray (h1 == h0), which would otherwise be 0/0.
	float hfOpticalDepth( float dist, float h0, float h1 ) {
		float dh = h1 - h0;
		float e0 = exp( -HF_K * h0 );
		if ( abs( HF_K * dh ) < 1e-4 ) return HF_DENSITY * dist * e0;
		float e1 = exp( -HF_K * h1 );
		return HF_DENSITY * dist * ( e0 - e1 ) / ( HF_K * dh );
	}
#endif
`;

  const fragment = /* glsl */`
#ifdef USE_FOG
	float hfH0 = cameraPosition.y - HF_BASE_Y;
	float hfH1 = vFogWorldPos.y - HF_BASE_Y;
	float hfDist = length( vFogWorldPos - cameraPosition );
	float hfTau = hfOpticalDepth( hfDist, hfH0, hfH1 );
	float fogFactor = 1.0 - exp( - max( hfTau, 0.0 ) );
	fogFactor = clamp( fogFactor, 0.0, 1.0 );

	// Inscatter colour. Near field is pure neutral haze; the city's own light
	// pollution only bleeds in once the ray is already deeply fogged. Without
	// this split the magenta skyline glow would wash over the furniture two
	// metres from the camera.
	float hfGlowMix = smoothstep( HF_GLOW_START, HF_GLOW_END, fogFactor );

	// Looking upward there is no street below the sightline to scatter light,
	// so the glow fades out with the height of the midpoint of the ray.
	float hfMidH = max( 0.5 * ( hfH0 + hfH1 ), 0.0 );
	float hfAlt = 1.0 - smoothstep( 0.0, HF_GLOW_CEILING, hfMidH );
	hfGlowMix *= mix( HF_GLOW_FLOOR, 1.0, hfAlt );

	vec3 hfInscatter = mix( HF_NEAR_HAZE, HF_FAR_GLOW, clamp( hfGlowMix, 0.0, 1.0 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, hfInscatter, fogFactor );
#endif
`;

  return { parsVertex, vertex, parsFragment, fragment };
}

let installed = false;

/** Trigger needsUpdate on all fog-enabled materials in the scene. */
function invalidateFogMaterials(scene: THREE.Scene): void {
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if ((mat as THREE.Material & { fog?: boolean }).fog) mat.needsUpdate = true;
    }
  });
}

/**
 * Overwrite three's fog chunks with the height-fog implementation and force a
 * recompile of every fog-enabled material already in the scene.
 *
 * Call with no scene at module init for the default look; call again with a
 * scene from the dev console to retune live.
 */
export function configureHeightFog(
  params: Partial<HeightFogParams> = {},
  scene?: THREE.Scene,
): HeightFogParams {
  const merged: HeightFogParams = { ...DEFAULT_PARAMS, ...params };
  const chunks = glsl(merged);

  THREE.ShaderChunk.fog_pars_vertex = chunks.parsVertex;
  THREE.ShaderChunk.fog_vertex = chunks.vertex;
  THREE.ShaderChunk.fog_pars_fragment = chunks.parsFragment;
  THREE.ShaderChunk.fog_fragment = chunks.fragment;
  installed = true;

  if (scene) invalidateFogMaterials(scene);
  return merged;
}

/**
 * Enable or disable the height-fog shader override.
 *
 * When enabled, behaves identically to `configureHeightFog(params, scene)`.
 * When disabled, restores three's stock fog ShaderChunks (the ones captured at
 * module import time), making the scene visually identical to the pre-height-fog
 * state (stock FogExp2 + ACES tonemapping). The FogExp2 object on the scene is
 * left untouched in both cases; it is still needed to activate USE_FOG.
 */
export function setHeightFogEnabled(
  enabled: boolean,
  scene?: THREE.Scene,
  params?: Partial<HeightFogParams>,
): void {
  if (enabled) {
    configureHeightFog(params ?? {}, scene);
  } else {
    THREE.ShaderChunk.fog_pars_vertex  = STOCK_CHUNKS.fog_pars_vertex;
    THREE.ShaderChunk.fog_vertex       = STOCK_CHUNKS.fog_vertex;
    THREE.ShaderChunk.fog_pars_fragment = STOCK_CHUNKS.fog_pars_fragment;
    THREE.ShaderChunk.fog_fragment     = STOCK_CHUNKS.fog_fragment;
    installed = false;

    if (scene) invalidateFogMaterials(scene);
  }
}

/** Returns true only while the height-fog chunks are actually installed. */
export function isHeightFogInstalled(): boolean {
  return installed;
}

/** Expose stock chunks so tests can verify byte-exact restoration. */
export const _STOCK_CHUNKS_FOR_TEST = STOCK_CHUNKS;
