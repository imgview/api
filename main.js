// main.js

const rateLimit = new Map();
const ADMIN_IPS = (Deno.env.get("waduh") || "")
  .split(",")
  .map(ip => ip.trim())
  .filter(Boolean);

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
    return new Response("Missing ?url parameter", { status: 400 });
  }

  // Validasi URL
  try {
    new URL(targetUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": req.headers.get("user-agent") ||
          "Mozilla/5.0 (Deno)",
      },
    });

    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Proxied-URL", targetUrl);

    return new Response(body, { status: res.status, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Fetch failed", message: err.message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
