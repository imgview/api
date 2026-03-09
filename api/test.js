const { Jimp } = require('jimp');

const REFERER_MAP = {
  'imgkc': 'https://v1.komikcast.fit/',
  'softkomik': 'https://softkomik.co/',
};

function getReferer(hostname) {
  for (const [key, referer] of Object.entries(REFERER_MAP)) {
    if (hostname.includes(key)) return referer;
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, w, h, q } = req.query;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const referer = getReferer(imageUrl.hostname);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      // Tidak minta webp agar server kirim jpeg
      'Accept': 'image/jpeg,image/png,image/*,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': referer ? 'cross-site' : 'none',
      'Cache-Control': 'no-cache',
    };

    if (referer) {
      headers['Referer'] = referer;
      headers['Origin'] = new URL(referer).origin;
    }

    const response = await fetch(imageUrl.toString(), {
      signal: controller.signal,
      headers,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok)
      return res.status(response.status).json({ error: `Gagal fetch: ${response.status}` });

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    if (!imageBuffer.length)
      return res.status(500).json({ error: 'Buffer kosong' });

    // Tanpa resize: langsung passthrough
    if (!w && !h && !q) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', imageBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(imageBuffer);
    }

    const image = await Jimp.fromBuffer(imageBuffer);
    const quality = q ? parseInt(q) : 85;

    if (w || h) {
      image.scaleToFit({
        w: w ? parseInt(w) : Jimp.AUTO,
        h: h ? parseInt(h) : Jimp.AUTO,
      });
    }

    const output = await image.getBuffer('image/jpeg', { quality });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', output.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(output);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
