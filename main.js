// main.js — Image Proxy Deno Deploy (anti Cloudflare block)

const rateLimit = new Map();
const ADMIN_IPS = (Deno.env.get("waduh") || "")
  .split(",")
  .map(ip => ip.trim())
  .filter(Boolean);

// Pembersih data tiap 10 menit
setInterval(() => {
  const now = Date.now();
  const oneHour = 3600000;
  for (const [ip, requests] of rateLimit.entries()) {
    const valid = requests.filter(t => now - t < oneHour);
    if (valid.length === 0) rateLimit.delete(ip);
    else rateLimit.set(ip, valid);
  }
}, 600000);

Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const isAdmin = ADMIN_IPS.includes(ip);
  const maxRequests = 50;
  const oneHour = 3600000;

  // === Rate Limit ===
  if (!isAdmin) {
    const now = Date.now();
    const list = rateLimit.get(ip) || [];
    const valid = list.filter(t => now - t < oneHour);

    if (valid.length >= maxRequests) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", reset: "1 hour" }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    valid.push(now);
    rateLimit.set(ip, valid);
  }

  // === Ambil parameter ?url ===
  const targetUrl = urlObj.searchParams.get("url");
  if (!targetUrl) {
    return new Response("Missing ?url parameter", { status: 400 });
  }

  // === Validasi URL ===
  try {
    new URL(targetUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  // === Header spoof anti Cloudflare ===
  const spoofHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9," +
      "image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://shngm.id/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Dest": "image",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Forwarded-For": "103.144.200.12",
    "X-Real-IP": "103.144.200.12",
  };

  try {
    const res = await fetch(targetUrl, { headers: spoofHeaders });

    // === Mode debug JSON (opsional) ===
    if (urlObj.searchParams.get("format") === "json") {
      return new Response(
        JSON.stringify({
          ok: res.ok,
          status: res.status,
          type: res.headers.get("content-type"),
          redirected: res.redirected,
          url: res.url,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // === Kirim hasil binary ===
    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Proxied-URL", targetUrl);

    return new Response(body, { status: res.status, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Fetch failed",
        message: err.message,
        target: targetUrl,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
