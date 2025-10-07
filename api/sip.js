// api/sip.js
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Extract URL from query parameter
    let { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'URL parameter required',
        usage: '/api/sip?url=https://example.com/image.jpg'
      });
    }

    console.log('Original URL received:', url);

    // **FIX: Decode URL components properly**
    // Decode the URL first, then fix any encoding issues
    let decodedUrl = decodeURIComponent(url);
    
    // **FIX: Restore double slashes after protocol**
    // Replace "https:/" with "https://" and "http:/" with "http://"
    decodedUrl = decodedUrl.replace(/(https?:)\/([^/])/, '$1//$2');
    
    console.log('Decoded and fixed URL:', decodedUrl);

    // Validate URL
    let imageUrl;
    try {
      imageUrl = new URL(decodedUrl);
    } catch (error) {
      console.error('URL validation failed:', error.message);
      return res.status(400).json({ 
        error: 'Invalid URL format after decoding',
        received: url,
        decoded: decodedUrl
      });
    }

    // Security checks
    const hostname = imageUrl.hostname;
    const blockedHosts = [
      'localhost', '127.0.0.1', '0.0.0.0',
      '192.168.', '10.', '172.16.', '172.31.',
      '169.254.', '::1'
    ];
    
    if (blockedHosts.some(blocked => hostname.startsWith(blocked) || hostname === blocked)) {
      return res.status(403).json({ error: 'Access to local resources denied' });
    }

    // Fetch the image with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    console.log('Fetching from:', imageUrl.toString());

    const response = await fetch(imageUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': imageUrl.origin
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Upstream error: ${response.status}` 
      });
    }

    // Check if it's actually an image
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'URL does not point to a valid image' 
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    
    if (imageBuffer.byteLength === 0) {
      return res.status(400).json({ 
        error: 'Empty image received' 
      });
    }

    // Forward headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Vary', 'Accept');
    
    // Send the image
    res.status(200).send(Buffer.from(imageBuffer));

  } catch (error) {
    console.error('Proxy error:', error);
    
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: 'Timeout while fetching image' 
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Please try again'
    });
  }
        }
