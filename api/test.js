const Jimp = require('jimp');

async function fetchWithFallback(imageUrl) {
  const urlStr = imageUrl.toString();

  // Daftar strategi fetch
  const strategies = [
    // 1. Langsung dengan header browser
    () => fetch(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
        'Referer': imageUrl.origin + '/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin',
      }
    }),
    // 2. Lewat weserv.nl (proxy publik gratis)
    () => fetch(`https://images.weserv.nl/?url=${encodeURIComponent(urlStr)}&default=1`),
    // 3. Lewat wsrv.nl (mirror weserv)
    () => fetch(`https://wsrv.nl/?url=${encodeURIComponent(urlStr)}`),
  ];

  for (const strategy of strategies) {
    try {
      const r = await strategy();
      if (r.ok) return r;
    } catch (e) {
      continue;
    }
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
    const response = await fetchWithFallback(imageUrl);

    if (!response)
      return res.status(403).json({ error: 'Semua strategi gagal, gambar diblok' });

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
