const Jimp = require('jimp');

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

  // Daftar referer yang dicoba secara berurutan
  const referers = [
    imageUrl.origin + '/',
    'https://www.google.com/',
    'https://imgkc2.my.id/',
    '',
  ];

  let response = null;
  let lastStatus = null;

  for (const referer of referers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': referer ? 'cross-site' : 'none',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Connection': 'keep-alive',
      };

      if (referer) {
        headers['Referer'] = referer;
        headers['Origin'] = new URL(referer).origin;
      }

      const r = await fetch(imageUrl.toString(), {
        signal: controller.signal,
        headers,
      }).finally(() => clearTimeout(timeout));

      lastStatus = r.status;

      if (r.ok) {
        response = r;
        break;
      }
    } catch (e) {
      lastStatus = e.message;
    }
  }

  if (!response) {
    return res.status(403).json({ error: `Semua percobaan gagal, status terakhir: ${lastStatus}` });
  }

  try {
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

    // Dengan resize pakai Jimp
    const image = await Jimp.read(imageBuffer);
    const mime = image.getMIME();

    if (w || h) {
      image.scaleToFit(
        w ? parseInt(w) : image.getWidth(),
        h ? parseInt(h) : image.getHeight()
      );
    }

    if (q) image.quality(parseInt(q));

    const output = await image.getBufferAsync(mime);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', output.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(output);

  } catch (err) {
    return res.status(500).json({
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' | ')
    });
  }
};
