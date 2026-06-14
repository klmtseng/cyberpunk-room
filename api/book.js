// Project Gutenberg full-text proxy.
// In dev this is served by the vite /__book middleware; in prod Vercel rewrites
// /__book → /api/book (see vercel.json). Same response shape both sides:
//   { total: number, start: number, chunk: string }
// Edge-cached for a day per (id,start,len) — book text never changes.

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const id = String(u.searchParams.get('id') ?? '').replace(/\D/g, '');
  const start = Math.max(0, Number(u.searchParams.get('start') ?? 0));
  const len = Math.min(120000, Math.max(1000, Number(u.searchParams.get('len') ?? 60000)));
  if (!id) {
    res.status(400).json({ error: 'id' });
    return;
  }
  try {
    const r = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, {
      headers: { 'User-Agent': 'neon-loft/1.0 (public-domain reader)' },
    });
    if (!r.ok) {
      res.status(502).json({ error: `gutenberg ${r.status}` });
      return;
    }
    const raw = await r.text();
    const s = raw.search(/\*\*\* START OF [^\n]*\*\*\*/);
    const e = raw.search(/\*\*\* END OF [^\n]*\*\*\*/);
    const text = (s >= 0 && e > s ? raw.slice(raw.indexOf('\n', s), e) : raw).trim();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({
      total: text.length,
      start,
      chunk: text.slice(start, start + len),
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}
