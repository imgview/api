// api/simple-proxy.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    // Copy headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the image
    const arrayBuffer = await response.arrayBuffer();
    res.status(200).send(Buffer.from(arrayBuffer));

  } catch (error) {
    res.status(500).json({ error: 'Failed to proxy image' });
  }
}
