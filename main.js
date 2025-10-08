import { ImageMagick, MagickFormat, initializeImageMagick } from "https://deno.land/x/wasm_imagemagick@0.0.27/mod.ts";

// Inisialisasi ImageMagick WASM
await initializeImageMagick();

Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const imageUrl = searchParams.get("url");
    const width = parseInt(searchParams.get("w") || "512");

    if (!imageUrl) {
      return new Response("Missing ?url parameter", { status: 400 });
    }

    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (DenoDeployBot)",
      },
    });

    if (!response.ok) {
      return new Response(`Failed to fetch image (${response.status})`, {
        status: 502,
      });
    }

    const inputArrayBuffer = await response.arrayBuffer();
    const inputBytes = new Uint8Array(inputArrayBuffer);

    let outputBytes;
    await ImageMagick.read(inputBytes, (image) => {
      image.resize(width, 0); // Resize lebar saja
      image.filterType = "Lanczos"; // Gunakan Lanczos3
      image.write((data) => {
        outputBytes = data;
      }, MagickFormat.Jpeg);
    });

    return new Response(outputBytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
});
