# Lord Erebus ⚡ Lucky Wheel (Single File + In-Browser SQLite)

A modern, standalone giveaway wheel web application with a **local SQLite database running directly in the browser via WebAssembly (sql.js)** and persistent **IndexedDB** storage.

Designed for instant zero-configuration deployment to **Vercel**, **GitHub Pages**, **Netlify**, or any static host.

---

## 🚀 Instant Vercel Deployment

1. **Via Vercel CLI**:
   ```bash
   npx vercel
   ```
2. **Via Vercel Web Dashboard**:
   - Push this folder to a GitHub repository.
   - Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
   - Import the repository and click **"Deploy"** (no build command or framework configuration required).

---

## 🔑 Default Credentials

- **Admin Username**: `admin`
- **Admin Password**: `admin123`
*(You can change the password or add new administrators anytime in the **Database & Setup** tab).*

---

## ✨ Features

- **Real In-Browser SQLite 3 (WASM)**:
  - Uses `sql.js` (SQLite compiled to WebAssembly).
  - Automatically persists the binary database to **IndexedDB** (`luckywheel_sqlite_db`).
  - **Export SQLite `.db` file**: Download the raw `.sqlite` / `.db` file anytime to inspect in DB Browser for SQLite or backup.
  - **Import SQLite `.db` file**: Load your existing SQLite databases right into the browser.
  - **Seed Demo Data**: Populates 20 realistic participants in 1 click.
- **Interactive Neon Canvas Wheel**:
  - High-DPI canvas wheel with glowing neon accents, 24 studs, metallic pointer, and mechanical ticking.
  - Web Audio API ticker and victory fanfare sound synthesizer (no external audio files needed).
  - Canvas confetti particle explosion on winner announcement.
- **Giveaway Rules & Prize Configurations**:
  - **Random Range**: Min and max prize limits with cryptographic uniform selection.
  - **Fixed Amount**: Identical prize for each winner.
  - **Prize List**: Multi-tier sequential prize ladder.
  - **Budget Cap**: Automatically prevents payouts beyond a total budget.
  - **Per-Person Cap**: Limits total winnings per participant across multiple draws.
  - **Winner Limits & Auto-Close**: Automatically closes when max winners or budget is reached.
- **Participant Management**:
  - Single participant addition (UID or Gmail address).
  - Bulk import via text or CSV/TXT file upload.
  - Gmail deduplication (handles dots and `+tag` variants).
  - Individual eligibility toggles and batch actions.
- **Exclusions & Audit Trail**:
  - Exclude staff, duplicates, or banned users from draws without deleting them.
  - Audit log recording all draws, setting changes, and exclusions.
- **Export History**:
  - Instant CSV export formatted and protected against formula injection.
