# SELF Talk Feedback

Web tool for **SouthEast Linux Fest** that listens for audience vote buttons over MQTT, matches votes to the active Pretalx talk in each ballroom, and generates staff and speaker reports.

## Features

- MQTT subscription on `vote/A`, `vote/B`, `vote/C`, `vote/D` with payloads `natural`, `pos`, or `neg`
- Automatic Pretalx schedule sync from [SELF schedule](https://speakers.southeastlinuxfest.org/southeast-linux-fest-2026/schedule/)
- Time-based vote-to-talk matching per room
- Staff authentication (session login)
- Staff user management (create, rename, reset password, delete)
- MQTT broker configuration from the staff UI (no `.env` edit required after first run)
- Pretalx URL and event slug configuration from the staff UI
- Live dashboard with recent votes and active talk counts
- End-of-event staff report (HTML + CSV) including unmatched votes
- On-demand speaker report via revocable share link

## Room mapping

| MQTT topic | Room |
|------------|------|
| `vote/A` | Salon A (Altispeed Ballroom) |
| `vote/B` | Salon B (Rocky Linux Ballroom) |
| `vote/C` | Salon C-E (VictoriaMetrics Ballroom) |
| `vote/D` | Piedmont 1-3 (TBD Ballroom) |

## Quick start

```bash
cp .env.example .env
# Edit STAFF_PASSWORD and SESSION_SECRET

npm install
npm run seed-staff
npm start
```

Open http://localhost:3847 and sign in with the credentials from `.env`.

On first start the app syncs the Pretalx schedule automatically. Use **Settings** in the nav or **Sync Pretalx schedule** on the dashboard to refresh manually.

## Settings

Configure MQTT and Pretalx from the staff UI at **Settings** (`/staff/settings`).

**MQTT:** broker URL, credentials, topic prefix, reconnect interval. Saving reconnects the listener.

**Pretalx:** base URL, event slug, auto-sync interval in minutes. Use **Test connection**, **Save and sync**, or **Sync schedule now** to verify and pull talks.

On first startup, defaults are taken from `.env` (if present) and stored in the database. After that, use the UI.

Example publish (mosquitto):

```bash
mosquitto_pub -h localhost -t vote/B -m pos
```

## Reports

- **Staff**: `/staff/reports` — summary table, CSV download, full HTML report with unmatched votes
- **Users**: `/staff/users` — add staff accounts, reset passwords, rename, delete
- **Settings**: `/staff/settings` — MQTT broker and Pretalx schedule configuration
- **Speaker**: staff clicks **Create speaker link** for a talk; share `/report/{token}` with the speaker (no login required)

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run web server + MQTT listener |
| `npm run dev` | Run with file watch |
| `npm run sync-schedule` | Sync Pretalx schedule only |
| `npm run seed-staff` | Create/update staff user |
| `npm test` | Run unit tests |

## Requirements

- Node.js 20+
- Network access to Pretalx and your MQTT broker during the event

## Production notes

- Set strong `SESSION_SECRET` and `STAFF_PASSWORD`
- Run behind HTTPS (reverse proxy with `X-Forwarded-Proto`)
- Back up `data/feedback.db` during the event
- Lounge and classroom rooms are excluded from MQTT mapping by design

### Deploy to AlmaLinux

On the server:

```bash
git clone https://github.com/mikespears/SELF-Talk-Feedback.git /opt/self-talk-feedback
cd /opt/self-talk-feedback
cp .env.example .env   # edit secrets
bash deploy/install.sh
```

From a workstation (optional): copy `scripts/deploy.env.example` to `scripts/deploy.env`, then run `node scripts/deploy-remote.mjs`.
