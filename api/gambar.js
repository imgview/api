import sharp from 'sharp';

const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const API_KEY = process.env.API_KEY || '';
const MAX_REQUESTS_WITHOUT_KEY = 5;
const requestCounts = new Map();

function validateApiKey(key) {
  if (!API_KEY) return false;
  return key === API_KEY;
}

function checkRateLimit(identifier, hasValidKey) {
  if (hasValidKey) {
    return { allowed: true, remaining: 'unlimited' };
  }
  
  const now = Date.now();
  const hourAgo = now - 3600000;
  
  if (!requestCounts.has(identifier)) requestCounts.set(identifier, []);
  const timestamps = requestCounts.get(identifier).filter(t => t > hourAgo);
  
  if (timestamps.length >= MAX_REQUESTS_WITHOUT_KEY) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: new Date(timestamps[0] + 3600000).toISOString() 
    };
  }
  
  timestamps.push(now);
  requestCounts.set(identifier, timestamps);
  return { 
    allowed: true, 
    remaining: MAX_REQUESTS_WITHOUT_KEY - timestamps.length 
  };
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return realIP || cfConnectingIP || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

async function fetchWithTimeoutAndRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (i === retries) throw error;
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

  if (Object.keys(req.query).length === 0) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Proxy Gambar</title>
        </head>
        <body>
          <center>
            <h2>Masukkan parameter, Contoh:</h2>
            <p><strong>Dengan API Key (Unlimited):</strong></p>
            <p>/?key=YOUR_API_KEY&w=200&q=75&url=IMAGE_URL</p>
            <p><strong>Tanpa API Key (Max 5 request/jam):</strong></p>
            <p>/?w=200&q=75&url=IMAGE_URL</p>
            <hr>
            <p><small>Parameter tambahan: sharp=true (untuk gambar lebih halus)</small></p>
          </center>
        </body>
    `);
  }

  try {
    const { key, url, h, w, q, fit = 'inside', format, sharp: enableSharpening } = req.query;

    // Jika tidak ada URL atau URL kosong, tampilkan halaman info tanpa rate limit
    if (!url || url.trim() === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Proxy Gambar - Masukkan URL</title>
        </head>
        <body>
          <center>
            <h2>📸 Masukkan URL Gambar</h2>
            <p>Tambahkan URL gambar setelah parameter <code>url=</code></p>
            <hr>
            <p><small>Contoh: <code>?w=200&url=https://example.com/image.jpg</code></small></p>
          </center>
        </body>
      `);
    }

    // Validasi dan rate limiting hanya untuk request yang benar-benar memproses gambar
    const hasValidKey = validateApiKey(key);
    const identifier = hasValidKey ? `key:${key}` : `ip:${getClientIP(req)}`;
    const rateLimitResult = checkRateLimit(identifier, hasValidKey);

    if (!rateLimitResult.allowed) {
      const resetTime = new Date(rateLimitResult.resetAt);
      const now = new Date();
      const minutesLeft = Math.ceil((resetTime - now) / (1000 * 60));
      res.setHeader('Content-Type', 'text/html');
      return res.status(429).send(`
        <head>
          <title>Akses Terbatas</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <center>
            <h2>⏰ Akses Terbatas</h2>
            <p>⚠️ Anda telah mencapai limit ${MAX_REQUESTS_WITHOUT_KEY} request per jam</p>
            <p>Coba lagi dalam ${minutesLeft} menit</p>
            <p>Reset pada: ${new Date(rateLimitResult.resetAt).toLocaleTimeString('id-ID')}</p>
            <hr>
            <p><small>💡 Gunakan API Key untuk akses unlimited</small></p>
          </center>
        </body>
      `);
    }

    let imageUrl;
    try {
      imageUrl = new URL(url);
      const hostname = imageUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('172.31.') || hostname.endsWith('.local')) {
        return res.status(400).json({ error: 'URL tidak diizinkan' });
      }
    } catch {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

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
    } catch {
      return res.status(504).json({ error: 'Gagal mengambil gambar dari sumber', message: 'Timeout atau koneksi terputus' });
    }

    if (!response.ok) return res.status(response.status).json({ error: `Gagal mengambil gambar: ${response.status}` });
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) return res.status(400).json({ error: 'URL tidak mengarah ke gambar yang valid' });
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) return res.status(413).json({ error: 'Gambar terlalu besar (max 10MB)' });
    const imageBuffer = await response.arrayBuffer();
    if (imageBuffer.byteLength === 0) return res.status(400).json({ error: 'Gambar kosong atau korup' });
    let imageData = Buffer.from(imageBuffer);
    const originalSize = imageData.length;

    try {
      const height = h ? parseInt(h) : undefined;
      const width = w ? parseInt(w) : undefined;
      const quality = q ? parseInt(q) : 75;
      const outputFormat = format || 'webp';
      
      let sharpInstance = sharp(imageData, { 
        failOnError: false, 
        limitInputPixels: Math.pow(2, 24)
      });
      
      const metadata = await sharpInstance.metadata();
      const maxWidth = width || Math.min(metadata.width, 1920);
      const maxHeight = height || undefined;
      
      // Resize dengan kernel mitchell untuk hasil lebih smooth
      sharpInstance = sharpInstance.resize(maxWidth, maxHeight, { 
        fit: fit, 
        withoutEnlargement: true, 
        kernel: sharp.kernel.mitchell, // Lebih smooth dari lanczos3
        fastShrinkOnLoad: false 
      });

      // Aplikasi sharpening untuk gambar lebih tajam dan halus
      if (enableSharpening === 'true' || !enableSharpening) {
        // Default apply sharpening untuk semua gambar
        sharpInstance = sharpInstance
          .median(1) // Hilangkan noise ringan
          .sharpen({
            sigma: 0.8,    // Blur radius (lebih rendah = lebih subtle)
            m1: 0.8,       // Flat areas
            m2: 0.3,       // Jagged areas
            x1: 2,
            y2: 10,
            y3: 20
          })
          .modulate({
            brightness: 1.01,  // Sedikit lebih cerah
            saturation: 1.03   // Sedikit lebih saturated
          });
      }
      
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
            palette: true, 
            effort: 10 
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
          sharpInstance = sharpInstance.webp({ 
            quality: Math.min(quality, 85), 
            effort: 6, 
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
      
      res.setHeader('Content-Type', outputContentType);
      res.setHeader('Content-Length', imageData.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
      res.setHeader('Vary', 'Accept');
      res.setHeader('X-Original-Size', originalSize);
      res.setHeader('X-Optimized-Size', optimizedSize);
      res.setHeader('X-Size-Reduction', `${reductionPercent}%`);
      res.setHeader('X-Rate-Limit-Remaining', rateLimitResult.remaining.toString());
      if (hasValidKey) res.setHeader('X-API-Key-Valid', 'true');
      res.status(200).send(imageData);
    } catch (sharpError) {
      return res.status(500).json({ error: 'Gagal memproses gambar', message: sharpError.message });
    }
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Timeout saat mengambil gambar' });
    res.status(500).json({ error: 'Terjadi kesalahan internal', message: process.env.NODE_ENV === 'development' ? error.message : 'Silakan coba lagi' });
  }
    }
