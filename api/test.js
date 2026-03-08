const Sharp = require('sharp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, h, w, q, fit } = req.query;

  if (!url) return res.status(400).json({ error: 'Parameter url wajib diisi' });

  let imageUrl;
  try {
    imageUrl = new URL(url);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) {
      return res.status(400).json({ error: 'Hanya protokol http/https' });
    }
  } catch {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(imageUrl.toString(), {
      signal: controller.signal,
      headers: {
        // Pura-pura browser biasa biar tidak diblok Cloudflare
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': imageUrl.origin + '/',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Cache-Control': 'no-cache',
      }
    });

    clearTimeout(timeout);

    if (!response.ok) return res.status(response.status).json({ error: `Gagal fetch: ${response.status}` });

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    let sharpInstance = Sharp(imageBuffer, { failOnError: false });

    if (w || h) {
      sharpInstance = sharpInstance.resize(
        w ? parseInt(w) : undefined,
        h ? parseInt(h) : undefined,
        { fit: fit || 'inside', withoutEnlargement: true }
      );
    }

    if (q) {
      const quality = parseInt(q);
      const meta = await Sharp(imageBuffer).metadata();
      const fmt = meta.format;
      if (fmt === 'jpeg') sharpInstance = sharpInstance.jpeg({ quality });
      else if (fmt === 'png') sharpInstance = sharpInstance.png({ quality });
      else if (fmt === 'webp') sharpInstance = sharpInstance.webp({ quality });
      else if (fmt === 'avif') sharpInstance = sharpInstance.avif({ quality });
    }

    const output = await sharpInstance.toBuffer();
    const meta = await Sharp(output).metadata();

    res.setHeader('Content-Type', `image/${meta.format}`);
    res.setHeader('Content-Length', output.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(output);

  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses gambar', message: err.message });
  }
};
