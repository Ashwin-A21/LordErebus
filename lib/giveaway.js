'use strict';
/** Giveaway rules: draws, prize splits, scheduling, formatting. */
const crypto = require('crypto');
const { q, one, tx } = require('./db');
const { now } = require('./http');

function cast(g) {
  if (!g) return null;
  for (const k of ['id', 'winners_count', 'budget', 'min_prize', 'max_per_ip', 'created_at']) g[k] = Number(g[k]);
  for (const k of ['draw_at', 'drawn_at']) g[k] = g[k] === null ? null : Number(g[k]);
  g.unique_ip_winners = !!Number(g.unique_ip_winners);
  return g;
}

const currentGiveaway = async (conn) => cast(await one('SELECT * FROM le_giveaways ORDER BY id DESC LIMIT 1', [], conn));

function accepting(g) {
  if (g.status !== 'open') return false;
  if (g.draw_at !== null && g.draw_at <= now()) return false;
  return true;
}

/** Run the scheduled draw if its time has come. Safe to call on every request. */
async function runDueSchedule() {
  const g = await currentGiveaway();
  if (!g || g.status === 'drawn' || g.draw_at === null || g.draw_at > now()) return;
  await performDraw(g.id, 'schedule');
}

/** Prizes sorted high → low. Equal split, or random amounts ≥ min that sum exactly to budget. */
function splitPrizes(n, budget, min, mode) {
  if (n <= 0) return [];
  if (mode !== 'random') {
    const base = Math.floor(budget / n), rem = budget % n;
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
  }
  min = Math.min(min, Math.floor(budget / n));
  const rest = budget - min * n;
  const w = Array.from({ length: n }, () => crypto.randomInt(1, 1001));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map(x => min + Math.floor(rest * x / sum));
  let left = budget - out.reduce((a, b) => a + b, 0);
  while (left-- > 0) out[crypto.randomInt(0, n)]++;
  return out.sort((a, b) => b - a);
}

/** CSPRNG Fisher–Yates; optional one-winner-per-IP. */
function pickRandom(pool, n, uniqueIp, takenIps = []) {
  pool = pool.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const seen = new Set(takenIps), picked = [];
  for (const row of pool) {
    if (picked.length >= n) break;
    if (uniqueIp) { if (seen.has(row.ip)) continue; seen.add(row.ip); }
    picked.push(row);
  }
  return picked;
}

/** Atomic: the row lock means two requests can never both draw. */
async function performDraw(gid, by) {
  return tx(async c => {
    const g = cast(await one('SELECT * FROM le_giveaways WHERE id = ? FOR UPDATE', [gid], c));
    if (!g) return { ok: false, error: 'Giveaway not found.' };
    if (g.status === 'drawn') return { ok: false, error: 'Winners were already drawn.' };

    const pool = await q('SELECT id, ip FROM le_entries WHERE giveaway_id = ? AND disqualified = 0', [gid], c);
    if (!pool.length) {
      // Nobody entered: cancel the schedule so it doesn't retry on every request.
      if (by === 'schedule') await q('UPDATE le_giveaways SET draw_at = NULL WHERE id = ?', [gid], c);
      return { ok: false, error: 'There are no eligible entries to draw from.' };
    }
    const winners = pickRandom(pool, Math.max(1, g.winners_count), g.unique_ip_winners);
    const prizes = splitPrizes(winners.length, g.budget, g.min_prize, g.split_mode);
    for (let i = 0; i < winners.length; i++) {
      await q('UPDATE le_entries SET win_rank = ?, prize = ? WHERE id = ?', [i + 1, prizes[i], winners[i].id], c);
    }
    await q('UPDATE le_giveaways SET status = "drawn", drawn_at = ?, drawn_by = ? WHERE id = ?', [now(), by, gid], c);
    return { ok: true, winners: winners.length };
  });
}

/** Swap a winner for a fresh random entrant who keeps the same rank and prize. */
async function replaceWinner(entryId) {
  return tx(async c => {
    const e = await one('SELECT * FROM le_entries WHERE id = ? FOR UPDATE', [entryId], c);
    if (!e || e.win_rank === null) return { ok: false, error: 'That entry is not a winner.' };
    const g = cast(await one('SELECT * FROM le_giveaways WHERE id = ? FOR UPDATE', [e.giveaway_id], c));
    const winnerIps = (await q('SELECT ip FROM le_entries WHERE giveaway_id = ? AND win_rank IS NOT NULL AND id <> ?', [g.id, entryId], c)).map(r => r.ip);
    const pool = await q('SELECT id, ip FROM le_entries WHERE giveaway_id = ? AND disqualified = 0 AND win_rank IS NULL AND id <> ?', [g.id, entryId], c);
    const pick = pickRandom(pool, 1, g.unique_ip_winners, winnerIps);
    if (!pick.length) return { ok: false, error: 'No other eligible entrant left to pick.' };
    await q('UPDATE le_entries SET win_rank = NULL, prize = NULL, disqualified = 1 WHERE id = ?', [entryId], c);
    await q('UPDATE le_entries SET win_rank = ?, prize = ? WHERE id = ?', [e.win_rank, e.prize, pick[0].id], c);
    return { ok: true, new_entry_id: pick[0].id };
  });
}

function maskUid(uid) {
  uid = String(uid);
  if (uid.length <= 4) return '•'.repeat(uid.length);
  return uid.slice(0, 2) + '•'.repeat(uid.length - 4) + uid.slice(-2);
}

/** Gmail ignores dots and "+tags": normalise so one inbox = one entry. */
function normalizeEmail(email) {
  email = String(email).trim().toLowerCase();
  let [local, domain = ''] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local + '@' + domain;
}

function publicGiveaway(g) {
  return {
    id: g.id, title: g.title, subtitle: g.subtitle, status: g.status, accepting: accepting(g),
    winners_count: g.winners_count, budget: g.budget, currency: g.currency, split_mode: g.split_mode,
    draw_at: g.draw_at, drawn_at: g.drawn_at,
  };
}

module.exports = { cast, currentGiveaway, accepting, runDueSchedule, splitPrizes, pickRandom, performDraw, replaceWinner, maskUid, normalizeEmail, publicGiveaway };
