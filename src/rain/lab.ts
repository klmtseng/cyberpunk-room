import * as THREE from 'three';
import { createRainSystem, type RainSystem } from './system';
import { createMist, type MistSystem } from './mist';
import { RainBed } from './audio';
import { LabWalker, wireLabJoysticks } from './walker';

/** Dedicated rain-scene (not the loft). Loft: ?room=1 */
export function wantRainLab(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get('room') === '1') return false;
  if (q.get('lab') === '0' || q.get('lab') === 'off') return false;
  return true;
}

const NIGHT_FOG = new THREE.Color(0x0c1018);
const DAY_FOG = new THREE.Color(0xc8d8e6);
const FOG_DENSITY = { thin: 0.022, mid: 0.048, thick: 0.082 };
const DAY_FOG_DENSITY = { thin: 0.008, mid: 0.016, thick: 0.028 };

export async function bootRainLab(): Promise<void> {
  document.title = '落地窗 · 雨';
  document.body.classList.add('rainlab');
  const bootEl = document.getElementById('boot');
  const appEl = document.getElementById('app')!;
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const touchhint = document.getElementById('touchhint');
  if (touchhint) touchhint.style.display = 'none';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  appEl.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(NIGHT_FOG, 1);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(NIGHT_FOG.getHex(), FOG_DENSITY.mid);
  scene.fog = fog;
  scene.background = NIGHT_FOG.clone();

  const room = { w: 8.4, d: 11.2, h: 3.36 };
  const winZ = room.d / 2;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 160);

  const ambient = new THREE.AmbientLight(0xffe6cc, 2.8);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xffe8d2, 0x4a3424, 1.25);
  scene.add(hemi);
  const windowKey = new THREE.DirectionalLight(0x9ec4e8, 1.15);
  windowKey.position.set(0, 4.2, 10);
  scene.add(windowKey);

  const sky = makeSkyCubes();
  scene.background = sky.night;

  const carpetMap = await loadCarpet();
  const interior = buildEmptyRoom(scene, room, winZ, carpetMap);

  const walker = new LabWalker(camera, canvas, {
    minX: -room.w / 2 + 0.45,
    maxX: room.w / 2 - 0.45,
    minZ: -room.d / 2 + 0.45,
    maxZ: winZ - 0.48,
    y: 1.55,
  });
  walker.position.set(0, 1.55, -room.d / 2 + 1.8);
  walker.yaw = Math.PI;
  walker.sync();
  wireLabJoysticks(walker);

  const current = {
    intensity: 0.8,
    windX: 0.16,
    windZ: 0.04,
    count: 1600,
    fog: FOG_DENSITY.thin,
    day: false,
  };

  function spawnRain(count: number): RainSystem {
    const sys = createRainSystem({
      count,
      yMax: 14,
      yMin: 0.04,
      xSpan: 18,
      z0: winZ + 0.45,
      z1: winZ + 24,
      wind: new THREE.Vector2(current.windX, current.windZ),
      color: new THREE.Color(0xc8dcf0),
    });
    sys.setIntensity(current.intensity);
    sys.group.visible = current.intensity > 0.001;
    return sys;
  }

  let rain: RainSystem = spawnRain(current.count);
  scene.add(rain.group);

  const mist: MistSystem = createMist({
    count: 150,
    xSpan: 20,
    z0: winZ + 1.2,
    z1: winZ + 22,
    y0: 0.5,
    y1: 7,
  });
  mist.setDensity(0.7);
  scene.add(mist.group);

  const bed = new RainBed();

  const applySky = () => {
    if (current.day) {
      ambient.intensity = 3.2;
      hemi.color.set(0xfff3e0);
      hemi.groundColor.set(0x8a7a62);
      hemi.intensity = 1.6;
      windowKey.color.set(0xfff1d2);
      windowKey.intensity = 2.6;
      windowKey.position.set(-5, 12, 14);
      interior.spots.forEach((s) => { s.intensity = 18; });
      interior.fixtures.forEach((f) => f.set(0xffe6c4));
      scene.background = sky.day;
      renderer.toneMappingExposure = 1.22;
    } else {
      ambient.intensity = 2.8;
      hemi.color.set(0xffe8d2);
      hemi.groundColor.set(0x4a3424);
      hemi.intensity = 1.25;
      windowKey.color.set(0x9ec4e8);
      windowKey.intensity = 1.15;
      windowKey.position.set(0, 4.2, 10);
      interior.spots.forEach((s) => { s.intensity = 52; });
      interior.fixtures.forEach((f) => f.set(0xffd09a));
      scene.background = sky.night;
      renderer.toneMappingExposure = 1.2;
    }
  };

  const applyWeather = () => {
    rain.setIntensity(current.intensity);
    rain.group.visible = current.intensity > 0.001;
    const n = Math.min(current.intensity, 1.9) / 1.9;
    mist.setDensity(current.day ? 0.12 + 0.28 * n : 0.22 + 0.4 * n);
    const night = current.fog;
    const day = night >= FOG_DENSITY.thick
      ? DAY_FOG_DENSITY.thick
      : night >= FOG_DENSITY.mid
        ? DAY_FOG_DENSITY.mid
        : DAY_FOG_DENSITY.thin;
    const base = current.day ? day : night;
    fog.density = THREE.MathUtils.lerp(base * 0.45, base * 0.85, n);
    if (current.day) {
      fog.color.copy(DAY_FOG);
      renderer.setClearColor(DAY_FOG, 1);
    } else {
      fog.color.copy(NIGHT_FOG);
      renderer.setClearColor(NIGHT_FOG, 1);
    }
    if (bed.ready) bed.setIntensity(current.intensity);
  };

  applySky();
  applyWeather();

  const panel = mountPanel({
    onIntensity: (k) => {
      current.intensity = k;
      applyWeather();
      bed.start();
      bed.setIntensity(k);
      panel.setAudio(true);
    },
    onWind: (x, z) => {
      current.windX = x;
      current.windZ = z;
      rain.setWind(x, z);
    },
    onCount: (n) => {
      scene.remove(rain.group);
      rain.dispose();
      current.count = n;
      rain = spawnRain(n);
      scene.add(rain.group);
    },
    onFog: (d) => {
      current.fog = d;
      applyWeather();
    },
    onDay: (day) => {
      current.day = day;
      applySky();
      applyWeather();
    },
    onRoom: () => {
      const url = new URL(location.href);
      url.searchParams.set('room', '1');
      url.searchParams.delete('lab');
      location.href = url.toString();
    },
  });

  const armAudio = () => {
    bed.start();
    bed.setIntensity(current.intensity);
    panel.setAudio(true);
  };
  canvas.addEventListener('pointerdown', armAudio, { once: false });
  panel.root.addEventListener('pointerdown', armAudio, { once: false });
  document.getElementById('joy')?.addEventListener('pointerdown', armAudio);
  document.getElementById('lookjoy')?.addEventListener('pointerdown', armAudio);

  const clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  if (bootEl) {
    bootEl.classList.add('gone');
    window.setTimeout(() => bootEl.remove(), 500);
  }

  if (import.meta.env.DEV) {
    (window as unknown as { __controlsTest?: object }).__controlsTest = {
      getYaw: () => walker.yaw,
      getPos: () => walker.position.clone(),
      setMove: (fwd: number, str: number) => walker.setMoveVector(fwd, str),
      setLook: (x: number, y: number) => walker.setLookVector(x, y),
    };
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    walker.update(dt);
    rain.update(dt);
    mist.update(dt);
    renderer.render(scene, camera);
    panel.tick(current.count);
  });
}

async function loadCarpet(): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const map = await loader.loadAsync('/assets/textures/lab/carpet.jpg');
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

function makeWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) {
    const x = i * 64;
    ctx.fillStyle = i % 2 === 0 ? '#4a3424' : '#3e2c1e';
    ctx.fillRect(x, 0, 64, 512);
    ctx.strokeStyle = 'rgba(20,12,8,0.45)';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, 512);
    ctx.stroke();
    for (let y = 0; y < 8; y++) {
      ctx.fillStyle = `rgba(${90 + (i * 13 + y * 7) % 40},${58 + y * 3},${28},0.18)`;
      ctx.fillRect(x + 4, y * 64 + 6, 56, 52);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 8);
  tex.anisotropy = 4;
  return tex;
}

type Interior = {
  spots: THREE.PointLight[];
  fixtures: THREE.Color[];
};

function makeSkyCubes(): { night: THREE.CubeTexture; day: THREE.CubeTexture } {
  return {
    night: paintSkyCube({
      zenith: '#070b14',
      horizon: '#1a2740',
      ground: '#08090e',
      stars: true,
    }),
    day: paintSkyCube({
      zenith: '#8eb4d4',
      horizon: '#d5e4f0',
      ground: '#b7c4ce',
      stars: false,
    }),
  };
}

function paintSkyCube(opts: {
  zenith: string;
  horizon: string;
  ground: string;
  stars: boolean;
}): THREE.CubeTexture {
  const size = 256;
  const face = (kind: 'side' | 'top' | 'bottom') => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    if (kind === 'top') {
      ctx.fillStyle = opts.zenith;
      ctx.fillRect(0, 0, size, size);
    } else if (kind === 'bottom') {
      ctx.fillStyle = opts.ground;
      ctx.fillRect(0, 0, size, size);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, opts.zenith);
      g.addColorStop(0.55, opts.horizon);
      g.addColorStop(1, opts.ground);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    if (opts.stars && kind !== 'bottom') {
      ctx.fillStyle = '#e8f0ff';
      const n = kind === 'top' ? 90 : 55;
      for (let i = 0; i < n; i++) {
        const x = (Math.sin(i * 12.9898 + kind.length) * 43758.5453) % 1;
        const y = (Math.sin(i * 78.233 + kind.length * 3) * 23421.631) % 1;
        const px = Math.abs(x) * size;
        const py = Math.abs(y) * (kind === 'top' ? size : size * 0.62);
        const r = i % 7 === 0 ? 1.2 : 0.6;
        ctx.globalAlpha = 0.25 + (i % 5) * 0.12;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    return c;
  };
  const images = [face('side'), face('side'), face('top'), face('bottom'), face('side'), face('side')];
  const cube = new THREE.CubeTexture(images);
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  return cube;
}

function buildEmptyRoom(
  scene: THREE.Scene,
  room: { w: number; d: number; h: number },
  winZ: number,
  carpetMap: THREE.Texture,
): Interior {
  const { w, d, h } = room;
  const wall = new THREE.MeshStandardMaterial({
    color: 0x6a5c50, roughness: 0.88, metalness: 0.02, fog: false,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: makeWoodTexture(), roughness: 0.55, metalness: 0.08, fog: false,
  });
  const ceil = new THREE.MeshStandardMaterial({
    color: 0x4e463c, roughness: 0.95, metalness: 0.0, fog: false,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x2a241c, roughness: 0.4, metalness: 0.35, fog: false,
  });

  const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  box(w, 0.08, d, floor, 0, -0.04, 0);
  box(w, 0.08, d, ceil, 0, h + 0.04, 0);
  box(0.16, h, d, wall, -w / 2, h / 2, 0);
  box(0.16, h, d, wall, w / 2, h / 2, 0);
  box(w, h, 0.16, wall, 0, h / 2, -d / 2);

  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.84, d * 0.9),
    new THREE.MeshStandardMaterial({
      map: carpetMap,
      roughness: 0.92,
      metalness: 0.0,
      fog: false,
    }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.012, 0);
  rug.name = 'Carpet';
  scene.add(rug);

  const sillH = 0.07;
  const headH = 0.12;
  const jamb = 0.1;
  box(w, sillH, 0.22, frame, 0, sillH / 2, winZ);
  box(w, headH, 0.22, frame, 0, h - headH / 2, winZ);
  box(jamb, h - sillH - headH, 0.22, frame, -w / 2 + jamb / 2, (sillH + h - headH) / 2, winZ);
  box(jamb, h - sillH - headH, 0.22, frame, w / 2 - jamb / 2, (sillH + h - headH) / 2, winZ);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w - jamb * 2 - 0.04, h - sillH - headH - 0.04),
    new THREE.MeshBasicMaterial({
      color: 0x8aa8c0,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(0, (sillH + h - headH) / 2, winZ - 0.03);
  glass.renderOrder = 2;
  glass.name = 'LabGlass';
  glass.visible = false;
  scene.add(glass);

  const spots: THREE.PointLight[] = [];
  const fixtures: THREE.Color[] = [];
  const lamps = [
    { x: -2.4, z: -d * 0.32 },
    { x: 2.4, z: -d * 0.32 },
    { x: 0, z: 0 },
    { x: -2.4, z: d * 0.28 },
    { x: 2.4, z: d * 0.28 },
  ];
  for (const p of lamps) {
    const light = new THREE.PointLight(0xffc090, 52, 9.5, 1.7);
    light.position.set(p.x, h - 0.18, p.z);
    scene.add(light);
    spots.push(light);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xffd09a, fog: false });
    fixtures.push(discMat.color);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), discMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(p.x, h - 0.02, p.z);
    scene.add(disc);
  }
  return { spots, fixtures };
}

function mountPanel(handlers: {
  onIntensity: (k: number) => void;
  onWind: (x: number, z: number) => void;
  onCount: (n: number) => void;
  onFog: (d: number) => void;
  onDay: (day: boolean) => void;
  onRoom: () => void;
}) {
  const el = document.createElement('div');
  el.id = 'rainlab-panel';
  el.classList.add('collapsed');
  el.innerHTML = `
    <button type="button" class="rl-head" aria-expanded="false">
      <span class="rl-title">落地窗</span>
      <span class="rl-toggle" aria-hidden="true">選單</span>
    </button>
    <div class="rl-body">
      <div class="rl-sub">空房間 · 窗外雨 · 霧 · 雨聲</div>
      <div class="rl-row" data-row="sky">
        <span>天</span>
        <button type="button" data-sky="night" class="on">夜</button>
        <button type="button" data-sky="day">日</button>
      </div>
      <div class="rl-row" data-row="intensity">
        <span>雨勢</span>
        <button type="button" data-i="0">停</button>
        <button type="button" data-i="0.8" class="on">小</button>
        <button type="button" data-i="1.3">中</button>
        <button type="button" data-i="1.9">大</button>
      </div>
      <div class="rl-row" data-row="fog">
        <span>霧</span>
        <button type="button" data-f="thin" class="on">薄</button>
        <button type="button" data-f="mid">中</button>
        <button type="button" data-f="thick">濃</button>
      </div>
      <div class="rl-row" data-row="wind">
        <span>風</span>
        <button type="button" data-w="0,0">無</button>
        <button type="button" data-w="0.18,0.05" class="on">微</button>
        <button type="button" data-w="0.58,0.14">強</button>
      </div>
      <div class="rl-row" data-row="count">
        <span>顆數</span>
        <button type="button" data-c="600">少</button>
        <button type="button" data-c="1600" class="on">中</button>
        <button type="button" data-c="2800">密</button>
      </div>
      <button class="rl-room" type="button">回 Neon Loft</button>
      <div class="rl-hint">左搖桿移動 · 右搖桿看方向 · 點一下開雨聲</div>
      <div class="rl-stat" id="rainlab-stat"></div>
    </div>
  `;
  document.body.appendChild(el);

  const head = el.querySelector('.rl-head') as HTMLButtonElement;
  const toggleLabel = el.querySelector('.rl-toggle') as HTMLElement;
  const setFold = (open: boolean) => {
    el.classList.toggle('collapsed', !open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggleLabel.textContent = open ? '收合' : '選單';
  };
  head.addEventListener('click', (e) => {
    e.stopPropagation();
    setFold(el.classList.contains('collapsed'));
  });

  const setOn = (row: string, btn: Element) => {
    el.querySelectorAll(`[data-row="${row}"] button`).forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  };

  el.querySelectorAll('[data-sky]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('sky', btn);
      handlers.onDay((btn as HTMLElement).dataset.sky === 'day');
    });
  });
  el.querySelectorAll('[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('intensity', btn);
      handlers.onIntensity(Number((btn as HTMLElement).dataset.i));
    });
  });
  el.querySelectorAll('[data-f]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('fog', btn);
      const key = (btn as HTMLElement).dataset.f as keyof typeof FOG_DENSITY;
      handlers.onFog(FOG_DENSITY[key]);
    });
  });
  el.querySelectorAll('[data-w]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('wind', btn);
      const [x, z] = String((btn as HTMLElement).dataset.w).split(',').map(Number);
      handlers.onWind(x, z);
    });
  });
  el.querySelectorAll('[data-c]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('count', btn);
      handlers.onCount(Number((btn as HTMLElement).dataset.c));
    });
  });
  el.querySelector('.rl-room')!.addEventListener('click', handlers.onRoom);

  const stat = el.querySelector('#rainlab-stat') as HTMLElement;
  const hint = el.querySelector('.rl-hint') as HTMLElement;
  return {
    root: el,
    setAudio: (on: boolean) => {
      hint.textContent = on
        ? '雨聲已開 · 左移動 · 右看方向'
        : '左搖桿移動 · 右搖桿看方向 · 點一下開雨聲';
    },
    tick: (count: number) => {
      stat.textContent = `${count} 雨滴`;
    },
  };
}
