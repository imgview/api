const dns = require("dns").promises;
const net = require("net");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "range",
  "user-agent",
  "x-requested-with",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "dnt",
  "priority",
]);

const ALLOWED_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "content-disposition",
  "accept-ranges",
  "content-range",
  "location",
  "retry-after",
  "vary",
  "expires",
  "age",
  "pragma",
  "x-robots-tag",
]);

const MAX_REDIRECTS = Number(process.env.PROXY_MAX_REDIRECTS || 5);
const REQUEST_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 15000);
const MAX_REQUEST_BODY_BYTES = Number(process.env.PROXY_MAX_REQUEST_BODY_BYTES || 2 * 1024 * 1024);
const MAX_RESPONSE_BODY_BYTES = Number(process.env.PROXY_MAX_RESPONSE_BODY_BYTES || 20 * 1024 * 1024);
const DEFAULT_USER_AGENT =
  process.env.PROXY_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

function sendCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Type,Content-Length,Content-Disposition,Cache-Control,ETag,Last-Modified,Location,Retry-After,Vary"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  return false;
}

function isBlockedHost(hostname) {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local")) return true;

  if (net.isIP(lower) === 4) return isPrivateIPv4(lower);
  if (net.isIP(lower) === 6) return isPrivateIPv6(lower);

  return false;
}

async function resolveAndCheckHostname(hostname) {
  if (isBlockedHost(hostname)) {
    throw new Error("Blocked host");
  }

  const records = await dns.lookup(hostname, { all: true });

  for (const record of records) {
    if (record.family === 4 && isPrivateIPv4(record.address)) {
      throw new Error("Blocked private IPv4");
    }
    if (record.family === 6 && isPrivateIPv6(record.address)) {
      throw new Error("Blocked private IPv6");
    }
  }
}

function getTargetUrl(req) {
  const urlFromQuery = req.query?.url || req.query?.u;
  if (!urlFromQuery) return null;

  try {
    return new URL(urlFromQuery);
  } catch {
    return null;
  }
}

async function readLimitedRawBody(req, limitBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;

    if (total > limitBytes) {
      throw new Error("Request body too large");
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

function filteredRequestHeaders(req, target) {
  const headers = {};

  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "host" || lower === "origin" || lower === "referer") continue;
    if (lower === "cookie") continue;
    if (!ALLOWED_REQUEST_HEADERS.has(lower)) continue;
    if (typeof value === "undefined") continue;

    headers[key] = value;
  }

  headers["referer"] = `${target.origin}/`;
  headers["origin"] = target.origin;

  if (!headers["user-agent"]) {
    headers["user-agent"] = DEFAULT_USER_AGENT;
  }

  return headers;
}

function filteredResponseHeaders(upstreamHeaders) {
  const headers = {};

  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "set-cookie") continue;
    if (!ALLOWED_RESPONSE_HEADERS.has(lower)) continue;

    headers[key] = value;
  }

  return headers;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function createByteLimitTransform(limitBytes) {
  let total = 0;

  return new Transform({
    transform(chunk, enc, cb) {
      total += chunk.length;
      if (total > limitBytes) {
        cb(new Error("Upstream response too large"));
        return;
      }
      cb(null, chunk);
    },
  });
}

async function fetchWithValidatedRedirects(target, init) {
  let currentUrl = new URL(target.toString());
  let currentMethod = init.method || "GET";
  let currentBody = init.body;
  let redirects = 0;

  while (true) {
    await resolveAndCheckHostname(currentUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(currentUrl.toString(), {
        ...init,
        method: currentMethod,
        body: currentBody,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: currentUrl };
    }

    redirects += 1;
    if (redirects > MAX_REDIRECTS) {
      throw new Error("Too many redirects");
    }

    const nextUrl = new URL(location, currentUrl);
    if (!["http:", "https:"].includes(nextUrl.protocol)) {
      throw new Error("Invalid redirect protocol");
    }

    if (nextUrl.username || nextUrl.password) {
      throw new Error("Redirect with credentials blocked");
    }

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = undefined;
    }

    if (currentMethod === "GET" || currentMethod === "HEAD") {
      currentBody = undefined;
    }

    currentUrl = nextUrl;
  }
}

module.exports = async function handler(req, res) {
  sendCORS(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const target = getTargetUrl(req);
  if (!target) {
    return res.status(400).json({
      ok: false,
      error: "Parameter 'url' wajib diisi.",
    });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return res.status(400).json({
      ok: false,
      error: "Hanya http dan https yang diizinkan.",
    });
  }

  if (target.username || target.password) {
    return res.status(400).json({
      ok: false,
      error: "URL dengan kredensial tidak diizinkan.",
    });
  }

  const secret = process.env.PROXY_KEY;
  if (secret) {
    const key = req.query?.key || req.headers["x-proxy-key"];
    if (key !== secret) {
      return res.status(401).json({
        ok: false,
        error: "Key tidak valid.",
      });
    }
  }

  try {
    await resolveAndCheckHostname(target.hostname);
  } catch {
    return res.status(403).json({
      ok: false,
      error: "Host diblokir.",
    });
  }

  const method = req.method.toUpperCase();
  const headers = filteredRequestHeaders(req, target);

  let body;
  if (!["GET", "HEAD"].includes(method)) {
    try {
      body = await readLimitedRawBody(req, MAX_REQUEST_BODY_BYTES);
    } catch (err) {
      return res.status(413).json({
        ok: false,
        error: err.message,
      });
    }
  }

  let upstream;
  let finalUrl;

  try {
    const result = await fetchWithValidatedRedirects(target, {
      method,
      headers,
      body: body && body.length ? body : undefined,
    });

    upstream = result.response;
    finalUrl = result.finalUrl;
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({
        ok: false,
        error: "Request timeout.",
      });
    }

    return res.status(502).json({
      ok: false,
      error: "Gagal fetch ke target.",
      detail: err.message,
    });
  }

  // Kalau redirect masih dikembalikan apa adanya, tetap aman karena host sudah divalidasi di setiap hop.
  const responseHeaders = filteredResponseHeaders(upstream.headers);
  for (const [key, value] of Object.entries(responseHeaders)) {
    res.setHeader(key, value);
  }

  // Tambahan kecil untuk debugging.
  res.setHeader("x-proxy-final-url", finalUrl.toString());

  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BODY_BYTES) {
    return res.status(413).json({
      ok: false,
      error: "Upstream response terlalu besar.",
    });
  }

  res.status(upstream.status);

  if (method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return res.end();
  }

  if (!upstream.body) {
    return res.end();
  }

  try {
    const source = Readable.fromWeb(upstream.body);
    const limiter = createByteLimitTransform(MAX_RESPONSE_BODY_BYTES);
    await pipeline(source, limiter, res);
  } catch (err) {
    // Kalau ukuran melebihi batas saat streaming, respons bisa terputus di tengah.
    if (!res.headersSent) {
      return res.status(413).json({
        ok: false,
        error: "Upstream response terlalu besar.",
      });
    }
  }
};