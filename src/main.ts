import * as THREE from 'three';
import { detectHardware, pickPreset, settingsFor, loadOverride } from './engine/quality';
import { createEngine } from './engine/renderer';
import { loadPrefs, savePrefs } from './engine/render_prefs';
import type { RenderPrefs } from './engine/render_prefs';
import { initXR } from './engine/xr';
import { installLighting, bakeEnvFromCity } from './world/lighting';
import { buildRoom } from './world/room';
import { buildCity } from './world/city';
import { buildRain } from './world/weather';
import { FPControls } from './player/fp-controls';
import { InteractSystem } from './player/interact';
import { TouchControls } from './player/touch-controls';
import { BookReader } from './player/bookreader';
import { FloorPlan } from './player/plan_view';
import { Ambience, speakerGain } from './world/audio';
import { HoloArcade } from './world/arcade';
import { ROOM_BOUNDS } from './world/room';
import { buildProps } from './world/props';
import { buildBarLantern, buildDeskLantern, type Lantern } from './world/lantern';
import { loadLoungeSofas } from './world/lounge_sofas';
import { buildFlipMosaic, type FlipMosaic } from './world/flip_mosaic';
import { CyberOS } from './pc/os';
import { RoomState, type DeviceDef } from './state/room_state';
import { saveOverride, needsReload } from './engine/quality';
import { buildVolumetric } from './engine/volumetric';
import { DepthOfFieldEffect, EffectPass } from 'postprocessing';
import { t, mountLangToggle } from './lib/i18n';
import { mountCredits } from './lib/credits';
import {
  runPlacementAudit as _runPlacementAudit,
  formatAuditReport as _formatAuditReport,
  type AuditIssue,
} from './dev/placement_audit';
import { applyOverrides, listEditableIds, getEditable, resetEditableRegistry } from './world/editable';
import OVERRIDES_JSON from '../overrides.json' with { type: 'json' };

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
  // Allow ?preset=ultra or #ultra to force the preset for one-shot comparison
  // shots without needing to click through SysMon. Survives reload only if
  // the hash/query is kept in the URL.
  const urlPreset = (() => {
    const m = location.hash.match(/^#(low|medium|high|ultra)$/)
      ?? new URL(location.href).searchParams.get('preset')?.match(/^(low|medium|high|ultra)$/);
    return m ? (m[1] as 'low' | 'medium' | 'high' | 'ultra') : null;
  })();
  // Touch detection used both for preset gating below AND for the touch UI
  // wiring further down. iPhones report "apple" GPU but no M1+ → fall into
  // `medium` by default which runs at ~8 fps. Force LOW on touch unless the
  // user explicitly overrode via URL hash / SysMon.
  const isTouchEarly = new URL(location.href).searchParams.get('touch') === '1'
                    || (navigator.maxTouchPoints ?? 0) > 0
                    || window.matchMedia('(pointer:coarse)').matches;
  const detectedPreset = isTouchEarly ? 'low' : pickPreset(hw);
  const preset = urlPreset ?? loadOverride() ?? detectedPreset;
  const settings = settingsFor(preset);
  console.info('[NEON LOFT] hardware', hw, '→ preset', preset);

  step(0.3);
  // Render prefs loaded before engine creation so initial tonemapping and fog
  // are set at shader-compile time, avoiding a forced recompile on first frame.
  const renderPrefs: RenderPrefs = loadPrefs();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
  appEl.appendChild(canvas);
  const ctx = createEngine(canvas, settings, renderPrefs);

  step(0.5);
  const lights = installLighting(ctx);
  resetEditableRegistry(); // T3: reset before any builder (buildRoom, buildProps, etc.)
  const room = buildRoom(ctx);
  const city = buildCity(ctx);
  const rain = buildRain(ctx);
  // Volumetric god-rays (M3) — gated by preset (HD 4000 stays at 0 sources).
  // Inserts into composer chain before bloom; anchors come from the city
  // build (rotating holo ring, holo octahedron, searchlight).
  const volumetric = buildVolumetric(ctx, city.volumetricAnchors);
  // HDR env bake (M6) — one-shot CubeCamera from the room center to give
  // every indoor MeshStandardMaterial city-colored IBL. Fail-soft.
  bakeEnvFromCity(ctx);

  step(0.75);
  const controls = new FPControls(ctx.camera, canvas, { eyeHeight: 1.7 });
  controls.setWalls(room.walls);
  controls.setHeightSampler(room.heightAt);
  const ambience = new Ambience();
  // Touch-device detection. Pointer-lock doesn't exist on touch; on the
  // first tap we fake a "locked" state so the existing movement code path
  // engages, and skip the pointer-lock request entirely. The `?touch=1`
  // URL flag forces touch mode on desktop for testing without a phone.
  const forceTouch = new URL(location.href).searchParams.get('touch') === '1';
  const IS_TOUCH = forceTouch
                || (navigator.maxTouchPoints ?? 0) > 0
                || window.matchMedia('(pointer:coarse)').matches;
  // Activation callback fired on the first touch (since canvas.click is
  // eaten by touch-controls' preventDefault on mobile). The SAME gesture
  // both starts the app AND begins joystick/look — no separate "tap to
  // start" → "swipe to play" double-step. setLocked(true) triggers the
  // onLockChange listener below which handles ambience + audio unmute +
  // lockhint dismiss.
  const activateForTouch = () => {
    controls.setLocked(true);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { /* user said no */ });
    }
  };
  if (IS_TOUCH) {
    document.body.classList.add('touch');
    // Swap the desktop hint text — touch users don't have WASD / Shift / E
    lockHint.innerHTML = t('lock.touch') + '<br/>' + t('lock.touch.keys');
  }
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
    // Another subsystem may own input (the DEV editor sets controls.enabled=false
    // while it is open). This handler's entire job is to engage player input, so
    // bail out wholesale rather than guarding each branch — that also covers the
    // touch path, which fakes lock via setLocked() instead of requestLock().
    if (!controls.enabled) return;
    if (IS_TOUCH) {
      // Touch path: no pointer-lock (doesn't exist). Fake the locked state
      // so movement code engages, kick audio context, request fullscreen.
      controls.setLocked(true);
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => { /* user said no */ });
      }
      return;
    }
    controls.requestLock();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { /* user said no */ });
    }
  });

  step(0.82);
  const props = buildProps(ctx);

  // Apply overrides (position/rotation/scale) from overrides.json to registered
  // editable entities. Must run after buildRoom() so the registry is populated.
  // In DEV mode, fetch the live file from the server so edits made by the
  // editor (which writes to disk at runtime) are always picked up on reload,
  // even though the static import is cached by Vite's module graph.
  let _overridesData: unknown = OVERRIDES_JSON;
  if (import.meta.env.DEV) {
    const r = await fetch('/overrides.json', { cache: 'no-store' });
    if (!r.ok) {
      throw new Error(
        `[neon] DEV: failed to load /overrides.json (HTTP ${r.status} ${r.statusText}). ` +
        `Editor saves will not take effect. Check that the dev server is running and /overrides.json is readable.`,
      );
    }
    _overridesData = await r.json();
  }
  const { applied, orphaned } = applyOverrides(_overridesData);
  if (orphaned.length > 0) {
    console.warn(
      `[neon] orphaned override ids (not found in scene registry): ${orphaned.join(', ')} — orphaned override`,
    );
  }

  // Placement audit — shared by `window.neon.audit` (dev hook) and the
  // CyberOS terminal `audit` command.  Logic lives in src/dev/placement_audit.ts
  // so the headless gate (tools/gate/check_wall_clip.mjs) can run the same
  // checks without a renderer.

  /** Returns the raw issue list — used by window.neon.audit (dev hook). */
  const runPlacementAudit = (): AuditIssue[] =>
    _runPlacementAudit([room.group, props.group]).issues;

  /** Format the audit issues for CyberOS terminal display (i18n strings). */
  const formatAuditReport = (): string => {
    const issues = runPlacementAudit();
    if (issues.length === 0) {
      return t('audit.pass');
    }
    const head = t('audit.head.prefix') + issues.length + t('audit.head.suffix');
    const tally: Record<string, number> = {};
    for (const i of issues) tally[i.kind] = (tally[i.kind] ?? 0) + 1;
    const summary = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' · ');
    // Show up to 18 entries; truncate the rest with a footer
    const rows = issues.slice(0, 18).map((i) => `  [${i.kind}] ${i.name}  ${i.detail}`);
    const footer = issues.length > 18
      ? t('audit.more.prefix') + (issues.length - 18) + t('audit.more.suffix') : '';
    return [head, '  ' + summary, '', ...rows, footer].filter(Boolean).join('\n');
  };

  // ---- 2D floor-plan overlay (top-down map for layout discussion) ----
  // Toggled via term `plan` or the P key. Reads camera pose each frame but
  // never mutates 3D state. See src/player/plan_view.ts for the canvas.
  const planCanvas = document.getElementById('floorplan') as HTMLCanvasElement;
  const floorPlan = new FloorPlan({
    canvas: planCanvas,
    worldGroups: [room.group, props.group],
    width: ROOM_BOUNDS.w,
    depth: ROOM_BOUNDS.d,
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !e.repeat) {
      // ignore if user is in CyberOS terminal or reader — those handle their own keys
      if (mode === 'os' || reader.isOpen) return;
      floorPlan.toggle();
    }
  });

  // Turkish brass+mosaic-glass lantern on the bar/island — Blender-built GLB,
  // E to toggle, stained-glass glow when lit. Loaded async; if the GLB or
  // mosaic texture fails the rest of the room boots anyway.
  let lantern: Lantern | null = null;
  // Lounge layout — user chose to keep the Polyhaven Victorian black-leather
  // set; the custom Blender L-sectional is loaded but NOT added to the scene
  // (kept for easy revert if user changes their mind). Two Sofa_02 instances
  // arranged perpendicular form the L corner — Polyhaven has no native
  // sectional in their catalog, so we pair the model with itself.
  loadLoungeSofas().then(({ custom: _custom, classic, ottoman, armchair }) => {
    // Sofa A — long edge along x, facing +z (toward window). Centred slightly
    // south-west of original sofa anchor to leave room for piece B's footprint.
    if (classic) {
      classic.position.set(-0.4, 0, 1.7);
      ctx.scene.add(classic);
      // Sofa B — perpendicular instance. clone(true) deep-copies the gltf
      // scene; materials are shared (one shader compile, low VRAM cost).
      const sofaB = classic.clone(true);
      sofaB.name = 'ClassicSofa02_B';
      sofaB.position.set(1.45, 0, 2.7);
      sofaB.rotation.y = -Math.PI / 2;       // back faces +x, seat opens to -x
      ctx.scene.add(sofaB);
    }
    if (armchair) {
      // accent reading chair tucked into the south-east corner, angled to face
      // the L corner so 3 seats triangulate naturally
      armchair.position.set(3.4, 0, 4.6);
      armchair.rotation.y = -Math.PI * 0.65;
      ctx.scene.add(armchair);
    }
    if (ottoman) {
      // shared foot rest sitting in the L pocket — visible from both sofas.
      // Was at (0.6, 0, 3.6) which sank into the coffee table; moved into the
      // open corner just south of sofa A's right end.
      ottoman.position.set(0.7, 0, 2.7);
      ottoman.rotation.y = Math.PI * 0.10;
      ctx.scene.add(ottoman);
    }
  }).catch((e) => console.warn('[lounge sofas] load failed', e));

  buildBarLantern(new THREE.Vector3(-1.72, 0.952, -4.32), () => {
    ambience.blip(820); ambience.blip(640);
  }).then((l) => {
    lantern = l;
    ctx.scene.add(l.group);
    interact.add(l.hit, l.isOn() ? t('prompt.barLantern.on') : t('prompt.barLantern.off'), () => {
      const on = l.toggle();
      interact.flash(on ? t('flash.barLantern.on') : t('flash.barLantern.off'));
      // update prompt label after toggle
      const entry = (interact as any).targets?.find?.((x: any) => x.object === l.hit);
      if (entry) entry.prompt = on ? t('prompt.barLantern.on') : t('prompt.barLantern.off');
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
      s === 'off' ? t('prompt.deskLantern.off') : s === 'dim' ? t('prompt.deskLantern.dim') : t('prompt.deskLantern.bright');
    interact.add(l.hit, t('prompt.deskLantern'), () => {
      const newLevel = l.cycle();
      const label = newLevel === 'off' ? t('flash.deskLantern.off')
        : newLevel === 'dim' ? t('flash.deskLantern.dim')
        : t('flash.deskLantern.bright');
      interact.flash(`${t('flash.deskLantern.prefix')} ${label},${t('flash.deskLantern.next')}${promptFor(newLevel)}`);
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
    interact.add(m.hit, t('prompt.mosaic'), () => {
      const label = m.reveal();
      interact.flash(`${t('flash.mosaic.prefix')} ${label}`);
      ambience.blip(720); ambience.blip(540);
    }, 3.4);
  }).catch((e) => console.warn('[mosaic] load failed', e));

  // ---------- weather state (terminal-controllable) ----------
  let weatherLevel: 'off' | 'light' | 'heavy' = 'light';
  let rainValue = 0.8;
  // raw scene applier — RoomState owns the canonical value; everyone else
  // (E-press, terminal, URL restore, future sync) goes through setWeather.
  const applyWeather = (level: 'off' | 'light' | 'heavy') => {
    weatherLevel = level;
    rainValue = level === 'off' ? 0 : level === 'light' ? 0.8 : 1.9;
    rain.setIntensity(Math.max(rainValue, 0.0001));
    rain.rain.visible = level !== 'off';
  };
  const setWeather = (level: 'off' | 'light' | 'heavy') => {
    roomState.set('weather', level);
  };

  // ---------- interaction system ----------
  const interact = new InteractSystem(ctx.camera);

  // ---------- RoomState: serialisable source of truth for devices (M2) ----
  // E-press / terminal / URL-restore / future multiplayer all mutate through
  // this store; props only receive absolute apply() calls from it.
  const roomState = new RoomState();
  // M4 share: a #room=<token> in the URL is a full room snapshot. Devices
  // that register late (async lanterns) pull their own pending value, so
  // restore isn't a single boot-time pass that async loads could miss.
  const pendingSnap = (() => {
    const m = location.hash.match(/room=([A-Za-z0-9_-]+)/);
    return m ? RoomState.decode(m[1]) : null;
  })();
  const registerDevice = (def: DeviceDef): void => {
    roomState.register(def);
    if (pendingSnap && def.id in pendingSnap) {
      roomState.set(def.id, pendingSnap[def.id], 'restore');
    }
  };
  // keep the address bar shareable at all times (debounced hash rewrite)
  let urlTimer = 0;
  roomState.subscribe(() => {
    window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      history.replaceState(null, '', `#room=${roomState.encode()}`);
    }, 400);
  });
  const shareURL = (): string =>
    `${location.origin}${location.pathname}#room=${roomState.encode()}`;

  registerDevice({
    id: 'weather', value: 'light', states: ['off', 'light', 'heavy'],
    apply: (v) => applyWeather(v as 'off' | 'light' | 'heavy'),
  });
  registerDevice({
    id: 'curtain', value: false, states: [false, true],
    apply: (v) => props.curtain.set(v as boolean),
  });
  registerDevice({
    id: 'pendants', value: true, states: [false, true],
    apply: (v) => { if (props.counterPendants.isOn() !== v) props.counterPendants.toggle(); },
  });
  registerDevice({
    id: 'neon', value: props.neonSign.names[0], states: props.neonSign.names,
    apply: (v) => props.neonSign.set(v as string),
  });
  registerDevice({
    id: 'tv', value: props.tv.channelNames[0], states: props.tv.channelNames,
    apply: (v) => { props.tv.setChannel(v as string); },
  });
  registerDevice({
    id: 'holo', value: props.holo.names[0], states: props.holo.names,
    apply: (v) => props.holo.set(v as string),
  });

  // Mount touch controls AFTER interact exists. Only adds listeners +
  // touches DOM when IS_TOUCH is true; no-op on desktop (the joystick
  // div is `display:none` without body.touch). The third arg is fired
  // on the FIRST touch so we satisfy autoplay / fullscreen gestures.
  if (IS_TOUCH) {
    new TouchControls(controls, interact, activateForTouch);
  }

  // holographic arcade cabinet — NEON BREAKER, actually playable
  const arcade = new HoloArcade(
    new THREE.Vector3(-4.6, 0, 4.75), 2.15, (f) => ambience.blip(f));
  ctx.scene.add(arcade.group);
  arcade.onClose = () => {
    controls.enabled = true;
    controls.clearKeys();
    interact.enabled = true;
    interact.flash(t('flash.arcade.leave'));
  };
  interact.add(arcade.screen, t('prompt.arcade.screen'), () => {
    if (mode !== 'play' || arcade.isActive) return;
    controls.enabled = false;
    interact.enabled = false;
    arcade.start();
  }, 2.8);
  interact.add(arcade.shell, t('prompt.arcade.shell'), () => {
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

  // ---------- M5 cinema / vista mode ----------
  // Layered over the seated state: when on, fade-in DOM letterbox bars,
  // enable a DOF post-pass, and after 8s of no mouse jiggle accumulate a
  // tiny yaw drift to sell "looking out the window".
  let cinemaOn = false;
  let cinemaIdleT = 0;          // seconds since last mouse motion (when seated)
  let cinemaSitGrace = 0;       // seconds remaining before auto-cinema kicks in after sit
  // letterbox DOM (cheap; doesn't fight with the WebGL canvas)
  const letterTop = document.createElement('div');
  const letterBot = document.createElement('div');
  for (const bar of [letterTop, letterBot]) {
    bar.style.cssText =
      'position:fixed;left:0;right:0;height:0;background:#000;'
      + 'pointer-events:none;transition:height .8s ease;z-index:37;';
    document.body.appendChild(bar);
  }
  letterTop.style.top = '0';
  letterBot.style.bottom = '0';
  // DOF pass — gated by preset enableDOF flag. Added at boot, enabled toggled
  // by cinema state so HD 4000 only pays the cost when the player asks for it.
  let dofPass: EffectPass | null = null;
  if (settings.enableDOF) {
    const dof = new DepthOfFieldEffect(ctx.camera, {
      focusDistance: 0.018,      // approx window distance / camera far
      focalLength: 0.06,
      bokehScale: settings.preset === 'ultra' ? 4.0 : 2.4,
    });
    dofPass = new EffectPass(ctx.camera, dof);
    dofPass.enabled = false;     // off by default; cinema flips it on
    // insert before the main bloom EffectPass; current order is
    //   [RenderPass, (Volumetric?), MainEffectPass]
    // we want   [..., DOF, MainEffectPass], so add at length-1.
    ctx.composer.addPass(dofPass, ctx.composer.passes.length - 1);
  }
  const setCinema = (on: boolean): boolean => {
    cinemaOn = on;
    if (dofPass) dofPass.enabled = on;
    const h = on ? '64px' : '0';
    letterTop.style.height = h;
    letterBot.style.height = h;
    if (!on) cinemaIdleT = 0;
    return on;
  };
  // any pointer motion cancels the idle pan (and exits cinema if user moves
  // the mouse aggressively while not seated — sitting locks the look so a
  // jiggle doesn't break it)
  window.addEventListener('mousemove', () => {
    cinemaIdleT = 0;
    if (cinemaOn && !seated) setCinema(false);
  });
  const stand = () => {
    if (!seated || !savedPose) return;
    seated = false;
    controls.enabled = true;
    controls.clearKeys();
    ctx.camera.position.copy(savedPose.pos);
    controls.setOrientation(savedPose.yaw, savedPose.pitch);
    // exit cinema when standing — the cinematic crop only makes sense
    // when the player has parked the camera and is looking out
    if (cinemaOn) setCinema(false);
    cinemaSitGrace = 0;
    interact.flash(t('flash.stand'));
  };
  window.addEventListener('keydown', (e) => {
    if (seated && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space'].includes(e.code)) {
      e.stopPropagation();
      stand();
    }
  }, true);

  // ---------- lighting moods ----------
  // multipliers: [ambient, hemi, perFixture[0..6]] — fixture order matches lighting.ts
  // Names are stored as i18n keys (mood.*); the 'zh' values are used as state IDs
  // in RoomState so the share URL remains language-neutral.
  const MOODS: Array<{ name: string; amb: number; hemi: number; fix: number[] }> = [
    { name: '標準', amb: 1, hemi: 1, fix: [1, 1, 1, 1, 1, 1, 1] },
    { name: '閱讀', amb: 1.35, hemi: 1.2, fix: [1.7, 0.5, 1.4, 1.2, 1.5, 0.4, 0.5] },
    { name: '影院', amb: 0.35, hemi: 0.3, fix: [0.12, 1.3, 0.15, 0.8, 0.3, 1.3, 1.2] },
    { name: '派對', amb: 0.55, hemi: 0.5, fix: [0.7, 1.5, 0.6, 1.4, 0.6, 1.6, 1.5] },
    { name: '全暗', amb: 0.15, hemi: 0.12, fix: [0, 0.25, 0, 0.2, 0, 0.3, 0.25] },
  ];
  // Map zh mood name → i18n display label
  const MOOD_I18N: Record<string, string> = {
    '標準': 'mood.standard', '閱讀': 'mood.reading',
    '影院': 'mood.cinema', '派對': 'mood.party', '全暗': 'mood.dark',
  };
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
    // Keep bloom knee in sync with overall scene brightness: low-ambient moods
    // (cinema 0.35) get a lower threshold so neon halos are still visible, while
    // bright moods (reading 1.35) raise it to avoid over-blooming desk lamps.
    ctx.setBloomExposure(m.amb);
  };
  registerDevice({
    id: 'mood', value: MOODS[0].name, states: MOODS.map((m) => m.name),
    apply: (v) => {
      const i = MOODS.findIndex((m) => m.name === v);
      if (i >= 0) { moodIdx = i; applyMood(); }
    },
  });
  const cycleLights = (): string => String(roomState.advance('mood'));
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
        if (!mosaic) return t('flash.cast.wall.fail');
        mosaic.castExternal(castVideo, `YT://${id}`);
        interact.flash(t('flash.cast.wall'));
        return t('flash.cast.wall.done');
      }
      // default: holo TV in the living room
      if (mosaic?.isTV()) mosaic.exitTV();
      props.tv.cast(castVideo);
      interact.flash(t('flash.cast.tv'));
      return t('flash.cast.tv.done');
    } catch (err) {
      return `${t('flash.cast.fail.prefix')}${String(err).slice(0, 80)}`;
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
    cycleDeskLantern: () => deskLantern?.cycle() ?? t('rpc.not.loaded'),
    cycleMosaic: () => mosaic?.reveal() ?? t('rpc.not.loaded'),
    cycleHoloTint: () => props.tv.cycleHoloTint(),
    toggleCounterPendants: () => props.counterPendants.toggle(),
    toggleDND: () => toggleDND(),
    cycleProjector: () => room.starProjector.cycle(),
    toggleFridge: () => room.fridge.toggle(),
    togglePlanView: () => floorPlan.toggle(),
    runAudit: () => formatAuditReport(),
    mosaicTV: (arg?: string) => {
      if (!mosaic) return t('rpc.not.loaded');
      if (arg === 'off' || arg === 'stop') {
        return mosaic.exitTV() ? t('rpc.tv.exit.ok') : t('rpc.tv.exit.noop');
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
    setPresetOverride: (p) => {
      saveOverride(p);
      const next = settingsFor(p);
      if (needsReload(settings, next)) {
        // One or more fields require geometry rebuild (e.g. buildingCount,
        // rainCount, vehicleCount differ between all four named presets as of
        // Aug 2026) — fall back to a full reload. The live path below will be
        // exercised once a future caller (power-save, mobile downgrade) creates
        // a custom QualitySettings that only touches LIVE_FIELDS.
        location.reload();
      } else {
        ctx.applyQuality(next);
      }
    },
    currentPreset: () => settings.preset,
    // W5 photoreal hooks
    setFlicker: (on) => city.setFlicker(on),
    isFlickerOn: () => city.isFlickerOn(),
    triggerBrownout: () => city.triggerBrownout(),
    triggerThunder: () => {
      city.triggerLightning();
      ambience.thunder();
      // duck the rain for 250ms via the existing setIntensity API; restore
      // afterward to whatever the current weather level called for.
      const restore = rainValue;
      rain.setIntensity(restore * 0.4);
      window.setTimeout(() => rain.setIntensity(restore), 250);
      return t('flash.thunder');
    },
    setCinema: (on) => setCinema(on),
    isCinemaOn: () => cinemaOn,
    setHeightFogPref: (enabled: boolean) => {
      renderPrefs.heightFog = enabled;
      savePrefs(renderPrefs);
      ctx.setHeightFog(enabled);
    },
    setTonemapPref: (mode: 'aces' | 'agx') => {
      renderPrefs.tonemap = mode;
      savePrefs(renderPrefs);
      ctx.setTonemap(mode);
    },
    getRenderPrefs: () => renderPrefs,
  });

  // jack-in state machine: play → enter-os (camera tween) → os → play
  let mode: 'play' | 'enter-os' | 'os' = 'play';
  let tweenT = 0;
  const tweenFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  const monitorPose = { pos: new THREE.Vector3(3.55, 1.44, 3.4), yaw: -Math.PI / 2, pitch: 0 };
  const enterOS = () => {
    if (mode !== 'play') return;
    // CyberOS is a DOM overlay; the WebXR compositor hides DOM in immersive
    // sessions. Block jack-in and surface a brief toast instead.
    if (ctx.renderer.xr.isPresenting) {
      interact.flash(t('flash.cyberos.vr'), 2400);
      return;
    }
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
  interact.add(room.monitorPlane, t('prompt.monitor'), enterOS, 3.0);
  interact.add(props.tv.mesh, t('prompt.tv'), () => {
    if (props.tv.isCasting()) {
      stopCast();
      interact.flash(t('flash.tv.stop'));
    } else {
      interact.flash(`${t('flash.tv.cast')}${String(roomState.advance('tv'))}`);
    }
  }, 3.0);
  interact.add(props.tv.screen, t('prompt.tv.screen'), () => {
    if (props.tv.isCasting()) {
      if (castVideo.paused) { void castVideo.play(); interact.flash(t('flash.tv.resume')); }
      else { castVideo.pause(); interact.flash(t('flash.tv.pause')); }
    } else {
      interact.flash(`${t('flash.tv.cast')}${String(roomState.advance('tv'))}`);
    }
  }, 4.5);
  interact.add(props.neonSign.mesh, t('prompt.neon'), () => interact.flash(`✨ ${String(roomState.advance('neon'))}`), 4.5);
  interact.add(props.recordPlayer.mesh, t('prompt.record'), () => {
    const on = ambience.togglePad();
    props.recordPlayer.setSpin(on);
    interact.flash(on ? t('flash.record.on') : t('flash.record.off'));
  }, 2.4);
  interact.add(room.windowPlane, t('prompt.window'), () => {
    setWeather(weatherLevel === 'off' ? 'light' : weatherLevel === 'light' ? 'heavy' : 'off');
    interact.flash(`${t('flash.rain.prefix')}${weatherLevel}`);
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

  interact.add(barProxy, t('prompt.bar'), () => {
    props.bar.pulse();
    drunkLevel = Math.min(1.8, drunkLevel + 0.55);
    interact.flash(t('flash.bar'));
  }, 2.6);
  interact.add(sofaProxy, t('prompt.sofa'), () => {
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
    interact.flash(t('flash.sofa.sit'), 3600);
    // arm cinema auto-enable: 1.2s grace, then fade in DOF + letterbox
    cinemaSitGrace = 1.2;
  }, 2.8);
  window.addEventListener('keydown', (e) => {
    if (!seated) return;
    if (e.code === 'KeyR') {
      reclined = !reclined;
      seatBase.set(0.4, reclined ? 1.02 : 1.18, reclined ? 1.75 : 2.0);
      ctx.camera.position.copy(seatBase);
      controls.setOrientation(Math.PI, reclined ? 0.34 : -0.04);
      interact.flash(reclined ? t('flash.recline.on') : t('flash.recline.off'));
    }
    if (e.code === 'KeyM') {
      massageT = massageT > 0 ? 0 : 8;
      interact.flash(massageT > 0 ? t('flash.massage.on') : t('flash.massage.off'));
    }
  });
  interact.add(bedProxy, t('prompt.bed'), () => {
    fade.style.opacity = '1';
    const wasDrunk = drunkLevel > 0.05;
    drunkLevel = 0;
    window.setTimeout(() => {
      fade.style.opacity = '0';
      interact.flash(wasDrunk ? t('flash.bed.drunk') : t('flash.bed.normal'));
    }, 1600);
  }, 2.8);
  interact.add(props.lightPanel, t('prompt.lights'), () => {
    const moodName = cycleLights();
    const moodKey = MOOD_I18N[moodName] ?? moodName;
    interact.flash(`${t('flash.lights.prefix')}${t(moodKey)}`);
  }, 2.4);
  interact.add(props.counterPendants.hit, t('prompt.pendants'), () => {
    const on = props.counterPendants.toggle();
    interact.flash(on ? t('flash.pendants.on') : t('flash.pendants.off'));
  }, 3.0);
  interact.add(props.holo.base, t('prompt.holo'), () => {
    interact.flash(`${t('flash.holo.prefix')}${props.holo.cycle()}`);
  }, 2.6);
  interact.add(props.curtain.panel, t('prompt.curtain'), () => {
    const closing = props.curtain.toggle();
    interact.flash(closing ? t('flash.curtain.closing') : t('flash.curtain.opening'));
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
  interact.add(room.bookshelf, t('prompt.bookshelf'), () => {
    interact.flash(t('flash.bookshelf'));
  }, 3.0);
  for (const { mesh, book } of room.titledBooks) {
    interact.add(mesh, `${t('prompt.book.prefix')}${book.title}${t('prompt.book.suffix')}`, () => {
      if (mode !== 'play' || reader.isOpen) return;
      controls.enabled = false;
      interact.enabled = false;
      void reader.open(book);
    }, 2.4);
  }
  // shard trays: the art shard now re-curates every wall frame
  interact.add(room.shardTrayArt, t('prompt.shardArt'), () => {
    props.art.next();
    interact.flash(t('flash.shardArt'));
  }, 2.4);
  interact.add(room.shardTrayAudio, t('prompt.shardAudio'), () => enterApp(() => os.openViola()), 2.4);
  interact.add(room.devlogShard, t('prompt.devlogShard'), () => enterApp(() => os.openDevlog()), 2.2);

  // wall frames: E swaps that frame for another painting
  for (const f of props.art.frames) {
    interact.add(f, t('prompt.frame'), () => {
      props.art.next();
      interact.flash(t('flash.frame'));
    }, 3.2);
  }

  // bathroom
  interact.add(room.bathroom.door, t('prompt.bathDoor'), () => {
    interact.flash(room.bathroom.toggleDoor() ? t('flash.bathDoor.open') : t('flash.bathDoor.close'));
  }, 2.6);
  interact.add(room.bathroom.toilet, t('prompt.toilet'), () => {
    ambience.flush();
    interact.flash(t('flash.toilet'));
  }, 2.0);
  interact.add(room.bathroom.mirror, t('prompt.mirror'), () => {
    interact.flash(t('flash.mirror'));
  }, 2.2);
  interact.add(room.bathroom.shower, t('prompt.shower'), () => {
    const on = room.bathroom.toggleShower();
    ambience.shower(on);
    interact.flash(on ? t('flash.shower.on') : t('flash.shower.off'));
  }, 2.4);
  interact.add(room.washer, t('prompt.washer'), () => {
    (room.washer.userData.startWash as () => void)();
    interact.flash(t('flash.washer'));
  }, 2.2);
  // speakers double as one-key BGM control: rain outside, music inside —
  // no need to jack into the PC once a station is loaded
  for (const sp of props.speakers) {
    interact.add(sp, t('prompt.speaker'), () => {
      const st = os.ytToggle();
      if (st === 'offline') {
        interact.flash(t('flash.speaker.load'));
        enterApp(() => os.openNeuroSound());
      } else {
        interact.flash(st === 'paused' ? t('flash.speaker.pause') : t('flash.speaker.play'));
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
      t('iris.time.prefix') + now.getHours() + t('iris.time.h') + now.getMinutes() + t('iris.time.m') + t('iris.0'),
      lastWeatherText
        ? t('iris.1.a') + lastWeatherText + t('iris.1.b')
        : t('iris.1.no'),
      t('iris.2'),
      t('iris.3'),
      t('iris.4'),
      t('iris.5'),
    ];
    irisLineIdx = (irisLineIdx + 1) % lines.length;
    const line = lines[irisLineIdx];
    // iris.5 triggers rain dial-down regardless of language
    if (irisLineIdx === 5) setWeather('light');
    props.assistant.setTalk(4);
    speak(line);
    return line;
  };
  interact.add(props.assistant.base, t('prompt.iris'), () => {
    interact.flash(`${t('flash.iris.prefix')}${irisSay()}${t('flash.iris.suffix')}`, 5200);
  }, 3.0);

  // home completion round: cat, coffee, entry door, wardrobe
  interact.add(props.cat.body, t('prompt.cat'), () => {
    props.cat.pet();
    ambience.purr();
    interact.flash(t('flash.cat'));
  }, 2.2);
  interact.add(props.coffee.machine, t('prompt.coffee'), () => {
    if (props.coffee.brew()) {
      ambience.brewSound();
      interact.flash(t('flash.coffee.brewing'));
    } else {
      interact.flash(t('flash.coffee.busy'));
    }
  }, 2.4);
  interact.add(room.entry.door, t('prompt.door'), () => {
    interact.flash(room.entry.toggle() ? t('flash.door.open') : t('flash.door.close'));
  }, 2.8);
  interact.add(room.entry.package, t('prompt.package'), () => {
    room.entry.setDelivered(false);
    const loot = [0, 1, 2, 3, 4].map((i) => t(`package.${i}`));
    interact.flash(loot[Math.floor(Math.random() * loot.length)], 4200);
  }, 2.4);
  interact.add(room.wardrobe.mesh, t('prompt.wardrobe'), () => {
    interact.flash(`${t('flash.wardrobe.prefix')} ${room.wardrobe.cycleOutfit()} ${t('flash.wardrobe.suffix')}`, 3200);
  }, 2.6);
  // bedside star projector: cycle off / 賽博 / 暖光 / 古典
  interact.add(room.starProjector.hit, t('prompt.projector'), () => {
    interact.flash(`${t('flash.projector.prefix')} ${room.starProjector.cycle()}`);
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
    interact.add(obj, `${t('prompt.pickup.prefix')}${name}`, () => {
      if (heldItem) return;
      const p = pickables.get(obj);
      if (!p) return;
      heldItem = p;
      p.origParent.remove(obj);
      ctx.camera.add(obj);
      obj.position.copy(HOLD_OFFSET);
      obj.rotation.set(0, 0, 0);
      interact.flash(`${t('flash.pickup.held')}${name}${t('flash.pickup.held.suffix')}`, 3000);
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
      interact.flash(`${t('flash.pickup.drop')}${item.name}${t('flash.pickup.drop.suffix')}`);
    } else {
      // return to original
      ctx.camera.remove(item.obj);
      item.origParent.add(item.obj);
      item.obj.position.copy(item.origPos);
      item.obj.rotation.copy(item.origRot);
      interact.flash(`${t('flash.pickup.return')}${item.name}${t('flash.pickup.return.suffix')}`);
    }
    heldItem = null;
  });

  // smart-fridge peek (E to open; auto-close after 6s)
  interact.add(room.fridge.hit, t('prompt.fridge'), () => {
    const open = room.fridge.toggle();
    interact.flash(open ? t('flash.fridge.open') : t('flash.fridge.close'));
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
  interact.add(room.entry.keypad, t('prompt.dnd'), () => {
    const on = toggleDND();
    interact.flash(on ? t('flash.dnd.on') : t('flash.dnd.off'));
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
      interact.flash(t('flash.doorbell'), 3600);
      pendingDelivery = false;
    } else if (!dnd && pendingDelivery) {
      // DND was just turned off and there's a queued package — release it on
      // the next tick instead of waiting for the full timer
      pendingDelivery = false;
      ambience.doorbell();
      room.entry.setDelivered(true);
      interact.flash(t('flash.doorbell.missed'), 3600);
    }
  }, 5000);



  setWeather('light');

  // real-world weather for the smart mirror: IP geolocation → open-meteo
  // (both keyless + CORS-friendly); refreshed every 20 minutes
  const WMO_DESC: Array<[number[], string]> = [
    [[0], t('wmo.clear')], [[1, 2], t('wmo.partly')], [[3], t('wmo.overcast')], [[45, 48], t('wmo.fog')],
    [[51, 53, 55, 56, 57], t('wmo.drizzle')], [[61, 63, 65, 66, 67], t('wmo.rain')],
    [[71, 73, 75, 77, 85, 86], t('wmo.snow')], [[80, 81, 82], t('wmo.showers')], [[95, 96, 99], t('wmo.thunderstorm')],
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
      lastWeatherText = t('weather.text')
        .replace('{city}', geo.label)
        .replace('{temp}', Number(cur.temperature_2m).toFixed(0))
        .replace('{desc}', desc);
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
  await initXR(ctx, { controls, interact });

  // spawn in the living area facing the window/city
  ctx.camera.position.set(-1.5, 1.7, -0.5);
  controls.setOrientation(Math.PI, -0.02);

  // mount language toggle button (top-right corner)
  mountLangToggle();
  // mount credits / attribution panel button (left of the language toggle)
  mountCredits();

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
        const planTag = floorPlan.isOn ? ' PLAN' : '';
        document.title = shaderErrCount > 0
          ? `NEON-SHADER-ERR ${shaderErrCount} FPS ${fps.toFixed(0)}${planTag}`
          : `NEON-OK FPS ${fps.toFixed(0)} ${settings.preset}${planTag}`;
      }
    }
  };

  // Chrome's ANGLE backend on old Mesa drivers (e.g. HD 4000 / crocus) fails
  // every shader with VALIDATE_STATUS false → white screen. Detect and explain
  // instead of leaving the user staring at a blank canvas.
  const showGpuFailOverlay = () => {
    if (document.getElementById('gpufail')) return;
    // The "use Firefox" advice only applies to desktop Chrome on broken
    // ANGLE drivers (the original audience for this overlay). On iOS all
    // browsers wrap WebKit so "switch to Firefox" is meaningless. On
    // touch devices in general, three.js shader warnings can fire false
    // positives even when the scene renders fine — skip the overlay
    // there and just log to title bar via the existing diagnostics path.
    if (IS_TOUCH) return;
    const el = document.createElement('div');
    el.id = 'gpufail';
    el.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;' +
      'background:#05060a;color:#c8f2ff;text-align:center;font-family:"Share Tech Mono",monospace;';
    el.innerHTML = '<div><div style="color:#ff2bdb;font-size:22px;letter-spacing:.2em">' +
      t('gpu.title') + '</div><div style="margin-top:14px;font-size:14px;line-height:1.8">' +
      t('gpu.body') + '</div></div>';
    document.body.appendChild(el);
  };
  canvas.addEventListener('webglcontextlost', () => {
    document.title = 'NEON-CTX-LOST';
    if (!IS_TOUCH) showGpuFailOverlay();
    sendBeacon();
  });
  setTimeout(() => {
    // Only fire on desktop. Touch devices' shader warnings (e.g. iOS
    // Safari complaining about precision qualifiers it doesn't actually
    // honour) routinely log to console.error without breaking rendering.
    if (!IS_TOUCH && shaderErrCount > 0) showGpuFailOverlay();
  }, 4000);

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
        // also composite the floor-plan overlay if it's visible (dev verify hook)
        if (floorPlan.isOn) {
          g2.drawImage(planCanvas, 0, 0, c2.width, c2.height);
        }
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
      audit: () => runPlacementAudit(),
      ctx,
      room,
      editable: { list: () => listEditableIds(), get: (id: string) => getEditable(id) },
      overrides: { applied, orphaned },
    };

    // Mount the Blender-style modal editor (DEV only)
    import('./editor/editor').then(({ mountEditor }) => {
      // T2: input adapter — editor takes exclusive ownership while open.
      // controls.enabled is the single source of truth for input ownership:
      // the canvas click handler and FpControls.requestLock() both check it.
      // A separate capturing click listener cannot work here — the canvas is the
      // event target, so at-target listeners fire in registration order and the
      // existing handler is registered first, before this module is imported.
      let _prevEnabled = true;
      const editorInputAdapter = {
        acquire() {
          _prevEnabled = controls.enabled;
          controls.enabled = false;
          if (document.pointerLockElement) document.exitPointerLock();
        },
        release() {
          controls.enabled = _prevEnabled;
        },
      };
      mountEditor(ctx, ctx.scene, ctx.camera, ctx.renderer as unknown as THREE.WebGLRenderer, editorInputAdapter);
    });
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
      if (floorPlan.isOn) floorPlan.renderFrame(ctx.camera);
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
        // ---- cinema sub-state ----
        // arm: 1.2s after sit, fade in the bars + DOF
        if (cinemaSitGrace > 0) {
          cinemaSitGrace -= dt;
          if (cinemaSitGrace <= 0 && !cinemaOn) setCinema(true);
        }
        // idle pan: after 8s of no mouse motion, accumulate a slow yaw
        // oscillation around the current head pose
        if (cinemaOn) {
          cinemaIdleT += dt;
          if (cinemaIdleT > 8) {
            // ±0.06 rad oscillation, 0.4 rad/s peak speed
            const panAmp = Math.min((cinemaIdleT - 8) / 4, 1) * 0.06;
            const pan = Math.sin((cinemaIdleT - 8) * 0.35) * panAmp;
            delta = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, delta + pan));
          }
        }
        controls.setOrientation(Math.PI + delta, pitch);
      } else if (cinemaOn) {
        // standalone vista mode (cinema on, no sit) — let yaw drift too
        cinemaIdleT += dt;
        if (cinemaIdleT > 8) {
          const panAmp = Math.min((cinemaIdleT - 8) / 4, 1) * 0.03;
          const pan = Math.sin((cinemaIdleT - 8) * 0.35) * panAmp;
          controls.setOrientation(controls.getYaw() + pan * dt, controls.getPitch());
        }
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
    // window-glass rain overlay (M1): drops + condensation animate from
    // the same rainValue source-of-truth; curtain occlusion fades them out
    if (room.windowRain) {
      room.windowRain.tick(t);
      room.windowRain.setRain(rainValue);
      room.windowRain.setCurtain(props.curtain.amount());
    }
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
