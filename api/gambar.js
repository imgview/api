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

// Fungsi untuk deteksi format gambar dari buffer
function detectImageFormat(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    // Check for AVIF signature
    const ftypString = buffer.slice(4, 12).toString('ascii');
    if (ftypString.includes('avif') || ftypString.includes('avis')) return 'avif';
  }
  return 'unknown';
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
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proxy Gambar</title></head>
      <body>
        <center>
          <h2>📸 Masukkan Parameter</h2>
          /api/image?url=https://example.com/pic.jpg&amp;w=400&amp;h=300&amp;q=80&amp;format=webp&amp;sharp=true&amp;sharpLevel=medium
        </center>
      </body>
    `);
  }

  const hasValidKey = validateApiKey(key);
  const identifier = hasValidKey ? `key:${key}` : `ip:${getClientIP(req)}`;
  const rateLimitResult = checkRateLimit(identifier, hasValidKey);

  if (!rateLimitResult.allowed) {
    const resetTime = new Date(rateLimitResult.resetAt);
    const now = new Date();
    const minutesLeft = Math.ceil((resetTime - now) / 60000);
    res.setHeader('Content-Type', 'text/html');
    return res.status(429).send(`
      <head><title>Akses Terbatas</title></head>
      <body>
        <center>
          <h2>⏰ Akses Terbatas</h2>
          <p>⚠️ Anda telah mencapai limit ${MAX_REQUESTS_WITHOUT_KEY} request per jam</p>
          <p>Coba lagi dalam ${minutesLeft} menit</p>
          <p>Reset pada: ${new Date(rateLimitResult.resetAt).toLocaleTimeString('id-ID')}</p>
        </center>
      </body>
    `);
  }

  let imageUrl;
  try {
    imageUrl = new URL(url);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) {
      return res.status(400).json({ error: 'Hanya protokol http/https yang diizinkan' });
    }
  } catch {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  const height = h ? parseInt(h) : undefined;
  const width = w ? parseInt(w) : undefined;
  const quality = q ? parseInt(q) : undefined;

  try {
    const response = await fetchWithTimeoutAndRetry(imageUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/avif,image/*,*/*;q=0.8',
        'Referer': imageUrl.origin
      }
    });

    if (!response.ok) return res.status(response.status).json({ error: `Gagal mengambil gambar: ${response.status}` });
    
    let imageBuffer = Buffer.from(await response.arrayBuffer());
    
    // Deteksi format gambar
    const detectedFormat = detectImageFormat(imageBuffer);
    console.log(`Format terdeteksi: ${detectedFormat}`);

    // Konfigurasi Sharp dengan opsi khusus untuk AVIF
    const sharpOptions = { 
      failOnError: false, 
      limitInputPixels: Math.pow(2, 24)
    };

    // Tambahkan unlimited untuk AVIF input
    if (detectedFormat === 'avif') {
      sharpOptions.unlimited = true;
    }

    let sharpInstance;
    try {
      sharpInstance = Sharp(imageBuffer, sharpOptions);
      
      // Ambil metadata untuk verifikasi
      const metadata = await sharpInstance.metadata();
      console.log(`Format dari metadata: ${metadata.format}`);
      
    } catch (sharpError) {
      console.error('Error saat inisialisasi Sharp:', sharpError);
      
      // Fallback: konversi AVIF ke PNG dulu menggunakan Sharp
      if (detectedFormat === 'avif') {
        try {
          const tempSharp = Sharp(imageBuffer, { unlimited: true, failOnError: false });
          imageBuffer = await tempSharp.png().toBuffer();
          sharpInstance = Sharp(imageBuffer, { failOnError: false });
        } catch (conversionError) {
          return res.status(500).json({ 
            error: 'Gagal memproses gambar AVIF', 
            message: 'Format AVIF tidak didukung sepenuhnya',
            suggestion: 'Coba install sharp versi terbaru dengan: npm install sharp'
          });
        }
      } else {
        throw sharpError;
      }
    }

    // Resize jika diperlukan
    if (w || h) {
      sharpInstance = sharpInstance.resize(width, height, { 
        fit: fit || 'inside', 
        withoutEnlargement: true, 
        kernel: Sharp.kernel.mitchell 
      });
    }

    // Sharpen jika diminta
    if (doSharp === 'true') {
      sharpInstance = sharpInstance.sharpen({ sigma: 0.7, m1: 0.9, m2: 0.35 });
    }

    // Konversi ke format output yang diminta
    let outputContentType = 'image/jpeg';
    if (format) {
      switch (format.toLowerCase()) {
        case 'jpeg':
        case 'jpg':
          sharpInstance = sharpInstance.jpeg({ quality: quality || 80 });
          outputContentType = 'image/jpeg';
          break;
        case 'png':
          sharpInstance = sharpInstance.png({ quality: quality || 80 });
          outputContentType = 'image/png';
          break;
        case 'webp':
          sharpInstance = sharpInstance.webp({ quality: quality || 80 });
          outputContentType = 'image/webp';
          break;
        case 'avif':
          sharpInstance = sharpInstance.avif({ quality: quality || 80 });
          outputContentType = 'image/avif';
          break;
      }
    } else {
      // Default ke WebP jika tidak ada format yang diminta
      sharpInstance = sharpInstance.webp({ quality: quality || 80 });
      outputContentType = 'image/webp';
    }

    const outputBuffer = await sharpInstance.toBuffer();
    
    res.setHeader('Content-Type', outputContentType);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.setHeader('X-Image-Format-Detected', detectedFormat);
    res.status(200).send(outputBuffer);
    
  } catch (err) {
    console.error('Error processing image:', err);
    res.status(500).json({ 
      error: 'Gagal memproses gambar', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};
