// File: api/test.js (Vercel)

export default async (request) => {
  // ************ KOREKSI KRITIS ************
  // Gunakan 'request.url' dan konstruktor URL hanya untuk mendapatkan search params.
  // Kita harus memastikan URL lengkap tersedia, atau setidaknya menangkap error
  // saat mengurai untuk mendapatkan parameter.

  let imageUrl;
  try {
    // Ambil parameter dengan asumsi URL request adalah valid.
    // Jika 'request.url' hanya berisi path, inilah yang menyebabkan crash.
    const requestUrl = new URL(request.url);
    imageUrl = requestUrl.searchParams.get("url");

    // Jika terjadi error pada baris ini, itu berarti 'request.url' tidak valid.
  } catch (e) {
    // Ini menangani kasus '/api/test' yang menyebabkan 'TypeError: Invalid URL'.
    // Karena kita tidak bisa mendapatkan parameter, kita anggap itu error 400.
    return new Response("Gagal mengurai URL permintaan server. Pastikan Anda menggunakan parameter '?url=...' dengan benar.", { 
        status: 400, 
        headers: { "Content-Type": "text/plain" }
    });
  }

  // Cek jika parameter hilang ATAU kosong. (Pengecekan logika yang benar)
  if (!imageUrl || imageUrl.trim() === "") {
    return new Response("Parameter 'url' (URL gambar sumber) hilang atau kosong.", { 
        status: 400, 
        headers: { "Content-Type": "text/plain" }
    });
  }

  // ... (Sisa kode fetch dan caching Anda)
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Referer": new URL(imageUrl).origin 
      }
    });

    if (!response.ok) {
      return new Response(`Gagal mengambil gambar. Status: ${response.status}.`, {
        status: response.status,
      });
    }
    // ... (Set header caching)
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: 200,
      headers: headers,
    });

  } catch (error) {
    // Ini menangani error fetch
    console.error("Image proxy error:", error);
    return new Response(`Error 500: Koneksi gagal ke sumber gambar. ${error.message}`, {
      status: 500,
    });
  }
};
