import './os.css';

// CyberOS — fullscreen DOM overlay desktop, shown when the player jacks into
// the in-room PC. Vanilla TS window manager; no framework needed.

export interface GameAPI {
  setWeather: (level: 'off' | 'light' | 'heavy') => void;
  getWeather: () => string;
  cycleNeon: () => string;
  toggleCurtain: () => boolean;
  cycleHolo: () => string;
  toggleLantern: () => boolean;
  cycleDeskLantern: () => string;
  cycleMosaic: () => string;
  cycleHoloTint: () => string;
  /** TV mode on the mosaic wall. Pass undefined to cycle videos; 'off' to exit. */
  mosaicTV: (arg?: string) => string;
  toggleCounterPendants: () => boolean;
  toggleDND: () => boolean;
  cycleProjector: () => string;
  toggleFridge: () => boolean;
  togglePlanView: () => boolean;
  cycleLights: () => string;
  triggerAd: () => string;
  irisSay: () => string;
  castToTV: (id: string, dest?: 'tv' | 'wall') => Promise<string>;
  getStats: () => { fps: number; preset: string; renderer: string; pos: string };
  setPresetOverride: (p: 'low' | 'medium' | 'high' | 'ultra') => void;
  currentPreset: () => string;
  // W5 photoreal additions
  /** flicker timeline: continuous tower sub-pulse */
  setFlicker: (on: boolean) => void;
  isFlickerOn: () => boolean;
  /** force a brownout — returns the district label */
  triggerBrownout: () => string;
  /** thunder: pairs city.triggerLightning + ambience.thunder + rain duck */
  triggerThunder: () => string;
  /** cinema/vista mode toggle (DOF + letterbox + idle pan) */
  setCinema: (on: boolean) => boolean;
  isCinemaOn: () => boolean;
}

interface OSWindow {
  id: string;
  el: HTMLElement;
  body: HTMLElement;
  tab: HTMLElement;
  onClose?: () => void;
}

import { BOOKS } from '../lib/books';

const PLAYLIST: Array<{ id: string; title: string }> = [
  { id: 'jfKfPfyJRdk', title: 'lofi hip hop radio' },
  { id: '4xDzrJKXOOY', title: 'synthwave radio' },
  { id: 'Na0w3Mz46GA', title: 'cyberpunk ambient' },
];

export class CyberOS {
  readonly root: HTMLElement;
  private winLayer: HTMLElement;
  private taskTabs: HTMLElement;
  private windows = new Map<string, OSWindow>();
  private zCounter = 100;
  private open = false;
  onExit: (() => void) | null = null;

  // --- YouTube state ---
  private ytReady = false;
  private ytPlayer: any = null;
  private ytHolder: HTMLElement;          // persistent home for the iframe
  private playlistIdx = 0;
  private masterVol = 70;                  // 0..100, user-set
  private spatialGain = 1;                 // 0..1, distance-driven
  ytStatus = 'offline';

  constructor(private api: GameAPI) {
    this.root = document.createElement('div');
    this.root.id = 'cyberos';
    this.root.innerHTML = `
      <div class="wallpaper"></div>
      <div class="oslogo"><b>CyberOS</b><i>v7.7 // NEURAL LINK ESTABLISHED</i></div>
      <div class="os-icons"></div>
      <div id="os-winlayer" style="position:absolute;inset:0 0 42px 0;pointer-events:none;"></div>
      <div id="os-taskbar">
        <span class="brand">CyberOS</span>
        <span class="tabs" style="display:flex;gap:6px;"></span>
        <span class="spacer"></span>
        <span class="clock"></span>
        <span class="exit">⏏ DISCONNECT [ESC]</span>
      </div>`;
    document.body.appendChild(this.root);
    this.winLayer = this.root.querySelector('#os-winlayer')!;
    this.taskTabs = this.root.querySelector('.tabs')!;
    (this.root.querySelector('.exit') as HTMLElement).onclick = () => this.exit();

    // persistent (hidden) home for the YouTube iframe so music keeps playing
    this.ytHolder = document.createElement('div');
    this.ytHolder.id = 'yt-persist';
    this.ytHolder.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:270px;';
    document.body.appendChild(this.ytHolder);

    const icons: Array<[string, string, string, () => void]> = [
      ['neurosound', '🎧', 'NeuroSound', () => this.openNeuroSound()],
      ['browser', '🌐', 'Netrunner', () => this.openBrowser()],
      ['term', '▮', 'NeoTerm', () => this.openTerm()],
      ['sysmon', '📊', 'SysMon', () => this.openSysMon()],
      ['mail', '✉', 'NeoMail', () => this.openMail()],
          ];
    const iconBox = this.root.querySelector('.os-icons')!;
    for (const [id, glyph, label, fn] of icons) {
      const el = document.createElement('div');
      el.className = 'os-icon';
      el.dataset.app = id;
      el.innerHTML = `<div class="glyph">${glyph}</div><div class="label">${label}</div>`;
      el.onclick = fn;
      iconBox.appendChild(el);
    }

    window.setInterval(() => {
      const c = this.root.querySelector('.clock');
      if (c) c.textContent = new Date().toLocaleTimeString('en-GB');
    }, 1000);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.exit();
    });
  }

  get isOpen(): boolean { return this.open; }

  /** live UI state for the dev beacon — lets remote debugging see the DOM side */
  getDebugState(): Record<string, unknown> {
    return {
      open: this.open,
      windows: [...this.windows.keys()],
      yt: this.ytStatus,
      ytPlayer: !!this.ytPlayer,
      nsHits: document.querySelectorAll('.ns .hit').length,
      fullscreen: !!document.fullscreenElement,
      pointerLocked: !!document.pointerLockElement,
      // W5 photoreal state
      flicker: this.api.isFlickerOn?.(),
      cinema: this.api.isCinemaOn?.(),
    };
  }

  enter(): void {
    this.open = true;
    this.root.classList.add('on');
  }

  exit(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    // park the YouTube iframe back in its hidden home so audio continues
    const nsWin = this.windows.get('neurosound');
    if (nsWin && this.ytPlayer) this.ytHolder.appendChild(this.ytPlayer.getIframe());
    this.onExit?.();
  }

  // ---------------- window manager ----------------

  private makeWindow(id: string, title: string, w: number, h: number, x: number, y: number): OSWindow {
    const existing = this.windows.get(id);
    if (existing) { this.focus(existing); return existing; }
    const el = document.createElement('div');
    el.className = 'os-win';
    el.style.cssText = `width:${w}px;height:${h}px;left:${x}px;top:${y}px;z-index:${++this.zCounter};`;
    el.innerHTML = `
      <div class="os-titlebar"><span>${title}</span><span class="spacer"></span>
        <button class="x">✕</button></div>
      <div class="os-body"></div>`;
    this.winLayer.appendChild(el);
    const body = el.querySelector('.os-body') as HTMLElement;

    const tab = document.createElement('span');
    tab.className = 'tab active';
    tab.textContent = title;
    tab.onclick = () => this.focus(win);
    this.taskTabs.appendChild(tab);

    const win: OSWindow = { id, el, body, tab };
    (el.querySelector('.x') as HTMLElement).onclick = () => this.close(win);
    el.addEventListener('pointerdown', () => this.focus(win));

    // dragging
    const bar = el.querySelector('.os-titlebar') as HTMLElement;
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      const startX = e.clientX - el.offsetLeft;
      const startY = e.clientY - el.offsetTop;
      const move = (ev: PointerEvent) => {
        el.style.left = `${Math.max(0, ev.clientX - startX)}px`;
        el.style.top = `${Math.max(0, ev.clientY - startY)}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    this.windows.set(id, win);
    this.focus(win);
    return win;
  }

  private focus(win: OSWindow): void {
    win.el.style.zIndex = String(++this.zCounter);
    for (const w of this.windows.values()) {
      w.el.classList.toggle('focus', w === win);
      w.tab.classList.toggle('active', w === win);
    }
  }

  private close(win: OSWindow): void {
    win.onClose?.();
    win.el.remove();
    win.tab.remove();
    this.windows.delete(win.id);
  }

  // ---------------- NeuroSound (YouTube) ----------------

  private loadYTApi(): Promise<void> {
    if (this.ytReady) return Promise.resolve();
    return new Promise((res) => {
      const w = window as any;
      if (w.YT?.Player) { this.ytReady = true; res(); return; }
      w.onYouTubeIframeAPIReady = () => { this.ytReady = true; res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }

  openNeuroSound(): OSWindow {
    const win = this.makeWindow('neurosound', 'NEUROSOUND', 580, 620, 140, 30);
    if (win.body.childElementCount > 0) return win;
    win.body.innerHTML = `
      <div class="ns">
        <div class="yt-holder"></div>
        <div class="row">
          <button class="prev">⏮</button>
          <button class="play">▶ / ⏸</button>
          <button class="next">⏭</button>
          <button class="cast">📽 投影到客廳</button>
          <input class="vol" type="range" min="0" max="100" value="${this.masterVol}" style="flex:1"/>
        </div>
        <div class="row">
          <input class="q" placeholder="搜尋 YouTube 音樂… (歌名 / 歌手 / 電台)"/>
          <button class="search">🔍 搜尋</button>
        </div>
        <div class="chips">${PLAYLIST.map((p, i) =>
          `<span class="chip" data-i="${i}">${p.title}</span>`).join('')}</div>
        <div class="results"><div class="hint" style="padding:10px">
          搜尋任何歌曲,點縮圖即播。也可直接貼 YouTube 連結。<br/>
          音量會隨你離喇叭的距離變化 — 站到窗邊聽聽看。</div></div>
      </div>`;
    const holder = win.body.querySelector('.yt-holder') as HTMLElement;
    const results = win.body.querySelector('.results') as HTMLElement;
    const qInput = win.body.querySelector('.q') as HTMLInputElement;

    const fmtDur = (s: number) => s > 0
      ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
    const playVideo = (id: string) => {
      if (this.ytPlayer) this.ytPlayer.loadVideoById(id);
      results.querySelectorAll('.hit').forEach((x) =>
        x.classList.toggle('sel', (x as HTMLElement).dataset.id === id));
    };
    const doSearch = async () => {
      const q = qInput.value.trim();
      if (!q) return;
      // pasted URL/ID? play straight away
      const direct = parseYouTubeId(q);
      if (direct) { playVideo(direct); qInput.value = ''; return; }
      results.innerHTML = '<div class="hint" style="padding:12px">⟳ 正在掃描網路節點…(首次搜尋約 5 秒)</div>';
      try {
        const r = await (await fetch(`/__ytsearch?q=${encodeURIComponent(q)}`)).json();
        if (!r.items?.length) throw new Error('沒有結果');
        results.innerHTML = '';
        for (const it of r.items) {
          const row = document.createElement('div');
          row.className = 'hit';
          row.dataset.id = it.id;
          row.innerHTML = `
            <img src="https://i.ytimg.com/vi/${it.id}/mqdefault.jpg" loading="lazy"/>
            <div class="meta"><div class="t">${it.title}</div>
              <div class="c">${it.channel ?? ''} ${fmtDur(it.duration)}</div></div>`;
          row.onclick = () => playVideo(it.id);
          results.appendChild(row);
        }
      } catch (err) {
        results.innerHTML = `<div class="hint" style="padding:12px">⛔ 搜尋失敗:${String(err).slice(0, 60)}</div>`;
      }
    };
    (win.body.querySelector('.search') as HTMLElement).onclick = doSearch;
    qInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') doSearch();
    });
    win.body.querySelectorAll('.chip').forEach((c) => {
      (c as HTMLElement).onclick = () => {
        const i = Number((c as HTMLElement).dataset.i);
        this.playlistIdx = i;
        playVideo(PLAYLIST[i].id);
      };
    });

    this.loadYTApi().then(() => {
      if (!this.ytPlayer) {
        const target = document.createElement('div');
        holder.appendChild(target);
        this.ytPlayer = new (window as any).YT.Player(target, {
          width: '100%', height: '100%',
          videoId: PLAYLIST[0].id,
          playerVars: { autoplay: 0, controls: 1 },
          events: {
            onReady: () => { this.applyVolume(); this.ytStatus = 'ready'; },
            onStateChange: (e: any) => {
              this.ytStatus = ['unstarted', 'ended', 'playing', 'paused', 'buffering', '?', 'cued'][e.data + 1] ?? '?';
            },
          },
        });
      } else {
        holder.appendChild(this.ytPlayer.getIframe());
      }
    });

    (win.body.querySelector('.play') as HTMLElement).onclick = () => this.ytToggle();
    (win.body.querySelector('.cast') as HTMLElement).onclick = async () => {
      const vid = this.ytPlayer?.getVideoData?.()?.video_id;
      if (!vid) { this.flashFoot(win, '先選一首歌再投影'); return; }
      this.flashFoot(win, '⟳ 解析串流中…');
      const msg = await this.api.castToTV(vid);
      if (!msg.startsWith('⛔')) this.ytPlayer?.pauseVideo?.();
      this.flashFoot(win, msg);
    };
    (win.body.querySelector('.next') as HTMLElement).onclick = () => this.ytNext(1);
    (win.body.querySelector('.prev') as HTMLElement).onclick = () => this.ytNext(-1);
    (win.body.querySelector('.vol') as HTMLInputElement).oninput = (e) => {
      this.masterVol = Number((e.target as HTMLInputElement).value);
      this.applyVolume();
    };
    return win;
  }

  private flashFoot(win: OSWindow, msg: string): void {
    let el = win.body.querySelector('.castmsg') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'castmsg hint';
      el.style.cssText = 'padding:4px 2px;font-family:"Share Tech Mono";font-size:11px;color:#ffe14d;';
      win.body.querySelector('.ns')?.insertBefore(el, win.body.querySelector('.chips'));
    }
    el.textContent = msg;
  }

  ytToggle(): string {
    if (!this.ytPlayer?.getPlayerState) return 'offline';
    const st = this.ytPlayer.getPlayerState();
    if (st === 1) { this.ytPlayer.pauseVideo(); return 'paused'; }
    this.ytPlayer.playVideo();
    return 'playing';
  }

  ytNext(dir: number): string {
    if (!this.ytPlayer) return 'offline';
    this.playlistIdx = (this.playlistIdx + dir + PLAYLIST.length) % PLAYLIST.length;
    const item = PLAYLIST[this.playlistIdx];
    this.ytPlayer.loadVideoById(item.id);
    return item.title;
  }

  /** called from the game loop with distance-based gain (0..1) */
  setSpatialGain(g: number): void {
    if (Math.abs(g - this.spatialGain) < 0.03) return;
    this.spatialGain = g;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.ytPlayer?.setVolume) {
      this.ytPlayer.setVolume(Math.round(this.masterVol * this.spatialGain));
    }
  }

  // ---------------- Netrunner browser ----------------

  openBrowser(): OSWindow {
    const win = this.makeWindow('browser', 'NETRUNNER', 760, 520, 220, 40);
    if (win.body.childElementCount > 0) return win;
    win.body.innerHTML = `
      <div class="browser">
        <div class="bar">
          <input class="url" placeholder="https:// — 部分網站會拒絕嵌入 (X-Frame-Options)"/>
          <button class="go">JACK&nbsp;IN</button>
        </div>
        <div class="bookmarks"></div>
        <div class="view" style="flex:1;display:flex;"></div>
      </div>`;
    const bookmarks: Array<[string, string]> = [
      ['Wikipedia', 'https://zh.wikipedia.org/wiki/%E8%B5%9B%E5%8D%9A%E6%9C%8B%E5%85%8B'],
      ['HN', 'https://hn.svelte.dev/top/1'],
      ['Wiby 復古搜尋', 'https://wiby.me/'],
      ['台北地圖', 'https://www.openstreetmap.org/export/embed.html?bbox=121.49,25.01,121.58,25.07'],
    ];
    const bmBox = win.body.querySelector('.bookmarks')!;
    const view = win.body.querySelector('.view') as HTMLElement;
    const urlInput = win.body.querySelector('.url') as HTMLInputElement;
    const nav = (url: string) => {
      urlInput.value = url;
      view.innerHTML = '';
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.style.cssText = 'flex:1;border:none;background:#fff;';
      view.appendChild(frame);
      // sites that refuse framing fail silently; show the ICE page as a hint
      window.setTimeout(() => {
        try {
          // cross-origin access throws when loaded fine — only same-origin
          // about:blank (i.e. refused/empty) lets us in
          const doc = (frame as any).contentDocument;
          if (doc && doc.location.href === 'about:blank') showIce();
        } catch { /* cross-origin = likely loaded; leave it */ }
      }, 3500);
    };
    const showIce = () => {
      view.innerHTML = `<div class="ice"><div><b>⛔ ICE BARRIER</b>
        目標主機拒絕神經連結 (X-Frame-Options)<br/>請換一個節點,或用實體瀏覽器開啟</div></div>`;
    };
    for (const [name, url] of bookmarks) {
      const b = document.createElement('span');
      b.className = 'bm';
      b.textContent = name;
      b.onclick = () => nav(url);
      bmBox.appendChild(b);
    }
    (win.body.querySelector('.go') as HTMLElement).onclick = () => {
      let u = urlInput.value.trim();
      if (u && !/^https?:\/\//.test(u)) u = 'https://' + u;
      if (u) nav(u);
    };
    nav(bookmarks[0][1]);
    return win;
  }

  // ---------------- NeoTerm ----------------

  openTerm(): OSWindow {
    const win = this.makeWindow('term', 'NEOTERM', 560, 380, 320, 180);
    if (win.body.childElementCount > 0) return win;
    win.body.innerHTML = `
      <div class="term">
        <div class="scroll">CyberOS NeoTerm — 輸入 help 查看指令\n</div>
        <div class="inline"><span class="ps1">v@neonloft:~$</span><input autocomplete="off"/></div>
      </div>`;
    const scroll = win.body.querySelector('.scroll') as HTMLElement;
    const input = win.body.querySelector('input') as HTMLInputElement;
    const println = (s: string) => {
      scroll.textContent += s + '\n';
      scroll.scrollTop = scroll.scrollHeight;
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep WASD/E from leaking into the game
      if (e.key !== 'Enter') return;
      const cmd = input.value.trim();
      input.value = '';
      println(`v@neonloft:~$ ${cmd}`);
      if (cmd) println(this.execTerm(cmd));
    });
    window.setTimeout(() => input.focus(), 100);
    return win;
  }

  execTerm(cmd: string): string {
    const [head, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(' ');
    switch (head) {
      case 'help':
        return [
          '── 環境 / 氛圍 ──',
          'weather <off|light|heavy>   控制窗外雨勢',
          'curtain                     電動窗簾升/降',
          'neon                        切換窗邊霓虹燈色',
          'light                       燈光情境 (標準/閱讀/影院/派對/全暗)',
          'dnd / quiet                 勿擾模式 — 門鈴靜音(包裹仍累積)',
          '',
          '── 燈具 ──',
          'lantern                     吧檯馬賽克燈籠 開/關',
          'desklamp                    桌上土耳其檯燈 三段:熄/微亮/明亮',
          'wash / pendant              吧檯柔光吊燈 開/關',
          '',
          '── 視覺裝置 ──',
          'mosaic                      翻牌馬賽克牆 換一幅 (14 幅藝術品輪播)',
          'holo                        茶几全息小投影 切換 (球/迷你城/寶石)',
          'ad                          天際線插播一支全息廣告',
          'iris                        虹 (IRIS) 全息助理說一句',
          '',
          '── 大氣 / 電影感 ──',
          'flicker [off]               城市霓虹呼吸 + 隨機停電 (預設開)',
          'brownout                    立即手動觸發一次區域停電',
          'thunder                     雷光閃 + 滾雷音 + 雨聲短暫變小',
          'cinema / vista [off]        電影模式:景深 + 黑邊 + 鏡頭微飄',
          '',
          '── 影音投影 ──',
          'tv [off]                    馬賽克牆當電視/退出 (3 個本地頻道)',
          'cast [wall|tv] [<YT_ID>]    串流投影 — 預設客廳全息電視,wall=馬賽克牆',
          'holotint / tint             全息電視色調循環 (無色/淡藍/中藍/深藍/全藍)',
          'bgm <play|next>             NeuroSound 音樂控制',
          '',
          '── 藝廊 / 圖書 ──',
          'art / gallery               牆上名畫提示 (走到畫框前按 E 換畫)',
          'lib / books                 書架提示',
          '',
          '── 系統 / 彩蛋 ──',
          'plan / map                  俯視 2D 平面圖 (P 鍵也可切換)',
          'stats                       顯示 FPS / 渲染器 / 座標',
          'devlog                      開啟 DEV.LOG 建造日誌',
          'viola                       開啟 VIOLA.ARCHIVE 家庭錄音',
          'whoami / ls / cat <檔名>    終端機假裝有檔案',
          'hack                        ???',
          'clear                       清螢幕',
        ].join('\n');
      case 'weather':
        if (arg === 'off' || arg === 'light' || arg === 'heavy') {
          this.api.setWeather(arg);
          return `> 天候控制:雨勢 ${arg}`;
        }
        return `目前雨勢: ${this.api.getWeather()} (用法: weather off|light|heavy)`;
      case 'neon':
        return `> 霓虹色 → ${this.api.cycleNeon()}`;
      case 'curtain':
        return this.api.toggleCurtain() ? '> 窗簾:下降中…' : '> 窗簾:上升中…';
      case 'holo':
        return `> 全息投影 → ${this.api.cycleHolo()}`;
      case 'lantern':
        return this.api.toggleLantern()
          ? '> 馬賽克燈籠 → 點亮 (彩繪玻璃)'
          : '> 馬賽克燈籠 → 熄滅';
      case 'desklamp': case 'desklight':
        return `> 桌上土耳其燈 → ${this.api.cycleDeskLantern()}`;
      case 'mosaic':
        return `> 翻牌馬賽克牆 → ${this.api.cycleMosaic()}`;
      case 'holotint': case 'holocolor': case 'tint':
        return `> 全息投影色調 → ${this.api.cycleHoloTint()}`;
      case 'tv':
        return `> 馬賽克電視 → ${this.api.mosaicTV(arg)}`;
      case 'wash': case 'pendant': case 'pendants':
        return this.api.toggleCounterPendants()
          ? '> 吧檯柔光開啟'
          : '> 吧檯柔光熄滅';
      case 'dnd': case 'quiet':
        return this.api.toggleDND()
          ? '> 勿擾模式 — 門鈴靜音中'
          : '> 接受訪客';
      case 'projector': case 'starprojector': case 'stars':
        return `> 床頭星空儀 → ${this.api.cycleProjector()}`;
      case 'plan': case 'floorplan': case 'map':
        return this.api.togglePlanView()
          ? '> 2D 平面圖開啟 — 走動時三角形跟著動,再 plan 或按 P 關閉'
          : '> 回到 3D 視角';
      case 'fridge':
        return this.api.toggleFridge() ? '> 冰箱打開了' : '> 冰箱關閉';
      case 'light': case 'lights':
        return `> 燈光情境 → ${this.api.cycleLights()}`;
      case 'lib': case 'books':
        return '> 藏書已實體化 — 到書櫃前看準書脊按 E,把書取下來讀';
      case 'cast': {
        // forms accepted:
        //   cast                  → current NeuroSound video → holo TV
        //   cast wall             → current NeuroSound video → mosaic wall
        //   cast wall <ytid>      → explicit YT id → mosaic wall (dev-friendly)
        //   cast tv <ytid>        → explicit YT id → holo TV
        const tokens = arg.split(/\s+/).filter(Boolean);
        let dest: 'tv' | 'wall' = 'tv';
        let explicitId: string | undefined;
        for (const t of tokens) {
          if (t === 'wall' || t === 'mosaic') dest = 'wall';
          else if (t === 'tv' || t === 'holo') dest = 'tv';
          else if (t.length >= 8) explicitId = t;
        }
        const vid = explicitId ?? this.ytPlayer?.getVideoData?.()?.video_id;
        if (!vid) return '> 先在 NeuroSound 選一首,或直接 cast wall <YT_ID>';
        void this.api.castToTV(vid, dest).then(() => this.ytPlayer?.pauseVideo?.());
        return dest === 'wall'
          ? '> 解析串流並投影到馬賽克牆…'
          : '> 解析串流並投影到客廳…';
      }
      case 'ad':
        return `> 全息廣告插播 → ${this.api.triggerAd()}`;
      case 'flicker': {
        if (arg === 'off' || arg === '0' || arg === 'stop') {
          this.api.setFlicker(false);
          return '> 霓虹閃爍 → 關閉,城市靜如標本';
        }
        this.api.setFlicker(true);
        return '> 霓虹閃爍 → 開啟,三色慢呼吸 + 隨機停電';
      }
      case 'brownout': case 'blackout':
        return `> ${this.api.triggerBrownout()} (約 1 秒)`;
      case 'thunder': case 'lightning':
        return `> ${this.api.triggerThunder()}`;
      case 'cinema': case 'vista': {
        if (arg === 'off' || arg === '0' || arg === 'stop') {
          this.api.setCinema(false);
          return '> 電影模式 → 關閉';
        }
        const on = this.api.setCinema(arg !== 'off');
        return on
          ? '> 電影模式 → 開啟 — 景深 + 黑邊,自動微移鏡頭'
          : '> 電影模式 → 關閉';
      }
      case 'art': case 'gallery':
        return '> 名畫已上牆 — 看著任何一幅畫框按 E 可換畫';
      case 'iris':
        return `> 虹:「${this.api.irisSay()}」`;
      case 'devlog':
        this.openDevlog();
        return '> 解密造屋者日誌…';
      case 'viola':
        this.openViola();
        return '> 開啟私人錄音檔案庫';
      case 'bgm':
        if (arg === 'next') return `> 切換電台 → ${this.ytNext(1)}`;
        return `> BGM ${this.ytToggle()}`;
      case 'stats': {
        const s = this.api.getStats();
        return `FPS ${s.fps} · ${s.preset} · ${s.renderer}\npos ${s.pos}`;
      }
      case 'whoami': return 'V (aka 房間的主人)';
      case 'ls': return 'manifesto.txt  netrun.cfg  jazz.playlist  no_future/';
      case 'cat':
        if (arg === 'manifesto.txt') {
          return '我們在霓虹裡入睡,在雨聲中醒來。\n城市不會記得任何人,但今晚的合成器音色屬於我。';
        }
        return `cat: ${arg || '?'}: 沒有那個檔案`;
      case 'hack':
        return [...Array(6)].map(() =>
          [...Array(48)].map(() => Math.random() > 0.5 ? '1' : '0').join(''),
        ).join('\n') + '\n> ACCESS GRANTED ✔ (其實什麼都沒發生)';
      case 'clear': {
        const sc = this.windows.get('term')?.body.querySelector('.scroll');
        if (sc) sc.textContent = '';
        return '';
      }
      default:
        return `term: 找不到指令 '${head}' — 試試 help`;
    }
  }

  // ---------------- SysMon ----------------

  openSysMon(): OSWindow {
    const win = this.makeWindow('sysmon', 'SYSMON', 460, 330, 420, 90);
    const render = () => {
      const s = this.api.getStats();
      const cur = this.api.currentPreset();
      win.body.innerHTML = `
        <div class="sysmon">
          <div><span class="k">FPS</span><span class="v">${s.fps}</span></div>
          <div><span class="k">QUALITY</span><span class="v">${s.preset}</span></div>
          <div><span class="k">GPU</span><span class="v">${s.renderer}</span></div>
          <div><span class="k">POSITION</span><span class="v">${s.pos}</span></div>
          <div><span class="k">BGM</span><span class="v">${this.ytStatus}</span></div>
          <div class="presets">
            ${(['low', 'medium', 'high', 'ultra'] as const).map((p) =>
              `<button data-p="${p}" class="${p === cur ? 'cur' : ''}">${p.toUpperCase()}</button>`).join('')}
          </div>
          <div style="font-size:11px;color:#6a7a9a;margin-top:6px">切換畫質檔位會重新載入場景</div>
        </div>`;
      win.body.querySelectorAll('button[data-p]').forEach((b) => {
        (b as HTMLElement).onclick = () => {
          this.api.setPresetOverride((b as HTMLElement).dataset.p as any);
        };
      });
    };
    render();
    const timer = window.setInterval(() => { if (this.windows.has('sysmon')) render(); }, 1500);
    win.onClose = () => window.clearInterval(timer);
    return win;
  }

  // ---------------- NeoMail ----------------

  openMail(): OSWindow {
    const win = this.makeWindow('mail', 'NEOMAIL', 680, 420, 260, 130);
    if (win.body.childElementCount > 0) return win;
    const mails: Array<[string, string, string]> = [
      ['房東 K', '租金調漲通知', '住戶你好:\n\n因第七區治安費上調,下季租金調整為 ¥4,200/月。\n附註:上次你陽台的無人機殘骸已清除,費用 ¥350 將併入帳單。\n\n— K'],
      ['NCPD 自動系統', '噪音檢舉結案', '你於 03:12 檢舉的「樓上機械腳步聲」已結案。\n結案原因:該樓層登記住戶為戰鬥改造退役者,屬合法義體維護行為。\n\n祝你有美好的一天。'],
      ['Drv.Chen', 'Re: 義眼韌體', '老樣子,韌體我幫你壓到 v0.9.7,夜視模組的色偏修了。\n但你那顆瞳孔的供應商倒了,下次壞掉就真的要換整顆。\n保重。\n\n— 陳'],
      ['NEON COLA', '★ 本週優惠 ★', '買二送一!全新口味「酸雨檸檬」上市!\n憑此信至任一販賣機輸入代碼 NEON-X 兌換。\n\n(本優惠不適用於現實世界)'],
    ];
    win.body.innerHTML = `<div class="mail"><div class="list"></div><div class="read">選一封信件…</div></div>`;
    const list = win.body.querySelector('.list')!;
    const read = win.body.querySelector('.read') as HTMLElement;
    mails.forEach(([from, subj, bodyTxt], i) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="from">${from}</div><div class="subj">${subj}</div>`;
      item.onclick = () => {
        win.body.querySelectorAll('.item').forEach((x) => x.classList.remove('sel'));
        item.classList.add('sel');
        read.textContent = `寄件者: ${from}\n主旨: ${subj}\n${'─'.repeat(40)}\n\n${bodyTxt}`;
      };
      if (i === 0) item.click();
      list.appendChild(item);
    });
    return win;
  }

  // ---------------- 藏書閣 (public-domain library reader) ----------------

  openLibrary(selectId?: number): OSWindow {
    const win = this.makeWindow('library', '藏書閣 // PUBLIC ARCHIVE', 780, 540, 180, 30);
    if (win.body.childElementCount > 0) {
      if (selectId !== undefined) {
        (win.body.querySelector(`.bk[data-id="${selectId}"]`) as HTMLElement | null)?.click();
      }
      return win;
    }
    win.body.innerHTML = `
      <div class="lib">
        <div class="shelf"></div>
        <div class="reader">
          <div class="rhead">選擇一本書 — 全文連線自 Project Gutenberg 公共圖書館</div>
          <div class="rtext">紙本在這個年代是奢侈品。<br/>但公共圖書館的資料庫永遠免費。</div>
          <div class="rfoot"></div>
        </div>
      </div>`;
    const shelfEl = win.body.querySelector('.shelf')!;
    const rhead = win.body.querySelector('.rhead') as HTMLElement;
    const rtext = win.body.querySelector('.rtext') as HTMLElement;
    const rfoot = win.body.querySelector('.rfoot') as HTMLElement;
    let cur: { id: number; pos: number; total: number } | null = null;

    const CHUNK = 60000;
    const loadChunk = async (id: number, start: number, append: boolean) => {
      rfoot.textContent = '⟳ 解碼資料碎片…';
      try {
        const r = await (await fetch(`/__book?id=${id}&start=${start}&len=${CHUNK}`)).json();
        if (r.error) throw new Error(r.error);
        const safe = String(r.chunk)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
        if (append) rtext.innerHTML += safe;
        else { rtext.innerHTML = safe; rtext.scrollTop = 0; }
        cur = { id, pos: start + String(r.chunk).length, total: Number(r.total) };
        const pct = Math.min(100, (cur.pos / cur.total) * 100).toFixed(1);
        rfoot.innerHTML = cur.pos < cur.total
          ? `已載入 ${pct}% <button class="more">▼ 繼續讀取</button>`
          : `■ 全書完 (${(cur.total / 1000).toFixed(0)}k 字元)`;
        const more = rfoot.querySelector('.more') as HTMLElement | null;
        if (more) more.onclick = () => { if (cur) loadChunk(cur.id, cur.pos, true); };
      } catch (err) {
        rfoot.textContent = `⛔ 圖書館連線失敗:${String(err).slice(0, 60)}`;
      }
    };

    for (const b of BOOKS) {
      const item = document.createElement('div');
      item.className = 'bk';
      item.dataset.id = String(b.id);
      item.innerHTML = `<div class="t">${b.title}</div>
        <div class="a">${b.author}</div><div class="g">${b.tag}</div>`;
      item.onclick = () => {
        shelfEl.querySelectorAll('.bk').forEach((x) => x.classList.remove('sel'));
        item.classList.add('sel');
        rhead.textContent = `${b.title} — ${b.author} · Project Gutenberg #${b.id}`;
        rtext.innerHTML = '';
        loadChunk(b.id, 0, false);
      };
      shelfEl.appendChild(item);
    }
    if (selectId !== undefined) {
      (shelfEl.querySelector(`.bk[data-id="${selectId}"]`) as HTMLElement | null)?.click();
    }
    return win;
  }

  // ---------------- 畫廊 (Met Museum open-access art) ----------------

  private metIds: number[] = [];
  private metQuery = '';

  openGallery(): OSWindow {
    const win = this.makeWindow('gallery', '畫廊 // ART VAULT', 720, 560, 240, 20);
    if (win.body.childElementCount > 0) return win;
    win.body.innerHTML = `
      <div class="gallery">
        <div class="gbar"></div>
        <div class="gview"><div class="gmsg">讀取資料碎片…</div></div>
        <div class="gmeta"></div>
        <div class="gfoot"><button class="next">▶ 下一件藏品</button>
          <span class="src">資料源:大都會博物館 Open Access(公有領域)</span></div>
      </div>`;
    const QUERIES = ['hokusai', 'hiroshige', 'van gogh', 'monet', 'vermeer', 'rembrandt', 'turner', 'degas'];
    const gbar = win.body.querySelector('.gbar')!;
    const gview = win.body.querySelector('.gview') as HTMLElement;
    const gmeta = win.body.querySelector('.gmeta') as HTMLElement;

    const search = async (q: string) => {
      this.metQuery = q;
      gbar.querySelectorAll('.chip').forEach((c) =>
        c.classList.toggle('sel', (c as HTMLElement).dataset.q === q));
      gview.innerHTML = '<div class="gmsg">檢索館藏中…</div>';
      try {
        const r = await (await fetch(
          `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q)}`,
        )).json();
        this.metIds = (r.objectIDs ?? []).slice(0, 120);
        if (this.metIds.length === 0) throw new Error('no results');
        showRandom();
      } catch (err) {
        gview.innerHTML = `<div class="gmsg">⛔ 館藏連線失敗:${String(err).slice(0, 50)}</div>`;
      }
    };

    const showRandom = async (tries = 0): Promise<void> => {
      if (tries > 7 || this.metIds.length === 0) {
        gview.innerHTML = '<div class="gmsg">這個碎片解碼失敗,換一個藏家試試</div>';
        return;
      }
      const id = this.metIds[Math.floor(Math.random() * this.metIds.length)];
      try {
        const a = await (await fetch(
          `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        )).json();
        if (!a?.isPublicDomain || !a?.primaryImageSmall) return showRandom(tries + 1);
        gview.innerHTML = '';
        const img = document.createElement('img');
        img.src = a.primaryImageSmall;
        gview.appendChild(img);
        gmeta.innerHTML = `<b>${a.title ?? '無題'}</b><br/>
          ${a.artistDisplayName || '佚名'} · ${a.objectDate ?? ''}<br/>
          <i>${(a.medium ?? '').slice(0, 60)}</i>`;
      } catch { return showRandom(tries + 1); }
    };

    for (const q of QUERIES) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.q = q;
      chip.textContent = q;
      chip.onclick = () => search(q);
      gbar.appendChild(chip);
    }
    (win.body.querySelector('.next') as HTMLElement).onclick = () => showRandom();
    search(QUERIES[Math.floor(Math.random() * QUERIES.length)]);
    return win;
  }

  // ---------------- 私人錄音 (family viola recordings) ----------------

  openViola(): OSWindow {
    const win = this.makeWindow('viola', '私人錄音 // VIOLA.ARCHIVE', 560, 420, 300, 80);
    if (win.body.childElementCount > 0) return win;
    win.body.innerHTML = `
      <div class="mail" style="flex-direction:column;">
        <div style="padding:10px 14px;font-size:12px;color:#ffe14d;border-bottom:1px solid #5af2ff22">
          ♪ 家庭檔案 — 中提琴練習錄音(僅本機,不上雲)</div>
        <div class="vlist" style="flex:1;overflow-y:auto;"></div>
        <div style="padding:10px 14px;border-top:1px solid #5af2ff22">
          <audio class="vplayer" controls style="width:100%;height:34px;"></audio>
        </div>
      </div>`;
    const list = win.body.querySelector('.vlist') as HTMLElement;
    const player = win.body.querySelector('.vplayer') as HTMLAudioElement;
    fetch('/__music').then((r) => r.json()).then((d: { files: string[] }) => {
      if (!d.files.length) {
        list.innerHTML = `<div style="padding:18px;font-size:12px;color:#6a7a9a;line-height:2">
          資料夾還是空的。<br/>
          把錄音檔放進 <b style="color:#5af2ff">public/assets/music/viola/</b><br/>
          重新開啟本視窗即自動上架。</div>`;
        return;
      }
      for (const f of d.files) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `<div class="from">♪ ${f.replace(/\.[^.]+$/, '')}</div>`;
        item.onclick = () => {
          win.body.querySelectorAll('.item').forEach((x) => x.classList.remove('sel'));
          item.classList.add('sel');
          player.src = `/assets/music/viola/${encodeURIComponent(f)}`;
          player.play().catch(() => {});
        };
        list.appendChild(item);
      }
    }).catch(() => { list.textContent = '讀取失敗'; });
    return win;
  }

  // ---------------- DEV.LOG (easter egg) ----------------

  openDevlog(): OSWindow {
    const win = this.makeWindow('devlog', 'DEV.LOG // 造屋者終端', 640, 500, 260, 50);
    if (win.body.childElementCount > 0) return win;
    const log = `
[BUILD RECORD — NEON LOFT]
Builders : the Owner × Claude (AI)
Method   : 100% procedural + public-domain data, zero paid assets
Source   : https://github.com/klmtseng/cyberpunk-room
Status   : STILL UNDER CONSTRUCTION — and happily so.

── W1 ───────────────────────────────────────
+ grey-box loft / first-person / rain / city skyline
[INCIDENT-001] "I clicked and the whole screen went white."
  Autopsy: this machine's GPU driver stack (ANGLE × crocus)
  executed every shader on sight — 53 compile errors, context
  lost. Verdict: defected to Firefox. The dead Chrome tab kept
  haunting our telemetry for days, stealing screenshots and
  submitting black frames. We call it The White Ghost.

── W2 ───────────────────────────────────────
+ 6m double-height loft / mezzanine bedroom / walkable stairs
+ 260 towers → rivers of traffic light → holo billboards
[INCIDENT-002] Owner: "A bookcase is blocking the stairs."
  The culprit was actually the vending machine. It has been
  exiled to the arcade corner, where it sells 飲料 in peace.
[INCIDENT-003] "There's a strange black ball in the sky."
  Identified: an unpowered advertising blimp. Fitted with
  cabin lights and a NEON COLA board. Now a lawful aircraft.
[INCIDENT-004] "A dirty yellow band crosses the ground."
  Cause: the avenue texture smeared at 1 meter per pixel.
  Repaved in purple-white, as the reference photos demand.
[INCIDENT-005] Magenta slabs floating at the window edges.
  Light-pollution planes showing their naked edges.
  Treated with gradient falloff and flanking towers.

── W3 ───────────────────────────────────────
+ CyberOS: music / browser / terminal / sysmon / mail
+ rain that swells near the glass / speaker falloff / curtains
+ bathroom pod (sliding door, steam shower) / washing machine
[INCIDENT-006] The smart mirror vanished on installation day.
  Autopsy: bricked 5cm INSIDE the wall. Exhumed successfully.
[INCIDENT-007] Mirror's real-world weather read
  "CONNECTION BLOCKED BY ICE". The actual ICE: browser
  tracking-protection, which treats IP-geolocation services
  as fingerprinters. Switched to an allow-listed source.
[INCIDENT-008] All 44 real books vanished from the shelf.
  Autopsy: the bookcase was one solid block — the books were
  sealed inside it like a time capsule. Rebuilt with open
  shelving. All volumes recovered, fully readable.
+ the mirror now reflects a chrome avatar (first-person
  bodies don't exist until someone builds them)
+ video holo-ads between towers (black = transparent)
+ master paintings via The Met's open archive

── STATISTICS ───────────────────────────────
interactables: 20+   real books: 44   paintings: unbounded
automated tests: 21/21 green
FPS: 30±3 — on 2012 integrated graphics. Respect.

"We fall asleep in neon, and wake to the sound of rain."
                                        — manifesto.txt
`;
    win.body.innerHTML = `<pre style="margin:0;padding:16px;font-family:'Share Tech Mono',monospace;
      font-size:12px;line-height:1.75;color:#9fe8c8;white-space:pre-wrap;">${log}</pre>`;
    return win;
  }

  // ---------------- self test ----------------

  async selfTest(): Promise<Record<string, string>> {
    const r: Record<string, string> = {};
    const check = (name: string, fn: () => boolean | string) => {
      try {
        const v = fn();
        r[name] = v === true ? 'PASS' : v === false ? 'FAIL' : `PASS (${v})`;
      } catch (e) { r[name] = `ERROR ${e}`; }
    };
    this.enter();
    check('overlay-visible', () => this.root.classList.contains('on'));
    this.openTerm();
    check('term-open', () => this.windows.has('term'));
    check('term-help', () => this.execTerm('help').includes('weather'));
    check('term-weather-heavy', () => this.execTerm('weather heavy').includes('heavy'));
    check('term-weather-state', () => this.api.getWeather());
    check('term-neon', () => this.execTerm('neon').includes('→'));
    check('term-stats', () => this.execTerm('stats').includes('FPS'));
    // W5 photoreal verbs — flicker / brownout / cinema must be wired through
    check('term-flicker-off', () => this.execTerm('flicker off').includes('關閉'));
    check('term-flicker-on', () => this.execTerm('flicker on').includes('開啟'));
    check('term-brownout', () => /熄燈|區域/.test(this.execTerm('brownout')));
    check('term-cinema-on', () => this.execTerm('cinema').includes('開啟'));
    check('term-cinema-off', () => this.execTerm('cinema off').includes('關閉'));
    this.openSysMon();
    check('sysmon-open', () => this.windows.has('sysmon'));
    check('sysmon-fps-shown', () => /FPS/.test(this.windows.get('sysmon')!.body.textContent ?? ''));
    this.openMail();
    check('mail-open', () => this.windows.has('mail'));
    check('mail-content', () => /租金/.test(this.windows.get('mail')!.body.textContent ?? ''));
    this.openBrowser();
    check('browser-open', () => this.windows.has('browser'));
    check('browser-iframe', () => this.windows.get('browser')!.body.querySelector('iframe') !== null);
    this.openNeuroSound();
    check('neurosound-open', () => this.windows.has('neurosound'));
    // poll up to 15s — the YT api loads slowly on software-rendered test envs
    for (let i = 0; i < 30 && !(window as any).YT?.Player; i++) {
      await new Promise((res) => setTimeout(res, 500));
    }
    check('yt-api-loaded', () => (window as any).YT?.Player !== undefined);
    check('yt-iframe', () => document.querySelector('#cyberos iframe[src*="youtube"], #yt-persist iframe') !== null);
    // close everything, restore weather, exit
    this.execTerm('weather light');
    for (const w of [...this.windows.values()]) this.close(w);
    check('all-closed', () => this.windows.size === 0);
    this.exit();
    check('overlay-hidden', () => !this.root.classList.contains('on'));
    return r;
  }
}

function parseYouTubeId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;
  const m = input.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
