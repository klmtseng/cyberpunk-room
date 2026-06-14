// VIOLA.ARCHIVE — list of personal recordings under public/assets/music/viola.
// That folder is gitignored (private family recordings), so prod has nothing
// to list — return an empty array and the VIOLA.ARCHIVE UI shows its
// "資料夾還是空的" placeholder.

export default function handler(_req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({ files: [] });
}
