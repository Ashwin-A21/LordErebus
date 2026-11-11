'use strict';
/**
 * Stateless admin sessions for serverless: an HMAC-signed, httpOnly cookie.
 * The token is tied to the current password hash, so changing the password signs everyone out.
 */
const crypto = require('crypto');
const { env, settingGet } = require('./db');
const { now } = require('./http');

const COOKIE = 'le_admin';
const TTL = 12 * 3600;

function secret() {
  // Prefer SESSION_SECRET; fall back to a key derived from the DB password so setup needs fewer variables.
  return env('SESSION_SECRET') || crypto.createHash('sha256').update('le-session:' + env('DB_PASS', '')).digest('hex');
}
const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const pwTag = hash => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ''));
}

function issue(res, req, passwordHash) {
  const payload = b64(JSON.stringify({ exp: now() + TTL, v: pwTag(passwordHash) }));
  const token = payload + '.' + sign(payload);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${isHttps(req) ? '; Secure' : ''}`);
  return csrfFor(token);
}

function clear(res, req) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}

const csrfFor = token => sign('csrf:' + token);

/** Returns { token, csrf } when the request carries a valid session, else null. */
async function session(req) {
  const token = cookies(req)[COOKIE];
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, sign(payload))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (_) { return null; }
  if (!data.exp || data.exp < now()) return null;
  const hash = await settingGet('admin_password_hash');
  if (!hash || data.v !== pwTag(hash)) return null;
  return { token, csrf: csrfFor(token) };
}

module.exports = { issue, clear, session, safeEqual };
