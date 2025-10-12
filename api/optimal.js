// pages/api/image-proxy.js
import sharp from 'sharp';

/**
 * Image proxy with optional resizing from header x-request-width or query ?w=
 * - Adds a subtle sharpen to reduce blur slightly
 * - Preserves image mime where possible
 * - Accepts quality param ?q= (1-100) default 80
 *
 * Usage examples:
 *  /api/image-proxy?url=https%3A%2F%2Fexample.com%2Fimg.jpg&w=400&q=80
 *  or send header 'x-request-width: 400'
 */

export default async function handler(req, res) {
  try {
    const { url: urlParam } = req.query;
    const rawUrl = Array.isArray(urlParam) ? urlParam[0] : urlParam;

    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }

    // decode in case client encoded it
    const imageUrl = decodeURIComponent(rawUrl);

    // Determine width: header -> query param
    const headerWidth = req.headers['x-request-width'];
    const qWidth = req.query.w || req.query.width;
    const width = parseInt(headerWidth || qWidth || '0', 10) || 0;

    // Quality param (1-100)
    const qParam = parseInt(req.query.q || '80', 10);
    const quality = Math.min(100, Math.max(10, isNaN(qParam) ? 80 : qParam));

    // Build referer from target host to help bypass simple hotlink protection
    let referer;
    try {
      const urlObj = new URL(imageUrl);
      referer = `${urlObj.protocol}//${urlObj.hostname}/`;
    } catch (e) {
      res.status(400).json({ error: 'Invalid url parameter' });
      return;
    }

    // Fetch the image from origin
    const fetchResp = await fetch(imageUrl, {
      method: 'GET',
      // follow redirects
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': referer,
      },
    });

    if (!fetchResp.ok) {
      // return useful debug info; don't leak too much
      const bodySnippet = await fetchResp.text().catch(() => '');
      res.status(502).json({
        error: 'Failed to fetch image',
        status: fetchResp.status,
        statusText: fetchResp.statusText,
        bodySnippet: bodySnippet.slice ? bodySnippet.slice(0, 1000) : ''
      });
      return;
    }

    const contentType = fetchResp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await fetchResp.arrayBuffer());

    // Prepare sharp pipeline
    let pipeline = sharp(buffer, { failOnError: false });

    // If width provided, resize. Keep aspect ratio.
    if (width > 0) {
      pipeline = pipeline.resize({ width, withoutEnlargement: true });
    }

    // Subtle improvements: normalize and slight sharpen to reduce blur
    // normalize helps with contrast; sharpen reduces perceived blur.
    pipeline = pipeline
      .withMetadata()            // preserve orientation metadata if present
      .normalize()               // improve contrast/gamma a bit
      .sharpen(0.5, 1, 0);       // subtle sharpening: sigma, flat, jagged

    // Decide output format based on original content-type
    let outBuffer;
    if (/png/i.test(contentType)) {
      outBuffer = await pipeline.png({ quality: Math.round(quality * 0.9) }).toBuffer();
      res.setHeader('Content-Type', 'image/png');
    } else if (/webp/i.test(contentType)) {
      outBuffer = await pipeline.webp({ quality }).toBuffer();
      res.setHeader('Content-Type', 'image/webp');
    } else if (/avif/i.test(contentType)) {
      // avif quality scale slightly different; map quality
      outBuffer = await pipeline.avif({ quality: Math.round(quality * 0.9) }).toBuffer();
      res.setHeader('Content-Type', 'image/avif');
    } else {
      // default to jpeg output (preserve small size and wide support)
      outBuffer = await pipeline.jpeg({ quality }).toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
    }

    // Cache headers - adjust as needed
    res.setHeader('Cache-Control', 'public, s-maxage=31536000, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Vary', 'Accept');

    res.status(200).send(outBuffer);
  } catch (err) {
    console.error('image-proxy error', err);
    res.status(500).json({ error: 'Internal Server Error', details: String(err) });
  }
        }
