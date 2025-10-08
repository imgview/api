// main.js — Robust Deno image proxy with fallback and SVG placeholder
const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const RATE_LIMIT_MS = 1000;
const lastRequest = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const last = lastRequest.get(ip) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  lastRequest.set(ip, now);
  return false;
}

async function fetchWithTimeout(url, opts = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow", ...opts });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      console.warn(`fetch attempt ${attempt+1} failed for ${url}: ${String(err)}`);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

// Small SVG placeholder returned on final failure (keeps HTTP 200 so browser <img> won't show net::ERR_HTTP_RESPONSE_CODE_FAILURE)
function svgPlaceholder(text = "Image unavailable") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
            font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#374151">${text}</text>
    </svg>`.trim();
  return new TextEncoder().encode(svg);
}

Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const params = urlObj.searchParams;
  const target = params.get("url");
  const w = params.get("w");
  const h = params.get("h");

  // health / warmup check
  if (!target) {
    return new Response(
      `OK — Img proxy ready\nUsage: ?url=<image_url>&w=<width>&h=<height>\nExample: ?url=https://example.com/a.jpg&w=400`,
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  // Basic CORS and OPTIONS
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" }});
  }

  // Rate limit per IP (1 req/sec)
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    console.log(`[rate-limit] ${ip}`);
    // return 429 JSON (not image) — caller can retry; but for <img> this will be handled by client
    return new Response(JSON.stringify({ error: "Rate limit: 1 request per second" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin":"*" }
    });
  }

  // Validate URL (block local/private)
  let targetUrl;
  try {
    targetUrl = new URL(target);
    const host = targetUrl.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local")) {
      console.log(`[blocked-local] ${target}`);
      return new Response(JSON.stringify({ error: "Local/private URLs not allowed" }), { status: 400, headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }});
    }
  } catch (e) {
    console.log(`[invalid-url] ${target}`);
    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }});
  }

  console.log(`[request] ip=${ip} target=${targetUrl.href} w=${w} h=${h}`);

  // Build browser-like headers to reduce blocking
  const spoofHeaders = {
    "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    "Referer": targetUrl.origin,
    "Origin": targetUrl.origin,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };

  // 1) Try fetching directly
  try {
    const upstream = await fetchWithTimeout(targetUrl.toString(), { headers: spoofHeaders });
    console.log(`[upstream] status=${upstream.status} for ${targetUrl.host}`);

    const ct = upstream.headers.get("content-type") || "";
    if (upstream.ok && ct.startsWith("image/")) {
      const buffer = new Uint8Array(await upstream.arrayBuffer());
      const headers = new Headers();
      headers.set("Content-Type", ct);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("X-Proxied-URL", targetUrl.href);
      return new Response(buffer, { status: 200, headers });
    } else {
      console.log(`[upstream-not-image-or-error] status=${upstream.status} content-type=${ct}`);
      // fall through to fallback
    }
  } catch (err) {
    console.warn(`[upstream-fetch-error] ${String(err)}`);
    // fall through to fallback
  }

  // 2) Fallback: try images.weserv.nl (resize + proxy service)
  try {
    // weserv wants URL without protocol; also supports w/h params
    const weserv = new URL("https://images.weserv.nl/");
    weserv.searchParams.set("url", targetUrl.href.replace(/^https?:\/\//, ""));
    if (w) weserv.searchParams.set("w", w);
    if (h) weserv.searchParams.set("h", h);
    weserv.searchParams.set("output", "webp"); // produce webp for better compression
    console.log(`[weserv] trying ${weserv.href}`);

    const wres = await fetchWithTimeout(weserv.href, { headers: { "User-Agent": spoofHeaders["User-Agent"], "Accept": "image/*,*/*;q=0.8" } });
    console.log(`[weserv] status=${wres.status}`);
    if (wres.ok) {
      const buf = new Uint8Array(await wres.arrayBuffer());
      const hdrs = new Headers();
      hdrs.set("Content-Type", wres.headers.get("content-type") || "image/webp");
      hdrs.set("Access-Control-Allow-Origin", "*");
      hdrs.set("Cache-Control", "public, max-age=86400");
      hdrs.set("X-Proxied-URL", targetUrl.href);
      hdrs.set("X-Fallback", "weserv");
      return new Response(buf, { status: 200, headers: hdrs });
    } else {
      console.log(`[weserv-failed] status=${wres.status}`);
    }
  } catch (e) {
    console.warn(`[weserv-error] ${String(e)}`);
  }

  // 3) Final fallback: return friendly SVG (200) so browser's <img> will display it instead of net::ERR...
  console.log(`[final-fallback] returning placeholder SVG for ${targetUrl.href}`);
  const svg = svgPlaceholder("Image unavailable");
  const svgHeaders = new Headers();
  svgHeaders.set("Content-Type", "image/svg+xml");
  svgHeaders.set("Cache-Control", "public, max-age=300");
  svgHeaders.set("Access-Control-Allow-Origin", "*");
  svgHeaders.set("X-Proxied-URL", targetUrl.href);
  return new Response(svg, { status: 200, headers: svgHeaders });
});
