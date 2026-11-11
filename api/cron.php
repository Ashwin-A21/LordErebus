<?php
declare(strict_types=1);
/**
 * Optional. Scheduled draws already run automatically whenever anyone has the site open,
 * but a cron job guarantees the draw happens on time even if nobody is visiting.
 *
 * Hostinger hPanel → Advanced → Cron Jobs → every minute:
 *   /usr/bin/php /home/USER/domains/YOUR-DOMAIN/public_html/api/cron.php
 * or by URL: https://YOUR-DOMAIN/api/cron.php?key=YOUR_CRON_KEY
 */
define('LE_APP', 1);
require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    $key = (string)cfg('cron_key', '');
    if ($key === '' || !hash_equals($key, (string)($_GET['key'] ?? ''))) {
        http_response_code(403);
        exit('forbidden');
    }
}
run_due_schedule();
echo "ok\n";
