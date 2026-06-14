// Google News RSS → top headlines for the smart-mirror feed.
// In dev this is served by the vite /__news middleware; in prod Vercel rewrites
// /__news → /api/news (see vercel.json). 10-minute edge cache per country.

const LOCALE = {
  TW: ['zh-TW', 'TW'], HK: ['zh-HK', 'HK'], CN: ['zh-CN', 'CN'], JP: ['ja', 'JP'],
  KR: ['ko', 'KR'], US: ['en-US', 'US'], GB: ['en-GB', 'GB'], DE: ['de', 'DE'],
  FR: ['fr', 'FR'], ES: ['es', 'ES'], SG: ['en-SG', 'SG'], MY: ['ms-MY', 'MY'],
  TH: ['th', 'TH'], VN: ['vi', 'VN'], ID: ['id', 'ID'],
};

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const cc = (u.searchParams.get('cc') ?? 'US').toUpperCase();
  const [hl, gl] = LOCALE[cc] ?? ['en-US', 'US'];
  try {
    const r = await fetch(
      `https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split('-')[0]}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 neon-loft-mirror' } },
    );
    if (!r.ok) {
      res.status(502).json({ titles: [], error: `google ${r.status}` });
      return;
    }
    const rss = await r.text();
    const titles = [...rss.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
      .map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim())
      .filter(Boolean)
      .slice(0, 6);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({ titles });
  } catch (err) {
    res.status(502).json({ titles: [], error: String(err) });
  }
}
