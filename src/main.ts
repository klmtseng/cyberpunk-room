import * as THREE from 'three';
import { detectHardware, pickPreset, settingsFor, loadOverride } from './engine/quality';
import { createEngine } from './engine/renderer';
import { initXR } from './engine/xr';
import { installLighting } from './world/lighting';
import { buildRoom } from './world/room';
import { buildCity } from './world/city';
import { buildRain } from './world/weather';
import { FPControls } from './player/fp-controls';
import { InteractSystem } from './player/interact';
import { BookReader } from './player/bookreader';
import { Ambience, speakerGain } from './world/audio';
import { HoloArcade } from './world/arcade';
import { ROOM_BOUNDS } from './world/room';
import { buildProps } from './world/props';
import { buildBarLantern, buildDeskLantern, type Lantern } from './world/lantern';
import { buildFlipMosaic, type FlipMosaic } from './world/flip_mosaic';
import { CyberOS } from './pc/os';
import { saveOverride } from './engine/quality';

// Diagnostic beacon: surface render health via document.title so any browser
// can be probed externally (xdotool getwindowname) without DevTools.
let shaderErrCount = 0;
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (args.some((a) => typeof a === 'string' && a.includes('Shader Error'))) shaderErrCount++;
  origConsoleError(...args);
};

async function boot() {
  const bootEl = document.getElementById('boot')!;
  const bootBar = document.getElementById('bootbar') as HTMLElement;
  const appEl = document.getElementById('app')!;
  const lockHint = document.getElementById('lockhint')!;
  const statsEl = document.getElementById('stats')!;

  const step = (p: number) => { bootBar.style.width = `${Math.round(p * 100)}%`; };

  step(0.1);
  const hw = await detectHardware();
  const preset = loadOverride() ?? pickPreset(hw);
  const settings = settingsFor(preset);
  console.info('[NEON LOFT] hardware', hw, '→ preset', preset);

  step(0.3);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
  appEl.appendChild(canvas);
  const ctx = createEngine(canvas, settings);

  step(0.5);
  const lights = installLighting(ctx);
  const room = buildRoom(ctx);
  const city = buildCity(ctx);
  const rain = buildRain(ctx);

  step(0.75);
  const controls = new FPControls(ctx.camera, canvas, { eyeHeight: 1.7 });
  controls.setWalls(room.walls);
  controls.setHeightSampler(room.heightAt);
  const ambience = new Ambience();
  controls.onLockChange(() => {
    lockHint.classList.toggle('gone', controls.isLocked);
    if (controls.isLocked) {
      ambience.start(); // user gesture satisfied
      // distant holo-ads may speak softly once a gesture unlocks audio
      try { city.adVideo.muted = false; city.adVideo.volume = 0.12; } catch { /* keep muted */ }
      try { castVideo.muted = false; } catch { /* keep muted */ }
    }
  });
  canvas.addEventListener('click', () => {
    controls.requestLock();
    // same user gesture also grants fullscreen — immersive by default
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { /* user said no */ });
    }
  });

  step(0.82);
  const props = buildProps(ctx);

  // Turkish brass+mosaic-glass lantern on the bar/island — Blender-built GLB,
  // E to toggle, stained-glass glow when lit. Loaded async; if the GLB or
  // mosaic texture fails the rest of the room boots anyway.
  let lantern: Lantern | null = null;
  buildBarLantern(new THREE.Vector3(-1.72, 0.952, -4.32), () => {
    ambience.blip(820); ambience.blip(640);
  }).then((l) => {
    lantern = l;
    ctx.scene.add(l.group);
    interact.add(l.hit, l.isOn() ? '熄滅馬賽克燈籠' : '點亮馬賽克燈籠', () => {
      const on = l.toggle();
      interact.flash(on ? '🪔 馬賽克燈籠點亮 — 彩繪玻璃' : '🪔 燈籠熄滅');
    }, 2.4);
  }).catch((e) => console.warn('[lantern] load failed', e));

  // Second Turkish lamp on the netrunner desk — bigger, more ornate piece
  // (IMG_5728-31). Texture is the user's actual photos stitched into an
  // equirect panorama (tools/lantern/extract_desk_mosaic.py), not procedural.
  // 3-state brightness cycle: off → dim → bright → off.
  // Desk top is at y=0.795; place the lamp at the right-front corner.
  let deskLantern: Lantern | null = null;
  buildDeskLantern(new THREE.Vector3(5.85, 0.80, 2.95), () => {
    ambience.blip(880); ambience.blip(660);
  }).then((l) => {
    deskLantern = l;
    ctx.scene.add(l.group);
    const promptFor = (s: string): string =>
      s === 'off' ? '亮一級' : s === 'dim' ? '亮二級' : '熄滅';
    interact.add(l.hit, '土耳其檯燈 — 切換亮度', () => {
      const newLevel = l.cycle();
      const labelZh = newLevel === 'off' ? '熄滅'
        : newLevel === 'dim' ? '微亮 (氛圍)'
        : '明亮';
      interact.flash(`💡 桌燈 → ${labelZh},再按一次:${promptFor(newLevel)}`);
    }, 2.4);
  }).catch((e) => console.warn('[deskLantern] load failed', e));

  // Flip-tile mosaic on the kitchen backsplash slot (replaces the static
  // purple grid). 28×5 tiles wave-flip to reveal Met Open Access art / 夜貓
  // procedural portraits / abstract patterns — see tools/mosaic/build_art_cache.py.
  let mosaic: FlipMosaic | null = null;
  buildFlipMosaic({
    center: new THREE.Vector3(-2.0, 1.45, -6.86),
    width: 4.6, height: 0.8, cols: 28, rows: 5,
  }).then((m) => {
    mosaic = m;
    ctx.scene.add(m.group);
    interact.add(m.hit, '翻牌馬賽克 — 換一幅', () => {
      const label = m.reveal();
      interact.flash(`🖼 馬賽克牆 → ${label}`);
      ambience.blip(720); ambience.blip(540);
    }, 3.4);
  }).catch((e) => console.warn('[mosaic] load failed', e));

  // ---------- weather state (terminal-controllable) ----------
  let weatherLevel: 'off' | 'light' | 'heavy' = 'light';
  let rainValue = 0.8;
  const setWeather = (level: 'off' | 'light' | 'heavy') => {
    weatherLevel = level;
    rainValue = level === 'off' ? 0 : level === 'light' ? 0.8 : 1.9;
    rain.setIntensity(Math.max(rainValue, 0.0001));
    rain.rain.visible = level !== 'off';
  };

  // ---------- interaction system ----------
  const interact = new InteractSystem(ctx.camera);

  // holographic arcade cabinet — NEON BREAKER, actually playable
  const arcade = new HoloArcade(
    new THREE.Vector3(-4.6, 0, 4.75), 2.15, (f) => ambience.blip(f));
  ctx.scene.add(arcade.group);
  arcade.onClose = () => {
    controls.enabled = true;
    controls.clearKeys();
    interact.enabled = true;
    interact.flash('離開街機 — 下次再來破紀錄');
  };
  interact.add(arcade.screen, '投幣開玩 NEON BREAKER', () => {
    if (mode !== 'play' || arcade.isActive) return;
    controls.enabled = false;
    interact.enabled = false;
    arcade.start();
  }, 2.8);
  interact.add(arcade.shell, '投幣開玩 NEON BREAKER', () => {
    if (mode !== 'play' || arcade.isActive) return;
    controls.enabled = false;
    interact.enabled = false;
    arcade.start();
  }, 2.8);

  // hold-a-book reading mode (replaces the old in-OS library reader)
  const reader = new BookReader(ctx.camera, ctx.scene);
  reader.onClose = () => {
    controls.enabled = true;
    controls.clearKeys();
    interact.enabled = true;
  };

  // invisible proxies for furniture built inside room.ts
  const proxy = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    m.position.set(x, y, z);
    ctx.scene.add(m);
    return m;
  };
  const sofaProxy = proxy(3.0, 1.0, 1.1, 0.4, 0.5, 2.0);
  const barProxy = proxy(1.7, 1.0, 0.9, -2.2, 0.6, -4.6);
  const bedProxy = proxy(2.3, 0.8, 1.7, -3.6, 3.5, -5.6);

  // fade scrim for the bed nap
  const fade = document.createElement('div');
  fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .9s;z-index:40;';
  document.body.appendChild(fade);

  // seated state
  let seated = false;
  let savedPose: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  const stand = () => {
    if (!seated || !savedPose) return;
    seated = false;
    controls.enabled = true;
    controls.clearKeys();
    ctx.camera.position.copy(savedPose.pos);
    controls.setOrientation(savedPose.yaw, savedPose.pitch);
    interact.flash('起身');
  };
  window.addEventListener('keydown', (e) => {
    if (seated && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space'].includes(e.code)) {
      e.stopPropagation();
      stand();
    }
  }, true);

  // ---------- lighting moods ----------
  // multipliers: [ambient, hemi, perFixture[0..6]] — fixture order matches lighting.ts
  const MOODS: Array<{ name: string; amb: number; hemi: number; fix: number[] }> = [
    { name: '標準', amb: 1, hemi: 1, fix: [1, 1, 1, 1, 1, 1, 1] },
    { name: '閱讀', amb: 1.35, hemi: 1.2, fix: [1.7, 0.5, 1.4, 1.2, 1.5, 0.4, 0.5] },
    { name: '影院', amb: 0.35, hemi: 0.3, fix: [0.12, 1.3, 0.15, 0.8, 0.3, 1.3, 1.2] },
    { name: '派對', amb: 0.55, hemi: 0.5, fix: [0.7, 1.5, 0.6, 1.4, 0.6, 1.6, 1.5] },
    { name: '全暗', amb: 0.15, hemi: 0.12, fix: [0, 0.25, 0, 0.2, 0, 0.3, 0.25] },
  ];
  let moodIdx = 0;
  const baseColors = lights.fixtures.map((f) => f.color.clone());
  const applyMood = () => {
    const m = MOODS[moodIdx];
    lights.ambient.intensity = lights.ambientBase * m.amb;
    lights.hemi.intensity = lights.hemiBase * m.hemi;
    lights.fixtures.forEach((f, i) => {
      f.intensity = lights.baseIntensities[i] * (m.fix[i] ?? 1);
      f.color.copy(baseColors[i]); // undo any party-mode hue sweep
    });
  };
  const cycleLights = (): string => {
    moodIdx = (moodIdx + 1) % MOODS.length;
    applyMood();
    return MOODS[moodIdx].name;
  };
  const partyHue = new THREE.Color();

  // ---------- electric sofa extras (recline + massage) ----------
  let reclined = false;
  let massageT = 0;
  const seatBase = new THREE.Vector3();

  // ---------- spatial TV cast pipeline (Chromecast-style) ----------
  const castVideo = document.createElement('video');
  castVideo.playsInline = true;
  castVideo.preload = 'auto';
  // muted until a user gesture is observed; otherwise Firefox/Chrome autoplay
  // policy rejects play() when the page hasn't been interacted with yet, and
  // the headless smoke-test path needs to be able to fire cast commands
  // remotely. See onLockChange below for the unmute hook.
  castVideo.muted = true;
  let castingTitle = '';
  const stopCast = () => {
    castVideo.pause();
    castVideo.removeAttribute('src');
    castVideo.load();
    props.tv.stopCast();
    city.setAdsPaused(false);
    castingTitle = '';
  };
  castVideo.addEventListener('ended', stopCast);
  const castToTV = async (id: string, dest: 'tv' | 'wall' = 'tv'): Promise<string> => {
    try {
      const r = await (await fetch(`/__resolve?id=${encodeURIComponent(id)}`)).json();
      if (!r.url) throw new Error(r.error ?? 'resolve failed');
      castVideo.src = `/__stream?u=${encodeURIComponent(r.url)}`;
      await castVideo.play();
      city.setAdsPaused(true);     // one VideoTexture at a time on this iGPU
      castingTitle = id;
      if (dest === 'wall') {
        // route the same stream to the mosaic wall instead of the holo TV
        if (props.tv.isCasting()) props.tv.stopCast();
        if (!mosaic) return '⛔ 馬賽克牆尚未載入';
        mosaic.castExternal(castVideo, `YT://${id}`);
        interact.flash('📡 投影到馬賽克牆 — 28×5 LED 面板');
        return '📡 已投影到馬賽克牆 — 回廚房看';
      }
      // default: holo TV in the living room
      if (mosaic?.isTV()) mosaic.exitTV();
      props.tv.cast(castVideo);
      interact.flash('📽 投影展開 — 回客廳看吧,影片浮在半空');
      return '📽 已投影到客廳 — ESC 出去邊走邊看';
    } catch (err) {
      return `⛔ 投影失敗:${String(err).slice(0, 80)}`;
    }
  };

  // ---------- CyberOS ----------
  let fps = 0; // updated by the stats loop below
  const os = new CyberOS({
    setWeather,
    getWeather: () => weatherLevel,
    cycleNeon: () => props.neonSign.cycle(),
    toggleCurtain: () => props.curtain.toggle(),
    cycleHolo: () => props.holo.cycle(),
    toggleLantern: () => lantern?.toggle() ?? false,
    cycleDeskLantern: () => deskLantern?.cycle() ?? '(未載入)',
    cycleMosaic: () => mosaic?.reveal() ?? '(未載入)',
    cycleHoloTint: () => props.tv.cycleHoloTint(),
    toggleCounterPendants: () => props.counterPendants.toggle(),
    toggleDND: () => toggleDND(),
    cycleProjector: () => room.starProjector.cycle(),
    toggleFridge: () => room.fridge.toggle(),
    mosaicTV: (arg?: string) => {
      if (!mosaic) return '(未載入)';
      if (arg === 'off' || arg === 'stop') {
        return mosaic.exitTV() ? '電視模式關閉,回到藝廊輪播' : '不在電視模式';
      }
      // entering TV: one VideoTexture at a time on this iGPU — pause the
      // city ads + holo TV cast so we don't fight for decoding bandwidth
      const wasArtMode = !mosaic.isTV();
      const label = mosaic.cycleTV();
      if (wasArtMode) {
        city.setAdsPaused(true);
        if (props.tv.isCasting()) stopCast();
      }
      return label;
    },
    cycleLights,
    triggerAd: () => city.triggerAd(),
    irisSay: () => irisSay(),
    castToTV,
    getStats: () => ({
      fps: Number(fps.toFixed(0)),
      preset: settings.preset.toUpperCase(),
      renderer: hw.gpuArchitecture.slice(0, 48),
      pos: ctx.camera.position.toArray().map((v) => v.toFixed(1)).join(', '),
    }),
    setPresetOverride: (p) => { saveOverride(p); location.reload(); },
    currentPreset: () => settings.preset,
  });

  // jack-in state machine: play → enter-os (camera tween) → os → play
  let mode: 'play' | 'enter-os' | 'os' = 'play';
  let tweenT = 0;
  const tweenFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  const monitorPose = { pos: new THREE.Vector3(3.55, 1.44, 3.4), yaw: -Math.PI / 2, pitch: 0 };
  const enterOS = () => {
    if (mode !== 'play') return;
    mode = 'enter-os';
    tweenT = 0;
    tweenFrom.pos.copy(ctx.camera.position);
    tweenFrom.yaw = controls.getYaw();
    tweenFrom.pitch = controls.getPitch();
    controls.enabled = false;
    controls.release();
    interact.enabled = false;
    lockHint.classList.add('gone');
  };
  os.onExit = () => {
    mode = 'play';
    ctx.camera.position.copy(tweenFrom.pos);
    controls.setOrientation(tweenFrom.yaw, tweenFrom.pitch);
    controls.enabled = true;
    controls.clearKeys();
    interact.enabled = true;
    lockHint.classList.remove('gone');
  };

  // ---------- monitor idle screen ----------
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 152;
    const g = c.getContext('2d')!;
    g.fillStyle = '#02030a'; g.fillRect(0, 0, 256, 152);
    g.fillStyle = '#ff2bdb'; g.font = 'bold 30px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.shadowColor = '#ff2bdb'; g.shadowBlur = 14;
    g.fillText('CyberOS', 128, 66);
    g.shadowBlur = 0;
    g.fillStyle = '#5af2ff'; g.font = '13px monospace';
    g.fillText('[ E ] JACK IN', 128, 102);
    for (let y = 0; y < 152; y += 3) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y, 256, 1); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = room.monitorPlane.material as THREE.MeshStandardMaterial;
    m.emissiveMap = tex;
    m.needsUpdate = true;
  }

  // ---------- register interactions ----------
  interact.add(room.monitorPlane, '接入 CyberOS', enterOS, 3.0);
  interact.add(props.tv.mesh, '空間投影', () => {
    if (props.tv.isCasting()) {
      stopCast();
      interact.flash('📽 投影結束');
    } else {
      interact.flash(`📽 投影:${props.tv.cycleChannel()}`);
    }
  }, 3.0);
  interact.add(props.tv.screen, '切換頻道', () => {
    if (props.tv.isCasting()) {
      if (castVideo.paused) { void castVideo.play(); interact.flash('▶ 續播'); }
      else { castVideo.pause(); interact.flash('⏸ 暫停'); }
    } else {
      interact.flash(`📽 投影:${props.tv.cycleChannel()}`);
    }
  }, 4.5);
  interact.add(props.neonSign.mesh, '切換霓虹色', () => interact.flash(`✨ ${props.neonSign.cycle()}`), 4.5);
  interact.add(props.recordPlayer.mesh, '播放黑膠 (合成器墊音)', () => {
    const on = ambience.togglePad();
    props.recordPlayer.setSpin(on);
    interact.flash(on ? '♫ 黑膠轉動中…' : '黑膠停止');
  }, 2.4);
  interact.add(room.windowPlane, '切換雨勢', () => {
    setWeather(weatherLevel === 'off' ? 'light' : weatherLevel === 'light' ? 'heavy' : 'off');
    interact.flash(`🌧 雨勢:${weatherLevel}`);
  }, 3.0);
  // ------- drink / drunk state -------
  // Bar drink raises drunkLevel; the update loop applies a head-roll sway +
  // pink overlay tint that decays over time. Sleeping on the bed clears it.
  let drunkLevel = 0;
  const drunkOverlay = document.createElement('div');
  drunkOverlay.style.cssText =
    'position:fixed;inset:0;background:rgba(255,140,200,0);'
    + 'pointer-events:none;mix-blend-mode:soft-light;transition:background .6s;z-index:38;';
  document.body.appendChild(drunkOverlay);
  const drunkVignette = document.createElement('div');
  drunkVignette.style.cssText =
    'position:fixed;inset:0;pointer-events:none;'
    + 'background:radial-gradient(ellipse at center,'
    + 'rgba(0,0,0,0) 35%, rgba(0,0,0,0.65) 100%);'
    + 'opacity:0;transition:opacity .6s;z-index:39;';
  document.body.appendChild(drunkVignette);

  interact.add(barProxy, '調一杯酒', () => {
    props.bar.pulse();
    drunkLevel = Math.min(1.8, drunkLevel + 0.55);
    interact.flash('🍸 NEON COLA + 合成龍舌蘭…乾杯!');
  }, 2.6);
  interact.add(sofaProxy, '坐下 (電動沙發)', () => {
    if (seated) return;
    seated = true;
    reclined = false;
    massageT = 0;
    savedPose = {
      pos: ctx.camera.position.clone(),
      yaw: controls.getYaw(),
      pitch: controls.getPitch(),
    };
    // controls stay ENABLED so mouse-look works while seated; the update
    // loop locks position back to seatBase every frame so WASD/gravity
    // can't actually move the player.
    controls.enabled = true;
    seatBase.set(0.4, 1.18, 2.0);
    ctx.camera.position.copy(seatBase);
    controls.setOrientation(Math.PI, -0.04);
    interact.flash('已就座 — 滑鼠左右看 · [R] 椅背 · [M] 按摩 · 移動鍵起身', 3600);
  }, 2.8);
  window.addEventListener('keydown', (e) => {
    if (!seated) return;
    if (e.code === 'KeyR') {
      reclined = !reclined;
      seatBase.set(0.4, reclined ? 1.02 : 1.18, reclined ? 1.75 : 2.0);
      ctx.camera.position.copy(seatBase);
      controls.setOrientation(Math.PI, reclined ? 0.34 : -0.04);
      interact.flash(reclined ? '⚙ 椅背放平 — 看看高樓上的雨' : '⚙ 椅背豎直');
    }
    if (e.code === 'KeyM') {
      massageT = massageT > 0 ? 0 : 8;
      interact.flash(massageT > 0 ? '〰 按摩模式 8 秒' : '按摩停止');
    }
  });
  interact.add(bedProxy, '小睡片刻', () => {
    fade.style.opacity = '1';
    const wasDrunk = drunkLevel > 0.05;
    drunkLevel = 0;
    window.setTimeout(() => {
      fade.style.opacity = '0';
      interact.flash(wasDrunk
        ? '…睡了一會兒,酒醒了'
        : '…睡了一會兒,窗外的雨還沒停');
    }, 1600);
  }, 2.8);
  interact.add(props.lightPanel, '燈光情境', () => {
    interact.flash(`💡 燈光:${cycleLights()}`);
  }, 2.4);
  interact.add(props.counterPendants.hit, '吧檯柔光', () => {
    const on = props.counterPendants.toggle();
    interact.flash(on ? '🪔 吧檯柔光開啟 — 配馬賽克牆比較不刺眼' : '🪔 吧檯柔光熄滅 — 高對比模式');
  }, 3.0);
  interact.add(props.holo.base, '全息投影', () => {
    interact.flash(`🔮 投影頻道:${props.holo.cycle()}`);
  }, 2.6);
  interact.add(props.curtain.panel, '電動窗簾', () => {
    const closing = props.curtain.toggle();
    interact.flash(closing ? '🪟 窗簾下降中…' : '🪟 窗簾上升中…');
  }, 2.4);
  // open an OS app in place (no desk camera tween)
  const enterApp = (openFn: () => void) => {
    if (mode !== 'play') return;
    tweenFrom.pos.copy(ctx.camera.position);
    tweenFrom.yaw = controls.getYaw();
    tweenFrom.pitch = controls.getPitch();
    mode = 'os';
    controls.enabled = false;
    controls.release();
    interact.enabled = false;
    lockHint.classList.add('gone');
    os.enter();
    openFn();
  };
  // bookshelf → 藏書閣 reader; each titled spine opens exactly that book
  interact.add(room.bookshelf, '藏書架', () => {
    interact.flash('📖 看準一本書的書脊按 E,把它取下來讀');
  }, 3.0);
  for (const { mesh, book } of room.titledBooks) {
    interact.add(mesh, `取下《${book.title}》`, () => {
      if (mode !== 'play' || reader.isOpen) return;
      controls.enabled = false;
      interact.enabled = false;
      void reader.open(book);
    }, 2.4);
  }
  // shard trays: the art shard now re-curates every wall frame
  interact.add(room.shardTrayArt, '讀取碎片:重新策展 (全部換畫)', () => {
    props.art.next();
    interact.flash('🖼 已向大都會博物館請求新一批館藏…');
  }, 2.4);
  interact.add(room.shardTrayAudio, '讀取碎片:家庭錄音檔案', () => enterApp(() => os.openViola()), 2.4);
  interact.add(room.devlogShard, '??? 金色碎片', () => enterApp(() => os.openDevlog()), 2.2);

  // wall frames: E swaps that frame for another painting
  for (const f of props.art.frames) {
    interact.add(f, '換一幅畫', () => {
      props.art.next();
      interact.flash('🖼 重新策展中…');
    }, 3.2);
  }

  // bathroom
  interact.add(room.bathroom.door, '浴室門', () => {
    interact.flash(room.bathroom.toggleDoor() ? '🚪 門開啟' : '🚪 門關閉');
  }, 2.6);
  interact.add(room.bathroom.toilet, '沖水', () => {
    ambience.flush();
    interact.flash('🚽 嘩——');
  }, 2.0);
  interact.add(room.bathroom.mirror, '智慧鏡', () => {
    interact.flash('🪞 鏡面掃描:外觀評分 SSS — 今晚也很賽博朋克');
  }, 2.2);
  interact.add(room.bathroom.shower, '淋浴', () => {
    const on = room.bathroom.toggleShower();
    ambience.shower(on);
    interact.flash(on ? '🚿 熱水 + 蒸氣中…' : '🚿 關閉');
  }, 2.4);
  interact.add(room.washer, '洗衣', () => {
    (room.washer.userData.startWash as () => void)();
    interact.flash('🌀 洗衣行程 20 秒 — 滾筒運轉中');
  }, 2.2);
  // speakers double as one-key BGM control: rain outside, music inside —
  // no need to jack into the PC once a station is loaded
  for (const sp of props.speakers) {
    interact.add(sp, '音樂 播放/暫停', () => {
      const st = os.ytToggle();
      if (st === 'offline') {
        interact.flash('🎧 還沒載入電台 — 幫你開 NeuroSound');
        enterApp(() => os.openNeuroSound());
      } else {
        interact.flash(st === 'paused' ? '⏸ 音樂暫停' : '▶ 音樂繼續 — 配著窗外的雨剛剛好');
      }
    }, 2.6);
  }

  // 虹 // IRIS — holographic assistant: lines reference live game + world state
  let lastWeatherText = '';
  const speak = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const zh = speechSynthesis.getVoices().find((v) => /zh|cmn/i.test(v.lang));
      if (zh) u.voice = zh;
      u.rate = 1.02;
      u.pitch = 1.1;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* no speech engine — subtitles only */ }
  };
  let irisLineIdx = 0;
  const irisSay = (): string => {
    const now = new Date();
    const lines: string[] = [
      `現在時間 ${now.getHours()} 點 ${now.getMinutes()} 分。夜城的雨,下得比你的截止日還準時。`,
      lastWeatherText
        ? `外面的真實世界:${lastWeatherText}。窗外這場雨倒是我們自己選的。`
        : '定位資料還沒回來,不過依我看,哪裡都在下雨。',
      '你的咖啡因攝取量已超標。要我假裝沒看到,還是再煮一杯?',
      '夜貓今天換了三個睡覺位置。牠的日程比你充實。',
      '提醒:你已經盯著城市看了一陣子了。這不是壞事,我只是記錄一下。',
      '雨太大了嗎?我把它調小一點。…好了。',
    ];
    irisLineIdx = (irisLineIdx + 1) % lines.length;
    const line = lines[irisLineIdx];
    if (line.startsWith('雨太大了嗎')) setWeather('light');
    props.assistant.setTalk(4);
    speak(line);
    return line;
  };
  interact.add(props.assistant.base, '呼叫 虹 // IRIS', () => {
    interact.flash(`🟣 虹:「${irisSay()}」`, 5200);
  }, 3.0);

  // home completion round: cat, coffee, entry door, wardrobe
  interact.add(props.cat.body, '摸摸夜貓', () => {
    props.cat.pet();
    ambience.purr();
    interact.flash('🐈‍⬛ 夜貓:呼嚕嚕嚕…(尾巴拍了拍)');
  }, 2.2);
  interact.add(props.coffee.machine, '沖一杯咖啡', () => {
    if (props.coffee.brew()) {
      ambience.brewSound();
      interact.flash('☕ 合成豆研磨中…(7 秒)');
    } else {
      interact.flash('☕ 已經在煮了,稍安勿躁');
    }
  }, 2.4);
  interact.add(room.entry.door, '大門', () => {
    interact.flash(room.entry.toggle() ? '🚪 安全鎖解除 — 門開' : '🚪 門關閉,上鎖');
  }, 2.8);
  interact.add(room.entry.package, '撿起包裹', () => {
    room.entry.setDelivered(false);
    const loot = [
      '📦 NEON COLA 兌換箱 — 裡面是 24 罐酸雨檸檬口味',
      '📦 鄰居誤送的義體目錄 — 折頁停在「夜視瞳 v2」那頁',
      '📦 一束塑膠花,附卡片:「替我澆水 — K」',
      '📦 二手書《如何與你的智慧家居和平共處》',
      '📦 空箱子。只有一張字條:「他們在看。」',
    ];
    interact.flash(loot[Math.floor(Math.random() * loot.length)], 4200);
  }, 2.4);
  interact.add(room.wardrobe.mesh, '換裝', () => {
    interact.flash(`🧥 義體外裝 → ${room.wardrobe.cycleOutfit()}(去浴室照照鏡子)`, 3200);
  }, 2.6);
  // bedside star projector: cycle off / 賽博 / 暖光 / 古典
  interact.add(room.starProjector.hit, '床頭星空儀', () => {
    interact.flash(`✨ 星空儀 → ${room.starProjector.cycle()}`);
  }, 2.0);
  // ------- pickup system -------
  // Aim at a pickable, E to grab — item parents to the camera and follows your
  // head until you press F (drop where you're standing) or Q (return to its
  // original spot). Held items dim the interact prompt while in hand.
  type PickableState = {
    obj: THREE.Object3D;
    name: string;
    origParent: THREE.Object3D;
    origPos: THREE.Vector3;
    origRot: THREE.Euler;
  };
  const pickables = new Map<THREE.Object3D, PickableState>();
  let heldItem: PickableState | null = null;
  const HOLD_OFFSET = new THREE.Vector3(0.22, -0.18, -0.38);

  const registerPickable = (obj: THREE.Object3D, name: string): void => {
    pickables.set(obj, {
      obj, name,
      origParent: obj.parent ?? ctx.scene,
      origPos: obj.position.clone(),
      origRot: obj.rotation.clone(),
    });
    interact.add(obj, `拿起 ${name}`, () => {
      if (heldItem) return;
      const p = pickables.get(obj);
      if (!p) return;
      heldItem = p;
      p.origParent.remove(obj);
      ctx.camera.add(obj);
      obj.position.copy(HOLD_OFFSET);
      obj.rotation.set(0, 0, 0);
      interact.flash(`✋ 拿著「${name}」— [F] 放下 · [Q] 放回原位`, 3000);
    }, 2.0);
  };

  for (const p of props.pickables) registerPickable(p.obj, p.name);

  window.addEventListener('keydown', (e) => {
    if (!heldItem) return;
    if (e.code !== 'KeyF' && e.code !== 'KeyQ') return;
    const item = heldItem;
    if (e.code === 'KeyF') {
      // drop at current world position
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      item.obj.getWorldPosition(wp);
      item.obj.getWorldQuaternion(wq);
      ctx.camera.remove(item.obj);
      item.origParent.add(item.obj);
      item.obj.position.copy(wp);
      item.origParent.worldToLocal(item.obj.position);
      item.obj.quaternion.copy(wq);
      // de-conjugate parent's world rotation by setting local rotation
      const parentWorldQ = new THREE.Quaternion();
      item.origParent.getWorldQuaternion(parentWorldQ);
      item.obj.quaternion.premultiply(parentWorldQ.invert());
      interact.flash(`📍 「${item.name}」放在這`);
    } else {
      // return to original
      ctx.camera.remove(item.obj);
      item.origParent.add(item.obj);
      item.obj.position.copy(item.origPos);
      item.obj.rotation.copy(item.origRot);
      interact.flash(`↩ 「${item.name}」放回原位`);
    }
    heldItem = null;
  });

  // smart-fridge peek (E to open; auto-close after 6s)
  interact.add(room.fridge.hit, '打開冰箱', () => {
    const open = room.fridge.toggle();
    interact.flash(open
      ? '🧊 NEON COLA × 5 + 神秘紫色瓶子 + 鄰居的塑膠花'
      : '🚪 冰箱關起來');
  }, 2.8);

  // Do-Not-Disturb: keypad LED strip by the door doubles as a DND toggle.
  // Green = normal (doorbell + deliveries fire on schedule); red = quiet
  // (deliveries silently queue, get released on the first ring after toggling off).
  let dnd = false;
  let pendingDelivery = false;
  const keypadMat = room.entry.keypad.material as THREE.MeshStandardMaterial;
  const setDND = (on: boolean): boolean => {
    dnd = on;
    keypadMat.emissive.setHex(on ? 0xff2a3d : 0x39ff88);
    return dnd;
  };
  const toggleDND = (): boolean => setDND(!dnd);
  interact.add(room.entry.keypad, '勿擾模式 (DND) 切換', () => {
    const on = toggleDND();
    interact.flash(on
      ? '🔇 勿擾模式 — 門鈴會被靜音,包裹仍在門口累積'
      : '🔔 接受訪客 — 累積的包裹會在下次門鈴釋出');
  }, 2.4);

  // doorbell: a delivery arrives every few minutes
  let bellTimer = 150 + Math.random() * 180;
  window.setInterval(() => {
    if (mode !== 'play') return;
    bellTimer -= 5;
    if (bellTimer <= 0) {
      bellTimer = 240 + Math.random() * 300;
      if (dnd) {
        // queue silently — when the user toggles DND off, the next tick releases it
        pendingDelivery = true;
        return;
      }
      ambience.doorbell();
      room.entry.setDelivered(true);
      interact.flash('🔔 門鈴 — 有人放了東西在門口', 3600);
      pendingDelivery = false;
    } else if (!dnd && pendingDelivery) {
      // DND was just turned off and there's a queued package — release it on
      // the next tick instead of waiting for the full timer
      pendingDelivery = false;
      ambience.doorbell();
      room.entry.setDelivered(true);
      interact.flash('🔔 門鈴 — 趁你不在的時候有東西到了', 3600);
    }
  }, 5000);



  setWeather('light');

  // real-world weather for the smart mirror: IP geolocation → open-meteo
  // (both keyless + CORS-friendly); refreshed every 20 minutes
  const WMO_DESC: Array<[number[], string]> = [
    [[0], '晴'], [[1, 2], '多雲時晴'], [[3], '陰'], [[45, 48], '霧'],
    [[51, 53, 55, 56, 57], '毛毛雨'], [[61, 63, 65, 66, 67], '雨'],
    [[71, 73, 75, 77, 85, 86], '雪'], [[80, 81, 82], '陣雨'], [[95, 96, 99], '雷雨'],
  ];
  const fetchGeo = async (): Promise<{ lat: number; lon: number; label: string; cc: string }> => {
    // geojs first — ip-geo APIs are often on tracker blocklists (Firefox ETP
    // silently kills the fetch); geojs is usually allowed
    try {
      const g = await (await fetch('https://get.geojs.io/v1/ip/geo.json')).json();
      if (g?.latitude) {
        return {
          lat: Number(g.latitude), lon: Number(g.longitude),
          label: String(g.city ?? g.region ?? g.country ?? '?'),
          cc: String(g.country_code ?? 'US'),
        };
      }
    } catch { /* fall through */ }
    const g2 = await (await fetch('https://ipwho.is/')).json();
    if (!g2?.success) throw new Error('geo failed');
    return {
      lat: Number(g2.latitude), lon: Number(g2.longitude),
      label: String(g2.city ?? '?'), cc: String(g2.country_code ?? 'US'),
    };
  };
  const fetchRealWeather = async () => {
    try {
      const geo = await fetchGeo();
      const wx = await (await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
        '&current=temperature_2m,weather_code,relative_humidity_2m',
      )).json();
      const cur = wx?.current;
      if (!cur) throw new Error('weather failed');
      const code = Number(cur.weather_code);
      const desc = WMO_DESC.find(([codes]) => codes.includes(code))?.[1] ?? '—';
      room.bathroom.setRealWeather({
        city: geo.label,
        tempC: Number(cur.temperature_2m),
        desc,
        humidity: Math.round(Number(cur.relative_humidity_2m)),
      });
      lastWeatherText = `${geo.label} ${Number(cur.temperature_2m).toFixed(0)} 度,${desc}`;
      // local-language headlines for the mirror feed (dev-server proxy)
      try {
        const news = await (await fetch(`/__news?cc=${encodeURIComponent(geo.cc)}`)).json();
        if (Array.isArray(news?.titles) && news.titles.length) {
          room.bathroom.setNews(news.titles);
        }
      } catch { /* mirror just keeps showing 擷取中 */ }
    } catch (err) {
      console.warn('[mirror] real weather unavailable', err);
      room.bathroom.setRealWeather(null);
    }
  };
  fetchRealWeather();
  window.setInterval(fetchRealWeather, 20 * 60 * 1000);

  step(0.9);
  await initXR(ctx);

  // spawn in the living area facing the window/city
  ctx.camera.position.set(-1.5, 1.7, -0.5);
  controls.setOrientation(Math.PI, -0.02);

  // hide boot screen
  step(1.0);
  setTimeout(() => bootEl.classList.add('gone'), 200);
  setTimeout(() => bootEl.remove(), 1200);

  // fps counter (writes the outer `fps` used by SysMon)
  let frame = 0; let lastTick = performance.now();
  const updateStats = () => {
    frame++;
    const now = performance.now();
    if (now - lastTick > 500) {
      fps = (frame * 1000) / (now - lastTick);
      frame = 0; lastTick = now;
      statsEl.textContent =
        `FPS ${fps.toFixed(0)} · ${settings.preset.toUpperCase()} · ${hw.gpuVendor}` +
        (hw.webgpuAvailable ? ' · WebGPU' : ' · WebGL2');
      if (import.meta.env.DEV) {
        document.title = shaderErrCount > 0
          ? `NEON-SHADER-ERR ${shaderErrCount} FPS ${fps.toFixed(0)}`
          : `NEON-OK FPS ${fps.toFixed(0)} ${settings.preset}`;
      }
    }
  };

  // Chrome's ANGLE backend on old Mesa drivers (e.g. HD 4000 / crocus) fails
  // every shader with VALIDATE_STATUS false → white screen. Detect and explain
  // instead of leaving the user staring at a blank canvas.
  const showGpuFailOverlay = () => {
    if (document.getElementById('gpufail')) return;
    const el = document.createElement('div');
    el.id = 'gpufail';
    el.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;' +
      'background:#05060a;color:#c8f2ff;text-align:center;font-family:"Share Tech Mono",monospace;';
    el.innerHTML = '<div><div style="color:#ff2bdb;font-size:22px;letter-spacing:.2em">' +
      'GPU DRIVER INCOMPATIBLE</div><div style="margin-top:14px;font-size:14px;line-height:1.8">' +
      '此瀏覽器的 GPU 後端無法編譯 shader（常見於 Chrome + 舊款 Intel 內顯）。<br/>' +
      '請改用 <b style="color:#5af2ff">Firefox</b> 開啟本頁，即可正常遊玩。</div></div>';
    document.body.appendChild(el);
  };
  canvas.addEventListener('webglcontextlost', () => {
    document.title = 'NEON-CTX-LOST';
    showGpuFailOverlay();
    sendBeacon();
  });
  setTimeout(() => { if (shaderErrCount > 0) showGpuFailOverlay(); }, 4000);

  // dev-only render health beacon (no-op in production builds)
  let lastCmdNonce = '';
  const sendBeacon = () => {
    if (!import.meta.env.DEV) return;
    const gl = ctx.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    fetch('/__beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ua: navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0] ?? 'unknown',
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked',
        shaderErrors: shaderErrCount,
        contextLost: gl.isContextLost(),
        fps: Number(fps.toFixed(1)),
        preset: settings.preset,
        pos: ctx.camera.position.toArray().map((v) => Number(v.toFixed(1))),
        osState: { ...os.getDebugState(), casting: props.tv.isCasting() && !castVideo.paused, castId: castingTitle },
      }),
    }).then((r) => r.json()).then((j: {
      shot?: boolean;
      cam?: { pos: number[]; yaw: number; pitch: number } | null;
      cmd?: { nonce: string; term: string } | null;
    }) => {
      if (j?.cmd?.term && j.cmd.nonce !== lastCmdNonce) {
        lastCmdNonce = j.cmd.nonce;
        console.info('[remote-term]', j.cmd.term, '→', os.execTerm(j.cmd.term));
      }
      if (j?.cam?.pos) {
        // remote camera teleport (dev-only); force a frame so a throttled
        // background tab still captures the new view
        ctx.camera.position.set(j.cam.pos[0], j.cam.pos[1], j.cam.pos[2]);
        controls.setOrientation(j.cam.yaw, j.cam.pitch);
        ctx.composer.render();
      }
      if (j?.shot) {
        // composite onto an opaque 2D canvas: the WebGL buffer's alpha channel
        // is zero, so a direct toDataURL yields a fully transparent PNG
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = canvas.height;
        const g2 = c2.getContext('2d')!;
        g2.fillStyle = '#000';
        g2.fillRect(0, 0, c2.width, c2.height);
        g2.drawImage(canvas, 0, 0);
        fetch('/__shot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ua: navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0] ?? 'unknown',
            dataUrl: c2.toDataURL('image/png'),
          }),
        }).catch(() => {});
      }
    }).catch(() => { /* dev server gone; ignore */ });
  };
  setInterval(sendBeacon, 3000);

  // YouTube volume follows distance to the nearest speaker
  window.setInterval(() => {
    os.setSpatialGain(speakerGain(ctx.camera.position, props.speakerPositions));
  }, 600);

  // dev hooks for automated self-testing (CDP / console)
  if (import.meta.env.DEV) {
    (window as any).neon = {
      os,
      reader,
      castToTV,
      stopCast,
      tv: props.tv,
      selfTest: () => os.selfTest(),
      setWeather,
      getWeather: () => weatherLevel,
      // placement audit: flags meshes embedded in walls, floating, or overlapping
      audit: () => {
        const issues: Array<{ kind: string; name: string; detail: string }> = [];
        const wallSlabs = [
          new THREE.Box3(new THREE.Vector3(-6.125, -1, -7.2), new THREE.Vector3(-5.875, 7, 7.2)),
          new THREE.Box3(new THREE.Vector3(5.875, -1, -7.2), new THREE.Vector3(6.125, 7, 7.2)),
          new THREE.Box3(new THREE.Vector3(-6.2, -1, -7.125), new THREE.Vector3(6.2, 7, -6.875)),
          new THREE.Box3(new THREE.Vector3(-6.2, -1, 6.875), new THREE.Vector3(6.2, 7, 7.125)),
        ];
        const meshes: Array<{ m: THREE.Mesh; box: THREE.Box3; vol: number }> = [];
        for (const grp of [room.group, props.group]) {
          grp.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.visible) return;
            const box = new THREE.Box3().setFromObject(mesh);
            if (!isFinite(box.min.x)) return;
            const s = new THREE.Vector3();
            box.getSize(s);
            meshes.push({ m: mesh, box, vol: s.x * s.y * s.z });
          });
        }
        const label = (mesh: THREE.Mesh) =>
          mesh.name || `${mesh.geometry.type}@${mesh.position.toArray().map((v) => v.toFixed(2))}`;
        // 1) embedded in architectural walls (centre of the mesh inside a slab)
        for (const { m, box } of meshes) {
          const c = new THREE.Vector3();
          box.getCenter(c);
          for (const slab of wallSlabs) {
            if (slab.containsPoint(c)) {
              issues.push({ kind: 'IN-WALL', name: label(m), detail: c.toArray().map((v) => v.toFixed(2)).join(',') });
            }
          }
          if (box.min.y < -0.03 && box.min.y > -3) {
            issues.push({ kind: 'BELOW-FLOOR', name: label(m), detail: `minY=${box.min.y.toFixed(3)}` });
          }
        }
        // 2) significant overlap between sizeable named meshes
        const big = meshes.filter((x) => x.vol > 0.02 && x.m.name);
        for (let i = 0; i < big.length; i++) {
          for (let j = i + 1; j < big.length; j++) {
            const a = big[i], b = big[j];
            if (a.box.intersectsBox(b.box)) {
              const inter = a.box.clone().intersect(b.box);
              const s = new THREE.Vector3();
              inter.getSize(s);
              const overlap = s.x * s.y * s.z;
              if (overlap > 0.25 * Math.min(a.vol, b.vol)) {
                issues.push({ kind: 'OVERLAP', name: `${label(a.m)} × ${label(b.m)}`, detail: `${(overlap * 1000).toFixed(0)}L` });
              }
            }
          }
        }
        return issues;
      },
    };
  }

  const lerpAngle = (a: number, b: number, k: number) => {
    const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * k;
  };

  let frameNo = 0;
  ctx.renderer.setAnimationLoop(() => {
    const dt = Math.min(ctx.clock.getDelta(), 0.05);
    const t = ctx.clock.elapsedTime;
    frameNo++;
    // CyberOS covers the screen — render the world at 1/6 rate while it's open
    if (mode === 'os' && frameNo % 6 !== 0) return;
    if (mode === 'enter-os') {
      tweenT = Math.min(tweenT + dt / 0.55, 1);
      const k = tweenT * tweenT * (3 - 2 * tweenT); // smoothstep
      ctx.camera.position.lerpVectors(tweenFrom.pos, monitorPose.pos, k);
      ctx.camera.rotation.set(
        tweenFrom.pitch + (monitorPose.pitch - tweenFrom.pitch) * k,
        lerpAngle(tweenFrom.yaw, monitorPose.yaw, k),
        0,
      );
      if (tweenT >= 1) { mode = 'os'; os.enter(); }
    } else if (mode === 'play') {
      controls.update(dt);
      interact.update();
      arcade.update(t, dt);
      // reflective mirror: render only when the player is near the bathroom,
      // and keep the cyber-avatar glued to the player's pose
      const nearMirror = ctx.camera.position.distanceTo(room.bathroom.mirror.position) < 5;
      room.bathroom.reflector.visible = nearMirror;
      if (nearMirror) {
        room.bathroom.avatar.position.set(
          ctx.camera.position.x, ctx.camera.position.y - 1.7, ctx.camera.position.z);
        room.bathroom.avatar.rotation.y = controls.getYaw();
      }
      // cast audio follows the floating screen
      if (props.tv.isCasting()) {
        const d = ctx.camera.position.distanceTo(props.tv.screen.position);
        castVideo.volume = Math.max(0.08, 1 - Math.max(0, (d - 2)) / 10);
      }
      // occupancy-sensing privacy glass: opaque while someone is inside the pod
      room.bathroom.setPrivate(
        ctx.camera.position.x > 2.55 && ctx.camera.position.z < -3.85
        && ctx.camera.position.y < 3,
      );
      // electric sofa: lock position to seatBase every frame so mouse-look
      // still works (head turn) but WASD/gravity can't move the player.
      if (seated) {
        if (massageT > 0) {
          massageT -= dt;
          ctx.camera.position.set(
            seatBase.x + Math.sin(t * 47) * 0.006,
            seatBase.y + Math.sin(t * 61) * 0.008,
            seatBase.z + Math.sin(t * 53) * 0.005,
          );
          if (massageT <= 0) ctx.camera.position.copy(seatBase);
        } else {
          ctx.camera.position.copy(seatBase);
        }
        // clamp yaw to ±90° around facing-window (Math.PI) so the player can
        // turn their head but not look behind through the sofa back
        let yaw = controls.getYaw();
        let delta = yaw - Math.PI;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const YAW_LIMIT = 1.55;   // ~90° each side
        if (delta > YAW_LIMIT) delta = YAW_LIMIT;
        else if (delta < -YAW_LIMIT) delta = -YAW_LIMIT;
        let pitch = controls.getPitch();
        const PITCH_LIMIT = 0.9;
        if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
        else if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
        controls.setOrientation(Math.PI + delta, pitch);
      }
      // drunk drift — head roll sway + pink overlay tint + edge vignette
      if (drunkLevel > 0.005) {
        drunkLevel = Math.max(0, drunkLevel - dt * 0.045);   // ~22s per +1 drink
        const k = Math.min(1, drunkLevel);
        const roll = Math.sin(t * 1.6) * k * 0.08 + Math.sin(t * 0.9 + 1.4) * k * 0.04;
        ctx.camera.rotation.z = roll;       // FPControls.update sets z=0; apply after
        const tintA = (k * 0.22).toFixed(3);
        drunkOverlay.style.background = `rgba(255,140,200,${tintA})`;
        drunkVignette.style.opacity = (k * 0.55).toFixed(3);
      } else if (ctx.camera.rotation.z !== 0) {
        ctx.camera.rotation.z = 0;
        drunkOverlay.style.background = 'rgba(255,140,200,0)';
        drunkVignette.style.opacity = '0';
      }
    }
    // party mood: slow hue sweep on the accent fixtures
    if (MOODS[moodIdx].name === '派對') {
      partyHue.setHSL((t * 0.08) % 1, 1, 0.55);
      lights.fixtures[1]?.color.copy(partyHue);          // under-stair wash
      if (lights.fixtures[5]) {
        lights.fixtures[5].color.setHSL(((t * 0.08) + 0.5) % 1, 1, 0.55); // arcade
      }
      const pulse = 0.75 + 0.25 * Math.sin(t * 6);
      lights.fixtures[0].intensity = lights.baseIntensities[0] * 0.7 * pulse;
    }
    room.update(t);
    city.update(t, dt);
    rain.update(dt);
    props.update(t, dt);
    if (lantern) lantern.update(dt);
    if (deskLantern) deskLantern.update(dt);
    if (mosaic) mosaic.update(t, dt);
    // closed curtain muffles the rain (about half as loud through the fabric)
    ambience.update(ctx.camera.position, ROOM_BOUNDS.d / 2,
      rainValue * (1 - 0.55 * props.curtain.amount()));
    ctx.composer.render();
    updateStats();
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#ff2bdb;padding:32px;font-family:'Share Tech Mono'">FATAL: ${err}\n${err.stack ?? ''}</pre>`;
});
