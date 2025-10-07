// api/sip.js - Simplified version of your working proxy
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'URL parameter required',
      usage: '/api/sip?url=https://example.com/image.jpg'
    });
  }

  console.log('SIP - Processing URL:', url);

  // **KUNCI: Tidak decode URL, pakai langsung seperti proxy yang berhasil**
  let imageUrl;
  try {
    imageUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ 
      error: 'Invalid URL format'
    });
  }

  try {
    // **Gunakan fetch configuration yang SAMA PERSIS dengan proxy berhasil**
    const response = await fetch(imageUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': imageUrl.origin
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch: ${response.status}` 
      });
    }

    // Check content type - hanya terima gambar
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'URL does not point to a valid image'
      });
    }

    // Get the image data
    const buffer = await response.arrayBuffer();

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    console.log('SIP - Successfully proxied image:', {
      contentType,
      size: buffer.byteLength
    });

    return res.status(200).send(Buffer.from(buffer));

  } catch (error) {
    console.error('SIP - Proxy error:', error);
    
    res.status(500).json({ 
      error: 'Failed to proxy image',
      message: error.message
    });
  }
  }
