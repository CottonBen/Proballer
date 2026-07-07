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
  lang TEXT NOT NULL DEFAULT 'fi',        -- invoice/email language ('fi'|'en')
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',           -- Finnish (canonical site language)
  bio_en TEXT NOT NULL DEFAULT '',        -- English version ('' = fall back to bio)
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
  notes TEXT NOT NULL DEFAULT '',             -- customer's free-text wishes for the coach
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

-- Coach reviews left by customers. A customer may review a coach only after a
-- session with them has completed, and at most once per coach (enforced by the
-- partial unique index below). Seeded demo reviews have a NULL customer_id.
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reviews_coach ON reviews (coach_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_customer_coach
  ON reviews (customer_id, coach_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Admin curation of the coach app's pitch list (on top of the LIPAS registry):
-- own venues added by hand, and LIPAS pitches hidden from the list. Custom
-- pitches are exposed with NEGATIVE ids so they can never collide with LIPAS
-- ids (bookings.pitch_id then references either space unambiguously).
CREATE TABLE IF NOT EXISTS custom_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL DEFAULT '',   -- LIPAS-style token ('artificial-turf', …) or ''
  lighting INTEGER NOT NULL DEFAULT 0,
  indoor INTEGER NOT NULL DEFAULT 0,
  www TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hidden_pitches (
  pitch_id INTEGER PRIMARY KEY,      -- LIPAS id
  hidden_at TEXT NOT NULL
);

-- Coach <-> customer chat. One thread per pair, auto-created on first booking.
-- Admins are implicit members of every chat (business oversight).
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coaches(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (coach_id, customer_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id),  -- NULL = automatic system line
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages (chat_id, id);
-- Per-user read cursor: the last message id this user has seen in a chat.
CREATE TABLE IF NOT EXISTS chat_reads (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
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
  // Customer's free-text notes to the coach, asked in the booking wizard.
  "ALTER TABLE bookings ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
  // Stripe Checkout session behind an online card payment (NULL = none started).
  'ALTER TABLE invoices ADD COLUMN stripe_session_id TEXT',
  // Card-payment deadline (UTC ISO, booking time + 72 h). Set only on invoices
  // created while Stripe is enabled; NULL = legacy bank-transfer invoice, which
  // the unpaid-booking sweep must never touch.
  'ALTER TABLE invoices ADD COLUMN pay_by TEXT',
  // One-shot flag: the "24 h left to pay" reminder notification went out.
  'ALTER TABLE invoices ADD COLUMN pay_reminder_sent INTEGER NOT NULL DEFAULT 0',
  // Pitch (playing field) the coach picked for the session, from the LIPAS
  // national sports-site registry. NULL/'' = not chosen yet.
  'ALTER TABLE bookings ADD COLUMN pitch_id INTEGER',
  "ALTER TABLE bookings ADD COLUMN pitch_name TEXT NOT NULL DEFAULT ''",
  // Has the coach been told about this booking? Card bookings start at 0 and
  // are announced when the payment confirms (server/notify.js); the DEFAULT 1
  // makes every pre-existing row count as already announced.
  'ALTER TABLE bookings ADD COLUMN coach_notified INTEGER NOT NULL DEFAULT 1',
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

// Backfill for invoices created in the brief pay-at-booking era BEFORE pay_by
// existed: still-unpaid card invoices get a 72 h window from this boot, so the
// sweep can release them instead of letting the bookings complete unpaid.
// Idempotent — after the first run no row matches (pay_by is set).
db.prepare(`UPDATE invoices SET pay_by = ?
  WHERE pay_by IS NULL AND status = 'sent' AND stripe_session_id IS NOT NULL`)
  .run(new Date(Date.now() + 72 * 3600000).toISOString());

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
  // Expire FIRST: an unpaid card-payment booking must be released (cancelled)
  // at its deadline, never silently "completed" into a free session.
  expireUnpaidBookings();
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

// Card payments are due AT booking: each invoice carries a pay_by deadline
// (config.stripe.payWindowMinutes after booking) — and the session start is
// always a deadline too, whichever comes first. The booking holds the slot
// until then; this sweep releases it once the deadline passes: cancelled,
// invoice voided, slot free again, customer AND coach notified. Only invoices
// with a pay_by deadline are eligible — legacy bank-transfer invoices (pay_by
// NULL) are never touched.
function expireUnpaidBookings() {
  // No Stripe guard here: the sweep only ever touches invoices that carry a
  // pay_by deadline (created while card payments were on). If the key is later
  // removed, those bookings must still expire instead of completing unpaid.
  const now = new Date().toISOString();
  const hki = helsinkiNow();

  // One-shot "24 h left" reminder — only meaningful when the business runs a
  // long pay-later window. With the current pay-at-booking window (< 24 h) the
  // customer is mid-checkout and a reminder would fire instantly, so skip.
  if (config.stripe.payWindowMinutes >= 24 * 60) {
    const remindBefore = new Date(Date.now() + 24 * 3600000).toISOString();
    const toRemind = db.prepare(`
      SELECT b.code, b.date, b.hour, b.customer_id, i.id AS invoice_id
      FROM bookings b JOIN invoices i ON i.booking_id = b.id
      WHERE b.status = 'confirmed' AND i.status = 'sent'
        AND i.pay_by IS NOT NULL AND i.pay_by > ? AND i.pay_by <= ?
        AND i.pay_reminder_sent = 0`).all(now, remindBefore);
    for (const r of toRemind) {
      db.prepare('UPDATE invoices SET pay_reminder_sent = 1 WHERE id = ?').run(r.invoice_id);
      db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
        .run(r.customer_id, `Payment reminder: your booking ${r.code} on ${r.date} at `
          + `${String(r.hour).padStart(2, '0')}:00 is still unpaid — pay it on the My bookings page `
          + 'within 24 hours (before the session, if it is sooner) or the booking will be cancelled automatically.', nowISO());
    }
  }

  // Release: the payment window has passed, or the session is about to start.
  const stale = db.prepare(`
    SELECT b.id, b.code, b.date, b.hour, b.customer_id, b.coach_id, b.coach_notified,
           i.number AS invoice_number
    FROM bookings b JOIN invoices i ON i.booking_id = b.id
    WHERE b.status = 'confirmed' AND b.total_cents > 0
      AND i.status = 'sent' AND i.pay_by IS NOT NULL
      AND (i.pay_by < ? OR b.date < ? OR (b.date = ? AND b.hour <= ?))`)
    .all(now, hki.date, hki.date, hki.hour);
  for (const s of stale) {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(s.id);
    db.prepare("UPDATE invoices SET status = 'void' WHERE number = ?").run(s.invoice_number);
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(s.customer_id, 'Your booking was cancelled because the payment was not completed. '
        + 'The slot is open again — you are welcome to book a new time.', nowISO());
    // Coaches only hear about announced bookings — one that was never sent to
    // them (unpaid card booking) also vanishes silently.
    if (s.coach_notified) {
      const coachUser = db.prepare('SELECT user_id FROM coaches WHERE id = ?').get(s.coach_id);
      if (coachUser && coachUser.user_id) {
        db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
          .run(coachUser.user_id, `Booking ${s.code} on ${s.date} at `
            + `${String(s.hour).padStart(2, '0')}:00 was released because the payment `
            + 'was not completed. The slot is open again.', nowISO());
      }
    }
  }
}

module.exports = {
  db,
  DATA_DIR,
  helsinkiNow,
  helsinkiDateOffset,
  nowISO,
  autoCompleteBookings,
};
