import * as THREE from 'three';

// Top-down "floor plan" overlay drawn on a 2D canvas. Sits inside #hud and is
// toggled via the `plan` term command (or the P key). Purely additive — never
// touches the 3D camera, composer, or any other game state. Following the
// project's existing pattern for #toast / #lockhint overlays.
//
// Data source: traverses the same `room.group` / `props.group` graphs that
// `window.neon.audit()` walks (main.ts:956). We build a flat list of bounding
// boxes once on enable; only the player triangle redraws each frame.

type Category = 'wall' | 'furniture' | 'interactive' | 'pickable' | 'prop';

interface PlanItem {
  name: string;
  category: Category;
  // axis-aligned top-down footprint in world coords (XZ plane)
  x0: number; z0: number; x1: number; z1: number;
  yTop: number;          // for filtering "too high" stuff (ceiling fixtures)
}

const CATEGORY_STYLE: Record<Category, { stroke: string; fill: string; label: string }> = {
  wall:        { stroke: 'rgba(180,200,230,0.85)', fill: 'rgba(150,170,200,0.30)', label: '#dde8ff' },
  furniture:   { stroke: 'rgba(90,180,255,0.85)',  fill: 'rgba(90,180,255,0.18)',  label: '#5af2ff' },
  interactive: { stroke: 'rgba(90,255,180,0.85)',  fill: 'rgba(90,255,180,0.18)',  label: '#39ff88' },
  pickable:    { stroke: 'rgba(255,80,210,0.85)',  fill: 'rgba(255,80,210,0.22)',  label: '#ff2bdb' },
  prop:        { stroke: 'rgba(180,180,210,0.6)',  fill: 'rgba(150,150,180,0.10)',  label: '#a0a8c0' },
};

// rough rule of thumb: which mesh names belong to which category. Falls back
// to 'prop' for anything tiny+unnamed. The big interactive proxies in the
// scene already use suffix conventions like *Proxy / *Hit which we exploit.
const INTERACTIVE_HINTS = ['Proxy', 'Hit', 'Keypad', 'Door', 'StarProjector', 'FlipMosaic', 'FridgeDoor', 'Monitor', 'Wardrobe', 'Cat'];
const PICKABLE_HINTS = ['Mug', 'Noodle', 'Bottle', 'Shard', 'DataShard', 'CoffeeMug', 'NoodleCup'];
const WALL_HINTS = ['Wall', 'Slab', 'Floor', 'Ceiling'];

function categoryFor(mesh: THREE.Mesh, sizeX: number, sizeZ: number, yMin: number): Category {
  const n = mesh.name || '';
  for (const h of WALL_HINTS) if (n.includes(h)) return 'wall';
  for (const h of PICKABLE_HINTS) if (n.includes(h)) return 'pickable';
  for (const h of INTERACTIVE_HINTS) if (n.includes(h)) return 'interactive';
  // very flat objects on the floor are usually rugs / pads → prop
  // medium-sized objects are furniture
  const area = sizeX * sizeZ;
  if (area > 0.4 && yMin < 1.2) return 'furniture';
  return 'prop';
}

export interface FloorPlanOpts {
  canvas: HTMLCanvasElement;
  worldGroups: THREE.Object3D[];
  /** room footprint for fitting the view (metres) */
  width: number;
  depth: number;
}

export class FloorPlan {
  private items: PlanItem[] = [];
  private ctx: CanvasRenderingContext2D;
  private active = false;
  private dirty = true;

  constructor(private opts: FloorPlanOpts) {
    const c = opts.canvas;
    const g = c.getContext('2d');
    if (!g) throw new Error('floor-plan: 2D context unavailable');
    this.ctx = g;
    window.addEventListener('resize', () => { this.dirty = true; });
  }

  get isOn(): boolean { return this.active; }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.opts.canvas.classList.remove('gone');
    this.opts.canvas.classList.add('on');
    this.rebuildItems();
    this.dirty = true;
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.opts.canvas.classList.add('gone');
    this.opts.canvas.classList.remove('on');
  }

  toggle(): boolean {
    if (this.active) this.disable(); else this.enable();
    return this.active;
  }

  /** Re-scan the scene graphs. Called on enable, or via `rebuild()` if scene mutates significantly. */
  rebuildItems(): void {
    this.items.length = 0;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    for (const grp of this.opts.worldGroups) {
      grp.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        box.setFromObject(m);
        if (!isFinite(box.min.x)) return;
        box.getSize(size);
        // skip things that are too small to label (decorative dust)
        // OR too tall+thin (rails, strips) — they clutter the map
        const footprint = size.x * size.z;
        if (footprint < 0.005) return;
        if (size.y > 1 && Math.max(size.x, size.z) < 0.08) return;
        // skip ceiling-only fixtures (above 5m) so the map doesn't drown in lights
        if (box.min.y > 4.5) return;
        const name = m.name || `${m.geometry?.type ?? 'Mesh'}`;
        const cat = categoryFor(m, size.x, size.z, box.min.y);
        this.items.push({
          name, category: cat,
          x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z,
          yTop: box.max.y,
        });
      });
    }
    // sort: walls back, then furniture, then interactive, then pickables, then props
    const order: Record<Category, number> = { wall: 0, furniture: 1, prop: 2, interactive: 3, pickable: 4 };
    this.items.sort((a, b) => order[a.category] - order[b.category]);
  }

  /** Per-frame draw. Cheap because everything except the player triangle is cached. */
  renderFrame(camera: THREE.Camera): void {
    if (!this.active) return;
    try {
      this.draw(camera);
    } catch (err) {
      // safety: never let plan view drag down the 3D pipeline
      console.warn('[plan-view] draw failed, disabling:', err);
      this.disable();
    }
  }

  private draw(camera: THREE.Camera): void {
    const c = this.opts.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth || window.innerWidth;
    const ch = c.clientHeight || window.innerHeight;
    if (c.width !== cw * dpr || c.height !== ch * dpr || this.dirty) {
      c.width = cw * dpr; c.height = ch * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dirty = false;
    }
    const g = this.ctx;
    g.clearRect(0, 0, cw, ch);

    // ---- viewport math: fit the room into the canvas with padding ----
    const PAD = 80;
    const usableW = cw - PAD * 2;
    const usableH = ch - PAD * 2 - 60;   // leave room for top legend bar
    const scale = Math.min(usableW / this.opts.width, usableH / this.opts.depth);
    const offX = cw / 2;
    const offY = (ch + 60) / 2;   // shift down a bit to clear the legend
    // map world (x, z) → canvas (px, py). +x → right, +z → down (top-down floor plan).
    const px = (x: number): number => offX + x * scale;
    const py = (z: number): number => offY + z * scale;

    // ---- top legend bar ----
    g.fillStyle = 'rgba(8,12,28,0.85)';
    g.fillRect(0, 0, cw, 56);
    g.font = '13px "Share Tech Mono", monospace';
    g.fillStyle = '#5af2ff';
    g.shadowColor = '#5af2ff'; g.shadowBlur = 8;
    g.fillText('FLOOR PLAN ▸ NEON LOFT', 18, 22);
    g.shadowBlur = 0;
    g.fillStyle = '#a0c8ff'; g.font = '11px "Share Tech Mono", monospace';
    g.fillText(`房間 ${this.opts.width.toFixed(1)}m × ${this.opts.depth.toFixed(1)}m  ·  顯示物件 ${this.items.length} 件  ·  P 或 term plan 切回 3D`, 18, 40);
    // legend chips
    const chipCats: Category[] = ['wall', 'furniture', 'interactive', 'pickable', 'prop'];
    const chipLabels: Record<Category, string> = {
      wall: '牆/結構', furniture: '家具', interactive: '可互動', pickable: '可拿取', prop: '雜物',
    };
    let chipX = cw - 18;
    for (let i = chipCats.length - 1; i >= 0; i--) {
      const cat = chipCats[i];
      const style = CATEGORY_STYLE[cat];
      const label = chipLabels[cat];
      g.font = '11px "Share Tech Mono", monospace';
      const w = g.measureText(label).width + 26;
      chipX -= w + 8;
      g.fillStyle = style.fill;
      g.strokeStyle = style.stroke;
      g.lineWidth = 1;
      g.fillRect(chipX, 14, w, 24);
      g.strokeRect(chipX + 0.5, 14.5, w - 1, 23);
      g.fillStyle = style.label;
      g.fillText(label, chipX + 22, 30);
      g.fillRect(chipX + 8, 21, 10, 10);
    }

    // ---- grid ----
    g.strokeStyle = 'rgba(80,140,200,0.10)';
    g.lineWidth = 1;
    const halfW = this.opts.width / 2, halfD = this.opts.depth / 2;
    g.beginPath();
    for (let x = -halfW; x <= halfW + 0.001; x += 0.5) {
      const X = px(x);
      g.moveTo(X, py(-halfD)); g.lineTo(X, py(halfD));
    }
    for (let z = -halfD; z <= halfD + 0.001; z += 0.5) {
      const Z = py(z);
      g.moveTo(px(-halfW), Z); g.lineTo(px(halfW), Z);
    }
    g.stroke();
    // bolder grid every 2m
    g.strokeStyle = 'rgba(120,200,255,0.22)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = -halfW; x <= halfW + 0.001; x += 2) {
      const X = px(x);
      g.moveTo(X, py(-halfD)); g.lineTo(X, py(halfD));
    }
    for (let z = -halfD; z <= halfD + 0.001; z += 2) {
      const Z = py(z);
      g.moveTo(px(-halfW), Z); g.lineTo(px(halfW), Z);
    }
    g.stroke();

    // ---- room outline ----
    g.strokeStyle = 'rgba(200,230,255,0.85)';
    g.lineWidth = 2;
    g.strokeRect(
      px(-halfW), py(-halfD),
      (halfW - -halfW) * scale, (halfD - -halfD) * scale,
    );

    // ---- compass + scale bar ----
    g.fillStyle = '#5af2ff'; g.font = '11px "Share Tech Mono", monospace';
    g.fillText('+X →', cw - 80, ch - 18);
    g.save();
    g.translate(20, ch - 18);
    g.fillText('+Z ↓', 0, 0);
    g.restore();
    // 1m scale bar
    const sbX = 20, sbY = ch - 38;
    g.strokeStyle = '#5af2ff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sbX, sbY); g.lineTo(sbX + scale, sbY); g.stroke();
    g.fillText('1m', sbX + scale + 6, sbY + 4);

    // ---- items ----
    g.lineWidth = 1.2;
    g.font = '11px "Rajdhani", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const it of this.items) {
      const style = CATEGORY_STYLE[it.category];
      const x = px(it.x0), y = py(it.z0);
      const w = (it.x1 - it.x0) * scale;
      const h = (it.z1 - it.z0) * scale;
      g.fillStyle = style.fill;
      g.strokeStyle = style.stroke;
      g.fillRect(x, y, w, h);
      g.strokeRect(x, y, w, h);
      // only label if rect is big enough to fit it
      if (w > 36 && h > 14 && it.name.length < 22) {
        g.fillStyle = style.label;
        g.fillText(it.name, x + w / 2, y + h / 2);
      }
    }

    // ---- player triangle ----
    const cx = px(camera.position.x);
    const cz = py(camera.position.z);
    // derive yaw from camera quaternion (PerspectiveCamera convention)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    g.save();
    g.translate(cx, cz);
    g.rotate(yaw);    // top-down: +z is down on canvas, matches our py() mapping
    g.fillStyle = 'rgba(255,80,210,0.95)';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(8, 8);
    g.lineTo(-8, 8);
    g.closePath();
    g.fill(); g.stroke();
    // small dot at exact position
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(0, 0, 2, 0, Math.PI * 2); g.fill();
    g.restore();

    // pose readout
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '11px "Share Tech Mono", monospace';
    g.fillStyle = '#ff2bdb';
    g.fillText(
      `PLAYER  x=${camera.position.x.toFixed(2)}  z=${camera.position.z.toFixed(2)}  yaw=${yaw.toFixed(2)}`,
      cw - 320, ch - 18,
    );
  }
}
