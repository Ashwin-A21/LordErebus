<?php
declare(strict_types=1);
/**
 * Admin API — every action except `me` and `login` needs a signed-in session,
 * and every POST needs the X-CSRF header returned by `me` / `login`.
 */
define('LE_APP', 1);
require __DIR__ . '/lib.php';

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('le_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

const SESSION_TTL = 12 * 3600;

function authed(): bool {
    if (empty($_SESSION['admin']) || empty($_SESSION['at'])) return false;
    if (time() - (int)$_SESSION['at'] > SESSION_TTL) { $_SESSION = []; return false; }
    return true;
}
function csrf(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return $_SESSION['csrf'];
}
function require_auth(): void {
    if (!authed()) fail('Please sign in.', 401);
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $sent = (string)($_SERVER['HTTP_X_CSRF'] ?? '');
        if (!hash_equals(csrf(), $sent)) fail('Session expired. Reload the page.', 403);
    }
}
function int_in($v, int $min, int $max, string $label): int {
    if (!is_numeric($v) || (int)$v != $v) fail("$label must be a whole number.", 422);
    $v = (int)$v;
    if ($v < $min || $v > $max) fail("$label must be between $min and $max.", 422);
    return $v;
}
function admin_giveaway(array $g): array {
    $id = $g['id'];
    $stats = q('SELECT COUNT(*) total,
                       SUM(disqualified = 0) eligible,
                       SUM(disqualified = 1) dq,
                       COUNT(DISTINCT ip) ips,
                       SUM(created_at > ?) last_hour
                FROM le_entries WHERE giveaway_id = ?', [time() - 3600, $id])->fetch();
    $shared = q('SELECT COUNT(*) ips, COALESCE(SUM(n), 0) entries FROM
                   (SELECT COUNT(*) n FROM le_entries WHERE giveaway_id = ? GROUP BY ip HAVING n > 1) t', [$id])->fetch();
    $stats['shared_ips'] = $shared['ips'];
    $stats['shared_ip_entries'] = $shared['entries'];
    $winners = q('SELECT id, game_uid, game_name, email, ip, win_rank, prize, created_at
                  FROM le_entries WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank', [$id])->fetchAll();
    return [
        'giveaway' => $g + ['accepting' => accepting_entries($g)],
        'stats' => array_map('intval', $stats),
        'winners' => $winners,
    ];
}

send_headers();

try {
    run_due_schedule();
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'];

    /* ---------------- auth ---------------- */
    if ($action === 'me') {
        json_out(['ok' => true, 'authed' => authed(), 'csrf' => authed() ? csrf() : null]);
    }

    if ($action === 'login' && $method === 'POST') {
        if (rate_limited('login', 8, 900)) fail('Too many failed attempts. Try again in 15 minutes.', 429);
        $pw = (string)(body()['password'] ?? '');
        $hash = setting_get('admin_password_hash');
        if ($hash === null) fail('Admin is not set up yet. Open /api/install.php first.', 503);
        if (!password_verify($pw, $hash)) {
            rate_hit('login');
            usleep(400000);
            fail('Wrong password.', 401);
        }
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) setting_set('admin_password_hash', password_hash($pw, PASSWORD_DEFAULT));
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['at'] = time();
        unset($_SESSION['csrf']);
        json_out(['ok' => true, 'csrf' => csrf()]);
    }

    require_auth();

    if ($action === 'logout' && $method === 'POST') {
        $_SESSION = [];
        session_destroy();
        json_out(['ok' => true]);
    }

    $g = current_giveaway();
    if (!$g) fail('No giveaway found. Run /api/install.php.', 500);

    /* ---------------- read ---------------- */
    if ($action === 'state' && $method === 'GET') {
        json_out(['ok' => true, 'server_time' => time()] + admin_giveaway($g));
    }

    if ($action === 'entries' && $method === 'GET') {
        $gid = isset($_GET['giveaway']) ? (int)$_GET['giveaway'] : $g['id'];
        $search = trim((string)($_GET['q'] ?? ''));
        $filter = (string)($_GET['filter'] ?? 'all');
        $page = max(1, (int)($_GET['page'] ?? 1));
        $per = 50;

        $where = ['e.giveaway_id = ?'];
        $args = [$gid];
        if ($search !== '') {
            $where[] = '(e.game_uid LIKE ? OR e.game_name LIKE ? OR e.email LIKE ? OR e.ip LIKE ?)';
            $like = '%' . addcslashes($search, '%_\\') . '%';
            array_push($args, $like, $like, $like, $like);
        }
        if ($filter === 'winners') $where[] = 'e.win_rank IS NOT NULL';
        if ($filter === 'dq') $where[] = 'e.disqualified = 1';
        if ($filter === 'shared_ip') $where[] = 'ipc.n > 1';

        $from = 'FROM le_entries e
                 JOIN (SELECT ip, COUNT(*) n FROM le_entries WHERE giveaway_id = ? GROUP BY ip) ipc ON ipc.ip = e.ip
                 WHERE ' . implode(' AND ', $where);
        $allArgs = array_merge([$gid], $args);
        $total = (int)q("SELECT COUNT(*) $from", $allArgs)->fetchColumn();
        $offset = ($page - 1) * $per;
        // Group same-IP entries together so multi-account players are easy to spot
        $order = $filter === 'shared_ip' ? 'ipc.n DESC, e.ip, e.id DESC' : 'e.id DESC';
        $rows = q("SELECT e.id, e.game_uid, e.game_name, e.email, e.ip, e.user_agent, e.created_at,
                          e.disqualified, e.win_rank, e.prize, ipc.n AS ip_count
                   $from ORDER BY $order LIMIT $per OFFSET $offset", $allArgs)->fetchAll();
        json_out(['ok' => true, 'rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int)ceil($total / $per))]);
    }

    if ($action === 'export' && $method === 'GET') {
        $gid = isset($_GET['giveaway']) ? (int)$_GET['giveaway'] : $g['id'];
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="giveaway-' . $gid . '-entries.csv"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF"); // Excel-friendly UTF-8
        fputcsv($out, ['id', 'game_uid', 'game_name', 'email', 'ip', 'entered_at_utc', 'disqualified', 'winner_rank', 'prize', 'user_agent']);
        $st = q('SELECT * FROM le_entries WHERE giveaway_id = ? ORDER BY id', [$gid]);
        while ($r = $st->fetch()) {
            // Prefix cells that spreadsheets would treat as formulas
            $safe = fn($v) => preg_match('/^[=+\-@]/', (string)$v) ? "'" . $v : $v;
            fputcsv($out, [$r['id'], $r['game_uid'], $safe($r['game_name']), $safe($r['email']), $r['ip'],
                gmdate('Y-m-d H:i:s', (int)$r['created_at']), $r['disqualified'], $r['win_rank'], $r['prize'], $safe($r['user_agent'])]);
        }
        fclose($out);
        exit;
    }

    if ($action === 'history' && $method === 'GET') {
        $rows = q('SELECT g.id, g.title, g.status, g.winners_count, g.budget, g.currency, g.drawn_at, g.drawn_by, g.created_at,
                          (SELECT COUNT(*) FROM le_entries e WHERE e.giveaway_id = g.id) entries,
                          (SELECT COUNT(*) FROM le_entries e WHERE e.giveaway_id = g.id AND e.win_rank IS NOT NULL) winners,
                          (SELECT COALESCE(SUM(prize),0) FROM le_entries e WHERE e.giveaway_id = g.id) paid
                   FROM le_giveaways g ORDER BY g.id DESC LIMIT 100')->fetchAll();
        json_out(['ok' => true, 'rows' => $rows]);
    }

    if ($action === 'winners' && $method === 'GET') {
        $gid = (int)($_GET['giveaway'] ?? 0);
        $rows = q('SELECT id, game_uid, game_name, email, ip, win_rank, prize FROM le_entries
                   WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank', [$gid])->fetchAll();
        json_out(['ok' => true, 'rows' => $rows]);
    }

    /* ---------------- write ---------------- */
    if ($method !== 'POST') fail('Unknown action.', 404);
    $b = body();

    switch ($action) {
        case 'save_config': {
            $title = trim((string)($b['title'] ?? ''));
            $subtitle = trim((string)($b['subtitle'] ?? ''));
            if ($title === '' || mb_strlen($title) > 120) fail('Title is required (max 120 characters).', 422);
            if (mb_strlen($subtitle) > 255) fail('Subtitle is too long.', 422);
            if ($g['status'] === 'drawn') {
                q('UPDATE le_giveaways SET title = ?, subtitle = ? WHERE id = ?', [$title, $subtitle, $g['id']]);
                json_out(['ok' => true, 'note' => 'Winners are drawn, so only the title and subtitle were updated.']);
            }
            $winners = int_in($b['winners_count'] ?? null, 1, 1000, 'Number of winners');
            $budget = int_in($b['budget'] ?? null, 0, 100000000, 'Budget');
            $minPrize = int_in($b['min_prize'] ?? 0, 0, 100000000, 'Minimum prize');
            $mode = ($b['split_mode'] ?? 'equal') === 'random' ? 'random' : 'equal';
            if ($mode === 'random' && $minPrize * $winners > $budget) {
                fail("Budget is too small: $winners winners × minimum $minPrize = " . ($minPrize * $winners) . '.', 422);
            }
            $currency = trim((string)($b['currency'] ?? '₹'));
            if ($currency === '' || mb_strlen($currency) > 8) fail('Currency must be 1–8 characters.', 422);
            $maxIp = int_in($b['max_per_ip'] ?? 0, 0, 1000, 'Entries per IP');
            $uniqueIp = !empty($b['unique_ip_winners']) ? 1 : 0;
            q('UPDATE le_giveaways SET title=?, subtitle=?, winners_count=?, budget=?, min_prize=?, split_mode=?, currency=?,
                 max_per_ip=?, unique_ip_winners=? WHERE id=?',
                [$title, $subtitle, $winners, $budget, $minPrize, $mode, $currency, $maxIp, $uniqueIp, $g['id']]);
            json_out(['ok' => true]);
        }

        case 'set_status': {
            if ($g['status'] === 'drawn') fail('This giveaway is finished. Start a new one.', 409);
            $status = ($b['status'] ?? '') === 'open' ? 'open' : 'paused';
            q('UPDATE le_giveaways SET status = ? WHERE id = ?', [$status, $g['id']]);
            json_out(['ok' => true]);
        }

        case 'schedule': {
            if ($g['status'] === 'drawn') fail('This giveaway is finished. Start a new one.', 409);
            if (($b['draw_at'] ?? null) === null) {
                q('UPDATE le_giveaways SET draw_at = NULL WHERE id = ?', [$g['id']]);
                json_out(['ok' => true]);
            }
            $at = int_in($b['draw_at'], time() + 30, time() + 366 * 86400, 'Draw time');
            q('UPDATE le_giveaways SET draw_at = ?, status = "open" WHERE id = ?', [$at, $g['id']]);
            json_out(['ok' => true]);
        }

        case 'draw_now': {
            $r = perform_draw($g['id'], 'admin');
            if (!$r['ok']) fail($r['error'], 409);
            json_out($r);
        }

        case 'replace_winner': {
            $r = replace_winner((int)($b['entry_id'] ?? 0));
            if (!$r['ok']) fail($r['error'], 409);
            json_out($r);
        }

        case 'toggle_dq': {
            $id = (int)($b['entry_id'] ?? 0);
            $e = q('SELECT win_rank FROM le_entries WHERE id = ?', [$id])->fetch();
            if (!$e) fail('Entry not found.', 404);
            if ($e['win_rank'] !== null) fail('This entry is a winner. Use "Replace" on the Draw tab instead.', 409);
            q('UPDATE le_entries SET disqualified = 1 - disqualified WHERE id = ?', [$id]);
            json_out(['ok' => true]);
        }

        case 'delete_entry': {
            $id = (int)($b['entry_id'] ?? 0);
            $e = q('SELECT win_rank FROM le_entries WHERE id = ?', [$id])->fetch();
            if (!$e) fail('Entry not found.', 404);
            if ($e['win_rank'] !== null) fail('Winners cannot be deleted. Use "Replace" instead.', 409);
            q('DELETE FROM le_entries WHERE id = ?', [$id]);
            json_out(['ok' => true]);
        }

        case 'new_giveaway': {
            if ($g['status'] !== 'drawn' && empty($b['force'])) {
                fail('The current giveaway has not been drawn yet.', 409, ['needs_force' => true]);
            }
            $title = trim((string)($b['title'] ?? '')) ?: $g['title'];
            q('INSERT INTO le_giveaways (title, subtitle, status, winners_count, budget, min_prize, split_mode, currency,
                 max_per_ip, unique_ip_winners, created_at) VALUES (?, ?, "paused", ?, ?, ?, ?, ?, ?, ?, ?)',
                [mb_substr($title, 0, 120), $g['subtitle'], $g['winners_count'], $g['budget'], $g['min_prize'],
                 $g['split_mode'], $g['currency'], $g['max_per_ip'], $g['unique_ip_winners'] ? 1 : 0, time()]);
            // Close the old one if it was still running
            if ($g['status'] !== 'drawn') q('UPDATE le_giveaways SET status = "paused", draw_at = NULL WHERE id = ?', [$g['id']]);
            json_out(['ok' => true]);
        }

        case 'change_password': {
            $cur = (string)($b['current'] ?? '');
            $next = (string)($b['next'] ?? '');
            if (!password_verify($cur, (string)setting_get('admin_password_hash'))) fail('Current password is wrong.', 401);
            if (strlen($next) < 8) fail('New password must be at least 8 characters.', 422);
            setting_set('admin_password_hash', password_hash($next, PASSWORD_DEFAULT));
            json_out(['ok' => true]);
        }
    }

    fail('Unknown action.', 404);
} catch (Throwable $e) {
    error_log('[lord-erebus admin] ' . $e->getMessage());
    fail('Server error: ' . $e->getMessage(), 500);
}
