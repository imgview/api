// api/index.js
export default async function handler(req, res) {
  const { type, clientIP, minutesLeft, maxRequests, whitelisted, remaining, resetAt } = req.query;

  res.setHeader('Content-Type', 'text/html');
  
  let htmlContent = '';
  
  if (type === 'rate-limit') {
    // Rate limit page
    htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Akses Terbatas</title>
        <style>
          body { 
            background: #1a1a1a; 
            color: #999; 
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
          }
          h1 { color: #d23b3b; text-align: center; }
          .mnt { color: green; font-weight: bold; }
          .ip { color: #4a90e2; }
          .limit { 
            text-align: center; 
            margin: 30px 0; 
            padding: 20px; 
            background: #111; 
            border-radius: 8px; 
            border: 1px solid #333;
          }
          .info { 
            background: #222; 
            padding: 20px; 
            border-radius: 8px; 
            border: 1px solid #333; 
          }
          .try { font-size: 18px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="limit">  		
          <h1>Akses Terbatas</h1>
          <p class="try">Coba lagi dalam <span class="mnt">${minutesLeft}</span> Menit</p>
        </div>
        <div class="info">
          <p>IP Anda: <span class="ip">${clientIP}</span></p>
          <p>Sisa request: 0</p>
          <p>Limit: ${maxRequests} request per jam</p>
        </div>
      </body>
      </html>
    `;
  } else {
    // Info page (default)
    htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Image Proxy API</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
          }
          h1 {
            color: #4a90e2;
            text-align: center;
            margin-bottom: 30px;
          }
          .section {
            background: #2d2d2d;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
          }
          .ip-address {
            font-size: 18px;
            font-weight: bold;
            color: #4a90e2;
            word-break: break-all;
          }
          .code {
            background: #000;
            color: #00ff00;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
            overflow-x: auto;
            margin: 10px 0;
          }
          .formats {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
          }
          .format-tag {
            background: #4a90e2;
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🖼️ Image Proxy API</h1>
          
          <!-- IP Address -->
          <div class="section">
            <h2>🌐 IP Address Anda</h2>
            <div class="ip-address">${clientIP || 'Tidak terdeteksi'}</div>
          </div>

          <!-- Cara Penggunaan -->
          <div class="section">
            <h2>🚀 Cara Penggunaan</h2>
            <div class="code">
              /api/image-proxy?url=URL_GAMBAR&w=LEBAR&h=TINGGI&format=FORMAT
            </div>
            <p><strong>Parameter:</strong></p>
            <ul>
              <li><code>url</code> - URL gambar sumber (wajib)</li>
              <li><code>w</code> - Lebar gambar (opsional)</li>
              <li><code>h</code> - Tinggi gambar (opsional)</li>
              <li><code>format</code> - Format output (opsional)</li>
            </ul>
          </div>

          <!-- Format yang Didukung -->
          <div class="section">
            <h2>📁 Format yang Didukung</h2>
            <div class="formats">
              <span class="format-tag">WebP</span>
              <span class="format-tag">JPEG</span>
              <span class="format-tag">PNG</span>
              <span class="format-tag">AVIF</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  res.status(200).send(htmlContent);
}
