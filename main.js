// main.js — Image Proxy Deno Deploy versi ringan (tanpa WASM)
const RATE_LIMIT_WINDOW = 1000;
const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const lastRequest = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const last = lastRequest.get(ip) || 0;
  if (now - last < RATE_LIMIT_WINDOW) return true;
  lastRequest.set(ip, now);
  return false;
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DenoImageProxy/1.0)",
          "Accept": "image/*,*/*;q=0.8",
          "Referer": new URL(url).origin,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error("Status " + res.status);
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

Deno.serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const w = searchParams.get("w");
  const h = searchParams.get("h");
  const q = searchParams.get("q");
  const fit = searchParams.get("fit") || "inside";
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Terlalu sering! Tunggu 1 detik." }), {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  if (!url) {
    return new Response(JSON.stringify({ error: "Gunakan parameter ?url=" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    // Gunakan layanan eksternal resize (weserv.nl)
    const proxyUrl = new URL("https://images.weserv.nl/");
    proxyUrl.searchParams.set("url", url.replace(/^https?:\/\//, ""));
    if (w) proxyUrl.searchParams.set("w", w);
    if (h) proxyUrl.searchParams.set("h", h);
    if (q) proxyUrl.searchParams.set("q", q);
    proxyUrl.searchParams.set("fit", fit);

    const res = await fetchWithRetry(proxyUrl.toString());
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return new Response(JSON.stringify({ error: "Gagal mengambil gambar." }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
