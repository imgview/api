// api/image-proxy.js - API tambahan untuk proxy gambar langsung

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method tidak diizinkan' });
  }

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ 
        error: 'Parameter URL gambar diperlukan',
        usage: 'GET /api/image-proxy?url=https://example.com/image.jpg'
      });
    }

    // Validate URL
    let imageUrl;
    try {
      imageUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Fetch the image
    const response = await fetch(imageUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageBot/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': imageUrl.origin
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Gagal mengambil gambar: ${response.status}` 
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1 hour

    // Send image
    res.status(200).send(Buffer.from(imageBuffer));

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ 
      error: 'Gagal memproxy gambar', 
      message: error.message 
    });
  }
}
