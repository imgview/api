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

function detectImageFormat(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
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

  const { key, url, h, w, q, fit } = req.query;
  const doSharp = req.query.sharp !== 'false'; // Default true

  if (!url || url.trim() === '') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(`
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proxy Gambar</title></head>
      <body>
        <center>
          <h2>📸 Masukkan Parameter</h2>
          /api/image?url=https://example.com/pic.jpg&amp;w=400&amp;h=300&amp;q=80&amp;sharp=true
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
    const detectedFormat = detectImageFormat(imageBuffer);

    const sharpOptions = { 
      failOnError: false, 
      limitInputPixels: Math.pow(2, 24)
    };

    if (detectedFormat === 'avif') {
      sharpOptions.unlimited = true;
    }

    let sharpInstance;
    try {
      sharpInstance = Sharp(imageBuffer, sharpOptions);
      await sharpInstance.metadata();
    } catch (sharpError) {
      console.error('Error saat inisialisasi Sharp:', sharpError);
      if (detectedFormat === 'avif') {
        try {
          const tempSharp = Sharp(imageBuffer, { unlimited: true, failOnError: false });
          imageBuffer = await tempSharp.png().toBuffer();
          sharpInstance = Sharp(imageBuffer, { failOnError: false });
        } catch (conversionError) {
          return res.status(500).json({ 
            error: 'Gagal memproses gambar AVIF'
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
        kernel: Sharp.kernel.lanczos3
      });
    }

    // Sharpen default true dengan parameter lebih halus + unsharp untuk teks
    if (doSharp) {
      sharpInstance = sharpInstance
        .sharpen({ 
          sigma: 0.6,    // Sudah diturunkan user
          m1: 0.8,       // Turun dari 0.95 ke 0.8
          m2: 0.3        // Turun dari 0.4 ke 0.3
        })
        .modulate({
          brightness: 1.0,
          saturation: 1.02  // Sedikit boost saturation untuk clarity
        });
    }

    // Set quality jika ada parameter q, sesuaikan dengan format asli
    if (quality) {
      if (detectedFormat === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality });
      } else if (detectedFormat === 'png') {
        sharpInstance = sharpInstance.png({ quality });
      } else if (detectedFormat === 'webp') {
        sharpInstance = sharpInstance.webp({ quality });
      } else if (detectedFormat === 'avif') {
        sharpInstance = sharpInstance.avif({ quality });
      }
    }

    const outputBuffer = await sharpInstance.toBuffer();

    res.setHeader('Content-Type', `image/${detectedFormat}`);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(outputBuffer);

  } catch (err) {
    console.error('Error processing image:', err);
    res.status(500).json({ 
      error: 'Gagal memproses gambar', 
      message: err.message
    });
  }
};
