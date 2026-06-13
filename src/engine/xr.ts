import type { EngineCtx } from './renderer';

export async function initXR(ctx: EngineCtx): Promise<void> {
  const xr = (navigator as any).xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') return;
  let supported = false;
  try { supported = await xr.isSessionSupported('immersive-vr'); } catch { supported = false; }
  if (!supported) return;

  const button = document.createElement('button');
  button.textContent = 'ENTER VR';
  Object.assign(button.style, {
    position: 'fixed', right: '14px', top: '14px', zIndex: '20',
    background: 'transparent', color: '#5af2ff',
    border: '1px solid #5af2ff66', padding: '8px 14px',
    fontFamily: "'Share Tech Mono', monospace", fontSize: '12px',
    letterSpacing: '.15em', cursor: 'pointer',
  } as CSSStyleDeclaration);
  button.onclick = async () => {
    try {
      const session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      await ctx.renderer.xr.setSession(session);
    } catch (err) { console.warn('VR session failed', err); }
  };
  document.body.appendChild(button);
}
