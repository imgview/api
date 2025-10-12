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

  const { key, url, h, w, q, fit, format, text } = req.query;

  if (!url || url.trim() === '') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Masukkan URL Gambar');
  }

  const paramKeys = Object.keys(req.query).filter(k => k !== 'key' && k !== 'url');
  const hasProcessingParams = paramKeys.length > 0;

  if (!hasProcessingParams) {
    let imageUrl;
    try {
      imageUrl = new URL(url);
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

  const hasValidKey = validateApiKey(key);
  const identifier = hasValidKey ? `key:${key}` : `ip:${getClientIP(req)}`;
  const rateLimitResult = checkRateLimit(identifier, hasValidKey);

  if (!rateLimitResult.allowed) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(429).send('Limit request tercapai, coba lagi nanti');
  }

  let imageUrl;
  try {
    imageUrl = new URL(url);
  } catch {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('URL tidak valid');
  }

  const height = h ? parseInt(h) : undefined;
  const width = w ? parseInt(w) : undefined;
  const quality = q ? parseInt(q) : undefined;
  const validFormats = ['webp', 'jpeg', 'jpg', 'png', 'avif'];
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
  if (text && text !== 'true' && text !== 'false') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Parameter text harus true atau false');
  }

  const cacheKey = `${url}-${w || ''}-${h || ''}-${q || ''}-${format || ''}-${fit || ''}-${text || ''}`;
  if (cache.has(cacheKey)) {
    const cachedImage = cache.get(cacheKey);
    res.setHeader('Content-Type', cachedImage.contentType);
    res.setHeader('Content-Length', cachedImage.data.length);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Rate-Limit-Remaining', rateLimitResult.remaining.toString());
    if (hasValidKey) res.setHeader('X-API-Key-Valid', 'true');
    return res.status(200).send(cachedImage.data);
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

  const imageBuffer = await response.arrayBuffer();
  if (imageBuffer.byteLength < 1024) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(400).send('Gambar tidak bisa diambil');
  }
  let imageData = Buffer.from(imageBuffer);
  const originalSize = imageData.length;

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

    // Deteksi gambar komik: aspect ratio tinggi, PNG (banyak teks), atau flag text=true
    const aspectRatio = Math.max(metadata.width / metadata.height, metadata.height / metadata.width);
    const isComicImage = text === 'true' || metadata.format === 'png' || aspectRatio > 1.8;

    // OPTIMASI KOMIK: Kurangi noise halus tanpa blur teks
    if (isComicImage) {
      sharpInstance = sharpInstance.median(2); // Window kecil untuk preserve detail
    }

    // Resize dengan kernel optimal untuk teks
    if (w || h) {
      sharpInstance = sharpInstance.resize(width, height, { 
        fit: fit || 'inside',
        withoutEnlargement: true, 
        kernel: sharp.kernel.lanczos3, // Terbaik untuk teks/line art
        fastShrinkOnLoad: true
      });
    }

    // OPTIMASI KOMIK: Sharpen adaptif - lebih agresif untuk teks
    if (isComicImage) {
      sharpInstance = sharpInstance.sharpen({
        sigma: 1.2,    // Radius blur sebelum sharpen - lebih fokus pada edge
        m1: 1.0,       // Flat area threshold - jangan sharpen area rata
        m2: 0.4,       // Jaggedness threshold - kurangi artifacts
        x1: 2.0,       // Sharpening strength
        y2: 10,        // Minimum edge brightness
        y3: 20         // Maximum edge brightness
      });
    } else {
      sharpInstance = sharpInstance.sharpen({
        sigma: 1.0,
        m1: 0.8,
        m2: 0.3,
        x1: 2.5,
        y2: 12,
        y3: 25
      });
    }

    // OPTIMASI KOMIK: Enhance kontras untuk teks hitam-putih lebih jelas
    if (isComicImage) {
      sharpInstance = sharpInstance.normalize({ lower: 1, upper: 99 }) // Expand dynamic range
        .modulate({
          brightness: 1.05,
          saturation: 1.15,
          lightness: 0
        })
        .linear(1.1, -(128 * 0.1)); // Micro-contrast boost
    } else {
      sharpInstance = sharpInstance.modulate({
        brightness: 1.08,
        saturation: 1.1,
        lightness: 0
      });
    }

    // OPTIMASI FORMAT: WebP optimal untuk komik (support transparency + ukuran kecil)
    const effectiveFormat = format ? format.toLowerCase() : 'webp';
    let outputContentType = contentType;
    
    // Quality adaptif: lebih tinggi untuk komik text-heavy
    const baseQuality = quality || (isComicImage ? 88 : 82);
    const effectiveQuality = Math.min(Math.max(baseQuality, 75), 95);

    switch (effectiveFormat) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({ 
          quality: effectiveQuality, 
          mozjpeg: true,
          chromaSubsampling: '4:4:4', // Preserve color detail untuk komik berwarna
          progressive: true,
          optimizeScans: true,
          trellisQuantisation: true,
          overshootDeringing: true
        });
        outputContentType = 'image/jpeg';
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ 
          quality: effectiveQuality,
          compressionLevel: 9, // Maksimal compression
          palette: !isComicImage, // Palette mode untuk non-komik (ukuran lebih kecil)
          effort: 7,
          adaptiveFiltering: true
        });
        outputContentType = 'image/png';
        break;
      case 'avif':
        sharpInstance = sharpInstance.avif({ 
          quality: effectiveQuality,
          effort: 6,
          chromaSubsampling: '4:4:4'
        });
        outputContentType = 'image/avif';
        break;
      case 'webp':
      default:
        sharpInstance = sharpInstance.webp({ 
          quality: effectiveQuality,
          effort: 6, // Effort tinggi = kompresi optimal
          smartSubsample: true,
          nearLossless: isComicImage, // Preserve detail untuk komik
          preset: isComicImage ? 'drawing' : 'default', // Preset khusus line art
          alphaQuality: 100 // Preserve transparency
        });
        outputContentType = 'image/webp';
        break;
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
