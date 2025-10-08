// main.js — simple Deno proxy that guarantees warm-up OK
const FETCH_TIMEOUT = 10000;

function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  return fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DenoImageProxy/1.0)",
      "Accept": "image/*,*/*;q=0.8",
      "Referer": new URL(url).origin,
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const params = urlObj.searchParams;
  const target = params.get("url");

  // Health / warm-up: root tanpa query harus balikan 200 OK cepat
  if (!target) {
    return new Response(
      "OK — Img proxy ready\nUsage: ?url=<image_url>",
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }

  // CORS
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: baseHeaders });

  // Basic validation (blok local/private)
  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (["localhost", "127.0.0.1"].includes(targetUrl.hostname) ||
        targetUrl.hostname.startsWith("192.168.") ||
        targetUrl.hostname.startsWith("10.") ||
        targetUrl.hostname.endsWith(".local")) {
      return new Response("Access to local addresses denied", { status: 400, headers: baseHeaders });
    }
  } catch {
    return new Response("Invalid URL", { status: 400, headers: baseHeaders });
  }

  // Perform fetch (non-blocking on startup — only per request)
  try {
    const upstream = await fetchWithTimeout(targetUrl.toString());
    if (!upstream.ok) {
      // forward upstream status but keep a sane body
      return new Response(`Upstream error ${upstream.status}`, { status: upstream.status, headers: baseHeaders });
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const arrayBuf = await upstream.arrayBuffer();
    return new Response(arrayBuf, {
      status: 200,
      headers: { ...baseHeaders, "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Fetch failed", message: String(err?.message || err) }), {
      status: 502,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
    });
  }
});
