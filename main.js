// main.js — Full Deno image proxy (fetch+retry + basic resize via imagescript)

import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts"; // jika error, beri tahu versinya
// ----------------- CONFIG -----------------
const FETCH_TIMEOUT = 10000; // ms
const MAX_RETRIES = 2;
const RATE_LIMIT_MS = 1000; // 1 request per IP per second
const MAX_CONTENT_LENGTH = 20 * 1024 * 1024; // 20 MB safety limit

// ----------------- RATE LIMIT STATE -----------------
const lastRequestAt = new Map(); // ip -> timestamp (ms)
const ADMIN_IPS = (Deno.env.get("waduh") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ----------------- HELPERS -----------------
async function fetchWithTimeoutAndRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        ...options,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      // last attempt -> throw
      if (i === retries) throw err;
      // wait backoff
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

// Basic hostname safety check (block private/local)
function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  return false;
}

// Infer image mime category
function chooseOutputFormat(contentType, wantFormat) {
  // wantFormat can be 'jpeg'|'png'|'webp'
  if (wantFormat) {
    const f = wantFormat.toLowerCase();
    if (["jpeg", "jpg", "png", "webp"].includes(f)) return f;
  }
  if (!contentType) return "jpeg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpeg";
  return "jpeg";
}

// ----------------- SERVER -----------------
Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const params = urlObj.searchParams;

  // get ip from headers (x-forwarded-for typical on Deno Deploy)
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const isAdmin = ADMIN_IPS.includes(ip);

  // RATE LIMIT 1 req / second
  if (!isAdmin) {
    const now = Date.now();
    const last = lastRequestAt.get(ip) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return new Response(JSON.stringify({ error: "Rate limit: 1 request per second" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    lastRequestAt.set(ip, now);
  }

  // params
  const target = params.get("url");
  const w = params.get("w");
  const h = params.get("h");
  const q = params.get("q"); // quality
  const fit = params.get("fit") || "inside";
  const wantFormat = params.get("format"); // optional jpeg/png/webp or 'json' for debug
  const raw = params.get("raw"); // if set, redirect to upstream (302) OR return binary? we'll redirect

  if (!target) {
    return new Response("Missing ?url parameter", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  // validate URL
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid URL", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  if (isPrivateOrLocalHost(targetUrl.hostname)) {
    return new Response("URL not allowed", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  // If raw=1 -> redirect to original image (useful for <img src=>)
  if (raw === "1") {
    return Response.redirect(targetUrl.toString(), 302);
  }

  // build spoof headers to look like browser
  const spoofHeaders = {
    "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
    "Referer": targetUrl.origin,
    "Origin": targetUrl.origin,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    // X-Forwarded-For spoof removed by default (Deno Deploy sets its own); keep minimal
  };

  // fetch
  let upstream;
  try {
    upstream = await fetchWithTimeoutAndRetry(targetUrl.toString(), {
      headers: spoofHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed fetching target", message: String(err?.message || err) }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    });
  }

  // if upstream returned non-image or error
  const contentType = upstream.headers.get("content-type") || "";
  const contentLengthHeader = upstream.headers.get("content-length");
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader) : null;
  if (contentLength && contentLength > MAX_CONTENT_LENGTH) {
    return new Response(JSON.stringify({ error: "Target image too large" }), { status: 413, headers: { "Content-Type": "application/json" } });
  }
  if (!contentType.startsWith("image/")) {
    // offer JSON debug mode
    if (wantFormat === "json") {
      return new Response(JSON.stringify({ ok: upstream.ok, status: upstream.status, contentType }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Target is not an image", contentType }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // if no transform requested — just proxy the binary with headers
  if (!w && !h && !q && !wantFormat) {
    const arrayBuffer = await upstream.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Proxied-URL", targetUrl.toString());
    return new Response(body, { status: upstream.status, headers });
  }

  // ELSE: do transform with imagescript
  try {
    const ab = await upstream.arrayBuffer();
    const uint8 = new Uint8Array(ab);

    // decode image
    let img = await Image.decode(uint8);
    const origW = img.width;
    const origH = img.height;

    // parse ints
    const width = w ? parseInt(w, 10) : undefined;
    const height = h ? parseInt(h, 10) : undefined;
    const quality = q ? Math.min(100, Math.max(1, parseInt(q, 10))) : 80;

    // resizing logic: ImageScript's resize(width, height) expects numbers; keep aspect ratio if one missing
    let targetW = width;
    let targetH = height;
    if (targetW && !targetH) {
      targetH = Math.round((targetW / origW) * origH);
    } else if (!targetW && targetH) {
      targetW = Math.round((targetH / origH) * origW);
    }

    if (targetW || targetH) {
      // imagescript uses .resize(width, height) with nearest/linear? use default
      img = img.resize(targetW || origW, targetH || origH);
    }

    // choose output format
    const outFmt = chooseOutputFormat(contentType, wantFormat); // jpeg/png/webp
    let outBytes;
    if (outFmt === "png") {
      outBytes = await img.encodePNG();
    } else if (outFmt === "webp") {
      // imagescript encodeWebp accepts quality 0-100
      outBytes = await img.encodeWebp({ quality });
    } else {
      // jpeg
      outBytes = await img.encodeJpeg({ quality });
    }

    const outHeaders = new Headers();
    outHeaders.set("Content-Type", outFmt === "png" ? "image/png" : outFmt === "webp" ? "image/webp" : "image/jpeg");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("X-Proxied-URL", targetUrl.toString());
    outHeaders.set("X-Original-Size", String(uint8.byteLength));
    outHeaders.set("X-Original-Content-Type", contentType);

    return new Response(outBytes, { status: 200, headers: outHeaders });

  } catch (err) {
    // if decoding/processing fails, return upstream binary as fallback
    try {
      const arrayBuffer = await upstream.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);
      const fallbackHeaders = new Headers();
      fallbackHeaders.set("Content-Type", contentType);
      fallbackHeaders.set("Access-Control-Allow-Origin", "*");
      fallbackHeaders.set("X-Proxied-URL", targetUrl.toString());
      fallbackHeaders.set("X-Error", "processing_failed");
      fallbackHeaders.set("X-Error-Message", String(err?.message || err));
      return new Response(body, { status: 200, headers: fallbackHeaders });
    } catch (e2) {
      return new Response(JSON.stringify({ error: "Processing failed and fallback failed", message: String(err?.message || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
});
