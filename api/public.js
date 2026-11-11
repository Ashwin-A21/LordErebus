'use strict';
/**
 * Public API
 *   GET  /api/public?action=state[&uid=123]   live giveaway state (polled by the site)
 *   POST /api/public?action=enter             {game_uid, game_name, email, website(honeypot)}
 */
const { q, one, scalar, env } = require('../lib/db');
const { handler, sendJson, fail, query, body, clientIp, rateLimited, rateHit, now } = require('../lib/http');
const G = require('../lib/giveaway');

module.exports = handler(async (req, res) => {
  await G.runDueSchedule();
  const params = query(req);
  const action = params.action || 'state';

  if (action === 'state' && req.method === 'GET') {
    const g = await G.currentGiveaway();
    if (!g) return sendJson(res, 200, { ok: true, giveaway: null, server_time: now() });

    const entries = Number(await scalar('SELECT COUNT(*) FROM le_entries WHERE giveaway_id = ? AND disqualified = 0', [g.id]));

    let winners = [];
    if (g.status === 'drawn') {
      winners = (await q('SELECT id, game_uid, game_name, win_rank, prize FROM le_entries WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank', [g.id]))
        .map(w => ({ _id: w.id, rank: Number(w.win_rank), name: w.game_name, uid: G.maskUid(w.game_uid), prize: Number(w.prize) }));
    }

    // Wheel: winners (if drawn) plus the most recent entrants, up to 24 slices, in entry order.
    const seg = new Map();
    winners.forEach(w => seg.set(w._id, { name: w.name, rank: w.rank }));
    const fill = await q('SELECT id, game_name FROM le_entries WHERE giveaway_id = ? AND disqualified = 0 AND win_rank IS NULL ORDER BY id DESC LIMIT 24', [g.id]);
    for (const f of fill) {
      if (seg.size >= Math.max(24, winners.length)) break;
      seg.set(f.id, { name: f.game_name, rank: null });
    }
    const wheel = [...seg.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    winners.forEach(w => delete w._id);

    let me = null;
    const uid = String(params.uid || '').replace(/\D/g, '');
    if (uid) {
      const row = await one('SELECT win_rank, prize FROM le_entries WHERE giveaway_id = ? AND game_uid = ?', [g.id, uid]);
      me = row
        ? { entered: true, won: row.win_rank !== null, rank: row.win_rank === null ? null : Number(row.win_rank), prize: row.prize === null ? null : Number(row.prize) }
        : { entered: false };
    }
    return sendJson(res, 200, { ok: true, server_time: now(), giveaway: G.publicGiveaway(g), entries, winners, wheel, me });
  }

  if (action === 'enter' && req.method === 'POST') {
    const b = await body(req);
    if (String(b.website || '').trim() !== '') fail(400, 'Entry rejected.'); // bot honeypot

    if (await rateLimited(req, 'enter', 20, 600)) fail(429, 'Too many attempts from your network. Please wait a few minutes.');
    await rateHit(req, 'enter');

    const g = await G.currentGiveaway();
    if (!g || !G.accepting(g)) fail(400, 'Entries are closed right now.');

    const uid = String(b.game_uid || '').trim();
    const name = String(b.game_name || '').replace(/[\x00-\x1F\x7F]/g, '').trim();
    const email = String(b.email || '').trim().toLowerCase();

    const errors = {};
    if (!/^\d{5,15}$/.test(uid)) errors.game_uid = 'Game UID must be 5–15 digits, numbers only.';
    if ([...name].length < 1 || [...name].length > 40) errors.game_name = 'Enter your in-game name (max 40 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 190) errors.email = 'Enter a valid email address.';
    else if (env('GMAIL_ONLY', 'true') !== 'false' && !/@(gmail|googlemail)\.com$/.test(email)) errors.email = 'Please use your Gmail address (@gmail.com).';
    if (Object.keys(errors).length) fail(422, 'Please fix the highlighted fields.', { fields: errors });

    const norm = G.normalizeEmail(email);
    const ip = clientIp(req);

    if (await scalar('SELECT 1 FROM le_entries WHERE giveaway_id = ? AND game_uid = ?', [g.id, uid])) {
      fail(409, 'This Game UID is already entered. Good luck!', { fields: { game_uid: 'Already entered.' } });
    }
    if (await scalar('SELECT 1 FROM le_entries WHERE giveaway_id = ? AND email_norm = ?', [g.id, norm])) {
      fail(409, 'This Gmail is already used for an entry.', { fields: { email: 'Already used.' } });
    }
    if (g.max_per_ip > 0) {
      const n = Number(await scalar('SELECT COUNT(*) FROM le_entries WHERE giveaway_id = ? AND ip = ?', [g.id, ip]));
      if (n >= g.max_per_ip) fail(429, 'Entry limit reached for your network/device.');
    }

    try {
      await q(`INSERT INTO le_entries (giveaway_id, game_uid, game_name, email, email_norm, ip, remote_addr, user_agent, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.id, uid, name, email, norm, ip, String(req.headers['x-forwarded-for'] || '').slice(0, 45),
         String(req.headers['user-agent'] || '').slice(0, 255), now()]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') fail(409, 'You are already entered in this giveaway.');
      throw e;
    }
    return sendJson(res, 200, { ok: true, message: "You're in! Winners are announced on this page." });
  }

  fail(404, 'Unknown action.');
});
