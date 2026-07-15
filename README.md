# Proballers Coaching Finland

Booking platform for a Finnish 1-on-1 football coaching business (working title).
Fully self-contained: Node.js + built-in SQLite, no external services required to run.

## What's inside

- **Public site** — hero carousel that rotates coaches every 5 seconds, coach cards,
  and a booking wizard: pick a free time → your position → session focus → city → confirm.
  A launch sale (50 % off, configurable) is applied automatically.
- **Three login roles**, one login page (`/login`):
  - **Admin** → `/admin`: visitors (7/30/90 days/all time), booked-but-not-completed count,
    completed sessions per window, booking conversion (tried vs. managed), revenue, invoices,
    per-coach performance, live view of every coach's calendar, bookings management,
    CSV exports and Google Sheets sync.
  - **Coach** → `/coach`: weekly availability calendar (8:00–20:00, default *not* available,
    click + **Save changes**), filters for cities (Helsinki/Espoo/Vantaa) and positions
    (goalkeepers/defenders/midfielders/attackers, multi-select) with a **Save filters** button,
    and their session list.
  - **Customer** → `/my-bookings`: their sessions and invoices.
- **Invoices** — every confirmed booking creates an invoice (HTML in `data/outbox/`),
  emailed automatically once SMTP is configured.
- **Data everywhere** — every dataset downloads as CSV and syncs to Google Sheets when connected.

## Run it locally

```bash
npm install
npm start            # http://localhost:3000
```

Node **22.13+** required (uses the built-in `node:sqlite`).

First start seeds the real logins and **demo data** (fake coaches, bookings and traffic,
clearly banner-flagged in the admin) so every screen has something to show.

- Remove demo data: press **Remove demo data** in the admin, or `npm run reset:production`.
- Reset everything back to demo state: `npm run reset`.

## Logins

| Role | Where it lands |
|---|---|
| Admin (owner) | `/admin` — analytics & management |
| Coach | `/coach` — availability calendar + filters |
| Customer | `/my-bookings` — self-signup on the site |

There is ONE shared admin login (both owners use it), created from the
`ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. Ben and Kalle keep their own
personal logins as coach accounts (coach app, calendars, chats). Setting
`ADMIN_EMAIL=proballerscoaching@gmail.com` on an existing database creates the
shared admin on the next boot and automatically turns the two old personal
admin logins into coach accounts.

### Credentials & security (read before going live)

- **No password lives in the source.** Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and
  `COACH_EMAIL` / `COACH_PASSWORD` env vars (in `.env` locally, in the host's
  environment in production) *before the first boot* so the seeded accounts use
  your real secrets. If a password var is missing, a strong random one is
  generated and printed to the server log once. The database only ever stores
  bcrypt hashes.
- **Rotate any time from inside the app:** any logged-in user can `POST /api/auth/change-password`
  with `{currentPassword, newPassword}` (this also signs out other sessions).
- Because you pasted your Google account password into a chat, change that password too —
  and note this app never uses it (Google Sheets connects via a service account instead).
New coaches: add a `users` row with role `coach` + a `coaches` profile row (see
`scripts/seed.js` for the exact shape) — or ask your developer/Claude to add a small
"invite coach" admin button later.

## Deploy to a public server

The app is one Node process + one SQLite file — it runs on any host. Two easy paths:

**Render (recommended, ~10 min)**
1. Push this folder to a **new, empty** GitHub repository (it is not connected to any yet).
2. On render.com: *New → Blueprint*, pick the repo — `render.yaml` configures everything,
   including the persistent disk for the database.
3. Set `DEMO_DATA=0` (already in the blueprint) so production starts clean.

**Any VPS / Docker**
```bash
docker build -t proballers .
docker run -d -p 80:3000 -v proballers-data:/app/data -e NODE_ENV=production -e DEMO_DATA=0 proballers
```

Behind HTTPS (any reverse proxy or Render's built-in TLS), session cookies are
automatically marked `Secure` via `NODE_ENV=production`.

## Connect Google Sheets (no password needed — ~2 minutes)

The app never logs into a Google account. It uses a *service account*, Google's
supported way to let an app edit one specific sheet you own:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) with the
   proballerscoaching@gmail.com account → create a project → *APIs & Services* →
   enable **Google Sheets API**.
2. *IAM & Admin → Service accounts → Create*. Then *Keys → Add key → JSON* — a key
   file downloads.
3. Create a blank Google Sheet in your account. Press **Share** and add the service
   account's email (looks like `something@project.iam.gserviceaccount.com`) as **Editor**.
4. Start the app with:
   ```bash
   GOOGLE_SERVICE_ACCOUNT=/path/to/key.json GOOGLE_SHEET_ID=<the long id in the sheet URL> npm start
   ```

From then on the sheet gets tabs for **Bookings, Invoices, Coaches, Availability,
VisitsDaily, Funnel, Customers** — synced automatically after every booking, hourly,
and on demand via the admin's *Sync now* button.

## Email invoices for real

Set SMTP credentials from any provider (Brevo has a free tier; Gmail works with an
[App Password](https://support.google.com/accounts/answer/185833) — *not* your account password):

```bash
SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 \
SMTP_USER=... SMTP_PASS=... SMTP_FROM="Proballers Coaching <you@example.com>" npm start
```

Until then, every invoice is still generated and viewable in the app (and in `data/outbox/`).

**Customer lifecycle emails** are automatic once SMTP works: a welcome email at signup,
a booking confirmation when the payment lands, a pitch confirmation when the coach picks
the field, a review request the day after each session (12:00), and a book-again nudge
three days after (12:00). The admin dashboard's *Email communications* panel shows the
send log and has a *Send due emails now* button.

**Changing the sender address**: set the `SMTP_FROM` environment variable (on Render:
Environment tab), e.g. `SMTP_FROM=info@proballerscoaching.com` or with a display name
`SMTP_FROM=Proballers Coaching <info@proballerscoaching.com>`. Note for Gmail SMTP:
Gmail only honors a From address that is the logged-in account or one of its verified
aliases — add the address first in Gmail → Settings → Accounts → *Send mail as*,
otherwise Gmail silently rewrites the sender back to the login address. `SITE_URL`
(default `https://proballerscoaching.com`) controls the links inside the emails.

## Configuration

Business rules live in [config.js](config.js): prices, the sale percentage, training
hours (8–20), cities, positions, session focus types, invoice details. Change and restart.

## Project layout

```
config.js            business settings (prices, sale, hours, cities, positions)
server/              express app, SQLite layer, auth, invoices, Sheets sync
server/routes/api.js all JSON endpoints
public/              the website (no build step required)
scripts/             seed + CSV export
data/                SQLite database, invoices outbox, exports (created at runtime)
```
