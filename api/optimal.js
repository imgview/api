// pages/api/image-proxy/index.js
const sharp = require('sharp');

module.exports = async (req, res) => {
  const { url, w, q } = req.query;

  if (!url) {
    res.status(400).send('Parameter url dibutuhkan. Contoh: /api/image-proxy/?url=https://example.com/img.jpg&w=400&q=80');
    return;
  }

  const width = parseInt(w || '0', 10);
  const quality = Math.min(100, Math.max(10, parseInt(q || '80', 10)));

  try {
    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).send('Gagal mengambil gambar dari sumber');
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let image = sharp(buffer);

    // Resize hanya pakai width, height otomatis sesuai aspect ratio
    if (width > 0) image = image.resize({ width, withoutEnlargement: true });

    // sedikit sharpen + noise reduction
    image = image
      .sharpen(0.5)
      .median(1)
      .jpeg({ quality, mozjpeg: true });

    const outputBuffer = await image.toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(outputBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Terjadi kesalahan saat memproses gambar');
  }
};
