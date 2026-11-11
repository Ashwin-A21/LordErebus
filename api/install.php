<?php
declare(strict_types=1);
/**
 * One-time installer. Open https://your-site/api/install.php once.
 * Creates the tables (prefixed le_) and the admin login, then locks itself.
 * Safe to re-run: it never overwrites data or an existing admin password.
 */
define('LE_APP', 1);
require __DIR__ . '/lib.php';
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$schema = [
"CREATE TABLE IF NOT EXISTS le_settings (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

"CREATE TABLE IF NOT EXISTS le_giveaways (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

"CREATE TABLE IF NOT EXISTS le_entries (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

"CREATE TABLE IF NOT EXISTS le_hits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bucket VARCHAR(20) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  at INT UNSIGNED NOT NULL,
  KEY k_lookup (bucket, ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
];

try {
    foreach ($schema as $sql) db()->exec($sql);
    echo "✓ Tables ready (le_settings, le_giveaways, le_entries, le_hits)\n";

    if (!current_giveaway()) {
        q('INSERT INTO le_giveaways (title, subtitle, created_at) VALUES (?, ?, ?)', [
            'Lord Erebus Giveaway',
            'Drop your Free Fire UID and get a shot at the prize pool.',
            time(),
        ]);
        echo "✓ First giveaway created (entries are closed until you open them in the admin panel)\n";
    }

    if (setting_get('admin_password_hash') === null) {
        $pw = (string)cfg('admin_initial_password', '');
        if (strlen($pw) < 8) {
            echo "✗ Set 'admin_initial_password' (8+ characters) in api/config.php, then reload this page.\n";
            exit;
        }
        setting_set('admin_password_hash', password_hash($pw, PASSWORD_DEFAULT));
        echo "✓ Admin password saved to the database as a secure hash.\n";
    } else {
        echo "• Admin password already set — left unchanged.\n";
    }

    echo "\nAll done. Open /admin.html to sign in.\n";
    echo "For safety, delete api/install.php from the server now (or leave it: it cannot change an existing password).\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "✗ Install failed: " . $e->getMessage() . "\n";
    echo "Check db_host / db_name / db_user / db_pass in api/config.php.\n";
}
