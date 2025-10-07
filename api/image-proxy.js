// api/image-proxy.js - API dengan parameter custom h dan q

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
    const { url, h, w, q } = req.query;

    if (!url) {
      return res.status(400).json({ 
        error: 'Parameter URL gambar diperlukan',
        usage: 'GET /api/image-proxy?url=https://example.com/image.jpg&h=300&q=80'
      });
    }

    // Validate URL
    let imageUrl;
    try {
      imageUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Fetch the original image
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
    let imageData = Buffer.from(imageBuffer);
    let contentType = response.headers.get('content-type') || 'image/jpeg';

    // Process image if parameters are provided
    if (h || w || q) {
      try {
        // You'll need to install sharp: npm install sharp
        const sharp = require('sharp');
        
        let sharpInstance = sharp(imageData);
        
        // Resize if height or width provided
        if (h || w) {
          const height = h ? parseInt(h) : null;
          const width = w ? parseInt(w) : null;
          
          sharpInstance = sharpInstance.resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
        
        // Adjust quality if provided (for JPEG/WebP)
        const quality = q ? parseInt(q) : undefined;
        if (quality && (contentType.includes('jpeg') || contentType.includes('webp'))) {
          sharpInstance = sharpInstance.jpeg({ quality }); // or .webp({ quality })
        }
        
        imageData = await sharpInstance.toBuffer();
        
      } catch (sharpError) {
        console.warn('Sharp processing failed, returning original image:', sharpError.message);
        // Continue with original image if processing fails
      }
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1 hour

    // Send image
    res.status(200).send(imageData);

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ 
      error: 'Gagal memproxy gambar', 
      message: error.message 
    });
  }
  }
