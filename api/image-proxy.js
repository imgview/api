// api/image-proxy.js
import sharp from 'sharp';

// Timeout configuration
const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 2;

// IP Whitelist configuration
const WHITELISTED_IPS = (process.env.WHITELIST_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);

// Rate limiting (in-memory - reset on deploy)
const requestCounts = new Map();
const MAX_REQUESTS_NON_WHITELIST = 1;

function getClientIP(req) {
  // Get real IP from various headers (Vercel forwards real IP)
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const cfConnectingIP = req.headers['cf-connecting-ip']; // Cloudflare
  
  if (forwarded) {
    // x-forwarded-for can be comma-separated list
    return forwarded.split(',')[0].trim();
  }
  
  return realIP || cfConnectingIP || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function isWhitelisted(ip) {
  if (WHITELISTED_IPS.length === 0) {
    return false; // No whitelist = all non-whitelisted
  }
  
  // Check exact match
  if (WHITELISTED_IPS.includes(ip)) {
    return true;
  }
  
  // Check CIDR ranges (e.g., 192.168.1.0/24)
  for (const whitelistedIP of WHITELISTED_IPS) {
    if (whitelistedIP.includes('/')) {
      // Simple CIDR check for /24, /16, /8
      const [network, bits] = whitelistedIP.split('/');
      const maskLength = parseInt(bits);
      
      if (maskLength === 24) {
        const ipPrefix = ip.split('.').slice(0, 3).join('.');
        const networkPrefix = network.split('.').slice(0, 3).join('.');
        if (ipPrefix === networkPrefix) return true;
      } else if (maskLength === 16) {
        const ipPrefix = ip.split('.').slice(0, 2).join('.');
        const networkPrefix = network.split('.').slice(0, 2).join('.');
        if (ipPrefix === networkPrefix) return true;
      } else if (maskLength === 8) {
        const ipPrefix = ip.split('.')[0];
        const networkPrefix = network.split('.')[0];
        if (ipPrefix === networkPrefix) return true;
      }
    }
  }
  
  return false;
}

function checkRateLimit(ip, isWhitelisted) {
  if (isWhitelisted) return { allowed: true, remaining: 'unlimited' };
  
  const now = Date.now();
  const hourAgo = now - 3600000; // 1 hour
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const timestamps = requestCounts.get(ip).filter(t => t > hourAgo);
  
  if (timestamps.length >= MAX_REQUESTS_NON_WHITELIST) {
    return { 
      allowed: false, 
      remaining: 0,
      resetAt: new Date(timestamps[0] + 3600000).toISOString()
    };
  }
  
  timestamps.push(now);
  requestCounts.set(ip, timestamps);
  
  return { 
    allowed: true, 
    remaining: MAX_REQUESTS_NON_WHITELIST - timestamps.length 
  };
}

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
    // Get client IP
    const clientIP = getClientIP(req);
    const whitelisted = isWhitelisted(clientIP);
    
    // Rate limiting check
    const rateLimitResult = checkRateLimit(clientIP, whitelisted);
    
    if (!rateLimitResult.allowed) {
  return res.status(429).send(
    `Error: Terlalu banyak request\n\n` +
    `Limit ${MAX_REQUESTS_NON_WHITELIST} request per jam tercapai.\n` +
    `Whitelist IP Anda untuk unlimited access.\n\n` +
    `Detail:\n` +
    `- IP Anda: ${clientIP}\n` +
    `- Reset pada: ${rateLimitResult.resetAt}\n` +
    `- Sisa request: 0`
  );
}

    const { url, h, w, q, fit = 'inside', format } = req.query;

    console.log('Processing request:', { 
      url: url?.substring(0, 100) + '...',
      clientIP,
      whitelisted,
      remaining: rateLimitResult.remaining
    });

    // Special endpoint to check IP and whitelist status
    if (!url || url === 'check' || url === 'info' || url === 'status') {
      return res.status(200).json({
        success: true,
        message: 'Image Proxy API - IP Info',
        yourIP: clientIP,
        whitelisted: whitelisted,
        rateLimit: {
          maxRequests: whitelisted ? 'unlimited' : MAX_REQUESTS_NON_WHITELIST,
          remaining: rateLimitResult.remaining,
          resetAt: rateLimitResult.resetAt || null
        },
        usage: {
          endpoint: '/api/image-proxy',
          requiredParams: ['url'],
          optionalParams: ['w', 'h', 'q', 'fit', 'format'],
          example: '/api/image-proxy?url=https://example.com/image.jpg&w=800&q=80&format=webp'
        },
        formats: ['webp', 'jpeg', 'png', 'avif'],
        maxImageSize: '10MB',
        documentation: 'https://github.com/yourusername/image-proxy'
      });
    }

    // Validate and sanitize URL
    let imageUrl;
    try {
      imageUrl = new URL(url);
      
      const hostname = imageUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || 
          hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
          hostname.startsWith('172.16.') || hostname.startsWith('172.31.') ||
          hostname.endsWith('.local')) {
        return res.status(400).json({ error: 'URL tidak diizinkan' });
      }
      
    } catch (error) {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Fetch the original image
    let response;
    try {
      response = await fetchWithTimeoutAndRetry(imageUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': imageUrl.origin
        },
        compress: true,
        follow: 5
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

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'URL tidak mengarah ke gambar yang valid' 
      });
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      return res.status(413).json({ 
        error: 'Gambar terlalu besar (max 10MB)' 
      });
    }

    const imageBuffer = await response.arrayBuffer();
    
    if (imageBuffer.byteLength === 0) {
      return res.status(400).json({ 
        error: 'Gambar kosong atau korup' 
      });
    }

    let imageData = Buffer.from(imageBuffer);
    const originalSize = imageData.length;

    console.log('Image loaded:', { 
      contentType,
      originalSize,
      params: { h, w, q, format }
    });

    // ALWAYS process image for optimization
    try {
      const height = h ? parseInt(h) : undefined;
      const width = w ? parseInt(w) : undefined;
      const quality = q ? parseInt(q) : 75; // Lower default quality
      const outputFormat = format || 'webp'; // Default to WebP for best compression

      let sharpInstance = sharp(imageData, {
        failOnError: false,
        limitInputPixels: Math.pow(2, 24)
      });

      // Get metadata
      const metadata = await sharpInstance.metadata();
      
      // Auto-resize if no dimensions specified (max 1920px width)
      const maxWidth = width || Math.min(metadata.width, 1920);
      const maxHeight = height || undefined;

      // Resize with Lanczos3 kernel for best quality
      sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
        fit: fit,
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3, // High quality resampling
        fastShrinkOnLoad: false // Don't use fast shrink for better quality
      });

      // Output format optimization
      let outputContentType;
      
      switch (outputFormat.toLowerCase()) {
        case 'jpeg':
        case 'jpg':
          sharpInstance = sharpInstance.jpeg({ 
            quality: Math.min(quality, 85),
            mozjpeg: true,
            chromaSubsampling: '4:2:0',
            progressive: true,
            optimizeScans: true
          });
          outputContentType = 'image/jpeg';
          break;
          
        case 'png':
          sharpInstance = sharpInstance.png({ 
            quality: Math.min(quality, 90),
            compressionLevel: 9,
            palette: true, // Use palette for smaller size
            effort: 10 // Maximum effort
          });
          outputContentType = 'image/png';
          break;
          
        case 'avif':
          sharpInstance = sharpInstance.avif({ 
            quality: Math.min(quality, 80),
            effort: 6
          });
          outputContentType = 'image/avif';
          break;
          
        case 'webp':
        default:
          // WebP provides best compression while maintaining quality
          sharpInstance = sharpInstance.webp({ 
            quality: Math.min(quality, 85),
            effort: 6, // Maximum compression effort
            smartSubsample: true,
            nearLossless: false,
            reductionEffort: 6
          });
          outputContentType = 'image/webp';
          break;
      }

      imageData = await sharpInstance.toBuffer();
      
      const optimizedSize = imageData.length;
      const reductionPercent = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
      
      console.log('Image optimized:', { 
        originalSize,
        optimizedSize,
        reduction: `${reductionPercent}%`,
        format: outputFormat
      });

      // Set response headers
      res.setHeader('Content-Type', outputContentType);
      res.setHeader('Content-Length', imageData.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
      res.setHeader('Vary', 'Accept');
      res.setHeader('X-Original-Size', originalSize);
      res.setHeader('X-Optimized-Size', optimizedSize);
      res.setHeader('X-Size-Reduction', `${reductionPercent}%`);
      res.setHeader('X-Client-IP', clientIP);
      res.setHeader('X-Rate-Limit-Remaining', rateLimitResult.remaining.toString());
      
      if (whitelisted) {
        res.setHeader('X-Whitelisted', 'true');
      }

      res.status(200).send(imageData);

    } catch (sharpError) {
      console.error('Image processing failed:', sharpError.message);
      return res.status(500).json({ 
        error: 'Gagal memproses gambar',
        message: sharpError.message
      });
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    
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
