// main.js — Image Proxy Deno dengan resize, retry, dan rate limit
import { ImageMagick, MagickFormat, initializeImageMagick } from "https://deno.land/x/wasm_imagemagick@0.0.26/mod.ts";

// Load WASM ImageMagick
const wasmUrl = "https://deno.land/x/wasm_imagemagick@0.0.26/wasm_imagemagick.wasm";
const wasmBytes = await fetch(wasmUrl).then((res) => res.arrayBuffer());
await initializeImageMagick(wasmBytes);

// --- Konfigurasi global ---
const RATE_LIMIT_WINDOW = 1000; // 1 detik per IP
const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const lastRequest = new Map(); // IP → timestamp terakhir

// Fungsi pembatas kecepatan (rate limit 1 req per detik per IP)
function isRateLimited(ip) {
  const now = Date.now();
  const last = lastRequest.get(ip) || 0;
  if (now - last < RATE_LIMIT_WINDOW) return true;
  lastRequest.set(ip, now);
  return false;
}

// Fetch gambar dengan timeout & retry
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
      console.warn(`Fetch gagal (percobaan ${i + 1}):`, e.message);
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Handler utama
Deno.serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const w = parseInt(searchParams.get("w") || "0");
  const h = parseInt(searchParams.get("h") || "0");
  const q = parseInt(searchParams.get("q") || "80");
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers });

  // Rate limit
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Terlalu banyak permintaan, tunggu 1 detik." }), {
      status: 429,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  if (!url) {
    return new Response(JSON.stringify({ error: "Parameter ?url wajib diisi." }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  // Validasi URL
  let target;
  try {
    target = new URL(url);
    if (
      ["localhost", "127.0.0.1"].includes(target.hostname) ||
      target.hostname.startsWith("192.168.") ||
      target.hostname.startsWith("10.")
    ) {
      return new Response(JSON.stringify({ error: "Akses ke IP lokal tidak diizinkan." }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "URL tidak valid." }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetchWithRetry(target.toString());
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) {
      return new Response(JSON.stringify({ error: "URL bukan gambar." }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const arrayBuf = await res.arrayBuffer();
    const input = new Uint8Array(arrayBuf);
    let output = input; // default: kirim original

    // Resize bila ada parameter
    if (w || h || q) {
      await ImageMagick.read(input, async (img) => {
        img.resize(w || h ? { width: w || undefined, height: h || undefined } : {});
        img.quality = Math.min(q, 100);
        const bytes = await img.write(MagickFormat.Jpeg);
        output = bytes;
      });
    }

    return new Response(output, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("Error:", err.message);
    return new Response(JSON.stringify({ error: "Gagal memproses gambar." }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
