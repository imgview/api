const rateLimit = new Map();

const ADMIN_IPS = (process.env.ADMIN_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);

// Cleanup rate limit setiap 10 menit

setInterval(() => {

  const now = Date.now();

  const oneHour = 3600000;

  for (const [ip, requests] of rateLimit.entries()) {

    const validRequests = requests.filter(time => now - time < oneHour);

    if (validRequests.length === 0) rateLimit.delete(ip);

    else rateLimit.set(ip, validRequests);

  }

}, 600000);

module.exports = async function handler(req, res) {

  // CORS Headers - Allow semua origin

  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, Cache-Control, X-API-Key, X-Custom-Header');

  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Date, Server, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');

  res.setHeader('Access-Control-Allow-Credentials', 'true');

  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight request

  if (req.method === 'OPTIONS') {

    return res.status(204).end();

  }

  // Get client IP

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 

             req.headers['x-real-ip'] || 

             req.connection?.remoteAddress || 

             'unknown';

  

  const isAdmin = ADMIN_IPS.includes(ip);

  const maxRequests = isAdmin ? 1000 : 50;

  // Rate limiting (kecuali admin)

  if (!isAdmin) {

    const now = Date.now();

    if (!rateLimit.has(ip)) rateLimit.set(ip, []);

    

    const requests = rateLimit.get(ip).filter(time => now - time < 3600000);

    

    if (requests.length >= maxRequests) {

      const oldestRequest = Math.min(...requests);

      const resetTime = new Date(oldestRequest + 3600000);

      const remainingMinutes = Math.ceil((resetTime - now) / 60000);

      

      res.setHeader('X-RateLimit-Limit', maxRequests.toString());

      res.setHeader('X-RateLimit-Remaining', '0');

      res.setHeader('X-RateLimit-Reset', resetTime.toISOString());

      

      return res.status(429).json({

        error: 'Rate limit exceeded',

        message: `Terlalu banyak request. Coba lagi dalam ${remainingMinutes} menit.`,

        resetTime: resetTime.toISOString()

      });

    }

    

    requests.push(now);

    rateLimit.set(ip, requests);

    

    // Set rate limit headers

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());

    res.setHeader('X-RateLimit-Remaining', (maxRequests - requests.length).toString());

  }

  // Validasi URL parameter

  const { url } = req.query;

  

  if (!url) {

    return res.status(400).json({

      error: 'Missing parameter',

      message: 'URL parameter is required. Usage: /api/proxy?url=https://example.com'

    });

  }

  // Validasi format URL

  let targetUrl;

  try {

    targetUrl = new URL(url);

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {

      throw new Error('Invalid protocol');

    }

  } catch (error) {

    return res.status(400).json({

      error: 'Invalid URL',

      message: 'URL harus valid dan menggunakan protokol http/https'

    });

  }

  try {

    // Prepare headers untuk request ke target

    const proxyHeaders = {

      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

      'Accept': req.headers['accept'] || '*/*',

      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9,id;q=0.8',

      'Accept-Encoding': 'gzip, deflate, br',

      'Cache-Control': req.headers['cache-control'] || 'no-cache',

      'Pragma': 'no-cache',

      'DNT': '1',

      'Sec-Fetch-Dest': 'empty',

      'Sec-Fetch-Mode': 'cors',

      'Sec-Fetch-Site': 'cross-site'

    };

    // Forward specific headers jika ada

    const headersToForward = [

      'authorization',

      'content-type',

      'cookie',

      'referer',

      'origin',

      'x-api-key',

      'x-requested-with'

    ];

    headersToForward.forEach(header => {

      if (req.headers[header]) {

        proxyHeaders[header.split('-').map(word => 

          word.charAt(0).toUpperCase() + word.slice(1)

        ).join('-')] = req.headers[header];

      }

    });

    // Prepare request body untuk method selain GET dan HEAD

    let body = undefined;

    if (req.method !== 'GET' && req.method !== 'HEAD') {

      if (req.body) {

        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      }

    }

    // Fetch target URL

    const response = await fetch(targetUrl.toString(), {

      method: req.method,

      headers: proxyHeaders,

      body: body,

      redirect: 'follow',

      compress: true

    });

    // Forward response headers (kecuali yang conflict dengan CORS)

    const headersToSkip = [

      'access-control-allow-origin',

      'access-control-allow-methods',

      'access-control-allow-headers',

      'access-control-expose-headers',

      'access-control-allow-credentials',

      'access-control-max-age',

      'content-encoding',

      'transfer-encoding',

      'connection',

      'keep-alive'

    ];

    response.headers.forEach((value, key) => {

      if (!headersToSkip.includes(key.toLowerCase())) {

        try {

          res.setHeader(key, value);

        } catch (e) {

          // Skip jika header tidak bisa di-set

        }

      }

    });

    // Set status code

    res.status(response.status);

    // Get content type

    const contentType = response.headers.get('content-type') || '';

    // Handle response berdasarkan content type

    if (contentType.includes('application/json')) {

      const data = await response.json();

      return res.json(data);

    } else if (contentType.includes('text/')) {

      const text = await response.text();

      return res.send(text);

    } else {

      // Binary data (images, files, etc)

      const buffer = await response.arrayBuffer();

      return res.send(Buffer.from(buffer));

    }

  } catch (error) {

    console.error('Proxy error:', error);

    

    return res.status(500).json({

      error: 'Proxy error',

      message: error.message || 'Terjadi kesalahan saat mengakses URL target',

      details: process.env.NODE_ENV === 'development' ? error.stack : undefined

    });

  }

};