// api/image-proxy.js
import sharp from 'sharp';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { url, h, w, q } = req.query;

    console.log('Received parameters:', { url, h, w, q });

    if (!url) {
      return res.status(400).json({ 
        error: 'Parameter URL gambar diperlukan'
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

    console.log('Original image loaded:', { 
      contentType,
      size: imageData.length,
      hasParams: !!(h || w || q)
    });

    // Process image if parameters are provided
    if (h || w || q) {
      try {
        console.log('Starting Sharp processing...', { h, w, q });
        
        let sharpInstance = sharp(imageData);
        
        // Resize if height or width provided
        if (h || w) {
          const height = h ? parseInt(h) : null;
          const width = w ? parseInt(w) : null;
          
          console.log('Resizing to:', { width, height });
          
          sharpInstance = sharpInstance.resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
        
        // Adjust quality if provided
        const quality = q ? parseInt(q) : undefined;
        console.log('Quality setting:', quality);
        
        if (quality !== undefined) {
          if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            sharpInstance = sharpInstance.jpeg({ quality });
          } else if (contentType.includes('webp')) {
            sharpInstance = sharpInstance.webp({ quality });
          } else if (contentType.includes('png')) {
            sharpInstance = sharpInstance.png({ quality });
          }
        }
        
        imageData = await sharpInstance.toBuffer();
        
        console.log('Sharp processing successful, new size:', imageData.length);
        
      } catch (sharpError) {
        console.error('Sharp processing FAILED:', sharpError.message);
        // Tetap gunakan gambar asli jika processing gagal
      }
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

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
