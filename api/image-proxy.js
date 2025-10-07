// api/image-proxy.js
import sharp from 'sharp';

// Timeout configuration
const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 2;

async function fetchWithTimeoutAndRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
      
    } catch (error) {
      console.log(`Fetch attempt ${i + 1} failed:`, error.message);
      
      if (i === retries) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

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

    console.log('Processing request for URL:', url?.substring(0, 100) + '...');

    if (!url) {
      return res.status(400).json({ 
        error: 'Parameter URL gambar diperlukan'
      });
    }

    // Validate and sanitize URL
    let imageUrl;
    try {
      imageUrl = new URL(url);
      
      // Security: Block localhost and private IPs
      const hostname = imageUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || 
          hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
          hostname.endsWith('.local')) {
        return res.status(400).json({ error: 'URL tidak diizinkan' });
      }
      
    } catch (error) {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Fetch the original image with retry mechanism
    let response;
    try {
      response = await fetchWithTimeoutAndRetry(imageUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': imageUrl.origin
        },
        // Vercel-specific optimizations
        compress: true,
        follow: 5 // Maximum redirects
      });
    } catch (fetchError) {
      console.error('All fetch attempts failed:', fetchError.message);
      return res.status(504).json({ 
        error: 'Gagal mengambil gambar dari sumber',
        message: 'Timeout atau koneksi terputus'
      });
    }

    if (!response.ok) {
      console.error('Upstream response not OK:', response.status);
      return res.status(response.status).json({ 
        error: `Gagal mengambil gambar: ${response.status}` 
      });
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'URL tidak mengarah ke gambar yang valid' 
      });
    }

    // Check file size limit (10MB untuk Vercel)
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      return res.status(413).json({ 
        error: 'Gambar terlalu besar (max 10MB)' 
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    
    if (imageBuffer.byteLength === 0) {
      return res.status(400).json({ 
        error: 'Gambar kosong atau korup' 
      });
    }

    let imageData = Buffer.from(imageBuffer);
    let outputContentType = contentType;

    console.log('Image loaded successfully:', { 
      contentType,
      size: imageData.length,
      hasTransformations: !!(h || w || q)
    });

    // Process image if parameters are provided
    if (h || w || q) {
      try {
        const height = h ? parseInt(h) : undefined;
        const width = w ? parseInt(w) : undefined;
        const quality = q ? parseInt(q) : 80;

        console.log('Applying transformations:', { width, height, quality });

        let sharpInstance = sharp(imageData, {
          failOnError: false,
          limitInputPixels: Math.pow(2, 24) // Increase pixel limit
        });

        // Resize if dimensions provided
        if (height || width) {
          sharpInstance = sharpInstance.resize(width, height, {
            fit: fit,
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
            fastShrinkOnLoad: false
          });
        }

        // Adjust quality
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          sharpInstance = sharpInstance.jpeg({ 
            quality: Math.min(quality, 100),
            mozjpeg: true,
            chromaSubsampling: '4:4:4'
          });
          outputContentType = 'image/jpeg';
        } else if (contentType.includes('png')) {
          sharpInstance = sharpInstance.png({ 
            quality: Math.min(quality * 10, 100),
            compressionLevel: 9
          });
        } else if (contentType.includes('webp')) {
          sharpInstance = sharpInstance.webp({ 
            quality: Math.min(quality, 100),
            effort: 4
          });
        } else {
          // Default to JPEG for other formats
          sharpInstance = sharpInstance.jpeg({ 
            quality: Math.min(quality, 100),
            mozjpeg: true
          });
          outputContentType = 'image/jpeg';
        }

        imageData = await sharpInstance.toBuffer();
        
        console.log('Image processing successful, output size:', imageData.length);

      } catch (sharpError) {
        console.error('Image processing failed, using original:', sharpError.message);
        // Continue with original image
      }
    }

    // Set headers
    res.setHeader('Content-Type', outputContentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000');
    res.setHeader('Vary', 'Accept');

    // Send the image
    res.status(200).send(imageData);

  } catch (error) {
    console.error('Unexpected error:', error);
    
    // More specific error responses
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: 'Timeout saat mengambil gambar' 
      });
    }
    
    res.status(500).json({ 
      error: 'Terjadi kesalahan internal',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Silakan coba lagi'
    });
  }
        }
