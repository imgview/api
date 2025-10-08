// main.js — versi Deno Deploy

// Simpan request per IP
const rateLimit = new Map();

// Daftar IP admin bebas limit (ambil dari ENV: waduh)
const ADMIN_IPS = (Deno.env.get("waduh") || "")
  .split(",")
  .map(ip => ip.trim())
  .filter(Boolean);

// Bersihkan cache request setiap 10 menit
setInterval(() => {
  const now = Date.now();
  const oneHour = 3600000;
  for (const [ip, reqs] of rateLimit.entries()) {
    const valid = reqs.filter(t => now - t < oneHour);
    if (valid.length === 0) rateLimit.delete(ip);
    else rateLimit.set(ip, valid);
  }
}, 600000);

// Jalankan server Deno
Deno.serve(async (req) => {
  const urlObj = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const isAdmin = ADMIN_IPS.includes(ip);
  const maxRequests = 50;
  const oneHour = 3600000;

  // Rate limit
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
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          req.headers.get("user-agent") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": req.headers.get("accept") || "*/*",
        "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
        "Referer": "https://google.com", // bypass anti-hotlink Cloudflare
        "Origin": "https://google.com",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });

    // Salin header respons asli
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("X-Proxied-URL", targetUrl);

    const contentType = headers.get("content-type") || "application/octet-stream";
    const body = await response.arrayBuffer();

    return new Response(body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Fetch failed", message: err.message }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
