import * as THREE from 'three';

// Flip-tile mosaic display — replaces the static purple backsplash with a wall
// of 28×5 tiles that wave-flip to reveal a piece of art. Three content sources
// rotate through `manifest.json`:
//   • Met Open Access works (downloaded offline at build time, never breaks)
//   • Procedural 夜貓 portraits (Warhol/NEON/8-bit/Egyptian)
//   • Procedural abstracts (Mondrian/Memphis/Bauhaus/Vasarely)
// Idle state shows the purple grid (looks like the original backsplash); E
// triggers the next reveal, auto-cycle every 3-4 min.

const MANIFEST_URL = '/assets/textures/mosaic_art/manifest.json';

interface ArtEntry {
  id: string;
  label: string;
  src: string;
  source: 'met' | 'procedural' | string;
}

interface Tile {
  grp: THREE.Group;
  /** col/row coords for wave delay calculation */
  c: number;
  r: number;
  /** seconds from animation start before this tile begins flipping */
  delay: number;
  /** angle this tile is heading toward this animation cycle (0 or π) */
  to: number;
  /** angle it left from this cycle */
  from: number;
}

export interface FlipMosaic {
  group: THREE.Group;
  hit: THREE.Object3D;
  /** Cycle to next image. If currently off → flip on to next. If on → flip off, swap, flip on. */
  reveal(): string;
  isRevealed(): boolean;
  currentLabel(): string;
  /** Enter TV mode (or cycle next video if already in TV mode). Returns label. */
  cycleTV(): string;
  /** Cast an external HTMLVideoElement onto the wall (used by YouTube cast). */
  castExternal(video: HTMLVideoElement, label: string): void;
  /** Leave TV mode and return to art-cycle. */
  exitTV(): boolean;
  isTV(): boolean;
  update(t: number, dt: number): void;
}

// Local videos bundled under public/assets/video. Mirrors city.ts so we don't
// drag in a circular dep — the holo-ad pipeline also points here.
const TV_PLAYLIST: Array<{ url: string; label: string }> = [
  { url: '/assets/video/hoload_TW-T7iP5xvk.mp4', label: 'MEGACITY LOOP' },
  { url: '/assets/video/hoload_pyR8g6a10R0.mp4', label: 'I OWN TIME' },
  { url: '/assets/video/hoload_mcl_fEI7nFU.mp4', label: 'Mr. Whitey™' },
];

export async function buildFlipMosaic(opts: {
  center: THREE.Vector3;
  width: number;
  height: number;
  cols: number;
  rows: number;
}): Promise<FlipMosaic> {
  const { center, width, height, cols, rows } = opts;
  const tileW = width / cols;
  const tileH = height / rows;
  const tileMargin = 0.94;       // small grout between tiles

  const group = new THREE.Group();
  group.name = 'FlipMosaic';
  group.position.copy(center);

  // ---------------- shared textures ----------------
  // back side: purple grid (matches the original kitchen backsplash look)
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 1024; gridCanvas.height = 256;
  {
    const g = gridCanvas.getContext('2d')!;
    g.fillStyle = '#0a0612'; g.fillRect(0, 0, 1024, 256);
    const tw = 1024 / cols, th = 256 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle = '#ffffff';
        g.fillRect(c * tw + 2, r * th + 2, tw - 4, th - 4);
      }
    }
  }
  const gridTex = new THREE.CanvasTexture(gridCanvas);
  gridTex.colorSpace = THREE.SRGBColorSpace;

  // front side: dynamic art canvas (gets new image painted onto it each cycle)
  const artCanvas = document.createElement('canvas');
  artCanvas.width = 1792; artCanvas.height = 320;
  const artCtx = artCanvas.getContext('2d')!;
  artCtx.fillStyle = '#0a0612';
  artCtx.fillRect(0, 0, artCanvas.width, artCanvas.height);
  const artTex = new THREE.CanvasTexture(artCanvas);
  artTex.colorSpace = THREE.SRGBColorSpace;
  artTex.minFilter = THREE.LinearFilter;

  // shared materials — saves draw calls (one shader compile per side)
  const backMat = new THREE.MeshStandardMaterial({
    color: 0x0a0612,
    emissive: 0xb44dff,
    emissiveMap: gridTex,
    emissiveIntensity: 0.9,
    roughness: 0.35,
  });
  const frontMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: artTex,
    emissive: 0xffffff,
    emissiveMap: artTex,
    emissiveIntensity: 0.55,
    roughness: 0.55,
  });

  // ---------------- build tile grid ----------------
  const tiles: Tile[] = [];
  const setBackUV = (geo: THREE.PlaneGeometry, c: number, r: number) => {
    const uv = geo.attributes.uv;
    const u0 = c / cols, u1 = (c + 1) / cols;
    const v0 = 1 - (r + 1) / rows, v1 = 1 - r / rows;
    // PlaneGeometry vertex order: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  };
  // Front plane is rotated π around Y to sit back-to-back; the tile group
  // then rotates π around X to reveal. Combined transform rotates the rendered
  // texture by 180° within each tile — so without counter-rotating the UV here
  // every cell would appear upside down + mirrored, breaking the overall image.
  const setFrontUV = (geo: THREE.PlaneGeometry, c: number, r: number) => {
    const uv = geo.attributes.uv;
    const u0 = c / cols, u1 = (c + 1) / cols;
    const v0 = 1 - (r + 1) / rows, v1 = 1 - r / rows;
    // 180° rotation in UV space: each vertex gets the diagonally-opposite UV
    uv.setXY(0, u1, v0);
    uv.setXY(1, u0, v0);
    uv.setXY(2, u1, v1);
    uv.setXY(3, u0, v1);
    uv.needsUpdate = true;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = -width/2 + (c + 0.5) * tileW;
      const ty = height/2 - (r + 0.5) * tileH;

      const grp = new THREE.Group();
      grp.position.set(tx, ty, 0);

      const backGeo = new THREE.PlaneGeometry(tileW * tileMargin, tileH * tileMargin);
      setBackUV(backGeo, c, r);
      const back = new THREE.Mesh(backGeo, backMat);
      grp.add(back);

      const frontGeo = new THREE.PlaneGeometry(tileW * tileMargin, tileH * tileMargin);
      setFrontUV(frontGeo, c, r);
      const front = new THREE.Mesh(frontGeo, frontMat);
      front.rotation.y = Math.PI;   // face -z so it sits back-to-back with `back`
      grp.add(front);

      group.add(grp);
      tiles.push({ grp, c, r, delay: 0, to: 0, from: 0 });
    }
  }

  // hit proxy — invisible plane covering the whole splash; tile geometry alone
  // is a sieve of gaps and would make raycast pickups flaky
  const hitGeo = new THREE.PlaneGeometry(width, height);
  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, 0, 0.01);
  hit.name = 'FlipMosaicProxy';
  group.add(hit);

  // ---------------- content pipeline ----------------
  let manifest: ArtEntry[] = [];
  let idx = -1;
  let currentLabel = '';
  try {
    manifest = await fetch(MANIFEST_URL).then((r) => r.json());
  } catch (e) {
    console.warn('[mosaic] manifest fetch failed', e);
  }

  const drawImageOntoCanvas = (img: HTMLImageElement): void => {
    artCtx.fillStyle = '#0a0612';
    artCtx.fillRect(0, 0, artCanvas.width, artCanvas.height);
    const arSrc = img.naturalWidth / img.naturalHeight;
    const arDst = artCanvas.width / artCanvas.height;
    let dw: number, dh: number;
    if (arSrc > arDst) {
      dh = artCanvas.height;
      dw = img.naturalWidth * dh / img.naturalHeight;
    } else {
      dw = artCanvas.width;
      dh = img.naturalHeight * dw / img.naturalWidth;
    }
    artCtx.drawImage(img, (artCanvas.width - dw) / 2, (artCanvas.height - dh) / 2, dw, dh);
    artTex.needsUpdate = true;
  };

  const loadEntry = (i: number): Promise<HTMLImageElement | null> => new Promise((resolve) => {
    if (!manifest[i]) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/' + manifest[i].src;
  });

  // ---------------- TV mode ----------------
  // Two flavours of TV: the bundled local playlist (own HTMLVideoElement) and
  // an external one shoved in by the YouTube cast pipeline. They share the
  // material swap path but use different VideoTextures so we don't fight over
  // a single decoder when toggling sources.
  let tvVideo: HTMLVideoElement | null = null;
  let tvTex: THREE.VideoTexture | null = null;
  let tvIdx = -1;
  let inTV = false;
  let externalCast = false;
  let externalTex: THREE.VideoTexture | null = null;
  let externalSource: HTMLVideoElement | null = null;

  const ensureTVRig = (): void => {
    if (tvVideo) return;
    tvVideo = document.createElement('video');
    tvVideo.playsInline = true;
    tvVideo.muted = true;        // background ambience role; iGPU doesn't need sync audio
    tvVideo.loop = true;
    tvVideo.preload = 'auto';
    tvTex = new THREE.VideoTexture(tvVideo);
    tvTex.colorSpace = THREE.SRGBColorSpace;
    tvTex.minFilter = THREE.LinearFilter;
  };

  // Swap the front material between still-art and one of the two video sources.
  const useFrontMap = (mode: 'art' | 'local' | 'external'): void => {
    if (mode === 'local') {
      ensureTVRig();
      frontMat.map = tvTex!;
      frontMat.emissiveMap = tvTex!;
      frontMat.emissiveIntensity = 0.85;
    } else if (mode === 'external' && externalTex) {
      frontMat.map = externalTex;
      frontMat.emissiveMap = externalTex;
      frontMat.emissiveIntensity = 0.9;
    } else {
      frontMat.map = artTex;
      frontMat.emissiveMap = artTex;
      frontMat.emissiveIntensity = 0.55;
    }
    frontMat.needsUpdate = true;
  };

  // ---------------- state machine ----------------
  type State = 'off' | 'flipping-on' | 'on' | 'flipping-off';
  let state: State = 'off';
  let stateT = 0;
  let nextAutoSwap = 240 + Math.random() * 60;   // first auto-swap 4-5 min after boot

  const TILE_FLIP_SEC = 0.55;
  const WAVE_SEC = 1.2;     // total spread of the wave start times

  const scheduleWave = (toAngle: number): void => {
    for (const t of tiles) {
      // diagonal wave from top-left to bottom-right with small jitter
      const d = (t.c / cols * 0.6 + t.r / rows * 0.4);
      t.delay = d * WAVE_SEC + Math.random() * 0.18;
      t.from = t.grp.rotation.x;
      t.to = toAngle;
    }
    stateT = 0;
  };

  const startReveal = async (): Promise<void> => {
    if (!manifest.length) return;
    idx = (idx + 1) % manifest.length;
    const img = await loadEntry(idx);
    if (!img) {
      console.warn('[mosaic] image load failed:', manifest[idx]?.src);
      return;
    }
    drawImageOntoCanvas(img);
    currentLabel = manifest[idx].label;
    scheduleWave(Math.PI);
    state = 'flipping-on';
    nextAutoSwap = 180 + Math.random() * 90;
  };

  const startHide = (): void => {
    scheduleWave(0);
    state = 'flipping-off';
  };

  const reveal = (): string => {
    if (inTV) {
      // E on the wall while in TV → behave like a remote: cycle channel
      return cycleTV();
    }
    if (state === 'flipping-on' || state === 'flipping-off') return '(切換中…)';
    if (state === 'off') {
      // schedule, but loadEntry is async — kick it off and return label optimistically
      void startReveal();
      return manifest[(idx + 1) % Math.max(1, manifest.length)]?.label ?? '(loading)';
    }
    // currently on → flip off then auto-flow into next reveal in update()
    startHide();
    return manifest[(idx + 1) % Math.max(1, manifest.length)]?.label ?? '(loading)';
  };

  const cycleTV = (): string => {
    if (!TV_PLAYLIST.length) return '(無影片)';
    ensureTVRig();
    // switching from external cast back to local playlist? drop the ext rig
    if (externalCast) {
      externalCast = false;
      externalTex = null;
      externalSource = null;
    }
    tvIdx = (tvIdx + 1) % TV_PLAYLIST.length;
    const entry = TV_PLAYLIST[tvIdx];
    if (tvVideo!.src.endsWith(entry.url) === false) {
      tvVideo!.src = entry.url;
      void tvVideo!.play().catch(() => { /* autoplay policy; user gesture comes from interact */ });
    }
    useFrontMap('local');
    if (!inTV) {
      inTV = true;
      if (state === 'off') {
        scheduleWave(Math.PI);
        state = 'flipping-on';
      }
    }
    currentLabel = `📺 ${entry.label}`;
    return currentLabel;
  };

  const castExternal = (video: HTMLVideoElement, label: string): void => {
    // re-create the VideoTexture if the underlying element changed; reusing
    // an existing one for the same element keeps the GPU upload contiguous
    if (externalSource !== video || !externalTex) {
      externalTex = new THREE.VideoTexture(video);
      externalTex.colorSpace = THREE.SRGBColorSpace;
      externalTex.minFilter = THREE.LinearFilter;
      externalSource = video;
    }
    externalCast = true;
    // ensure local TV doesn't also keep decoding in the background
    if (tvVideo) tvVideo.pause();
    useFrontMap('external');
    if (!inTV) {
      inTV = true;
      if (state === 'off') {
        scheduleWave(Math.PI);
        state = 'flipping-on';
      }
    }
    currentLabel = `📡 ${label}`;
  };

  const exitTV = (): boolean => {
    if (!inTV) return false;
    inTV = false;
    if (tvVideo) tvVideo.pause();
    externalCast = false;
    externalTex = null;
    externalSource = null;
    useFrontMap('art');
    if (state === 'on') startHide();
    return true;
  };

  const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

  const update = (_t: number, dt: number): void => {
    stateT += dt;
    if (state === 'on' && !inTV) {
      nextAutoSwap -= dt;
      if (nextAutoSwap <= 0) startHide();
    }

    if (state === 'flipping-on' || state === 'flipping-off') {
      let allDone = true;
      for (const tile of tiles) {
        const elapsed = stateT - tile.delay;
        if (elapsed < 0) { allDone = false; continue; }
        const k = Math.min(1, elapsed / TILE_FLIP_SEC);
        if (k < 1) allDone = false;
        const e = easeOut(k);
        tile.grp.rotation.x = tile.from + (tile.to - tile.from) * e;
      }
      if (allDone) {
        if (state === 'flipping-on') {
          state = 'on';
          nextAutoSwap = 180 + Math.random() * 90;
        } else {
          // flipping-off finished → load next art and flip on again
          void startReveal();
        }
      }
    }
  };

  return {
    group,
    hit,
    reveal,
    isRevealed: () => state === 'on' || state === 'flipping-on',
    currentLabel: () => currentLabel,
    cycleTV,
    castExternal,
    exitTV,
    isTV: () => inTV,
    update,
  };
}
