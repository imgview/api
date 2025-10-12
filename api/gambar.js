import * as sharp from 'sharp';

const FETCH_TIMEOUT = 30000;
const MAX_RETRIES = 2;
const API_KEY = process.env.API_KEY || '';
const MAX_REQUESTS_WITHOUT_KEY = 10;
const requestCounts = new Map();
const cache = new Map();

function validateApiKey(key) {
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
  return forwarded ? forwarded.split(',')[0].trim() : realIP || cfConnectingIP || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
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

setInterval(() => {
  const now = Date.now();
  const hourAgo = now - 3600000;
  for (const [key, timestamps] of requestCounts) {
    requestCounts.set(key, timestamps.filter(t => t > hourAgo));
    if (requestCounts.get(key).length === 0) requestCounts.delete(key);
  }
}, 3600000);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Peringatan simpel untuk /api
  if (req.url === '/api' || req.url === '/api/') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(404).send('tidak ada apa apa disini');
  }

  // Peringatan simpel untuk /api/gambar
  if (req.url === '/api/gambar' || req.url === '/api/gambar/') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('/?w=300&q=75&url=');
  }

  const { key, url, h, w, q, fit, format, sharp: sharpParam, sharpLevel, text } = req.query;

  // Peringatan simpel untuk URL kosong
  if (!url || url.trim() === '') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Masukkan URL Gambar');
  }

  // Jika hanya url disediakan, kembalikan gambar asli
  if (Object.keys(req.query).length === 1 || (Object.keys(req.query).length === 2 && key)) {
    let imageUrl;
    try {
      imageUrl = new URL(url);
      if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(400).send('URL tidak valid');
      }
      const hostname = imageUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || 
          hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('172.31.') || 
          hostname.endsWith('.local')) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(400).send('URL tidak diizinkan');
      }
    } catch {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('URL tidak valid');
    }

    let response;
    try {
      response = await fetchWithTimeoutAndRetry(imageUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': ''
        },
        compress: true,
        follow: 5
      });
    } catch {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(504).send('Gagal mengambil gambar');
    }

    if (!response.ok) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(response.status).send(`Gagal mengambil: ${response.status}`);
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('Bukan gambar valid');
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(413).send('Gambar terlalu besar');
    }

    const imageBuffer = await response.arrayBuffer();
    if (imageBuffer.byteLength < 1024) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('Gambar tidak bisa diambil');
    }
    const imageData = Buffer.from(imageBuffer);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', imageData.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    return res.status(200).send(imageData);
  }

  // Validasi dan rate limiting
  const hasValidKey = validateApiKey(key);
  const identifier = hasValidKey ? `key:${key}` : `ip:${getClientIP(req)}`;
  const rateLimitResult = checkRateLimit(identifier, hasValidKey);

  if (!rateLimitResult.allowed) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(429).send('Limit request tercapai, coba lagi nanti');
  }

  // Validasi URL
  let imageUrl;
  try {
    imageUrl = new URL(url);
    if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('URL tidak valid');
    }
    const hostname = imageUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || 
        hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('172.31.') || 
        hostname.endsWith('.local')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('URL tidak diizinkan');
    }
  } catch {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('URL tidak valid');
  }

  // Validasi parameter
  const height = h ? parseInt(h) : undefined;
  const width = w ? parseInt(w) : undefined;
  const quality = q ? parseInt(q) : undefined;
  const validFormats = ['webp', 'jpeg', 'jpg', 'png', 'avif'];
  const validSharpLevels = ['low', 'medium', 'high'];
  const validFits = ['contain', 'cover', 'fill', 'inside', 'outside'];

  if ((height && (isNaN(height) || height <= 0 || height > 10000)) || 
      (width && (isNaN(width) || width <= 0 || width > 10000))) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Parameter h atau w tidak valid');
  }
  if (quality && (isNaN(quality) || quality < 1 || quality > 100)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Parameter q tidak valid');
  }
  if (format && !validFormats.includes(format.toLowerCase())) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send(`Format tidak didukung: ${validFormats.join(', ')}`);
  }
  if (fit && !validFits.includes(fit.toLowerCase())) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send(`Fit tidak didukung: ${validFits.join(', ')}`);
  }
  if (sharpParam === 'true' && (!sharpLevel || !validSharpLevels.includes(sharpLevel.toLowerCase()))) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Parameter sharpLevel wajib: low, medium, high');
  }
  if (text && text !== 'true' && text !== 'false') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Parameter text harus true atau false');
  }

  // Cek cache
  const cacheKey = `${url}-${w || ''}-${h || ''}-${q || ''}-${format || ''}-${fit || ''}-${sharpParam || ''}-${sharpLevel || ''}-${text || ''}`;
  if (cache.has(cacheKey)) {
    const cachedImage = cache.get(cacheKey);
    res.setHeader('Content-Type', cachedImage.contentType);
    res.setHeader('Content-Length', cachedImage.data.length);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Rate-Limit-Remaining', rateLimitResult.remaining.toString());
    if (hasValidKey) res.setHeader('X-API-Key-Valid', 'true');
    return res.status(200).send(cachedImage.data);
  }

  // Fetch gambar
  let response;
  try {
    response = await fetchWithTimeoutAndRetry(imageUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': ''
      },
      compress: true,
      follow: 5
    });
  } catch {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(504).send('Gagal mengambil gambar');
  }

  if (!response.ok) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(response.status).send(`Gagal mengambil: ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.startsWith('image/')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Bukan gambar valid');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(413).send('Gambar terlalu besar');
  }

  const imageBuffer = await response.arrayBuffer();
  if (imageBuffer.byteLength < 1024) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Gambar tidak bisa diambil');
  }
  let imageData = Buffer.from(imageBuffer);
  const originalSize = imageData.length;

  // Jika tidak ada parameter pemrosesan, kembalikan gambar asli
  if (!w && !h && !q && !format && !sharpParam && !fit && !text) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', imageData.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.setHeader('X-Rate-Limit-Remaining', rateLimitResult.remaining.toString());
    if (hasValidKey) res.setHeader('X-API-Key-Valid', 'true');
    return res.status(200).send(imageData);
  }

  // Check Sharp
  if (typeof sharp !== 'object' || typeof sharp.default !== 'function') {
    console.error('Sharp module error: not loaded correctly');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send('Server error: Sharp tidak tersedia');
  }

  try {
    let sharpInstance = sharp.default(imageData, { 
      failOnError: false, 
      limitInputPixels: Math.pow(2, 24)
    });
    
    const metadata = await sharpInstance.metadata();
    if (!metadata || !metadata.width || !metadata.height) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send('Format gambar tidak didukung');
    }

    const isTextImage = text === 'true' || metadata.format === 'png' || (metadata.width / metadata.height > 2 || metadata.height / metadata.width > 2);
    const isSmallImage = metadata.width < 300 || metadata.height < 300;

    // Resize jika w atau h disediakan
    if (w || h) {
      sharpInstance = sharpInstance.resize(width, height, { 
        fit: fit || 'inside',
        withoutEnlargement: true, 
        kernel: sharp.kernel.mitchell,
        fastShrinkOnLoad: false 
      });
    }

    // Sharpening jika sharp=true
    if (sharpParam === 'true') {
      let sharpenParams;
      if (isTextImage) {
        sharpenParams = { sigma: isSmallImage ? 0.2 : 0.3, m1: 0.3, m2: 0.1, x1: 0.5, y2: 3, y3: 5 };
      } else {
        switch (sharpLevel.toLowerCase()) {
          case 'low':
            sharpenParams = { sigma: isSmallImage ? 0.3 : 0.5, m1: 0.5, m2: 0.2, x1: 1, y2: 5, y3: 10 };
            break;
          case 'high':
            sharpenParams = { sigma: isSmallImage ? 0.8 : 1.2, m1: 1.0, m2: 0.5, x1: 3, y2: 15, y3: 30 };
            break;
          case 'medium':
            sharpenParams = { sigma: isSmallImage ? 0.5 : 0.8, m1: 0.8, m2: 0.3, x1: 2, y2: 10, y3: 20 };
            break;
        }
      }

      sharpInstance = sharpInstance
        .median(isTextImage ? 1 : isSmallImage ? 1 : 2)
        .sharpen(sharpenParams)
        .modulate({
          brightness: isTextImage ? 1.0 : isSmallImage ? 1.0 : 1.01,
          saturation: isTextImage ? 1.0 : isSmallImage ? 1.0 : 1.03
        });
    }

    let outputContentType = contentType;
    if (format) {
      const effectiveQuality = quality ? (isTextImage ? Math.max(quality, 70) : Math.max(quality, 60)) : (isTextImage ? 70 : 60);
      switch (format.toLowerCase()) {
        case 'jpeg':
        case 'jpg':
          sharpInstance = sharpInstance.jpeg({ 
            quality: Math.min(effectiveQuality, 85), 
            mozjpeg: true, 
            chromaSubsampling: isTextImage ? '4:4:4' : '4:2:0',
            progressive: true, 
            optimizeScans: true 
          });
          outputContentType = 'image/jpeg';
          break;
        case 'png':
          sharpInstance = sharpInstance.png({ 
            quality: Math.min(effectiveQuality, 90), 
            compressionLevel: 9, 
            palette: true, 
            effort: 10 
          });
          outputContentType = 'image/png';
          break;
        case 'avif':
          sharpInstance = sharpInstance.avif({ 
            quality: Math.min(effectiveQuality, 80), 
            effort: 6 
          });
          outputContentType = 'image/avif';
          break;
        case 'webp':
          sharpInstance = sharpInstance.webp({ 
            quality: Math.min(effectiveQuality, 85), 
            effort: 6, 
            smartSubsample: !isTextImage,
            nearLossless: false, 
            reductionEffort: 6 
          });
          outputContentType = 'image/webp';
          break;
      }
    }
    
    imageData = await sharpInstance.toBuffer();
    const optimizedSize = imageData.length;
    const reductionPercent = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
    
    cache.set(cacheKey, { data: imageData, contentType: outputContentType });

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
    console.error('Sharp error:', sharpError.message);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send(`Gagal memproses gambar: ${sharpError.message}`);
  }
}
