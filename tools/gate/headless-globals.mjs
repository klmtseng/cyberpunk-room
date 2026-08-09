/**
 * headless-globals.mjs — browser-API stubs for headless Node execution.
 *
 * Loaded via  --import tools/gate/headless-globals.mjs  BEFORE any project
 * TypeScript is imported.  Only stubs browser globals that room.ts / props.ts
 * / i18n.ts reference at module-load time or inside buildRoom/buildProps.
 *
 * IRON RULE: these stubs affect ONLY material/texture/timing/lang-detection.
 * They MUST NOT influence any Object3D's position, scale, rotation, or
 * geometry dimensions — those come verbatim from room.ts / props.ts.
 */

// ── Canvas stub ──────────────────────────────────────────────────────────────
// A recursive Proxy: any property access returns a no-op function that itself
// returns the same kind of Proxy.  Special-cased returns for APIs that callers
// actually read back (getImageData, measureText, canvas.width/height).

function makeImageData(w, h) {
  return {
    data:   new Uint8ClampedArray((w || 512) * (h || 512) * 4),
    width:  w || 512,
    height: h || 512,
  };
}

function makeGradient() {
  return { addColorStop: () => {} };
}

function makeProxyCanvas() {
  const style = {};

  function makeCtx(canvasRef) {
    const handler = {
      get(_, prop) {
        if (prop === 'measureText')         return (t) => ({ width: String(t).length * 8 });
        if (prop === 'style')               return style;
        if (prop === 'canvas')              return canvasRef || { width: 512, height: 512 };
        if (prop === 'getImageData')        return (x, y, w, h) => makeImageData(w, h);
        if (prop === 'putImageData')        return () => {};
        if (prop === 'createImageData')     return (w, h) => makeImageData(w, h);
        if (prop === 'createLinearGradient') return () => makeGradient();
        if (prop === 'createRadialGradient') return () => makeGradient();
        if (prop === 'createPattern')       return () => ({});
        if (prop === 'drawImage')           return () => {};
        // Any other method: no-op, returns another ctx-like proxy
        return new Proxy(function () {}, {
          apply: () => makeCtx(canvasRef),
          get:   (__, p) => (p === 'then' ? undefined : makeCtx(canvasRef)),
        });
      },
      set() { return true; },
    };
    return new Proxy({}, handler);
  }

  // Use a real object with a Proxy wrapper so that width/height assignments
  // are stored and readable (room.ts does `c.width = 512; c.height = 512;`).
  const canvas = {
    _width:  512,
    _height: 512,
    style,
    addEventListener:    () => {},
    removeEventListener: () => {},
    toDataURL:           () => '',
    getContext:          function () { return makeCtx(this); },
  };

  return new Proxy(canvas, {
    get(target, prop) {
      if (prop === 'width')  return target._width;
      if (prop === 'height') return target._height;
      return target[prop];
    },
    set(target, prop, val) {
      if (prop === 'width')  { target._width  = Number(val); return true; }
      if (prop === 'height') { target._height = Number(val); return true; }
      target[prop] = val;
      return true;
    },
  });
}

// ── document stub ─────────────────────────────────────────────────────────────

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return makeProxyCanvas();
      // Minimal stub for other elements (img, video, div…)
      return {
        style:               {},
        src:                 '',
        addEventListener:    () => {},
        removeEventListener: () => {},
        setAttribute:        () => {},
      };
    },
    createElementNS(_, tag) { return this.createElement(tag); },
    getElementById:      () => null,
    body:                { appendChild: () => {}, removeChild: () => {} },
    head:                { appendChild: () => {} },
    documentElement:     { style: {} },
    cookie:              '',
  };
}

// ── window stub ───────────────────────────────────────────────────────────────

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener:    () => {},
    removeEventListener: () => {},
    innerWidth:          1280,
    innerHeight:         720,
    devicePixelRatio:    1,
    setTimeout:          (fn, ms) => setTimeout(fn, ms),
    clearTimeout:        (id) => clearTimeout(id),
    setInterval:         (fn, ms) => setInterval(fn, ms),
    clearInterval:       (id) => clearInterval(id),
  };
} else if (!globalThis.window.setTimeout) {
  // window exists but is partial (rare in Node)
  globalThis.window.setTimeout  = (fn, ms) => setTimeout(fn, ms);
  globalThis.window.clearTimeout = (id) => clearTimeout(id);
}

// ── Other browser globals ─────────────────────────────────────────────────────

if (typeof globalThis.location === 'undefined') {
  globalThis.location = { search: '', hash: '', href: '', pathname: '/' };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem:    () => null,
    setItem:    () => {},
    removeItem: () => {},
  };
}
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { language: 'en', userAgent: '' };
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
