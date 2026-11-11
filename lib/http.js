'use strict';
/** Request/response helpers shared by the API functions. */
const { q, scalar, ensureSchema } = require('./db');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; this.expose = true; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

const now = () => Math.floor(Date.now() / 1000);

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

/** Wrap a handler: schema bootstrap + uniform JSON errors. */
function handler(fn) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await fn(req, res);
    } catch (e) {
      if (e && e.expose) return sendJson(res, e.status || 400, { ok: false, error: e.message, ...(e.extra || {}) });
      console.error('[lord-erebus]', e);
      const dbDown = e && /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ER_ACCESS_DENIED|ER_HOST_NOT_PRIVILEGED|ER_DBACCESS_DENIED/.test(String(e.code || e.message));
      sendJson(res, 500, { ok: false, error: dbDown ? 'Database connection failed. Check the DB_* settings and Remote MySQL access.' : 'Server error. Please try again in a moment.' });
    }
  };
}

function query(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

/** JSON body (Vercel pre-parses it; fall back to reading the stream). */
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 64 * 1024) fail(413, 'Request too large.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return {}; }
}

/** Vercel sets x-real-ip / x-forwarded-for to the real visitor IP (clients cannot spoof it there). */
function clientIp(req) {
  const h = req.headers;
  const cand = [h['x-real-ip'], String(h['x-forwarded-for'] || '').split(',')[0], req.socket && req.socket.remoteAddress];
  for (const c of cand) {
    const v = String(c || '').trim().replace(/^::ffff:/, '');
    if (v && v.length <= 45 && /^[0-9a-fA-F:.]+$/.test(v)) return v;
  }
  return '0.0.0.0';
}

async function rateLimited(req, bucket, max, windowSec) {
  if (Math.random() < 0.02) await q('DELETE FROM le_hits WHERE at < ?', [now() - 86400]);
  const n = await scalar('SELECT COUNT(*) FROM le_hits WHERE bucket = ? AND ip = ? AND at > ?', [bucket, clientIp(req), now() - windowSec]);
  return Number(n) >= max;
}
async function rateHit(req, bucket) {
  await q('INSERT INTO le_hits (bucket, ip, at) VALUES (?, ?, ?)', [bucket, clientIp(req), now()]);
}

module.exports = { HttpError, fail, now, sendJson, handler, query, body, clientIp, rateLimited, rateHit };
