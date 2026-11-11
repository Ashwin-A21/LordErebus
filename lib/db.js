'use strict';
/**
 * MySQL connection (Hostinger remote MySQL) + schema bootstrap.
 * Credentials come from Vercel environment variables, never from the repo.
 */
const mysql = require('mysql2/promise');

const SCHEMA_VERSION = '1';

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS le_settings (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS le_giveaways (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  subtitle VARCHAR(255) NOT NULL DEFAULT '',
  status ENUM('open','paused','drawn') NOT NULL DEFAULT 'paused',
  winners_count INT UNSIGNED NOT NULL DEFAULT 5,
  budget INT UNSIGNED NOT NULL DEFAULT 1000,
  min_prize INT UNSIGNED NOT NULL DEFAULT 0,
  split_mode ENUM('equal','random') NOT NULL DEFAULT 'equal',
  currency VARCHAR(8) NOT NULL DEFAULT '₹',
  max_per_ip INT UNSIGNED NOT NULL DEFAULT 0,
  unique_ip_winners TINYINT(1) NOT NULL DEFAULT 1,
  draw_at INT UNSIGNED NULL,
  drawn_at INT UNSIGNED NULL,
  drawn_by VARCHAR(20) NULL,
  created_at INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS le_entries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  giveaway_id INT UNSIGNED NOT NULL,
  game_uid VARCHAR(20) NOT NULL,
  game_name VARCHAR(40) NOT NULL,
  email VARCHAR(190) NOT NULL,
  email_norm VARCHAR(190) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  remote_addr VARCHAR(45) NOT NULL,
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  created_at INT UNSIGNED NOT NULL,
  disqualified TINYINT(1) NOT NULL DEFAULT 0,
  win_rank INT UNSIGNED NULL,
  prize INT UNSIGNED NULL,
  UNIQUE KEY uq_uid (giveaway_id, game_uid),
  UNIQUE KEY uq_email (giveaway_id, email_norm),
  KEY k_ip (giveaway_id, ip),
  KEY k_win (giveaway_id, win_rank),
  CONSTRAINT fk_entries_giveaway FOREIGN KEY (giveaway_id) REFERENCES le_giveaways(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS le_hits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bucket VARCHAR(20) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  at INT UNSIGNED NOT NULL,
  KEY k_lookup (bucket, ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

// Reuse one small pool per warm serverless instance.
function pool() {
  if (!global.__lePool) {
    const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'].filter(k => !env(k));
    if (missing.length) {
      const e = new Error('Server not configured: missing environment variables ' + missing.join(', '));
      e.status = 500; e.expose = true;
      throw e;
    }
    global.__lePool = mysql.createPool({
      host: env('DB_HOST'),
      port: Number(env('DB_PORT', 3306)),
      database: env('DB_NAME'),
      user: env('DB_USER'),
      password: env('DB_PASS'),
      charset: 'utf8mb4',
      timezone: 'Z',
      connectionLimit: 3,
      maxIdle: 3,
      idleTimeout: 20000,
      enableKeepAlive: true,
      connectTimeout: 10000,
      ssl: env('DB_SSL') === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return global.__lePool;
}

/** Run a query. `conn` lets transactions reuse their connection. */
async function q(sql, params = [], conn) {
  const [rows] = await (conn || pool()).query(sql, params);
  return rows;
}
async function one(sql, params, conn) { return (await q(sql, params, conn))[0] || null; }
async function scalar(sql, params, conn) {
  const r = await one(sql, params, conn);
  return r ? Object.values(r)[0] : null;
}

async function tx(fn) {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function settingGet(k, conn) {
  const v = await scalar('SELECT v FROM le_settings WHERE k = ?', [k], conn);
  return v === null ? null : String(v);
}
async function settingSet(k, v, conn) {
  await q('INSERT INTO le_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, v], conn);
}

/**
 * Creates tables, the first giveaway and the admin password on first run.
 * Checked once per warm instance (one cheap SELECT).
 */
async function ensureSchema() {
  if (global.__leSchemaOk) return;
  let ver = null;
  try { ver = await settingGet('schema_version'); } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  if (ver !== SCHEMA_VERSION) {
    // Several serverless instances can cold-start at once: a named lock makes setup run only once.
    const conn = await pool().getConnection();
    try {
      await q("SELECT GET_LOCK('le_schema_setup', 15)", [], conn);
      for (const sql of SCHEMA) await q(sql, [], conn);
      const has = await scalar('SELECT COUNT(*) FROM le_giveaways', [], conn);
      if (!Number(has)) {
        await q('INSERT INTO le_giveaways (title, subtitle, created_at) VALUES (?, ?, ?)',
          ['Lord Erebus Giveaway', 'Drop your Free Fire UID and get a shot at the prize pool.', Math.floor(Date.now() / 1000)], conn);
      }
      await settingSet('schema_version', SCHEMA_VERSION, conn);
    } finally {
      try { await q("SELECT RELEASE_LOCK('le_schema_setup')", [], conn); } catch (_) {}
      conn.release();
    }
  }
  if (!(await settingGet('admin_password_hash'))) {
    const pw = env('ADMIN_INITIAL_PASSWORD', '');
    if (pw.length >= 8) {
      const bcrypt = require('bcryptjs');
      await settingSet('admin_password_hash', await bcrypt.hash(pw, 10));
    }
  }
  global.__leSchemaOk = true;
}

module.exports = { q, one, scalar, tx, settingGet, settingSet, ensureSchema, env };
