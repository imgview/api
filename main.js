// main.js
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const width = parseInt(url.searchParams.get("w") || "400", 10);

  if (!target) {
    return new Response("Parameter ?url= diperlukan", { status: 400 });
  }

  // Cek rate limit sederhana
  await new Promise((r) => setTimeout(r, 1000)); // delay 1 detik per request

  try {
    // Gunakan layanan resize eksternal (weserv.nl) sebagai proxy
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(target)}&w=${width}&output=webp`;

    const res = await fetch(proxyUrl);
    if (!res.ok) {
      throw new Error(`Gagal ambil gambar: ${res.status}`);
    }

    const blob = await res.blob();
    return new Response(blob, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500 });
  }
});
