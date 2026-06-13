import * as THREE from 'three';
import type { Book } from '../lib/books';

// Hold-a-real-book reading mode: an open book floats in front of the camera,
// full text laid out on paper pages. A/D or ←/→ flip, E/ESC closes.
// Progress per book persists in localStorage.

const PAGE_W = 448, PAGE_H = 600;       // canvas px
const MARGIN = 30, LINE_H = 25, FONT = '16px Georgia, "Noto Serif CJK TC", serif';

export class BookReader {
  readonly group = new THREE.Group();
  isOpen = false;
  onClose: (() => void) | null = null;

  private canL = document.createElement('canvas');
  private canR = document.createElement('canvas');
  private texL: THREE.CanvasTexture;
  private texR: THREE.CanvasTexture;
  private measure = document.createElement('canvas').getContext('2d')!;

  private book: Book | null = null;
  private text = '';
  private total = Infinity;
  private fetching = false;
  private pages: number[] = [0];        // char offset where each page starts
  private idx = 0;                      // current LEFT page index

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    if (!camera.parent) scene.add(camera);   // camera children need a scene path
    this.canL.width = this.canR.width = PAGE_W;
    this.canL.height = this.canR.height = PAGE_H;
    this.texL = new THREE.CanvasTexture(this.canL);
    this.texR = new THREE.CanvasTexture(this.canR);
    this.texL.colorSpace = this.texR.colorSpace = THREE.SRGBColorSpace;

    const pageGeo = new THREE.PlaneGeometry(0.30, 0.40);
    const mkPage = (tex: THREE.CanvasTexture, side: -1 | 1) => {
      const m = new THREE.Mesh(pageGeo, new THREE.MeshBasicMaterial({ map: tex }));
      m.position.x = side * 0.152;
      m.rotation.y = side * -0.16;
      return m;
    };
    const pageL = mkPage(this.texL, -1);
    const pageR = mkPage(this.texR, 1);
    // leather cover behind the pages
    const coverMat = new THREE.MeshBasicMaterial({ color: 0x2c1f16 });
    const mkCover = (side: -1 | 1) => {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.325, 0.43), coverMat);
      c.position.set(side * 0.158, -0.002, -0.006);
      c.rotation.y = side * -0.16;
      return c;
    };
    const spine = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.42), coverMat);
    spine.position.z = -0.012;
    this.group.add(mkCover(-1), mkCover(1), spine, pageL, pageR);
    this.group.position.set(0, -0.135, -0.5);
    this.group.rotation.x = -0.42;
    this.group.visible = false;
    camera.add(this.group);

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      e.stopPropagation();
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.flip(1);
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.flip(-1);
      else if (e.code === 'KeyE' || e.code === 'Escape') this.close();
    }, true);
  }

  async open(book: Book): Promise<void> {
    this.book = book;
    this.text = '';
    this.total = Infinity;
    this.pages = [0];
    this.idx = 0;
    this.isOpen = true;
    this.group.visible = true;
    this.drawNotice('擷取書頁中…', book.title);
    try {
      const saved = Number(localStorage.getItem(`neonloft.read.${book.id}`) ?? 0);
      if (saved > 0) this.pages = [saved];
      await this.ensure(this.pages[0] + 9000);
      this.render();
    } catch {
      this.drawNotice('⛔ 圖書館連線失敗', book.title);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.group.visible = false;
    if (this.book) {
      localStorage.setItem(`neonloft.read.${this.book.id}`, String(this.pages[this.idx] ?? 0));
    }
    this.onClose?.();
  }

  private flip(dir: 1 | -1): void {
    if (dir > 0) {
      const nextStart = this.pages[this.idx + 2];
      if (nextStart === undefined || nextStart >= this.total) return;
      this.idx += 2;
    } else {
      if (this.idx === 0) return;
      this.idx -= 2;
    }
    this.render();
    if (this.book) {
      localStorage.setItem(`neonloft.read.${this.book.id}`, String(this.pages[this.idx] ?? 0));
    }
    // prefetch ahead
    void this.ensure((this.pages[this.idx] ?? 0) + 9000).then(() => this.render());
  }

  private async ensure(upto: number): Promise<void> {
    while (this.text.length < Math.min(upto, this.total) && !this.fetching) {
      this.fetching = true;
      try {
        const r = await (await fetch(
          `/__book?id=${this.book!.id}&start=${this.text.length}&len=60000`,
        )).json();
        if (r.error) throw new Error(r.error);
        this.total = Number(r.total);
        this.text += String(r.chunk);
      } finally {
        this.fetching = false;
      }
      if (!this.text.length) break;
    }
  }

  /** lay out one page starting at `start`; returns the next page's offset */
  private layout(g: CanvasRenderingContext2D | null, start: number): number {
    const ctx = g ?? this.measure;
    ctx.font = FONT;
    const maxW = PAGE_W - MARGIN * 2;
    const maxLines = Math.floor((PAGE_H - MARGIN * 2 - 30) / LINE_H);
    let pos = start;
    for (let line = 0; line < maxLines && pos < this.text.length; line++) {
      let lineText = '';
      while (pos < this.text.length) {
        const ch = this.text[pos];
        if (ch === '\n') { pos++; break; }
        // greedy fit; CJK breaks anywhere, latin breaks at the last space
        if (ctx.measureText(lineText + ch).width > maxW) {
          if (!/[　-鿿豈-﫿]/.test(ch)) {
            const sp = lineText.lastIndexOf(' ');
            if (sp > maxW / 30) { pos -= (lineText.length - sp - 1); lineText = lineText.slice(0, sp); }
          }
          break;
        }
        lineText += ch;
        pos++;
      }
      if (g) g.fillText(lineText, MARGIN, MARGIN + 18 + line * LINE_H);
    }
    return pos;
  }

  private paper(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#e9e2d0';
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    for (let i = 0; i < 260; i++) {     // paper grain
      g.fillStyle = Math.random() > 0.5 ? 'rgba(120,100,70,.03)' : 'rgba(255,255,255,.04)';
      g.fillRect(Math.random() * PAGE_W, Math.random() * PAGE_H, 2, 2);
    }
    g.fillStyle = '#2b251c';
    g.font = FONT;
  }

  private render(): void {
    if (!this.book) return;
    const gL = this.canL.getContext('2d')!;
    const gR = this.canR.getContext('2d')!;
    this.paper(gL);
    this.paper(gR);
    const startL = this.pages[this.idx] ?? 0;
    const endL = this.layout(gL, startL);
    this.pages[this.idx + 1] = endL;
    const endR = this.layout(gR, endL);
    this.pages[this.idx + 2] = endR;
    // header + footer
    const pct = this.total > 0 && this.total !== Infinity
      ? Math.min(100, (endR / this.total) * 100).toFixed(1) : '…';
    gL.font = 'italic 12px Georgia, serif';
    gL.fillStyle = 'rgba(60,50,40,.55)';
    gL.fillText(`${this.book.title} — ${this.book.author}`, MARGIN, PAGE_H - 16);
    gR.font = 'italic 12px Georgia, serif';
    gR.fillStyle = 'rgba(60,50,40,.55)';
    const foot = endR >= this.total ? '— 全書完 —' : `${pct}%  ·  [A/D] 翻頁  [E] 闔上`;
    gR.fillText(foot, PAGE_W - MARGIN - gR.measureText(foot).width, PAGE_H - 16);
    this.texL.needsUpdate = true;
    this.texR.needsUpdate = true;
  }

  private drawNotice(msg: string, title: string): void {
    for (const [can, tex] of [[this.canL, this.texL], [this.canR, this.texR]] as const) {
      const g = can.getContext('2d')!;
      this.paper(g);
      g.font = 'bold 20px Georgia, serif';
      g.fillText(title, MARGIN, 90);
      g.font = FONT;
      g.fillText(msg, MARGIN, 140);
      tex.needsUpdate = true;
    }
  }
}
