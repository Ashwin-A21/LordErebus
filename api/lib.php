<?php
declare(strict_types=1);

/**
 * Lord Erebus Giveaway — shared backend library.
 * Not reachable from the web (see api/.htaccess and the LE_APP guard).
 */
if (!defined('LE_APP')) { http_response_code(403); exit; }

date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

$LE_CFG_FILE = __DIR__ . '/config.php';
if (!is_file($LE_CFG_FILE)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Server not configured: api/config.php is missing.']);
    exit;
}
$GLOBALS['LE_CFG'] = require $LE_CFG_FILE;

function cfg(string $key, $default = null) {
    return $GLOBALS['LE_CFG'][$key] ?? $default;
}

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        cfg('db_host', 'localhost'), (int)cfg('db_port', 3306), cfg('db_name'));
    $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function setting_get(string $k, ?string $default = null): ?string {
    $v = q('SELECT v FROM le_settings WHERE k = ?', [$k])->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function setting_set(string $k, string $v): void {
    q('INSERT INTO le_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, $v]);
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */
function send_headers(): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
}

function json_out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400, array $extra = []): void {
    json_out(['ok' => false, 'error' => $msg] + $extra, $code);
}

function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input') ?: '';
    $j = json_decode($raw, true);
    $b = is_array($j) ? $j : $_POST;
    return $b;
}

function client_ip(): string {
    if (cfg('trust_proxy_headers', false)) {
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR'] as $h) {
            if (!empty($_SERVER[$h])) {
                $first = trim(explode(',', (string)$_SERVER[$h])[0]);
                if (filter_var($first, FILTER_VALIDATE_IP)) return $first;
            }
        }
    }
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Simple sliding-window rate limit. Returns true when the caller is over the limit. */
function rate_limited(string $bucket, int $max, int $windowSec): bool {
    $ip = client_ip();
    $now = time();
    if (random_int(1, 50) === 1) {
        q('DELETE FROM le_hits WHERE at < ?', [$now - 86400]);
    }
    $n = (int)q('SELECT COUNT(*) FROM le_hits WHERE bucket = ? AND ip = ? AND at > ?',
        [$bucket, $ip, $now - $windowSec])->fetchColumn();
    return $n >= $max;
}

function rate_hit(string $bucket): void {
    q('INSERT INTO le_hits (bucket, ip, at) VALUES (?, ?, ?)', [$bucket, client_ip(), time()]);
}

/* ------------------------------------------------------------------ */
/* Giveaway logic                                                      */
/* ------------------------------------------------------------------ */
function current_giveaway(): ?array {
    $g = q('SELECT * FROM le_giveaways ORDER BY id DESC LIMIT 1')->fetch();
    return $g ? cast_giveaway($g) : null;
}

function get_giveaway(int $id): ?array {
    $g = q('SELECT * FROM le_giveaways WHERE id = ?', [$id])->fetch();
    return $g ? cast_giveaway($g) : null;
}

function cast_giveaway(array $g): array {
    foreach (['id', 'winners_count', 'budget', 'min_prize', 'max_per_ip', 'created_at'] as $k) $g[$k] = (int)$g[$k];
    foreach (['draw_at', 'drawn_at'] as $k) $g[$k] = $g[$k] === null ? null : (int)$g[$k];
    $g['unique_ip_winners'] = (bool)$g['unique_ip_winners'];
    return $g;
}

function accepting_entries(array $g): bool {
    if ($g['status'] !== 'open') return false;
    if ($g['draw_at'] !== null && $g['draw_at'] <= time()) return false;
    return true;
}

/** Run the scheduled draw if its time has come. Safe to call on every request. */
function run_due_schedule(): void {
    $g = current_giveaway();
    if (!$g || $g['status'] === 'drawn' || $g['draw_at'] === null || $g['draw_at'] > time()) return;
    perform_draw($g['id'], 'schedule');
}

/**
 * Split a budget between $n winners. Returns prizes sorted high → low.
 * equal:  budget / n, remainder spread one unit at a time.
 * random: every winner gets at least $min, the rest is split by random weights.
 */
function split_prizes(int $n, int $budget, int $min, string $mode): array {
    if ($n <= 0) return [];
    if ($mode !== 'random') {
        $base = intdiv($budget, $n);
        $rem = $budget % $n;
        $out = [];
        for ($i = 0; $i < $n; $i++) $out[] = $base + ($i < $rem ? 1 : 0);
        return $out;
    }
    $min = min($min, intdiv($budget, $n));
    $rest = $budget - $min * $n;
    $w = [];
    for ($i = 0; $i < $n; $i++) $w[] = random_int(1, 1000);
    $sum = array_sum($w);
    $out = [];
    $given = 0;
    for ($i = 0; $i < $n; $i++) {
        $add = intdiv($rest * $w[$i], $sum);
        $out[] = $min + $add;
        $given += $add;
    }
    $left = $rest - $given;
    while ($left > 0) {
        $out[random_int(0, $n - 1)]++;
        $left--;
    }
    rsort($out);
    return $out;
}

/**
 * Pick up to $n random entries from $pool (rows with id, ip) using a CSPRNG.
 * When $uniqueIp is set, at most one winner per IP address. $takenIps are already-used IPs.
 */
function pick_random(array $pool, int $n, bool $uniqueIp, array $takenIps = []): array {
    // Fisher–Yates shuffle with random_int
    for ($i = count($pool) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$pool[$i], $pool[$j]] = [$pool[$j], $pool[$i]];
    }
    $picked = [];
    $seen = array_fill_keys($takenIps, true);
    foreach ($pool as $row) {
        if (count($picked) >= $n) break;
        if ($uniqueIp) {
            if (isset($seen[$row['ip']])) continue;
            $seen[$row['ip']] = true;
        }
        $picked[] = $row;
    }
    return $picked;
}

/** Draw winners for a giveaway. Atomic: concurrent calls cannot double-draw. */
function perform_draw(int $gid, string $by): array {
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $g = q('SELECT * FROM le_giveaways WHERE id = ? FOR UPDATE', [$gid])->fetch();
        if (!$g) { $pdo->rollBack(); return ['ok' => false, 'error' => 'Giveaway not found.']; }
        $g = cast_giveaway($g);
        if ($g['status'] === 'drawn') { $pdo->rollBack(); return ['ok' => false, 'error' => 'Winners were already drawn.']; }

        $pool = q('SELECT id, ip FROM le_entries WHERE giveaway_id = ? AND disqualified = 0', [$gid])->fetchAll();
        if (!$pool) {
            if ($by === 'schedule') {
                // Nobody entered: cancel the schedule so we do not retry on every request.
                q('UPDATE le_giveaways SET draw_at = NULL WHERE id = ?', [$gid]);
                $pdo->commit();
            } else {
                $pdo->rollBack();
            }
            return ['ok' => false, 'error' => 'There are no eligible entries to draw from.'];
        }

        $winners = pick_random($pool, max(1, $g['winners_count']), $g['unique_ip_winners']);
        $prizes = split_prizes(count($winners), $g['budget'], $g['min_prize'], $g['split_mode']);

        $up = $pdo->prepare('UPDATE le_entries SET win_rank = ?, prize = ? WHERE id = ?');
        foreach ($winners as $i => $w) $up->execute([$i + 1, $prizes[$i], $w['id']]);

        q('UPDATE le_giveaways SET status = "drawn", drawn_at = ?, drawn_by = ? WHERE id = ?', [time(), $by, $gid]);
        $pdo->commit();
        return ['ok' => true, 'winners' => count($winners)];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/** Replace one winner (e.g. fake account) with a fresh random entrant who keeps the same prize. */
function replace_winner(int $entryId): array {
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $e = q('SELECT * FROM le_entries WHERE id = ? FOR UPDATE', [$entryId])->fetch();
        if (!$e || $e['win_rank'] === null) { $pdo->rollBack(); return ['ok' => false, 'error' => 'That entry is not a winner.']; }
        $g = cast_giveaway(q('SELECT * FROM le_giveaways WHERE id = ? FOR UPDATE', [$e['giveaway_id']])->fetch());

        $winnerIps = q('SELECT ip FROM le_entries WHERE giveaway_id = ? AND win_rank IS NOT NULL AND id <> ?',
            [$g['id'], $entryId])->fetchAll(PDO::FETCH_COLUMN);
        $pool = q('SELECT id, ip FROM le_entries WHERE giveaway_id = ? AND disqualified = 0 AND win_rank IS NULL AND id <> ?',
            [$g['id'], $entryId])->fetchAll();
        $pick = pick_random($pool, 1, $g['unique_ip_winners'], $winnerIps);
        if (!$pick) { $pdo->rollBack(); return ['ok' => false, 'error' => 'No other eligible entrant left to pick.']; }

        q('UPDATE le_entries SET win_rank = NULL, prize = NULL, disqualified = 1 WHERE id = ?', [$entryId]);
        q('UPDATE le_entries SET win_rank = ?, prize = ? WHERE id = ?', [$e['win_rank'], $e['prize'], $pick[0]['id']]);
        $pdo->commit();
        return ['ok' => true, 'new_entry_id' => (int)$pick[0]['id']];
    } catch (Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $ex;
    }
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
function mask_uid(string $uid): string {
    $len = strlen($uid);
    if ($len <= 4) return str_repeat('•', $len);
    return substr($uid, 0, 2) . str_repeat('•', $len - 4) . substr($uid, -2);
}

/** Gmail ignores dots and anything after "+", so normalise to stop duplicate entries. */
function normalize_email(string $email): string {
    $email = strtolower(trim($email));
    [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');
    if ($domain === 'gmail.com' || $domain === 'googlemail.com') {
        $local = str_replace('.', '', explode('+', $local)[0]);
        $domain = 'gmail.com';
    }
    return $local . '@' . $domain;
}

function public_giveaway(array $g): array {
    return [
        'id' => $g['id'],
        'title' => $g['title'],
        'subtitle' => $g['subtitle'],
        'status' => $g['status'],
        'accepting' => accepting_entries($g),
        'winners_count' => $g['winners_count'],
        'budget' => $g['budget'],
        'currency' => $g['currency'],
        'split_mode' => $g['split_mode'],
        'draw_at' => $g['draw_at'],
        'drawn_at' => $g['drawn_at'],
    ];
}
