// Nama file: api/cache-image.js (Vercel) atau netlify/edge-functions/cache-image.js (Netlify)

export default async (request) => {
  // 1. Dapatkan URL gambar yang ingin di-cache dari query parameter 'url'
  const url = new URL(request.url).searchParams.get("url");

  if (!url) {
    return new Response("Parameter 'url' hilang.", { status: 400 });
  }

  try {
    // 2. Ambil (fetch) gambar dari sumber eksternal
    const response = await fetch(url);

    // Jika gambar tidak ditemukan atau error di sumber (4xx/5xx), kembalikan error tersebut
    if (!response.ok) {
      // Mengatasi kemungkinan error 403/500 yang Anda alami
      return new Response(`Gagal mengambil gambar. Status: ${response.status}`, {
        status: response.status,
      });
    }

    // 3. Buat response baru untuk dikembalikan ke klien/CDN
    const headers = new Headers(response.headers);

    // *************************************************************
    // * KUNCI PENTING: Mengatur Cache-Control Header
    // * max-age=31536000 adalah 1 tahun (caching yang sangat agresif)
    // * s-maxage=31536000 ditujukan untuk CDN (Netlify/Vercel)
    // *************************************************************
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, s-maxage=31536000, immutable"
    );

    // Opsional: Atur CORS agar gambar bisa dimuat di situs Anda
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Vary", "Origin");

    // 4. Salurkan body gambar bersama dengan header cache yang kuat
    return new Response(response.body, {
      status: 200,
      headers: headers,
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    return new Response("Terjadi Internal Server Error saat mengambil gambar.", {
      status: 500,
    });
  }
};
