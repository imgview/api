const fs = require('fs').promises;
const { join } = require('path');

const rateLimit = new Map();
const ADMIN_IPS = (process.env.waduh || '').split(',').map(ip => ip.trim()).filter(Boolean);

setInterval(() => {
  const now = Date.now();
  const oneHour = 3600000;
  for (const [ip, requests] of rateLimit.entries()) {
    const validRequests = requests.filter(time => now - time < oneHour);
    if (validRequests.length === 0) rateLimit.delete(ip);
    else rateLimit.set(ip, validRequests);
  }
}, 600000);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
  const isAdmin = ADMIN_IPS.includes(ip);
  const maxRequests = 50;
  let requests = [];

  if (!isAdmin) {
    const now = Date.now();
    if (!rateLimit.has(ip)) rateLimit.set(ip, []);
    requests = rateLimit.get(ip).filter(time => now - time < 3600000);
    if (requests.length >= maxRequests) {
      const oldestRequest = Math.min(...requests);
      const resetTime = new Date(oldestRequest + 3600000);
      const remainingMinutes = Math.ceil((resetTime - now) / 60000);
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', resetTime.toISOString());
      return res.status(429).send(`<p>Rate limit tercapai. Coba lagi dalam ${remainingMinutes} menit.</p>`);
    }
    requests.push(now);
    rateLimit.set(ip, requests);
  }

  const { url } = req.query;
  if (!url) return res.status(400).send('<p>URL parameter missing</p>');

  try {
    new URL(url);
    if (!url.startsWith('http://') && !url.startsWith('https://')) throw new Error('Invalid protocol');
  } catch {
    return res.status(400).send('<p>URL tidak valid</p>');
  }

  try {
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    };

    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    if (req.headers['referer']) headers['Referer'] = req.headers['referer'];

    const response = await fetch(url, { method: req.method, headers
