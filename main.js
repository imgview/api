import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const width = parseInt(url.searchParams.get("w") || "400", 10);

  // Jika root path tanpa parameter -> tampilkan info
  if (!target) {
    return new Response(
      `✅ ImgView aktif!\nGunakan format:\n?url=<gambar>&w=<lebar>\n\nContoh:\n?url=https://kiryuu02.com/wp-content/uploads/2021/04/niwatori-fighter-459997-HAsjbASi.jpg&w=300`,
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Rate limit sederhana
  await new Promise((r) => setTimeout(r, 1000)); // delay 1 detik per request

  try {
    // Gunakan weserv.nl untuk resize
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(
      target
    )}&w=${width}&output=webp`;

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
