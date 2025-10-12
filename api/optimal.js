const sharp = require('sharp');

module.exports = async (req, res) => {
  const { url, w, q } = req.query;

  if (!url) {
    res.status(400).send('Parameter url dibutuhkan. Contoh: /api/image-proxy/?url=https://example.com/img.jpg&w=400&q=90');
    return;
  }

  const width = parseInt(w || '0', 10);
  const quality = Math.min(100, Math.max(10, parseInt(q || '90', 10))); // default 90

  try {
    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).send('Gagal mengambil gambar dari sumber');
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let image = sharp(buffer);

    if (width > 0) image = image.resize({ width, withoutEnlargement: true });

    // Haluskan gambar sedikit tanpa kehilangan detail
    image = image
      .blur(0.3)      // blur ringan → hilangkan semut-semut
      //.sharpen(0.2) // opsional: bisa ditambahkan sedikit jika kurang tajam
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
