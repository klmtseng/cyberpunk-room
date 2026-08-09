/**
 * ts-loader.mjs — custom ESM loader that resolves extension-less TypeScript
 * imports (e.g. '../world/room' → '../world/room.ts').
 *
 * Only active when passed via  --loader tools/gate/ts-loader.mjs.
 * Package imports (no leading '.') and imports that already have an extension
 * are passed through unchanged.
 *
 * Note: --experimental-loader is stable enough for gate use; the warning
 * about preferring register() is cosmetic and does not affect correctness.
 */

export async function resolve(specifier, context, nextResolve) {
  // Stub .glsl imports — the file doesn't need to exist on disk; load() below
  // returns a synthetic ES module.
  if (specifier.endsWith('.glsl')) {
    return {
      url: new URL(specifier, context.parentURL).href,
      shortCircuit: true,
    };
  }

  // Only rewrite relative imports without an extension
  const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
  const hasExt = /\.\w+$/.test(specifier);

  if (isRelative && !hasExt) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      // Fall through — let Node report the real error
    }
  }

  return nextResolve(specifier, context);
}

// Intercept .glsl file imports and return an empty stub so room.ts can load
// without the actual GLSL shader source.  The audit only reads mesh positions;
// shader code has no effect on geometry.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.glsl')) {
    // Stub: export a dummy material factory that returns a MeshBasicMaterial
    return {
      format: 'module',
      source: `
        import * as THREE from 'three';
        export function buildWindowRainMaterial() {
          const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
          return {
            material: mat,
            setTime: () => {},
            setRainIntensity: () => {},
            dispose: () => {},
          };
        }
      `,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}

