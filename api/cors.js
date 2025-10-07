export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const response = await fetch('https://luvyaa.my.id');
    const html = await response.text();

    const imgTags = [...html.matchAll(/<img[^>]+src="([^">]+)"/g)].map(m => m[1]);

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, images: imgTags }));
  } catch (err) {
    res.status(500).end(JSON.stringify({ ok: false, error: err.message }));
  }
}
