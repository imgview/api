Deno.serve(async (req) => {
  const { searchParams } = new URL(req.url);

  const url = searchParams.get("url");
  if (!url) {
    return new Response("✅ Server aktif\nGunakan ?url=<alamat gambar>", {
      headers: { "content-type": "text/plain" },
    });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": new URL(url).origin,
        "Accept": "image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return new Response(
        `Gagal ambil gambar: ${response.status} ${response.statusText}`,
        { status: 502 }
      );
    }

    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=86400");

    const body = await response.arrayBuffer();
    return new Response(body, { status: 200, headers });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
});
