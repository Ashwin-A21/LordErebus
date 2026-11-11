'use strict';
/**
 * Admin API — every action except `me` and `login` needs a signed-in session,
 * and every POST needs the X-CSRF header returned by `me` / `login`.
 */
const bcrypt = require('bcryptjs');
const { q, one, scalar, settingGet, settingSet } = require('../lib/db');
const { handler, sendJson, fail, query, body, rateLimited, rateHit, now } = require('../lib/http');
const auth = require('../lib/auth');
const G = require('../lib/giveaway');

function intIn(v, min, max, label) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isInteger(n)) fail(422, `${label} must be a whole number.`);
  if (n < min || n > max) fail(422, `${label} must be between ${min} and ${max}.`);
  return n;
}

async function adminState(g) {
  const st = await one(`SELECT COUNT(*) total, SUM(disqualified = 0) eligible, SUM(disqualified = 1) dq,
                               COUNT(DISTINCT ip) ips, SUM(created_at > ?) last_hour
                        FROM le_entries WHERE giveaway_id = ?`, [now() - 3600, g.id]);
  const shared = await one(`SELECT COUNT(*) ips, COALESCE(SUM(n), 0) entries FROM
                            (SELECT COUNT(*) n FROM le_entries WHERE giveaway_id = ? GROUP BY ip HAVING n > 1) t`, [g.id]);
  const stats = {};
  for (const [k, v] of Object.entries(st)) stats[k] = Number(v || 0);
  stats.shared_ips = Number(shared.ips || 0);
  stats.shared_ip_entries = Number(shared.entries || 0);
  const winners = await q(`SELECT id, game_uid, game_name, email, ip, win_rank, prize, created_at
                           FROM le_entries WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank`, [g.id]);
  return { giveaway: { ...g, accepting: G.accepting(g) }, stats, winners };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = handler(async (req, res) => {
  await G.runDueSchedule();
  const params = query(req);
  const action = params.action || '';
  const method = req.method;

  /* ---------------- auth ---------------- */
  if (action === 'me') {
    const s = await auth.session(req);
    return sendJson(res, 200, { ok: true, authed: !!s, csrf: s ? s.csrf : null });
  }

  if (action === 'login' && method === 'POST') {
    if (await rateLimited(req, 'login', 8, 900)) fail(429, 'Too many failed attempts. Try again in 15 minutes.');
    const pw = String((await body(req)).password || '');
    const hash = await settingGet('admin_password_hash');
    if (!hash) fail(503, 'Admin is not set up yet. Set ADMIN_INITIAL_PASSWORD in Vercel and redeploy.');
    if (!(await bcrypt.compare(pw, hash))) {
      await rateHit(req, 'login');
      await new Promise(r => setTimeout(r, 400));
      fail(401, 'Wrong password.');
    }
    const csrf = auth.issue(res, req, hash);
    return sendJson(res, 200, { ok: true, csrf });
  }

  const s = await auth.session(req);
  if (!s) fail(401, 'Please sign in.');
  if (method === 'POST' && !auth.safeEqual(req.headers['x-csrf'] || '', s.csrf)) fail(403, 'Session expired. Reload the page.');

  if (action === 'logout' && method === 'POST') {
    auth.clear(res, req);
    return sendJson(res, 200, { ok: true });
  }

  const g = await G.currentGiveaway();
  if (!g) fail(500, 'No giveaway found.');

  /* ---------------- read ---------------- */
  if (method === 'GET') {
    if (action === 'state') return sendJson(res, 200, { ok: true, server_time: now(), ...(await adminState(g)) });

    if (action === 'entries') {
      const gid = params.giveaway ? Number(params.giveaway) : g.id;
      const search = String(params.q || '').trim();
      const filter = String(params.filter || 'all');
      const page = Math.max(1, Number(params.page) || 1);
      const per = 50;
      const where = ['e.giveaway_id = ?'];
      const args = [gid];
      if (search) {
        where.push('(e.game_uid LIKE ? OR e.game_name LIKE ? OR e.email LIKE ? OR e.ip LIKE ?)');
        const like = '%' + search.replace(/[\\%_]/g, m => '\\' + m) + '%';
        args.push(like, like, like, like);
      }
      if (filter === 'winners') where.push('e.win_rank IS NOT NULL');
      if (filter === 'dq') where.push('e.disqualified = 1');
      if (filter === 'shared_ip') where.push('ipc.n > 1');
      const from = `FROM le_entries e
        JOIN (SELECT ip, COUNT(*) n FROM le_entries WHERE giveaway_id = ? GROUP BY ip) ipc ON ipc.ip = e.ip
        WHERE ${where.join(' AND ')}`;
      const allArgs = [gid, ...args];
      const total = Number(await scalar(`SELECT COUNT(*) ${from}`, allArgs));
      // Group same-IP entries together so multi-account players are easy to spot
      const order = filter === 'shared_ip' ? 'ipc.n DESC, e.ip, e.id DESC' : 'e.id DESC';
      const rows = await q(`SELECT e.id, e.game_uid, e.game_name, e.email, e.ip, e.user_agent, e.created_at,
                                   e.disqualified, e.win_rank, e.prize, ipc.n AS ip_count
                            ${from} ORDER BY ${order} LIMIT ${per} OFFSET ${(page - 1) * per}`, allArgs);
      return sendJson(res, 200, { ok: true, rows, total, page, pages: Math.max(1, Math.ceil(total / per)) });
    }

    if (action === 'export') {
      const gid = params.giveaway ? Number(params.giveaway) : g.id;
      const rows = await q('SELECT * FROM le_entries WHERE giveaway_id = ? ORDER BY id', [gid]);
      const lines = [['id', 'game_uid', 'game_name', 'email', 'ip', 'entered_at_utc', 'disqualified', 'winner_rank', 'prize', 'user_agent'].join(',')];
      for (const r of rows) {
        lines.push([r.id, r.game_uid, r.game_name, r.email, r.ip,
          new Date(r.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19),
          r.disqualified, r.win_rank, r.prize, r.user_agent].map(csvCell).join(','));
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="giveaway-${gid}-entries.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end('﻿' + lines.join('\r\n'));
    }

    if (action === 'history') {
      const rows = await q(`SELECT g.id, g.title, g.status, g.winners_count, g.budget, g.currency, g.drawn_at, g.drawn_by, g.created_at,
          (SELECT COUNT(*) FROM le_entries e WHERE e.giveaway_id = g.id) entries,
          (SELECT COUNT(*) FROM le_entries e WHERE e.giveaway_id = g.id AND e.win_rank IS NOT NULL) winners,
          (SELECT COALESCE(SUM(prize), 0) FROM le_entries e WHERE e.giveaway_id = g.id) paid
        FROM le_giveaways g ORDER BY g.id DESC LIMIT 100`);
      rows.forEach(r => { r.paid = Number(r.paid); });
      return sendJson(res, 200, { ok: true, rows });
    }

    if (action === 'winners') {
      const rows = await q(`SELECT id, game_uid, game_name, email, ip, win_rank, prize FROM le_entries
                            WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank`, [Number(params.giveaway) || 0]);
      return sendJson(res, 200, { ok: true, rows });
    }
    fail(404, 'Unknown action.');
  }

  /* ---------------- write ---------------- */
  if (method !== 'POST') fail(405, 'Method not allowed.');
  const b = await body(req);

  switch (action) {
    case 'save_config': {
      const title = String(b.title || '').trim();
      const subtitle = String(b.subtitle || '').trim();
      if (!title || title.length > 120) fail(422, 'Title is required (max 120 characters).');
      if (subtitle.length > 255) fail(422, 'Subtitle is too long.');
      if (g.status === 'drawn') {
        await q('UPDATE le_giveaways SET title = ?, subtitle = ? WHERE id = ?', [title, subtitle, g.id]);
        return sendJson(res, 200, { ok: true, note: 'Winners are drawn, so only the title and subtitle were updated.' });
      }
      const winners = intIn(b.winners_count, 1, 1000, 'Number of winners');
      const budget = intIn(b.budget, 0, 100000000, 'Budget');
      const minPrize = intIn(b.min_prize ?? 0, 0, 100000000, 'Minimum prize');
      const mode = b.split_mode === 'random' ? 'random' : 'equal';
      if (mode === 'random' && minPrize * winners > budget) fail(422, `Budget is too small: ${winners} winners × minimum ${minPrize} = ${minPrize * winners}.`);
      const currency = String(b.currency ?? '₹').trim();
      if (!currency || [...currency].length > 8) fail(422, 'Currency must be 1–8 characters.');
      const maxIp = intIn(b.max_per_ip ?? 0, 0, 1000, 'Entries per IP');
      await q(`UPDATE le_giveaways SET title=?, subtitle=?, winners_count=?, budget=?, min_prize=?, split_mode=?, currency=?,
               max_per_ip=?, unique_ip_winners=? WHERE id=?`,
        [title, subtitle, winners, budget, minPrize, mode, currency, maxIp, b.unique_ip_winners ? 1 : 0, g.id]);
      return sendJson(res, 200, { ok: true });
    }

    case 'set_status': {
      if (g.status === 'drawn') fail(409, 'This giveaway is finished. Start a new one.');
      await q('UPDATE le_giveaways SET status = ? WHERE id = ?', [b.status === 'open' ? 'open' : 'paused', g.id]);
      return sendJson(res, 200, { ok: true });
    }

    case 'schedule': {
      if (g.status === 'drawn') fail(409, 'This giveaway is finished. Start a new one.');
      if (b.draw_at === null || b.draw_at === undefined) {
        await q('UPDATE le_giveaways SET draw_at = NULL WHERE id = ?', [g.id]);
        return sendJson(res, 200, { ok: true });
      }
      const at = intIn(b.draw_at, now() + 30, now() + 366 * 86400, 'Draw time');
      await q('UPDATE le_giveaways SET draw_at = ?, status = "open" WHERE id = ?', [at, g.id]);
      return sendJson(res, 200, { ok: true });
    }

    case 'draw_now': {
      const r = await G.performDraw(g.id, 'admin');
      if (!r.ok) fail(409, r.error);
      return sendJson(res, 200, r);
    }

    case 'replace_winner': {
      const r = await G.replaceWinner(Number(b.entry_id) || 0);
      if (!r.ok) fail(409, r.error);
      return sendJson(res, 200, r);
    }

    case 'toggle_dq':
    case 'delete_entry': {
      const id = Number(b.entry_id) || 0;
      const e = await one('SELECT win_rank FROM le_entries WHERE id = ?', [id]);
      if (!e) fail(404, 'Entry not found.');
      if (e.win_rank !== null) fail(409, 'This entry is a winner. Use "Replace" on the Draw tab instead.');
      if (action === 'toggle_dq') await q('UPDATE le_entries SET disqualified = 1 - disqualified WHERE id = ?', [id]);
      else await q('DELETE FROM le_entries WHERE id = ?', [id]);
      return sendJson(res, 200, { ok: true });
    }

    case 'new_giveaway': {
      if (g.status !== 'drawn' && !b.force) fail(409, 'The current giveaway has not been drawn yet.', { needs_force: true });
      const title = String(b.title || '').trim().slice(0, 120) || g.title;
      await q(`INSERT INTO le_giveaways (title, subtitle, status, winners_count, budget, min_prize, split_mode, currency,
               max_per_ip, unique_ip_winners, created_at) VALUES (?, ?, 'paused', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, g.subtitle, g.winners_count, g.budget, g.min_prize, g.split_mode, g.currency, g.max_per_ip, g.unique_ip_winners ? 1 : 0, now()]);
      if (g.status !== 'drawn') await q('UPDATE le_giveaways SET status = "paused", draw_at = NULL WHERE id = ?', [g.id]);
      return sendJson(res, 200, { ok: true });
    }

    case 'change_password': {
      const hash = await settingGet('admin_password_hash');
      if (!(await bcrypt.compare(String(b.current || ''), String(hash)))) fail(401, 'Current password is wrong.');
      const next = String(b.next || '');
      if (next.length < 8) fail(422, 'New password must be at least 8 characters.');
      const newHash = await bcrypt.hash(next, 10);
      await settingSet('admin_password_hash', newHash);
      const csrf = auth.issue(res, req, newHash); // keep this browser signed in
      return sendJson(res, 200, { ok: true, csrf });
    }
  }
  fail(404, 'Unknown action.');
});
