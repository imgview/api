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
    const { url, h, w, q, fit = 'inside' } = req.query;

    console.log('Received parameters:', { url, h, w, q, fit });

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
      size: imageData.length
    });

    // Process image if parameters are provided
    if (h || w || q) {
      try {
        console.log('Starting Sharp processing with optimized settings...');
        
        let sharpInstance = sharp(imageData, {
          // Tambahan konfigurasi untuk kualitas lebih baik
          failOnError: false,
          limitInputPixels: false
        });
        
        // Resize dengan konfigurasi optimal
        if (h || w) {
          const height = h ? parseInt(h) : null;
          const width = w ? parseInt(w) : null;
          
          console.log('Resizing with optimized kernel:', { width, height });
          
          sharpInstance = sharpInstance.resize(width, height, {
            fit: fit, // 'inside', 'cover', 'fill', etc
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,    // ← KUNCI UTAMA untuk kehalusan
            fastShrinkOnLoad: false,          // ← Quality over speed
            position: 'center',
            background: { r: 255, g: 255, b: 255, alpha: 1 } // White background untuk fit=contain
          });
        }
        
        // Quality optimization dengan preset yang lebih baik
        const quality = q ? parseInt(q) : 80;
        console.log('Quality optimization:', quality);
        
        // Konversi ke format optimal berdasarkan kualitas
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          sharpInstance = sharpInstance.jpeg({ 
            quality,
            mozjpeg: true,      // ← Kompresi lebih baik
            chromaSubsampling: '4:4:4' // ← Kurangi chroma subsampling
          });
          contentType = 'image/jpeg';
        } else if (contentType.includes('webp')) {
          sharpInstance = sharpInstance.webp({ 
            quality,
            effort: 4           // ← Kompresi lebih baik (0-6)
          });
        } else if (contentType.includes('png')) {
          sharpInstance = sharpInstance.png({ 
            quality: quality * 10, // PNG quality range 0-100
            compressionLevel: 9, // ← Kompresi maksimal
            palette: true       // ← Optimize for smaller files
          });
        } else {
          // Default to JPEG untuk format lain
          sharpInstance = sharpInstance.jpeg({ 
            quality,
            mozjpeg: true 
          });
          contentType = 'image/jpeg';
        }
        
        imageData = await sharpInstance.toBuffer();
        
        console.log('Optimized processing successful, new size:', imageData.length);
        
      } catch (sharpError) {
        console.error('Sharp processing failed:', sharpError.message);
        // Fallback ke gambar asli
      }
    }

    // Set cache headers yang lebih agresif
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000'); // 1 day browser, 1 year CDN
    res.setHeader('Vary', 'Accept, Content-Type');

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
