import * as THREE from 'three';

// Dense neon-ad wall — covers a chunk of one interior wall with ~30 small
// glowing billboards in a packed-but-irregular grid. Matches the cozy
// cyberpunk-lounge reference photos where the lounge sits opposite (or
// adjacent to) a wall of small ads/screens.
//
// All panels share a small CanvasTexture per cell; ~30% of them get a
// per-second redraw to look "alive" (scrolling ticker / flickering hot deals).
// Static panels are drawn once and never touched again.
//
// Designed to drop into room.ts as one call: `buildAdWall({ ... }, group)`.

interface AdTemplate {
  bg: string;       // panel background fill
  accent: string;   // main neon glow + big text colour
  big: string;      // hero word (1-2 CJK chars or short kana / latin)
  small: string;    // sub-line
  style: 'block' | 'banner' | 'scan' | 'ticker' | 'glitch';
}

const TEMPLATES: AdTemplate[] = [
  { bg: '#160520', accent: '#ff2bdb', big: '夜貓',  small: 'NOODLE 24H',         style: 'block'  },
  { bg: '#02060c', accent: '#5af2ff', big: 'ORC-9', small: '腦插義體 0%',          style: 'banner' },
  { bg: '#1a0a0a', accent: '#ff8a3d', big: 'NEON',  small: 'COLA®',              style: 'block'  },
  { bg: '#0a1a0a', accent: '#39ff88', big: '駭客',  small: 'TOOLS / 工具',       style: 'banner' },
  { bg: '#2a0a3a', accent: '#b44dff', big: '夢',    small: 'DREAM CLINIC',        style: 'scan'   },
  { bg: '#0a1212', accent: '#ffe14d', big: '雨',    small: '雨夜計程車 24H',      style: 'block'  },
  { bg: '#16080a', accent: '#ff5566', big: 'BUY!',  small: '今日特價 -40%',       style: 'glitch' },
  { bg: '#020812', accent: '#88c8ff', big: '虹',    small: 'IRIS NEURAL',         style: 'scan'   },
  { bg: '#0c0408', accent: '#ff4499', big: 'NEKO',  small: 'CAT CAFÉ B1',         style: 'banner' },
  { bg: '#06141c', accent: '#5af2ff', big: '電子',  small: 'CYBER 義肢',           style: 'block'  },
  { bg: '#1a1006', accent: '#ffb050', big: '燒酒',  small: '夜九折',              style: 'block'  },
  { bg: '#04060a', accent: '#88ff88', big: 'V.N',   small: 'NETRUN OS 9.1',       style: 'ticker' },
  { bg: '#220414', accent: '#ff80c8', big: '舞',    small: 'NIGHT DANCE',         style: 'glitch' },
  { bg: '#0a0a12', accent: '#80ffff', big: 'HACK',  small: '駭入服務',             style: 'banner' },
  { bg: '#0c1004', accent: '#aaff44', big: '麵',    small: 'RAMEN 拉麵',          style: 'block'  },
  { bg: '#160808', accent: '#ff6644', big: 'SUSHI', small: '回轉壽司',             style: 'block'  },
];

// drawing helpers per style — kept inline so the whole module stays self-
// contained and Vite can tree-shake unused branches easily.
function drawBlock(g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number): void {
  g.fillStyle = t.bg; g.fillRect(0, 0, w, h);
  // glow border
  g.strokeStyle = t.accent;
  g.lineWidth = 2;
  g.shadowColor = t.accent; g.shadowBlur = 10;
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
  g.shadowBlur = 0;
  // big hero text
  g.fillStyle = t.accent;
  const big = Math.floor(h * 0.45);
  g.font = `bold ${big}px "Orbitron", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = t.accent; g.shadowBlur = 14;
  g.fillText(t.big, w / 2, h * 0.42);
  g.shadowBlur = 0;
  // sub-line
  g.fillStyle = '#d8eaff';
  g.font = `${Math.floor(h * 0.16)}px "Share Tech Mono", monospace`;
  g.fillText(t.small, w / 2, h * 0.78);
  // scanlines
  g.fillStyle = 'rgba(0,0,0,.30)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
}

function drawBanner(g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number): void {
  // gradient background
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, t.bg);
  grd.addColorStop(0.5, t.accent + '55');
  grd.addColorStop(1, t.bg);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = t.accent;
  g.lineWidth = 1.5;
  g.strokeRect(1, 1, w - 2, h - 2);
  // big text shifted left
  g.fillStyle = t.accent;
  const big = Math.floor(h * 0.55);
  g.font = `bold ${big}px "Orbitron", sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.shadowColor = t.accent; g.shadowBlur = 16;
  g.fillText(t.big, w * 0.08, h * 0.45);
  g.shadowBlur = 0;
  g.fillStyle = '#d8eaff';
  g.font = `${Math.floor(h * 0.18)}px "Share Tech Mono", monospace`;
  g.fillText(t.small, w * 0.08, h * 0.80);
}

function drawScan(g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number): void {
  drawBlock(g, t, w, h, time);
  // overlay: moving scan band
  const y = ((time * 35) % (h + 30)) - 15;
  const grd = g.createLinearGradient(0, y - 20, 0, y + 20);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, t.accent + 'aa');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, y - 20, w, 40);
}

function drawTicker(g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number): void {
  g.fillStyle = t.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = t.accent;
  g.lineWidth = 1.5;
  g.strokeRect(1, 1, w - 2, h - 2);
  // big label up top
  g.fillStyle = t.accent;
  g.font = `bold ${Math.floor(h * 0.35)}px "Orbitron", sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText(t.big, 6, 4);
  // ticker scroll
  const tickText = `${t.small}  ·  ↑12.4%  ·  ${t.big}NET  ·  系統正常  ·  `;
  const fullText = tickText.repeat(4);
  const tickFont = `${Math.floor(h * 0.24)}px "Share Tech Mono", monospace`;
  g.font = tickFont;
  g.textBaseline = 'middle';
  g.fillStyle = '#a8e0ff';
  const offset = (time * 22) % (g.measureText(tickText).width);
  g.fillText(fullText, w - offset, h * 0.80);
}

function drawGlitch(g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number): void {
  drawBlock(g, t, w, h, time);
  // random horizontal slice offset
  if (Math.sin(time * 7) > 0.6) {
    const sliceY = Math.floor((Math.sin(time * 13) * 0.5 + 0.5) * h);
    const sliceH = Math.floor(h * 0.15);
    const slice = g.getImageData(0, sliceY, w, sliceH);
    g.putImageData(slice, Math.sin(time * 17) * 6, sliceY);
  }
  // colour split flash
  if (Math.sin(time * 5.3) > 0.85) {
    g.fillStyle = 'rgba(255, 80, 200, 0.18)';
    g.fillRect(0, 0, w, h);
  }
}

const DRAWERS: Record<AdTemplate['style'],
  (g: CanvasRenderingContext2D, t: AdTemplate, w: number, h: number, time: number) => void> = {
  block: drawBlock, banner: drawBanner, scan: drawScan,
  ticker: drawTicker, glitch: drawGlitch,
};

interface Panel {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  template: AdTemplate;
  w: number; h: number;
  /** Static panels never redraw; animated ones tick. */
  animated: boolean;
  /** Stagger animated redraws so they don't all paint on the same frame. */
  phase: number;
}

export interface AdWall {
  group: THREE.Group;
  /** call from animation loop — cheap, only ~6 panels animate */
  update: (t: number) => void;
  /** total panel count */
  count: number;
}

export interface AdWallOpts {
  /** wall surface coordinate on the perpendicular axis */
  x: number;
  /** which way panels face. -1 means normal points to -x (into the room from east wall). */
  facingX: -1 | 1;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
  cols?: number;
  rows?: number;
  /** 0..1 — fraction of cells deliberately left empty for breathing room */
  gapRate?: number;
  /** 0..1 — fraction of panels with per-frame animation. Higher = livelier but more canvas paint cost. */
  animatedRate?: number;
  /** rng seed so re-builds are deterministic per session */
  seed?: number;
}

export function buildAdWall(opts: AdWallOpts): AdWall {
  const cols = opts.cols ?? 8;
  const rows = opts.rows ?? 5;
  const gapRate = opts.gapRate ?? 0.18;
  const animatedRate = opts.animatedRate ?? 0.22;
  const wallW = opts.zMax - opts.zMin;
  const wallH = opts.yMax - opts.yMin;
  const cellW = wallW / cols;
  const cellH = wallH / rows;

  // small deterministic-ish RNG (mulberry32) so the wall looks the same on
  // every page load — otherwise the layout would jitter on each HMR reload
  // and that's distracting when iterating on the surrounding decor
  let seed = opts.seed ?? 0xc0ffee;
  const rng = (): number => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const group = new THREE.Group();
  group.name = 'AdWall';
  const panels: Panel[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < gapRate) continue;
      // panel size: jitter within cell + occasional 2-cell merges for variety
      const padW = cellW * (0.04 + rng() * 0.10);
      const padH = cellH * (0.04 + rng() * 0.10);
      let panelW = cellW - padW * 2;
      let panelH = cellH - padH * 2;
      // ~15% chance to make a "double-wide" banner; only if column has space
      if (c < cols - 1 && rng() < 0.12) panelW = cellW * 1.85 - padW * 2;

      const template = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
      // canvas resolution scaled to panel aspect — keep base 192px wide
      const canvasW = 192;
      const canvasH = Math.max(48, Math.floor(canvasW * panelH / panelW));
      const canvas = document.createElement('canvas');
      canvas.width = canvasW; canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;

      // initial paint
      DRAWERS[template.style](ctx, template, canvasW, canvasH, 0);

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        transparent: false,
      });
      // PlaneGeometry default: width along x, height along y, normal +z.
      // We want normal along -x (or +x per opts.facingX); rotate around Y.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), mat);
      mesh.rotation.y = opts.facingX === -1 ? -Math.PI / 2 : Math.PI / 2;
      // map plane local-x onto scene z
      const zCenter = opts.zMin + c * cellW + cellW / 2 + (panelW - (cellW - padW * 2)) / 2;
      const yCenter = opts.yMin + r * cellH + cellH / 2;
      mesh.position.set(opts.x, yCenter, zCenter);

      group.add(mesh);
      const animated = template.style === 'ticker' || template.style === 'scan'
        || (template.style === 'glitch') || rng() < animatedRate;
      panels.push({
        mesh, canvas, ctx, tex, template,
        w: canvasW, h: canvasH, animated,
        phase: rng() * 6,    // 0-6 second offset
      });
    }
  }

  // mild thick frame behind everything — gives the wall as a whole some
  // backing so panel gaps don't show the bare wall mat
  const backerW = wallW + 0.05;
  const backerH = wallH + 0.05;
  const backer = new THREE.Mesh(
    new THREE.PlaneGeometry(backerW, backerH),
    new THREE.MeshStandardMaterial({
      color: 0x05060a, emissive: 0x0a0610, emissiveIntensity: 0.5,
      roughness: 0.6, metalness: 0.4,
    }),
  );
  backer.rotation.y = opts.facingX === -1 ? -Math.PI / 2 : Math.PI / 2;
  // backer must be FURTHER from the viewer than the panels (deeper into wall),
  // not closer — otherwise it occludes them. Viewer sits on the side the
  // facingX vector points to, so the backer goes in the opposite direction.
  backer.position.set(opts.x - 0.006 * opts.facingX, (opts.yMin + opts.yMax) / 2, (opts.zMin + opts.zMax) / 2);
  group.add(backer);

  const update = (t: number): void => {
    for (const p of panels) {
      if (!p.animated) continue;
      // throttle: each animated panel repaints ~6 fps
      const k = (t + p.phase) % (1 / 6);
      if (k > 0.04) continue;
      DRAWERS[p.template.style](p.ctx, p.template, p.w, p.h, t + p.phase);
      p.tex.needsUpdate = true;
    }
  };

  return { group, update, count: panels.length };
}
