# Lord Erebus — Free Fire Giveaway

A giveaway site with a PHP + MySQL backend, built for Hostinger shared hosting.

- **Public site** (`index.html`): full-screen hero and an entry form (Free Fire UID, in-game name, Gmail). It shows a live countdown, and the wheel spins on its own when winners are drawn.
- **Admin panel** (`admin.html`): open or close entries, set the number of winners and the budget (equal or random split), and start the draw now or schedule it. You can also see every entry with its IP, flag entries that share an IP, replace a winner, export CSV and browse past giveaways.

## What gets stored

Table `le_entries` stores the game UID, in-game name, Gmail, IP address, device (user agent), the time of entry, and the winner rank and prize. All tables start with `le_`, so they won't clash with anything else in the database.

The admin password is stored as a bcrypt hash in `le_settings`, not in any file.

## Deploy to Hostinger

1. Upload these files to `public_html` (File Manager or Git):
   `index.html`, `admin.html`, `assets/`, `api/`
2. Create `api/config.php` by copying `api/config.sample.php`. Fill in the database name, user and password. Keep `db_host` as `localhost`. Set `admin_initial_password` too.
   (`config.php` is git-ignored, so passwords never reach GitHub.)
3. Open `https://YOUR-DOMAIN/api/install.php` once. It creates the tables and saves the admin password hash.
4. Delete `api/install.php` from the server (optional but recommended). Then remove `admin_initial_password` from `config.php`.
5. Go to `https://YOUR-DOMAIN/admin.html`, sign in, set the winners and budget, and click **Open entries**.

### Scheduled draws

Scheduled draws run automatically when anyone has the site open. To make sure a draw runs on time even if nobody is visiting, add a cron job in hPanel → Advanced → Cron Jobs, running every minute:

```
/usr/bin/php /home/USER/domains/YOUR-DOMAIN/public_html/api/cron.php
```

## How the draw works

- Winners are picked on the server with a cryptographically secure shuffle (`random_int`), in a database transaction, so a giveaway can never be drawn twice.
- **Equal split:** the budget ÷ number of winners.
- **Random split:** every winner gets at least the minimum, and the amounts add up exactly to the budget. #1 gets the most.
- **One winner per IP** (on by default) stops one person from winning with several accounts.
- If there are fewer eligible entries than winners, everyone eligible wins.

## Anti-abuse

- One entry per UID and one per Gmail. Gmail dots and `+tags` are normalised, so `a.b+x@gmail.com` counts as `ab@gmail.com`.
- A hidden honeypot field catches bots, and each IP is rate-limited.
- The optional "max entries per IP" limit is off by default. Mobile networks like Jio share one IP across many real users, so a strict limit can block genuine players. Shared IPs are always flagged in Admin → Entries.
- Admin login allows 8 failed attempts per 15 minutes. Sessions use httpOnly, SameSite=Strict cookies, and every change needs a CSRF token.
