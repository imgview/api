const REFERER_MAP = {
  'imgkc': 'https://v1.komikcast.fit/',
  'softkomik': 'https://softkomik.co/',
  'westmanga': 'https://westmanga.tv/',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Parameter url wajib diisi' });

  let imageUrl;
  try {
    imageUrl = new URL(url);
    if (!['http:', 'https:'].includes(imageUrl.protocol))
      return res.status(400).json({ error: 'Hanya http/https' });
  } catch {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  try {
    const referer = Object.entries(REFERER_MAP).find(([key]) => imageUrl.hostname.includes(key))?.[1] || null;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': referer ? 'cross-site' : 'none',
    };

    if (referer) {
      headers['Referer'] = referer;
      headers['Origin'] = new URL(referer).origin;
    }

    const response = await fetch(imageUrl.toString(), { headers });

    if (!response.ok)
      return res.status(response.status).json({ error: `Gagal fetch: ${response.status}` });

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
