const Sharp = require('sharp');

const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const API_KEY = process.env.API_KEY || '';
const MAX_REQUESTS_WITHOUT_KEY = 5;
const requestCounts = new Map();
const cache = new Map();

function validateApiKey(key) {
  return key === API_KEY;
}

function checkRateLimit(identifier, hasValidKey) {
  if (hasValidKey) return { allowed: true, remaining: 'unlimited' };

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
  return { allowed: true, remaining: MAX_REQUESTS_WITHOUT_KEY - timestamps.length };
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { key, url, h, w, q, fit, format, sharpLevel, text } = req.query;
  const doSharp = req.query.sharp;

  if (!url || url.trim() === '') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(`
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Proxy Gambar - Masukkan URL</title>
        <style>body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }</style>
      </head>
      <body>
        <center>
          <h2>📸 Masukkan Parameter</h2>
          masukkan parameter <code>url</code>
          <h4>Contoh</h4>
          <p>/api/image?url=https://example.com/pic.jpg&amp;w=400&amp;h=300&amp;q=80&amp;format=webp&amp;sharp=true&amp;sharpLevel=medium</p>
      </body>
    `);
  }

  const hasValidKey = validateApiKey(key);
  const identifier = hasValidKey ? `key:${key}` : `ip:${getClientIP(req)}`;
  const rateLimitResult = checkRateLimit(identifier, hasValidKey);

  if (!rateLimitResult.allowed) {
    const resetTime = new Date(rateLimitResult.resetAt);
    const nowDate = new Date();
    const minutesLeft = Math.ceil((resetTime - nowDate) / (1000 * 60));
    res.setHeader('Content-Type', 'text/html');
    return res.status(429).send(`
      <head><title>Akses Terbatas</title></head>
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
    if (!['http:', 'https:'].includes(imageUrl.protocol)) {
      return res.status(400).json({ error: 'Hanya protokol http atau https yang diizinkan' });
    }
    const hostname = imageUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || 
        hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('172.31.') || 
        hostname.endsWith('.local')) {
      return res.status(400).json({ error: 'URL tidak diizinkan' });
    }
  } catch {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  const height = h ? parseInt(h) : undefined;
  const width = w ? parseInt(w) : undefined;
  const quality = q ? parseInt(q) : undefined;
  const validFormats = ['webp', 'jpeg', 'jpg', 'png', 'avif'];
  const validSharpLevels = ['low', 'medium', 'high'];
  const validFits = ['contain', 'cover', 'fill', 'inside', 'outside'];

  if ((height && (isNaN(height) || height <= 0 || height > 10000)) || 
      (width && (isNaN(width) || width <= 0 || width > 10000))) {
    return res.status(400).json({ error: 'Parameter h atau w tidak valid, harus angka positif dan <= 10000' });
  }
  if (quality && (isNaN(quality) || quality < 1 || quality > 100)) {
    return res.status(400).json({ error: 'Parameter q tidak valid, harus antara 1-100' });
  }
  if (format && !validFormats.includes(format.toLowerCase())) {
    return res.status(400).json({ error: `Format tidak didukung. Gunakan: ${validFormats.join(', ')}` });
  }
  if (fit && !validFits.includes(fit.toLowerCase())) {
    return res.status(400).json({ error: `Fit tidak didukung. Gunakan: ${validFits.join(', ')}` });
  }
  if (doSharp === 'true' && (!sharpLevel || !validSharpLevels.includes(sharpLevel.toLowerCase()))) {
    return res.status(400).json({ error: 'Parameter sharpLevel wajib disediakan (low, medium, high) jika sharp=true' });
  }
  if (text && text !== 'true' && text !== 'false') {
    return res.status(400).json({ error: 'Parameter text harus true atau false' });
  }

  const cacheKey = `${url}-${w || ''}-${h || ''}-${q || ''}-${format || ''}-${fit || ''}-${doSharp || ''}-${sharpLevel || ''}-${text || ''}`;
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

  const imageBuffer = await response.arrayBuffer();
  if (imageBuffer.byteLength === 0) return res.status(400).json({ error: 'Gambar kosong atau korup' });
  let imageData = Buffer.from(imageBuffer);
  const originalSize = imageData.length;

  try {
    let sharpInstance = Sharp(imageData, { failOnError: false, limitInputPixels: Math.pow(2, 24) });
    const metadata = await sharpInstance.metadata();
    const isTextImage = text === 'true' || metadata.format === 'png' || (metadata.width / metadata.height > 2 || metadata.height / metadata.width > 2);
    const isSmallImage = metadata.width < 300 || metadata.height < 300;

    if (w || h) sharpInstance = sharpInstance.resize(width, height, { fit: fit || 'inside', withoutEnlargement: true, kernel: Sharp.kernel.mitchell, fastShrinkOnLoad: false });

    if (doSharp === 'true') {
      let sharpenParams;
      if (isTextImage) {
        sharpenParams = { sigma: isSmallImage ? 0.25 : 0.35, m1: 0.35, m2: 0.12 };
      } else {
        switch ((sharpLevel || 'medium').
