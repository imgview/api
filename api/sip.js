// api/sip/[...url].js
export default async function handler(req, res) {
  const { url } = req.query;
  
  // Join the URL parts back together
  const imageUrl = Array.isArray(url) ? url.join('/') : url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL required' });
  }

  // Add protocol if missing
  const fullUrl = imageUrl.startsWith('http') ? imageUrl : `https://${imageUrl}`;
  
  try {
    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    res.status(500).json({ error: 'Proxy failed' });
  }
      }
