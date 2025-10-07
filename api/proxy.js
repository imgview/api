const rateLimit = new Map();

const ADMIN_IPS = (process.env.waduh || '').split(',').map(ip => ip.trim()).filter(Boolean);

setInterval(() => {
  const now = Date.now();
  const oneHour = 3600000;

  for (const [ip, requests] of rateLimit.entries()) {
    const validRequests = requests.filter(time => now - time < oneHour);
    if (validRequests.length === 0) {
      rateLimit.delete(ip);
    } else {
      rateLimit.set(ip, validRequests);
    }
  }
}, 600000);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() 
             || req.headers['x-real-ip'] 
             || 'unknown';

  console.log('🔍 Request IP:', ip);
  console.log('🔍 Whitelisted IPs:', ADMIN_IPS);
  console.log('🔍 Is Admin?', ADMIN_IPS.includes(ip));

  const isAdmin = ADMIN_IPS.length > 0 && ADMIN_IPS.includes(ip);

  if (isAdmin) {
    res.setHeader('X-RateLimit-Status', 'unlimited');
    res.setHeader('X-RateLimit-Limit', 'unlimited');
    res.setHeader('X-User-Type', 'admin');
  } else {
    const now = Date.now();
    const oneHour = 3600000;
    const maxRequests = 5;

    if (!rateLimit.has(ip)) {
      rateLimit.set(ip, []);
    }

    const requests = rateLimit.get(ip).filter(time => now - time < oneHour);

    if (requests.length >= maxRequests) {
      const oldestRequest = Math.min(...requests);
      const resetTime = new Date(oldestRequest + oneHour);
      const remainingMinutes = Math.ceil((resetTime - now) / 60000);

      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', resetTime.toISOString());
      res.setHeader('Content-Type', 'text/html');

      // HTML untuk rate limit
      const htmlResponse = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Batas Permintaan Tercapai</title>
          <style>
            body {
              font-family: 'Segoe UI', Arial, sans-serif;
              margin: 0;
              padding: 0;
              background: linear-gradient(to bottom, #f0f4f8, #d9e2ec);
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              color: #333;
            }
            .container {
              background-color: #fff;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
              text-align: center;
              max-width: 500px;
              width: 90%;
            }
            h1 {
              color: #d32f2f;
              font-size: 2em;
              margin-bottom: 20px;
            }
            p {
              font-size: 1.2em;
              line-height: 1.5;
              margin-bottom: 20px;
            }
            .icon {
              font-size: 3em;
              color: #d32f2f;
              margin-bottom: 20px;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              background-color: #1976d2;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              font-size: 1em;
              transition: background-color 0.3s;
            }
            .button:hover {
              background-color: #1565c0;
            }
            .footer {
              margin-top: 30px;
              font-size: 0.9em;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">⚠️</div>
            <h1>Batas Permintaan Tercapai</h1>
            <p>
              Maaf, Anda telah mencapai batas maksimum <strong>${maxRequests} permintaan per jam</strong>.
              Silakan coba lagi dalam <strong>${remainingMinutes} menit</strong>.
            </p>
            <p>
              Untuk informasi lebih lanjut, hubungi tim dukungan kami.
            </p>
            <a href="/support" class="button">Hubungi Dukungan</a>
            <div class="footer">
              &copy; ${new Date().getFullYear()} Nama Perusahaan Anda. Semua hak dilindungi.
            </div>
          </div>
        </body>
        </html>
      `;

      return res.status(429).send(htmlResponse);
    }

    requests.push(now);
    rateLimit.set(ip, requests);

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (maxRequests - requests.length).toString());
    res.setHeader('X-RateLimit-Status', 'limited');
    res.setHeader('X-User-Type', 'public');
  }

  res.setHeader('X-Proxy-Server', 'Vercel-Proxy-RateLimited');

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '/api/proxy?url=TARGET_URL',
      status: isAdmin ? 'admin (unlimited)' : 'public (limited)',
      debug: {
        your_ip: ip,
        whitelisted_ips: ADMIN_IPS,
        is_admin: isAdmin
      }
    });
  }

  try {
    new URL(url);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Invalid protocol');
    }
  } catch (e) {
    return res.status(400).json({ 
      error: 'Invalid URL format',
      received: url
    });
  }

  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    };

    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    if (req.headers['referer']) {
      headers['Referer'] = req.headers['referer'];
    }

    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });

    const contentType = response.headers.get('content-type') || 'text/plain';

    res.setHeader('Content-Type', contentType);

    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    const lastModified = response.headers.get('last-modified');
    if (lastModified) res.setHeader('Last-Modified', lastModified);

    const etag = response.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);

    res.setHeader('X-Proxied-URL', url);
    res.setHeader('X-Proxy-Status', response.status.toString());

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else if (contentType.includes('text/')) {
      const text = await response.text();
      return res.status(response.status).send(text);
    } else {
      const buffer = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buffer));
    }

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(502).json({ 
      error: 'Fetch failed', 
      message: error.message,
      url: url
    });
  }
}
