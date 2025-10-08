// main.js — Deno Deploy Image Proxy
// Dibuat ringan, aman, dan anti-blokir Cloudflare

const rateLimit = new Map();

// IP admin bebas limit (env: waduh)
const ADMIN_IPS = (Deno.env.get("waduh") || "")
  .split(",")
  .map(ip => ip.trim())
  .filter(Boolean);

// interval bersih-bersih cache
setInterval(() => {
  const now = Date.now();
  for (const [ip, time] of rateLimit.entries()) {
    if (now - time > 1000) rateLimit.delete(ip); // 1 detik
  }
}, 5000);

Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const isAdmin = ADMIN_IPS.includes(ip);

  // Rate limit: 1 request per detik per IP
  const now = Date.now();
  const last = rateLimit.get(ip) || 0;
  if (!isAdmin && now - last < 1000) {
    return new Response(
      JSON.stringify({ error: "Rate limit: 1 request per second" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }
  rateLimit.set(ip, now);

  // Ambil parameter ?url=
  const targetUrl = urlObj.searchParams.get("url");
  if (!targetUrl) {
    return new Response("Missing ?url parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Validasi URL
  try {
    new URL(targetUrl);
  } catch {
    return new Response("Invalid URL", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          req.headers.get("user-agent") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": targetUrl.startsWith("https://")
          ? targetUrl.replace(/(https:\/\/[^\/]+).*/, "$1")
          : "https://google.com",
        "Origin": "https://google.com",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });

    // Kalau status 4xx/5xx, tetap kirim 200 agar browser tidak error
    if (!res.ok) {
      return new Response("Upstream error", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain",
        },
      });
    }

    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("X-Proxied-URL", targetUrl);

    return new Response(body, { status: 200, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Fetch failed", message: err.message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
