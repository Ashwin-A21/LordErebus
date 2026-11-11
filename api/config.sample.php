<?php
/**
 * Copy this file to config.php and fill in your values.
 * config.php is git-ignored so your passwords never reach GitHub.
 */
return [
    // On Hostinger, PHP running on the same hosting account connects via "localhost".
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'your_database_name',
    'db_user' => 'your_database_user',
    'db_pass' => 'your_database_password',

    // Used ONLY by install.php to create the first admin login.
    // The password is stored as a bcrypt hash in the database (le_settings).
    // After installing you can remove this line and change the password from the admin panel.
    'admin_initial_password' => 'change-me',

    // Only accept @gmail.com addresses on the entry form.
    'gmail_only' => true,

    // Secret for the optional cron URL: /api/cron.php?key=...
    'cron_key' => 'put-a-long-random-string-here',

    // Hostinger serves sites through its CDN, so the visitor IP arrives in a header.
    // Set to false if your site is NOT behind a proxy/CDN.
    'trust_proxy_headers' => true,
];
