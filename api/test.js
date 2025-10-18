// File: api/test.js (Vercel) / cache-image.js (Netlify)

export default async (request) => {
  const urlParams = new URL(request.url).searchParams;
  const imageUrl = urlParams.get("url");

  // KOREKSI KRITIS: Cek jika parameter hilang ATAU kosong.
  if (!imageUrl || imageUrl.trim() === "") {
    return new Response("Parameter 'url' (URL gambar sumber) hilang atau kosong.", { 
        status: 400, 
        headers: { "Content-Type": "text/plain" }
    });
  }

  // Lanjutkan dengan perbaikan anti-hotlinking sebelumnya:
  try {
    const response = await fetch(imageUrl, {
      headers: {
        // Menyamar sebagai Browser Chrome
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        // Meniru Referer dari halaman sumber (untuk anti-hotlinking)
        "Referer": new URL(imageUrl).origin 
      }
    });

    if (!response.ok) {
      return new Response(`Gagal mengambil gambar. Status: ${response.status}.`, {
        status: response.status,
      });
    }

    // Set header cache yang kuat
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: 200,
      headers: headers,
    });

  } catch (error) {
    // Ini menangani error koneksi atau DNS
    console.error("Image proxy error:", error);
    return new Response(`Error 500: Koneksi gagal ke sumber gambar. ${error.message}`, {
      status: 500,
    });
  }
};
