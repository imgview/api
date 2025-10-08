// main.js — versi dasar (tanpa sharp dulu)
Deno.serve(async (req) => {
  const { searchParams } = new URL(req.url);

  const targetUrl = searchParams.get("url");
  if (!targetUrl) {
    return new Response("OK — Img proxy ready\nUsage: ?url=<image_url>", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    // Validasi URL
    const parsed = new URL(targetUrl);

    // Ambil gambar dari target URL
    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": parsed.origin,
        "Accept": "image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      return new Response(
        `Failed to fetch: ${res.status} ${res.statusText}`,
        { status: res.status },
      );
    }

    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=86400");

    const body = await res.arrayBuffer();
    return new Response(body, { status: 200, headers });
  } catch (err) {
    return new Response(
      `Fetch error: ${err.message}`,
      { status: 500, headers: { "Content-Type": "text/plain" } },
    );
  }
});
