# Proballers Coaching Finland

Booking platform for a Finnish 1-on-1 football coaching business (working title).
Fully self-contained: Node.js + built-in SQLite, no external services required to run.

## What's inside

- **Public site** — hero carousel that rotates coaches every 5 seconds, coach cards,
  and a booking wizard: pick a free time → your position → session focus → city → confirm.
  Sessions are a flat €40 (prices in [config.js](config.js); an optional automatic
  sale can be re-enabled via `pricing.salePercent`).
- **Three login roles**, one login page (`/login`):
  - **Admin** → `/admin`: visitors (7/30/90 days/all time), booked-but-not-completed count,
    completed sessions per window, booking conversion (tried vs. managed), revenue, invoices,
    per-coach performance, live view of every coach's calendar, bookings management,
    CSV exports and Google Sheets sync.
  - **Coach** → `/coach`: weekly availability calendar (8:00–22:00, default *not* available,
    click + **Save changes**), filters for cities (Helsinki/Espoo/Vantaa/Kirkkonummi) and positions
    (goalkeepers/defenders/midfielders/attackers, multi-select) with a **Save filters** button,
    and their session list.
  - **Customer** → `/my-bookings`: their sessions and invoices.
- **Invoices** — every booking creates an invoice (HTML in `data/outbox/`),
  emailed automatically once SMTP is configured.
- **Payment: MobilePay only** — nobody pays at checkout. A booking is made, the
  customer's billing details are captured with it, and the booking sits in
  **pending payment** until the money arrives (see below).
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

## Connect Attio (CRM) — one-way sync

The app can mirror **customers and leads** into [Attio](https://attio.com) as *People*,
and their **bookings, group spots and packages** as *Deals* linked to that person. It is
one-way (app → Attio) and completely optional: with no key set, none of this runs.

The app stays the source of truth for bookings, invoices and payments — Attio only
receives a copy for pipeline and relationship work. Coaches and admins are staff, so they
are never synced.

1. In Attio: **Settings → Developers → Create an access token**. Give it the scopes
   `record_permission:read-write` and `object_configuration:read-write` (the second lets
   the app create the custom People fields — source, stage, area, language, sessions,
   lifetime value — automatically).
2. Set the token as an env var (in `.env` locally, in Render's environment in production):
   ```bash
   ATTIO_API_KEY=<token>
   ```
   From then on every new lead, signup, booking and payment flows into Attio in the
   background (fire-and-forget — a customer's booking is never blocked or slowed by Attio,
   and any Attio error is just logged).
3. **Seed your existing data once** (safe to re-run — people upsert by email, deals are
   idempotent):
   ```bash
   ATTIO_API_KEY=<token> node scripts/attio-backfill.js --limit 1   # smoke-test one of each
   ATTIO_API_KEY=<token> node scripts/attio-backfill.js             # then the full backfill
   ```
   Add `--dry-run` (no key needed) to print every payload without sending it. `Deals` uses
   Attio's built-in object; if custom-field setup is skipped (missing scope), people still
   sync with all their context packed into the standard *Description* field.

Optionally connect the shared `proballerscoaching@gmail.com` inbox under Attio's email
integration so conversations auto-log against the right person.

## Daily brief (`GET /api/brief`)

A read-only endpoint that returns the day's key numbers — sessions today, revenue today +
month-to-date, the next 7 days, new signups/leads, and things needing attention (unpaid
invoices, open leads, packages down to their last session). It's **off by default** and
turns on only when you set a secret:

```bash
BRIEF_TOKEN=<long random value>   # node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Then a scheduler (or you) can fetch it without logging in:

- `GET /api/brief?token=<value>` → JSON
- `GET /api/brief?token=<value>&format=html` → a styled HTML dashboard
- `GET /api/brief?token=<value>&send=1` → also emails the brief to the admin inbox (via SMTP)

Without the token the endpoint returns 404; a wrong token returns 401. Requests are lightly
rate-limited. "Today" is always the Helsinki business day, regardless of when the brief is
fetched.

**Delivery:** the always-on app emails the brief to the admins **daily at 20:30 Europe/London**
by itself (an internal scheduler — DST-aware, so it stays 20:30 local through BST and GMT; it
only runs when SMTP is configured, or set `BRIEF_DAILY=1` to force it). The email body *is* the
dashboard. A logged-in admin can also open the dashboard on demand at **`/api/admin/brief`**
(session-authed, no token). The token-gated `/api/brief` above stays available for any external
puller. (Note: a scheduled *cloud* agent can't be used to fetch it — that sandbox blocks
outbound requests to the site — which is why the app sends it itself.)

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

## Payments (MobilePay)

Nobody pays at checkout. The flow is:

1. The customer picks a session and fills in their billing details (name, email,
   phone, street address, postal code, city). The details are remembered on the
   account, so a returning customer just sees a one-line summary with an
   **Edit** button.
2. The booking is created in **pending payment** — the slot is held, but the coach
   is *not* told about it yet and the session is not confirmed.
3. The invoice is emailed. It carries the MobilePay number, the amount, and the
   **invoice number as the reference** the payer types in the message field.
4. When the money arrives the invoice flips to paid, a receipt is emailed, the
   booking is confirmed and the coach is notified.

An unpaid booking holds its slot for `payment.holdHours` (72 h by default) or
until the session starts, whichever comes first; after that it is released, the
slot reopens and the customer is emailed. Group spots and prepaid packages work
the same way, using the spot code (`GSU-…`) or package code (`PKG-…`) as the
reference.

In the admin dashboard, bookings can be filtered by payment state (**awaiting
payment / paid / pays at session**) on top of the usual status filter, with a
running total of what is still owed and the customer's invoice address one click
away on every row.

**Confirming payments — two ways, both idempotent:**

- **By hand (the default).** A *personal* MobilePay number has no API. The owner
  sees the payment in their phone and clicks **mark paid** in the admin dashboard.
- **Automatically.** With a Vipps MobilePay **merchant** agreement, set
  `MOBILEPAY_WEBHOOK_SECRET` and point the webhook at
  `POST /api/mobilepay/webhook`. Each notification is signature-verified
  (HMAC-SHA256 of the raw body, hex or base64, in `X-MobilePay-Signature`),
  recorded in `payment_events` for idempotency, and matched to the right
  purchase by reference — case-insensitively and ignoring dashes and spaces, so
  `pbf 2026 0001` finds `PBF-2026-0001`. Duplicate deliveries, failed or
  cancelled payments and references nobody can match are all handled: the last
  raises an admin notification rather than losing the money silently.
  Without the secret the endpoint answers 503 and the manual path is unaffected.

Set `PAYMENT_MOBILEPAY` to change the receiving number (see [.env.example](.env.example)).

## Search engines (SEO)

The site paints itself with JavaScript, and crawlers and link-preview bots do
not run scripts. So everything that has to be right in a search result or a
shared link is rendered server-side in [server/seo.js](server/seo.js):

- **`/robots.txt`** and **`/sitemap.xml`**, both generated. The sitemap is built
  from the live coach list, so adding or deactivating a coach in the admin
  updates it with no file to remember.
- **Per-coach `<head>`** on `/coaches/:slug` — its own title, description,
  canonical, social card and `Person` markup (including the star rating once a
  coach has reviews). These six pages previously shared one generic title, which
  made them look like a single duplicate.
- **Homepage `SportsActivityLocation` markup** carrying the cities served and
  live prices from [config.js](config.js), so the two never drift apart.
- **`noindex`** on every signed-in page (`/admin`, `/my-bookings`, `/chats`,
  `/coach`, `/app`, `/login`) — they are empty shells until a script fills them
  in for one person.

`SITE_URL` controls the absolute URLs in all of the above. Covered by
`tests/test-seo.js`.

## Configuration

Business rules live in [config.js](config.js): prices, the sale percentage, training
hours (8–22), cities, positions, session focus types, payment and invoice details.
Change and restart.

## Project layout

```
config.js            business settings (prices, sale, hours, cities, positions)
server/              express app, SQLite layer, auth, invoices, Sheets sync
server/routes/api.js all JSON endpoints
public/              the website (no build step required)
scripts/             seed + CSV export
data/                SQLite database, invoices outbox, exports (created at runtime)
```
