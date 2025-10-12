export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const imageUrl = decodeURIComponent(url);
    
    // Extract domain for referer
    const urlObj = new URL(imageUrl);
    const referer = `${urlObj.protocol}//${urlObj.hostname}/`;
    
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': referer,
        'Origin': referer.slice(0, -1),
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch image' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';

    return new Response(response.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, s-maxage=31536000, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, s-maxage=31536000, immutable',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Error fetching image', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
        }
