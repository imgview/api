// File: api/cache-image.js (Vercel) atau netlify/edge-functions/cache-image.js (Netlify)

export default async (request) => {
  // Menggunakan new URL(request.url) untuk mengurai URL request
  const urlParams = new URL(request.url).searchParams;
  const imageUrl = urlParams.get("url"); // Gunakan nama variabel yang lebih jelas

  if (!imageUrl) {
    return new Response("Parameter 'url' hilang.", { status: 400 });
  }

  // VALIDASI: Pastikan URL adalah protokol HTTP/HTTPS yang valid sebelum fetch
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    return new Response("URL gambar tidak valid.", { status: 400 });
  }

  try {
    // Lakukan fetch ke sumber gambar
    const response = await fetch(imageUrl);

    if (!response.ok) {
      // Mengembalikan error sumber, ini penting untuk debugging
      return new Response(`Gagal mengambil gambar dari sumber. Status: ${response.status}`, {
        status: response.status,
      });
    }

    // Buat response baru dengan header caching yang kuat
    const headers = new Headers(response.headers);
    
    // Set header cache yang agresif untuk memaksa CDN menyimpan
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, s-maxage=31536000, immutable"
    );

    // Salurkan body dan header
    return new Response(response.body, {
      status: 200,
      headers: headers,
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    // Error 500 ini menandakan kegagalan koneksi atau error internal lainnya
    return new Response(`Error 500: Koneksi atau runtime gagal. ${error.message}`, {
      status: 500,
    });
  }
};
