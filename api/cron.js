'use strict';
/**
 * Optional: guarantees a scheduled draw runs on time even if nobody has the site open.
 * (Without it, draws still run automatically on the next visit or poll.)
 *
 * Call with header  Authorization: Bearer <CRON_SECRET>  (Vercel Cron does this for you)
 * or via URL        /api/cron?key=<CRON_SECRET>         (e.g. free cron-job.org, every minute)
 */
const { env } = require('../lib/db');
const { handler, sendJson, fail, query } = require('../lib/http');
const { safeEqual } = require('../lib/auth');
const G = require('../lib/giveaway');

module.exports = handler(async (req, res) => {
  const secret = env('CRON_SECRET', '');
  const sent = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(query(req).key || '');
  if (!secret || !safeEqual(sent, secret)) fail(403, 'Forbidden.');
  await G.runDueSchedule();
  sendJson(res, 200, { ok: true });
});
