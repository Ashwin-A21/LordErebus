# Lord Erebus — Free Fire Giveaway

A giveaway site for **Vercel**: static pages plus Node.js serverless functions, storing data in a **MySQL** database (Hostinger).

- **Public site** (`/`): full-screen Free Fire hero and an entry form (game UID, in-game name, Gmail). It shows a live countdown, and the wheel spins on its own when winners are drawn.
- **Admin panel** (`/admin`): open or close entries, set the number of winners and the budget (equal or random split), and start the draw now or schedule it. You can also see every entry with its IP, flag entries that share an IP, replace a winner, export CSV and browse past giveaways.

## Project layout

```
index.html, admin.html, assets/   static site
api/public.js                     entry form + live state      → /api/public
api/admin.js                      admin panel API               → /api/admin
api/cron.js                       optional scheduled-draw ping  → /api/cron
lib/                              shared code (DB, auth, draw logic)
scripts/dev-server.js             local preview: npm run dev
```

## Deploy

### 1. Allow Vercel to reach your Hostinger database

hPanel → **Databases → Remote MySQL**:
- Pick your giveaway database.
- For the host, enter `%` (any host). Vercel has no fixed IP address, so you can't allow a single one.
- Note the **MySQL host name / IP** shown on that page. That is your `DB_HOST`.

### 2. Import the repo into Vercel

vercel.com → **Add New → Project** → import this GitHub repo. Set Framework Preset to **Other**. Leave the build and output settings empty.

### 3. Add environment variables

In Vercel → Project → **Settings → Environment Variables**, add the variables from `.env.example`:

| Variable | Value |
|---|---|
| `DB_HOST` | the Remote MySQL host from step 1 |
| `DB_PORT` | `3306` |
| `DB_NAME` | your database name |
| `DB_USER` | your database user |
| `DB_PASS` | your database password |
| `ADMIN_INITIAL_PASSWORD` | the first admin password (8+ characters) |
| `SESSION_SECRET` | a long random string |
| `CRON_SECRET` | another long random string |

Then **Redeploy**. On the first request, the app creates its tables (all named `le_…`) and saves the admin password as a bcrypt hash in the database. After that, change the password from Admin → Settings.

**Tip:** Settings → Functions → Function Region. Pick the region closest to your database server, for example Mumbai (`bom1`) if your Hostinger server is in India. Every API call talks to the database, so a nearby region makes the site faster.

### 4. Scheduled draws (optional cron)

Scheduled draws already run automatically whenever anyone has the site open, because the page polls every few seconds. To make sure a draw runs on time even if nobody is visiting, create a free job at [cron-job.org](https://cron-job.org) that runs every minute and opens:

```
https://YOUR-SITE.vercel.app/api/cron?key=YOUR_CRON_SECRET
```

## Local preview

```bash
npm install
cp .env.example .env    # fill in the values
npm run dev             # http://localhost:3000
```

## How the draw works

- Winners are picked on the server with a cryptographically secure shuffle (`crypto.randomInt`), in a database transaction, so a giveaway can never be drawn twice.
- **Equal split:** the budget ÷ number of winners.
- **Random split:** every winner gets at least the minimum, and the amounts add up exactly to the budget. #1 gets the most.
- **One winner per IP** (on by default) stops one person from winning with several accounts.

## Anti-abuse

- One entry per UID and one per Gmail. Gmail dots and `+tags` are normalised, so `a.b+x@gmail.com` counts as `ab@gmail.com`.
- A hidden honeypot field catches bots, and each IP is rate-limited.
- Every entry stores its IP and device. Admin → Entries → **Shared IP** groups entries that came from the same IP.
- The optional "max entries per IP" limit is off by default. Mobile networks like Jio share one IP across many real users, so a strict limit can block genuine players.
- Admin sessions use signed httpOnly, SameSite=Strict cookies, and every change needs a CSRF token. Admin login allows 8 failed attempts per 15 minutes. Changing the password signs out every other session.
