export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  preset: QualityPreset;
  rainCount: number;
  shadowMapSize: number;
  enableShadows: boolean;
  enableBloom: boolean;
  enableChromaticAberration: boolean;
  /** Reserved for a future SSR pass — only the Ultra preset sets this true.
   *  No active consumer yet; the `postprocessing` library on which the rest
   *  of the pipeline is built does not ship SSR, and wiring `three/addons/
   *  postprocessing/SSRPass` would require migrating to three.js's own
   *  EffectComposer. Picked up when we have RTX hardware to test on. */
  enableSSR: boolean;
  enablePlanarReflection: boolean;
  pixelRatio: number;
  buildingCount: number;
  vehicleCount: number;
  // W5 photoreal additions
  windowRainShader: boolean;     // streaks + condensation on the window glass
  windowRainRefraction: boolean; // reserved: sample-and-displace city behind drops (ultra only)
  enableWetCity: boolean;        // Reflector under city + bright avenue streaks in street texture
  volumetricSources: number;     // god-ray pass source count (0 disables)
  volumetricSamples: number;     // per-source radial samples
  enableDOF: boolean;            // bokeh pass available; enabled by cinema mode (always-on at ultra)
}

export interface HardwareInfo {
  gpuVendor: string;
  gpuArchitecture: string;
  webgpuAvailable: boolean;
  deviceMemoryGB: number;
  cores: number;
}

const PRESETS: Record<QualityPreset, Omit<QualitySettings, 'preset'>> = {
  ultra: {
    rainCount: 30000, shadowMapSize: 4096, enableShadows: true,
    enableBloom: true, enableChromaticAberration: true,
    enableSSR: true, enablePlanarReflection: true, pixelRatio: 1.5,
    buildingCount: 900, vehicleCount: 100,
    windowRainShader: true, windowRainRefraction: true,
    enableWetCity: true, volumetricSources: 3, volumetricSamples: 64,
    enableDOF: true,
  },
  high: {
    rainCount: 10000, shadowMapSize: 1024, enableShadows: true,
    enableBloom: true, enableChromaticAberration: true,
    enableSSR: false, enablePlanarReflection: true, pixelRatio: 1.0,
    buildingCount: 650, vehicleCount: 75,
    windowRainShader: true, windowRainRefraction: false,
    enableWetCity: true, volumetricSources: 1, volumetricSamples: 16,
    enableDOF: true,
  },
  medium: {
    rainCount: 5000, shadowMapSize: 512, enableShadows: true,
    enableBloom: true, enableChromaticAberration: false,
    enableSSR: false, enablePlanarReflection: true, pixelRatio: 1.0,
    buildingCount: 420, vehicleCount: 55,
    windowRainShader: true, windowRainRefraction: false,
    enableWetCity: true, volumetricSources: 0, volumetricSamples: 0,
    enableDOF: true,
  },
  low: {
    rainCount: 1500, shadowMapSize: 0, enableShadows: false,
    enableBloom: true, enableChromaticAberration: false,
    enableSSR: false, enablePlanarReflection: false, pixelRatio: 0.62,
    buildingCount: 260, vehicleCount: 34,
    // glass shader runs (fragment-only on a single quad — free on iGPU)
    // but without refraction. Reflector + god-rays + DOF off for Low.
    windowRainShader: true, windowRainRefraction: false,
    enableWetCity: false, volumetricSources: 0, volumetricSamples: 0,
    enableDOF: false,
  },
};

export async function detectHardware(): Promise<HardwareInfo> {
  let gpuVendor = 'unknown';
  let gpuArchitecture = 'unknown';
  let webgpuAvailable = false;
  if ('gpu' in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        webgpuAvailable = true;
        const info = (adapter as any).info ?? (await (adapter as any).requestAdapterInfo?.());
        if (info) {
          gpuVendor = (info.vendor ?? 'unknown').toLowerCase();
          gpuArchitecture = (info.architecture ?? 'unknown').toLowerCase();
        }
      }
    } catch { /* WebGPU probe failed; fall back */ }
  }
  if (gpuVendor === 'unknown') {
    const probe = probeWebGLRenderer();
    gpuVendor = probe.vendor.toLowerCase();
    gpuArchitecture = probe.renderer.toLowerCase();
  }
  return {
    gpuVendor,
    gpuArchitecture,
    webgpuAvailable,
    deviceMemoryGB: (navigator as any).deviceMemory ?? 4,
    cores: navigator.hardwareConcurrency ?? 4,
  };
}

function probeWebGLRenderer(): { vendor: string; renderer: string } {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return { vendor: 'unknown', renderer: 'unknown' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (!dbg) return { vendor: 'unknown', renderer: 'unknown' };
  return {
    vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? ''),
    renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? ''),
  };
}

export function pickPreset(hw: HardwareInfo): QualityPreset {
  const sig = (hw.gpuVendor + ' ' + hw.gpuArchitecture).toLowerCase();
  const isIntelIGP = /intel/.test(sig) && /(hd|uhd|iris)/.test(sig);
  const isRTX = /(rtx|ada|ampere|turing)/.test(sig);
  const isModernNV = /nvidia|geforce/.test(sig);
  const isAppleSilicon = /apple/.test(sig) && /(m1|m2|m3|m4)/.test(sig);
  const isAMDDiscrete = /(radeon|amd)/.test(sig) && /(rx|navi|rdna)/.test(sig);
  if (isRTX && hw.webgpuAvailable && hw.deviceMemoryGB >= 8) return 'ultra';
  if (isModernNV || isAppleSilicon || isAMDDiscrete) return 'high';
  if (isIntelIGP || hw.deviceMemoryGB < 4) return 'low';
  return 'medium';
}

export function settingsFor(preset: QualityPreset): QualitySettings {
  return { preset, ...PRESETS[preset] };
}

const STORAGE_KEY = 'neonloft.quality';

export function loadOverride(): QualityPreset | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'low' || v === 'medium' || v === 'high' || v === 'ultra') return v;
  } catch { /* ignore */ }
  return null;
}

export function saveOverride(p: QualityPreset | null): void {
  try {
    if (p) localStorage.setItem(STORAGE_KEY, p);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
