<?php
declare(strict_types=1);
/**
 * Public API
 *   GET  api/public.php?action=state[&uid=123]   live giveaway state (polled by the site)
 *   POST api/public.php?action=enter             {game_uid, game_name, email, website(honeypot)}
 */
define('LE_APP', 1);
require __DIR__ . '/lib.php';
send_headers();

try {
    run_due_schedule();
    $action = $_GET['action'] ?? 'state';

    if ($action === 'state' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $g = current_giveaway();
        if (!$g) json_out(['ok' => true, 'giveaway' => null, 'server_time' => time()]);

        $entries = (int)q('SELECT COUNT(*) FROM le_entries WHERE giveaway_id = ? AND disqualified = 0', [$g['id']])->fetchColumn();

        $winners = [];
        if ($g['status'] === 'drawn') {
            foreach (q('SELECT id, game_uid, game_name, win_rank, prize FROM le_entries
                        WHERE giveaway_id = ? AND win_rank IS NOT NULL ORDER BY win_rank', [$g['id']]) as $w) {
                $winners[] = [
                    'rank' => (int)$w['win_rank'],
                    'name' => $w['game_name'],
                    'uid' => mask_uid($w['game_uid']),
                    'prize' => (int)$w['prize'],
                    '_id' => (int)$w['id'],
                ];
            }
        }

        // Wheel segments: winners (if drawn) plus the most recent entrants, up to 24.
        $seg = [];
        foreach ($winners as $w) $seg[$w['_id']] = ['name' => $w['name'], 'rank' => $w['rank']];
        $fill = q('SELECT id, game_name FROM le_entries WHERE giveaway_id = ? AND disqualified = 0 AND win_rank IS NULL
                   ORDER BY id DESC LIMIT 24', [$g['id']])->fetchAll();
        foreach ($fill as $f) {
            if (count($seg) >= max(24, count($winners))) break;
            $seg[(int)$f['id']] = ['name' => $f['game_name'], 'rank' => null];
        }
        ksort($seg);
        foreach ($winners as &$w) unset($w['_id']);
        unset($w);

        $me = null;
        $uid = preg_replace('/\D/', '', (string)($_GET['uid'] ?? ''));
        if ($uid !== '') {
            $row = q('SELECT win_rank, prize, disqualified FROM le_entries WHERE giveaway_id = ? AND game_uid = ?', [$g['id'], $uid])->fetch();
            $me = $row ? [
                'entered' => true,
                'won' => $row['win_rank'] !== null,
                'rank' => $row['win_rank'] === null ? null : (int)$row['win_rank'],
                'prize' => $row['prize'] === null ? null : (int)$row['prize'],
            ] : ['entered' => false];
        }

        json_out([
            'ok' => true,
            'server_time' => time(),
            'giveaway' => public_giveaway($g),
            'entries' => $entries,
            'winners' => $winners,
            'wheel' => array_values($seg),
            'me' => $me,
        ]);
    }

    if ($action === 'enter' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $b = body();
        if (trim((string)($b['website'] ?? '')) !== '') fail('Entry rejected.'); // bot honeypot

        if (rate_limited('enter', 20, 600)) fail('Too many attempts from your network. Please wait a few minutes.', 429);
        rate_hit('enter');

        $g = current_giveaway();
        if (!$g || !accepting_entries($g)) fail('Entries are closed right now.');

        $uid = trim((string)($b['game_uid'] ?? ''));
        $name = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($b['game_name'] ?? '')));
        $email = strtolower(trim((string)($b['email'] ?? '')));

        $errors = [];
        if (!preg_match('/^\d{5,15}$/', $uid)) $errors['game_uid'] = 'Game UID must be 5–15 digits, numbers only.';
        $nameLen = mb_strlen($name);
        if ($nameLen < 1 || $nameLen > 40) $errors['game_name'] = 'Enter your in-game name (max 40 characters).';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            $errors['email'] = 'Enter a valid email address.';
        } elseif (cfg('gmail_only', true) && !preg_match('/@(gmail|googlemail)\.com$/', $email)) {
            $errors['email'] = 'Please use your Gmail address (@gmail.com).';
        }
        if ($errors) fail('Please fix the highlighted fields.', 422, ['fields' => $errors]);

        $norm = normalize_email($email);
        $ip = client_ip();

        if (q('SELECT 1 FROM le_entries WHERE giveaway_id = ? AND game_uid = ?', [$g['id'], $uid])->fetchColumn()) {
            fail('This Game UID is already entered. Good luck!', 409, ['fields' => ['game_uid' => 'Already entered.']]);
        }
        if (q('SELECT 1 FROM le_entries WHERE giveaway_id = ? AND email_norm = ?', [$g['id'], $norm])->fetchColumn()) {
            fail('This Gmail is already used for an entry.', 409, ['fields' => ['email' => 'Already used.']]);
        }
        if ($g['max_per_ip'] > 0) {
            $n = (int)q('SELECT COUNT(*) FROM le_entries WHERE giveaway_id = ? AND ip = ?', [$g['id'], $ip])->fetchColumn();
            if ($n >= $g['max_per_ip']) fail('Entry limit reached for your network/device.', 429);
        }

        try {
            q('INSERT INTO le_entries (giveaway_id, game_uid, game_name, email, email_norm, ip, remote_addr, user_agent, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                $g['id'], $uid, $name, $email, $norm, $ip,
                (string)($_SERVER['REMOTE_ADDR'] ?? ''),
                mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                time(),
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') fail('You are already entered in this giveaway.', 409);
            throw $e;
        }
        json_out(['ok' => true, 'message' => "You're in! Winners are announced on this page."]);
    }

    fail('Unknown action.', 404);
} catch (Throwable $e) {
    error_log('[lord-erebus] ' . $e->getMessage());
    fail('Server error. Please try again in a moment.', 500);
}
