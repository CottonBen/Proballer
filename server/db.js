// Database layer. Uses Node's built-in SQLite (node:sqlite, Node >= 22.13) so
// the app has zero native dependencies and deploys anywhere Node runs.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'proballers.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','coach','customer')),
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',      -- JSON array of asset URLs
  locations TEXT NOT NULL DEFAULT '[]',   -- JSON array from config.locations
  positions TEXT NOT NULL DEFAULT '[]',   -- JSON array from config.positions
  featured INTEGER NOT NULL DEFAULT 1,    -- appears in the hero carousel
  display_order INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- A row here means: this coach IS available for this one-hour slot.
-- (Coaches are assumed unavailable unless they mark themselves free.)
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coaches(id),
  date TEXT NOT NULL,          -- YYYY-MM-DD (Europe/Helsinki)
  hour INTEGER NOT NULL,       -- start hour, 8..19 (slot runs hour:00-hour+1:00)
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (coach_id, date, hour)
);
CREATE INDEX IF NOT EXISTS idx_availability_coach_date ON availability (coach_id, date);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,   -- short public reference, e.g. PBF-4F7K2A
  customer_id INTEGER NOT NULL REFERENCES users(id),
  coach_id INTEGER NOT NULL REFERENCES coaches(id),
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  location TEXT NOT NULL,      -- city, or 'Online' for online sessions
  position TEXT NOT NULL,
  focus TEXT NOT NULL,         -- focus type id from config.focusTypes
  is_online INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','cancelled')),
  credit_applied INTEGER NOT NULL DEFAULT 0,  -- 1 = paid with a free-session credit
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT             -- ISO timestamp of the session end, set on completion
);
-- One active booking per coach slot (cancelled slots can be re-booked).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot
  ON bookings (coach_id, date, hour) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings (customer_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  number TEXT NOT NULL UNIQUE,
  customer_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','paid','void')),
  html_path TEXT
);

-- One row per page view (anonymous visitor cookie).
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  path TEXT NOT NULL,
  day TEXT NOT NULL,           -- YYYY-MM-DD (Europe/Helsinki)
  ts TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day);

-- Product events: the booking funnel, signups, logins.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  user_id INTEGER,
  type TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  day TEXT NOT NULL,
  ts TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_type_day ON events (type, day);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Free-session credits, granted when a coach cancels a customer's booking.
-- used_by_booking_id NULL = still available; it makes the next booking free.
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_by_booking_id INTEGER REFERENCES bookings(id),
  demo INTEGER NOT NULL DEFAULT 0
);

-- In-app messages for customers (e.g. "your session was cancelled").
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Idempotent column migrations for databases created before a feature existed.
for (const stmt of [
  'ALTER TABLE bookings ADD COLUMN credit_applied INTEGER NOT NULL DEFAULT 0',
  // Coach payout locked in at completion time (never recomputed afterwards).
  'ALTER TABLE bookings ADD COLUMN earn_cents INTEGER',
  'ALTER TABLE bookings ADD COLUMN payout_basis_cents INTEGER',
  // Invoice status before a void, so reactivation can restore 'paid' vs 'sent'.
  'ALTER TABLE invoices ADD COLUMN prev_status TEXT',
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

// ---------------------------------------------------------------------------
// Europe/Helsinki time helpers. All business dates/hours are Helsinki-local.
// ---------------------------------------------------------------------------
const hkiFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function helsinkiNow(d = new Date()) {
  const parts = Object.fromEntries(hkiFmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
  };
}

// Helsinki date string N days from today (negative = past). Uses calendar-date
// arithmetic (not millisecond math) so it is correct across DST transitions.
function helsinkiDateOffset(days) {
  const [y, m, d] = helsinkiNow().date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function nowISO() { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
// Lazy auto-completion: a confirmed booking whose slot has ended counts as a
// completed session. Runs cheaply before reads that depend on status.
// ---------------------------------------------------------------------------
function autoCompleteBookings() {
  const { date, hour } = helsinkiNow();
  // completed_at is the session end in Helsinki local time (naive, no numeric
  // offset — the old hard-coded +02:00 was wrong during summer time / EEST).
  db.prepare(`
    UPDATE bookings
    SET status = 'completed',
        completed_at = date || 'T' || printf('%02d', hour + 1) || ':00:00'
    WHERE status = 'confirmed' AND (date < ? OR (date = ? AND hour + 1 <= ?))
  `).run(date, date, hour);
}

module.exports = {
  db,
  DATA_DIR,
  helsinkiNow,
  helsinkiDateOffset,
  nowISO,
  autoCompleteBookings,
};
