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
  
  // Check admin: hanya by IP whitelist
  const isAdmin = ADMIN_IPS.length > 0 && ADMIN_IPS.includes(ip);
  
  if (isAdmin) {
    res.setHeader('X-RateLimit-Status', 'unlimited');
    res.setHeader('X-RateLimit-Limit', 'unlimited');
    res.setHeader('X-User-Type', 'admin');
  } else {
    const now = Date.now();
    const oneHour = 3600000;
    const maxRequests = 1;
    
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
      
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: `Maximum ${maxRequests} requests per hour. Try again in ${remainingMinutes} minutes.`,
        limit: maxRequests,
        reset_at: resetTime.toISOString()
      });
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
      status: isAdmin ? 'admin (unlimited)' : 'public (limited)'
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
