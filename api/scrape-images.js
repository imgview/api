// api/scrape-images.js - Letakkan file ini di folder api/ di project Vercel Anda

import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method tidak diizinkan. Gunakan GET.' });
  }

  try {
    const { url, selector, limit = 10 } = req.query;

    if (!url) {
      return res.status(400).json({ 
        error: 'Parameter URL diperlukan',
        usage: 'GET /api/scrape-images?url=https://example.com&selector=img&limit=10'
      });
    }

    // Validate URL
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'URL tidak valid' });
    }

    // Fetch the webpage
    const response = await fetch(targetUrl.toString(), {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  }
});

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Gagal mengambil halaman: ${response.status} ${response.statusText}` 
      });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Default selector untuk gambar
    const imageSelector = selector || 'img';
    const images = [];

    $(imageSelector).each((index, element) => {
      if (images.length >= parseInt(limit)) return false; // Stop jika sudah mencapai limit

      const $img = $(element);
      let src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');

      if (src) {
        // Convert relative URLs to absolute URLs
        if (src.startsWith('//')) {
          src = targetUrl.protocol + src;
        } else if (src.startsWith('/')) {
          src = targetUrl.origin + src;
        } else if (!src.startsWith('http')) {
          src = new URL(src, targetUrl.toString()).toString();
        }

        const imageInfo = {
          src: src,
          alt: $img.attr('alt') || '',
          title: $img.attr('title') || '',
          width: $img.attr('width') || '',
          height: $img.attr('height') || '',
          className: $img.attr('class') || '',
          id: $img.attr('id') || ''
        };

        images.push(imageInfo);
      }
    });

    // Return results
    res.status(200).json({
      success: true,
      source_url: url,
      total_found: images.length,
      images: images,
      scraped_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ 
      error: 'Terjadi kesalahan saat scraping', 
      message: error.message 
    });
  }
}
