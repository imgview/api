import sharp from 'sharp';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const imageUrl = searchParams.get('url');
  const width = parseInt(searchParams.get('w') || '0');
  const quality = parseInt(searchParams.get('q') || '80');

  if (!imageUrl) {
    return new Response('masukkan parameter lengkap misalnya /?w=200&q=75&url=', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return new Response(`Gagal mengambil gambar (${response.status})`, {
        status: response.status,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let image = sharp(buffer);

    if (width > 0) image = image.resize(width);

    // sedikit halus tanpa kabur
    image = image
      .sharpen(0.5)
      .median(1)
      .jpeg({ quality, mozjpeg: true });

    const output = await image.toBuffer();

    return new Response(output, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (e) {
    return new Response('Terjadi kesalahan: ' + e.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
 }
