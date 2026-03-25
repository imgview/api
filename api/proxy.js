const dns = require("dns").promises;
const net = require("net");

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

function sendCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Type,Content-Length,Content-Disposition,Cache-Control,ETag,Last-Modified"
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

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function filteredRequestHeaders(req, target) {
  const headers = {};

  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "origin") continue;
    if (lower === "referer") continue;
    if (typeof value === "undefined") continue;
    headers[key] = value;
  }

  headers["referer"] = `${target.origin}/`;
  headers["origin"] = target.origin;

  return headers;
}

function filteredResponseHeaders(upstreamHeaders) {
  const headers = {};

  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "set-cookie") continue;
    headers[key] = value;
  }

  return headers;
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
  } catch (err) {
    return res.status(403).json({
      ok: false,
      error: "Host diblokir.",
    });
  }

  const method = req.method.toUpperCase();
  const headers = filteredRequestHeaders(req, target);

  let body;
  if (!["GET", "HEAD"].includes(method)) {
    body = await readRawBody(req);
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: "follow",
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Gagal fetch ke target.",
      detail: err.message,
    });
  }

  const responseHeaders = filteredResponseHeaders(upstream.headers);
  for (const [key, value] of Object.entries(responseHeaders)) {
    res.setHeader(key, value);
  }

  res.status(upstream.status);

  if (method === "HEAD") {
    return res.end();
  }

  const arrayBuffer = await upstream.arrayBuffer();
  return res.send(Buffer.from(arrayBuffer));
};
