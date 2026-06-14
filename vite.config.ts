import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync, existsSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import { execFile } from 'child_process';
import { homedir } from 'os';
import { Readable } from 'stream';

// Dev-only health beacon: the page POSTs render diagnostics here so we can
// verify GPU health from the shell on machines without X11 tooling (Wayland).
function beacon(): Plugin {
  return {
    name: 'neon-beacon',
    configureServer(server) {
      server.middlewares.use('/__beacon', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            // per-browser files: a broken Chrome tab must not clobber Firefox's numbers
            const ua = String(data.ua ?? 'unknown').split('/')[0].toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
            writeFileSync(`/tmp/neon-beacon-${ua}.json`,
              JSON.stringify({ ts: new Date().toISOString(), ...data }, null, 2));
            writeFileSync('/tmp/neon-beacon.json',
              JSON.stringify({ ts: new Date().toISOString(), ...data }, null, 2));
          } catch { /* malformed beacon; ignore */ }
          // remote shutter: write a UA tag ("firefox"/"chrome"/"any") into
          // /tmp/neon-shot-request — only the matching browser is asked to
          // shoot (a broken-WebGL Chrome tab kept stealing the flag with
          // black frames)
          let wantShot = false;
          try {
            if (existsSync('/tmp/neon-shot-request')) {
              const reqTag = readFileSync('/tmp/neon-shot-request', 'utf8').trim() || 'any';
              const uaTag = String(JSON.parse(body).ua ?? '').split('/')[0].toLowerCase().replace(/[^a-z]/g, '');
              wantShot = reqTag === 'any' || reqTag === uaTag;
            }
          } catch { /* ignore */ }
          // remote camera: write {pos:[x,y,z],yaw,pitch} to /tmp/neon-cam.json.
          // ONE-SHOT: read once, delete the file. A leftover would otherwise
          // yank the player back to the same pose every beacon tick (~3s).
          let cam: unknown = null;
          try {
            if (existsSync('/tmp/neon-cam.json')) {
              cam = JSON.parse(readFileSync('/tmp/neon-cam.json', 'utf8'));
              unlinkSync('/tmp/neon-cam.json');
            }
          } catch { /* ignore */ }
          // remote terminal: write {nonce, term:"holo"} to /tmp/neon-cmd.json
          let cmd: unknown = null;
          try {
            if (existsSync('/tmp/neon-cmd.json')) {
              cmd = JSON.parse(readFileSync('/tmp/neon-cmd.json', 'utf8'));
            }
          } catch { /* ignore */ }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ shot: wantShot, cam, cmd }));
        });
      });
      // dev-only news proxy: Google News RSS has no CORS, so fetch server-side.
      // /__news?cc=TW → top headlines in that country's language
      const newsCache = new Map<string, { ts: number; titles: string[] }>();
      server.middlewares.use('/__news', async (req, res) => {
        const cc = (new URL(req.url ?? '', 'http://x').searchParams.get('cc') ?? 'US').toUpperCase();
        const cached = newsCache.get(cc);
        if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ titles: cached.titles }));
          return;
        }
        const LOCALE: Record<string, [string, string]> = {
          TW: ['zh-TW', 'TW'], HK: ['zh-HK', 'HK'], CN: ['zh-CN', 'CN'], JP: ['ja', 'JP'],
          KR: ['ko', 'KR'], US: ['en-US', 'US'], GB: ['en-GB', 'GB'], DE: ['de', 'DE'],
          FR: ['fr', 'FR'], ES: ['es', 'ES'], SG: ['en-SG', 'SG'], MY: ['ms-MY', 'MY'],
          TH: ['th', 'TH'], VN: ['vi', 'VN'], ID: ['id', 'ID'],
        };
        const [hl, gl] = LOCALE[cc] ?? ['en-US', 'US'];
        try {
          const rss = await (await fetch(
            `https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split('-')[0]}`,
          )).text();
          const titles = [...rss.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
            .map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim())
            .filter(Boolean)
            .slice(0, 6);
          newsCache.set(cc, { ts: Date.now(), titles });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ titles }));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ titles: [], error: String(err) }));
        }
      });
      // dev-only Project Gutenberg proxy: full public-domain book text, sliced.
      // /__book?id=24264&start=0&len=60000
      const bookCache = new Map<string, string>();
      server.middlewares.use('/__book', async (req, res) => {
        const u = new URL(req.url ?? '', 'http://x');
        const id = String(u.searchParams.get('id') ?? '').replace(/\D/g, '');
        const start = Math.max(0, Number(u.searchParams.get('start') ?? 0));
        const len = Math.min(120000, Math.max(1000, Number(u.searchParams.get('len') ?? 60000)));
        if (!id) { res.statusCode = 400; res.end('{"error":"id"}'); return; }
        try {
          let text = bookCache.get(id);
          if (!text) {
            const raw = await (await fetch(
              `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
            )).text();
            // strip the Gutenberg license header/footer
            const s = raw.search(/\*\*\* START OF [^\n]*\*\*\*/);
            const e = raw.search(/\*\*\* END OF [^\n]*\*\*\*/);
            text = (s >= 0 && e > s ? raw.slice(raw.indexOf('\n', s), e) : raw).trim();
            bookCache.set(id, text);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            total: text.length,
            start,
            chunk: text.slice(start, start + len),
          }));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      // dev-only: resolve a YouTube id to a direct progressive stream URL.
      // format 18 = 360p mp4 with muxed audio — one file, VideoTexture-friendly.
      // Wrapped in a two-shot retry because googlevideo occasionally returns
      // 403/SSL errors mid-fetch even when the CLI succeeds; first failure is
      // usually recoverable on a re-spawn.
      const resolveCache = new Map<string, { ts: number; url: string }>();
      const runYtdlp = (vid: string): Promise<{ url?: string; error?: string }> =>
        new Promise((resolve) => {
          execFile(
            `${homedir()}/.local/bin/yt-dlp`,
            [
              '-g',
              // ask for muxed-audio mp4 explicitly; the [acodec!=none] guard
              // avoids the silent-DASH fallback that plays as a black, mute clip
              '-f', '18/best[height<=480][ext=mp4][acodec!=none]',
              '--no-warnings',
              '--retries', '3',
              '--socket-timeout', '12',
              `https://www.youtube.com/watch?v=${vid}`,
            ],
            { timeout: 45000 },
            (err, stdout, stderr) => {
              const url = stdout.trim().split('\n')[0] ?? '';
              if (err || !url.startsWith('https://')) {
                // surface the actual yt-dlp stderr tail instead of the generic
                // node "Command failed" string — much easier to debug.
                const detail = ((stderr ?? '').toString().trim().split('\n').slice(-2).join(' | ')
                  || String(err ?? 'no url')).slice(0, 200);
                resolve({ error: detail });
                return;
              }
              resolve({ url });
            },
          );
        });
      server.middlewares.use('/__resolve', async (req, res) => {
        const vid = String(new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '');
        if (!/^[\w-]{11}$/.test(vid)) { res.statusCode = 400; res.end('{"error":"id"}'); return; }
        const cached = resolveCache.get(vid);
        if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url: cached.url }));
          return;
        }
        let r = await runYtdlp(vid);
        if (r.error) {
          // brief pause then one re-spawn — covers transient googlevideo hiccups
          await new Promise((rr) => setTimeout(rr, 600));
          r = await runYtdlp(vid);
        }
        if (r.url) {
          resolveCache.set(vid, { ts: Date.now(), url: r.url });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url: r.url }));
          return;
        }
        console.warn(`[resolve] ${vid} failed after retry: ${r.error}`);
        res.statusCode = 502;
        res.end(JSON.stringify({ error: r.error ?? 'unknown' }));
      });

      // dev-only: same-origin proxy for the googlevideo stream — without it the
      // cross-origin video taints the WebGL texture upload. Forwards Range so
      // the <video> element can seek.
      server.middlewares.use('/__stream', async (req, res) => {
        try {
          const raw = new URL(req.url ?? '', 'http://x').searchParams.get('u') ?? '';
          const target = new URL(raw);
          if (!/(^|\.)googlevideo\.com$/.test(target.hostname)) {
            res.statusCode = 403;
            res.end('forbidden host');
            return;
          }
          const headers: Record<string, string> = {};
          if (req.headers.range) headers.range = String(req.headers.range);
          const upstream = await fetch(target, { headers });
          res.statusCode = upstream.status;
          for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            const v = upstream.headers.get(h);
            if (v) res.setHeader(h, v);
          }
          if (upstream.body) {
            Readable.fromWeb(upstream.body as never).pipe(res);
          } else {
            res.end();
          }
        } catch (err) {
          res.statusCode = 502;
          res.end(String(err).slice(0, 200));
        }
      });

      // dev-only YouTube search via yt-dlp (no API key): /__ytsearch?q=lofi
      const ytCache = new Map<string, { ts: number; items: unknown[] }>();
      server.middlewares.use('/__ytsearch', (req, res) => {
        const q = (new URL(req.url ?? '', 'http://x').searchParams.get('q') ?? '').slice(0, 80);
        if (!q.trim()) { res.statusCode = 400; res.end('{"items":[]}'); return; }
        const cached = ytCache.get(q);
        if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ items: cached.items }));
          return;
        }
        execFile(
          `${homedir()}/.local/bin/yt-dlp`,
          [`ytsearch12:${q}`, '--flat-playlist',
            '--print', '%(id)s\t%(title)s\t%(duration)s\t%(channel)s', '--no-warnings'],
          { timeout: 25000 },
          (err, stdout) => {
            if (err) { res.statusCode = 502; res.end(JSON.stringify({ items: [], error: String(err).slice(0, 100) })); return; }
            const items = stdout.trim().split('\n').filter(Boolean).map((line) => {
              const [id, title, duration, channel] = line.split('\t');
              return { id, title, duration: Number(duration) || 0, channel };
            }).filter((x) => /^[\w-]{11}$/.test(x.id));
            ytCache.set(q, { ts: Date.now(), items });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ items }));
          },
        );
      });
      // dev-only: list personal recordings dropped into public/assets/music/viola
      server.middlewares.use('/__music', (_req, res) => {
        try {
          const dir = new URL('./public/assets/music/viola', import.meta.url).pathname;
          const files = readdirSync(dir)
            .filter((f: string) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f))
            .sort();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ files }));
        } catch {
          res.end(JSON.stringify({ files: [] }));
        }
      });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { dataUrl, ua } = JSON.parse(body) as { dataUrl: string; ua?: string };
            const b64 = dataUrl.split(',')[1];
            const tag = String(ua ?? 'unknown').split('/')[0].toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
            writeFileSync(`/tmp/neon-shot-${tag}.png`, Buffer.from(b64, 'base64'));
            writeFileSync('/tmp/neon-shot.png', Buffer.from(b64, 'base64'));
            if (existsSync('/tmp/neon-shot-request')) unlinkSync('/tmp/neon-shot-request');
          } catch { /* ignore */ }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), beacon()],
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
