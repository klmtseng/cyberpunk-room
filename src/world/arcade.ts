import * as THREE from 'three';

// HOLO-ARCADE: a single cabinet whose shell is a hologram (additive edges +
// translucent panels) but whose screen plays like a real arcade — neon
// Breakout. A/D move, E/ESC leaves the machine.

const W = 240, H = 300;          // screen canvas
const PADDLE_W = 46, PADDLE_H = 7, BALL_R = 4;

export class HoloArcade {
  readonly group = new THREE.Group();
  readonly screen: THREE.Mesh;
  readonly shell: THREE.Mesh;     // interact target (panels)
  isActive = false;
  onClose: (() => void) | null = null;

  private can = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private flickMats: THREE.Material[] = [];

  private state: 'attract' | 'play' | 'over' = 'attract';
  private px = W / 2;             // paddle center
  private keys = { left: false, right: false };
  private ball = { x: W / 2, y: H - 60, vx: 70, vy: -95 };
  private bricks: boolean[] = [];
  private score = 0;
  private lives = 3;
  private level = 1;
  private best = Number(localStorage.getItem('neonloft.arcade.best') ?? 0);
  private drawTimer = 0;

  constructor(pos: THREE.Vector3, ry: number, private beep: (f: number) => void) {
    this.can.width = W;
    this.can.height = H;
    this.g = this.can.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.can);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;   // crunchy arcade pixels

    const holo = (color: number, opacity: number) => {
      const m = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      this.flickMats.push(m);
      return m;
    };
    // projection base on the floor
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.56, 0.05, 20),
      new THREE.MeshStandardMaterial({ color: 0x0c0f18, metalness: 0.8, roughness: 0.3 }),
    );
    base.position.y = 0.025;
    this.group.add(base);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.018, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x5af2ff, emissiveIntensity: 2.2 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    this.group.add(ring);
    // holographic cabinet: edge skeleton + ghost panels
    const cab = new THREE.BoxGeometry(0.92, 1.85, 0.78);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cab),
      new THREE.LineBasicMaterial({
        color: 0x5af2ff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    edges.position.y = 0.985;
    this.group.add(edges);
    this.flickMats.push(edges.material as THREE.Material);
    this.shell = new THREE.Mesh(cab, holo(0xff2bdb, 0.06));
    this.shell.position.y = 0.985;
    this.shell.name = 'HoloArcade';
    this.group.add(this.shell);
    // control deck hologram + buttons
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.3), holo(0x5af2ff, 0.18));
    deck.position.set(0, 1.02, 0.46);
    deck.rotation.x = -0.25;
    this.group.add(deck);
    for (const bx of [-0.12, 0.12]) {
      const btn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10),
        new THREE.MeshBasicMaterial({ color: bx < 0 ? 0xff2bdb : 0x39ff88 }),
      );
      btn.position.set(bx, 1.06, 0.5);
      btn.rotation.x = -0.25;
      this.group.add(btn);
    }
    // the real screen (solid, like an actual tube in the hologram)
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.7),
      new THREE.MeshStandardMaterial({
        color: 0x02030a, emissive: 0xffffff, emissiveIntensity: 0.95, emissiveMap: this.tex,
      }),
    );
    this.screen.position.set(0, 1.42, 0.345);
    this.screen.rotation.x = -0.1;
    this.screen.name = 'ArcadeScreen';
    this.group.add(this.screen);

    this.group.position.copy(pos);
    this.group.rotation.y = ry;

    window.addEventListener('keydown', (e) => {
      if (!this.isActive) return;
      e.stopPropagation();
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = true;
      if (e.code === 'KeyE' || e.code === 'Escape') this.stop();
      if (e.code === 'Space' && this.state === 'over') this.reset(true);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = false;
    });
    this.reset(true);
    this.state = 'attract';
  }

  start(): void {
    this.isActive = true;
    this.reset(true);
    this.state = 'play';
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.state = 'attract';
    this.onClose?.();
  }

  private reset(full: boolean): void {
    if (full) { this.score = 0; this.lives = 3; this.level = 1; }
    this.px = W / 2;
    this.ball = { x: W / 2, y: H - 60, vx: 70 * (Math.random() > 0.5 ? 1 : -1), vy: -95 };
    const speed = 1 + (this.level - 1) * 0.15;
    this.ball.vx *= speed;
    this.ball.vy *= speed;
    this.bricks = new Array(6 * 8).fill(true);
    if (full) this.state = 'play';
  }

  update(t: number, dt: number): void {
    // hologram instability
    const flick = 0.75 + 0.18 * Math.sin(t * 21) + 0.07 * Math.sin(t * 6.3);
    for (const m of this.flickMats) {
      const base = (m as THREE.MeshBasicMaterial);
      base.opacity = (base.color.getHex() === 0xff2bdb ? 0.06 : base instanceof THREE.LineBasicMaterial ? 0.85 : 0.18) * flick;
    }
    if (this.state === 'play' && this.isActive) this.step(Math.min(dt, 0.033));
    this.drawTimer += dt;
    if (this.drawTimer > (this.state === 'play' ? 0.033 : 0.25)) {
      this.drawTimer = 0;
      this.draw(t);
    }
  }

  private step(dt: number): void {
    const PSPEED = 180;
    if (this.keys.left) this.px = Math.max(PADDLE_W / 2, this.px - PSPEED * dt);
    if (this.keys.right) this.px = Math.min(W - PADDLE_W / 2, this.px + PSPEED * dt);
    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < BALL_R) { b.x = BALL_R; b.vx *= -1; this.beep(220); }
    if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx *= -1; this.beep(220); }
    if (b.y < 16 + BALL_R) { b.y = 16 + BALL_R; b.vy *= -1; this.beep(220); }
    // paddle
    const py = H - 24;
    if (b.vy > 0 && b.y + BALL_R >= py && b.y + BALL_R <= py + PADDLE_H + 6
        && Math.abs(b.x - this.px) <= PADDLE_W / 2 + BALL_R) {
      b.vy = -Math.abs(b.vy);
      b.vx += ((b.x - this.px) / (PADDLE_W / 2)) * 60;   // english
      this.beep(330);
    }
    // bricks
    const bw = 26, bh = 11, ox = 7, oy = 34;
    const col = Math.floor((b.x - ox) / (bw + 2));
    const row = Math.floor((b.y - oy) / (bh + 2));
    if (row >= 0 && row < 6 && col >= 0 && col < 8) {
      const i = row * 8 + col;
      if (this.bricks[i]) {
        this.bricks[i] = false;
        b.vy *= -1;
        this.score += 10 * this.level;
        this.beep(520 + row * 40);
        if (this.bricks.every((x) => !x)) {
          this.level++;
          this.reset(false);
          this.beep(880);
        }
      }
    }
    // drop
    if (b.y > H + BALL_R) {
      this.lives--;
      this.beep(110);
      if (this.lives <= 0) {
        this.state = 'over';
        this.best = Math.max(this.best, this.score);
        localStorage.setItem('neonloft.arcade.best', String(this.best));
      } else {
        const lv = this.level;
        this.reset(false);
        this.level = lv;
      }
    }
  }

  private draw(t: number): void {
    const g = this.g;
    g.fillStyle = '#04050c';
    g.fillRect(0, 0, W, H);
    // header
    g.fillStyle = '#5af2ff';
    g.font = 'bold 10px monospace';
    g.fillText(`SCORE ${this.score}`, 6, 11);
    g.fillText(`LV${this.level}`, W / 2 - 10, 11);
    const lifeStr = '♥'.repeat(Math.max(0, this.lives));
    g.fillStyle = '#ff2bdb';
    g.fillText(lifeStr, W - 40, 11);
    g.strokeStyle = '#1a2440';
    g.strokeRect(0.5, 14.5, W - 1, H - 15);
    if (this.state === 'attract' || this.state === 'over') {
      g.textAlign = 'center';
      g.fillStyle = '#ff2bdb';
      g.font = 'bold 24px monospace';
      g.fillText(this.state === 'over' ? 'GAME OVER' : 'NEON', W / 2, 110);
      if (this.state === 'attract') g.fillText('BREAKER', W / 2, 140);
      g.fillStyle = '#5af2ff';
      g.font = '11px monospace';
      g.fillText(`BEST ${this.best}`, W / 2, 170);
      if (Math.sin(t * 3) > -0.2) {
        g.fillText(this.state === 'over' ? '[SPACE] 再來一局 · [E] 離開' : '[E] 投幣開玩', W / 2, 205);
      }
      g.fillText('A/D 移動擋板', W / 2, 228);
      g.textAlign = 'left';
    } else {
      // bricks
      const bw = 26, bh = 11, ox = 7, oy = 34;
      const palette = ['#ff2bdb', '#ff8a3d', '#ffe14d', '#39ff88', '#5af2ff', '#b44dff'];
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 8; c++) {
          if (!this.bricks[r * 8 + c]) continue;
          g.fillStyle = palette[r];
          g.fillRect(ox + c * (bw + 2), oy + r * (bh + 2), bw, bh);
        }
      }
      // paddle + ball
      g.fillStyle = '#e8f6ff';
      g.fillRect(this.px - PADDLE_W / 2, H - 24, PADDLE_W, PADDLE_H);
      g.beginPath();
      g.arc(this.ball.x, this.ball.y, BALL_R, 0, 7);
      g.fillStyle = '#ffe14d';
      g.fill();
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let y = 16; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}
