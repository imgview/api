export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Proxy-Server', 'Vercel-Proxy');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  // Get target URL
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '/api/proxy?url=https://example.com',
      examples: {
        json: '/api/proxy?url=https://httpbin.org/get',
        html: '/api/proxy?url=https://google.com',
        api: '/api/proxy?url=https://api.github.com/users/github'
      }
    });
  }
  
  // Validate URL
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
    // Prepare headers to forward
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    };
    
    // Forward Authorization header if present
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }
    
    // Forward Referer if present
    if (req.headers['referer']) {
      headers['Referer'] = req.headers['referer'];
    }
    
    // Make the request
    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });
    
    // Get content type
    const contentType = response.headers.get('content-type') || 'text/plain';
    
    // Forward important response headers
    res.setHeader('Content-Type', contentType);
    
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
    
    const lastModified = response.headers.get('last-modified');
    if (lastModified) res.setHeader('Last-Modified', lastModified);
    
    const etag = response.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);
    
    // Add custom headers
    res.setHeader('X-Proxied-URL', url);
    res.setHeader('X-Proxy-Status', response.status);
    
    // Handle response based on content type
    if (contentType.includes('application/json')) {
      // JSON response
      const data = await response.json();
      return res.status(response.status).json(data);
    } else if (contentType.includes('text/')) {
      // Text/HTML response
      const text = await response.text();
      return res.status(response.status).send(text);
    } else {
      // Binary data (images, files, etc)
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
