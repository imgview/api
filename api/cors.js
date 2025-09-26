// api/cors.js
module.exports = (req, res) => {
  // IZINKAN semua origin (untuk "anti-CORS")
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Izinkan metode yang diperlukan (tambahkan lain jika perlu)
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );

  // Izinkan header yang diperlukan oleh client
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  // Bila butuh credential (cookies/auth) -> jangan pakai '*' untuk origin
  // res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Tangani preflight OPTIONS (penting)
  if (req.method === 'OPTIONS') {
    // No content, cuma header preflight
    res.statusCode = 204;
    return res.end();
  }

  // Contoh response untuk GET/POST
  // Ambil body (jika JSON)
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    // Jika ada JSON
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch (e) { /* ignore */ }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      method: req.method,
      message: 'API di Vercel - CORS diizinkan',
      received: parsed
    }));
  });
};