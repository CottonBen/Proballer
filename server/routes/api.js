// All JSON API endpoints: public site data, auth, booking, coach tools, admin analytics.
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const config = require('../../config');
const { db, DATA_DIR, nowISO, helsinkiNow, helsinkiDateOffset, autoCompleteBookings } = require('../db');
const { createSession, destroySession, requireRole, loginThrottle } = require('../auth');
const { createInvoiceForBooking, OUTBOX } = require('../invoice');
const sheets = require('../sheets');
const tiers = require('../tiers');

const router = express.Router();
const WINDOWS = { d7: 7, d30: 30, d90: 90 };

const parseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const coachPublic = (c) => ({
  id: c.id, name: c.name, slug: c.slug, bio: c.bio,
  photos: parseJSON(c.photos, []),
  locations: parseJSON(c.locations, []),
  positions: parseJSON(c.positions, []),
  featured: Boolean(c.featured),
});

function recordEvent(req, type, meta = {}) {
  const { date } = helsinkiNow();
  db.prepare('INSERT INTO events (visitor_id, user_id, type, meta, day, ts) VALUES (?,?,?,?,?,?)')
    .run(req.visitorId || null, req.user ? req.user.id : null, type, JSON.stringify(meta), date, nowISO());
}

const escHtml = (s) => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Coach photos uploaded through the admin UI live on the persistent data disk
// (not in the bundled public/ folder, which is wiped on every redeploy), served
// read-only at /uploads by app.js.
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const slugify = (name) => String(name).toLowerCase().normalize('NFKD')
  .replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'coach';
function uniqueSlug(base) {
  let slug = base, n = 1;
  while (db.prepare('SELECT 1 FROM coaches WHERE slug = ?').get(slug)) slug = `${base}-${++n}`;
  return slug;
}

// Save one base64 data-URL image to the uploads disk, returning its /uploads path.
// Throws a 400-tagged error on an unsupported format or oversized file.
function savePhotoDataUrl(dataUrl, slug) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw Object.assign(new Error('Unsupported image — use JPG, PNG or WebP.'), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw Object.assign(new Error('That image looks empty.'), { status: 400 });
  if (buf.length > 6 * 1024 * 1024) throw Object.assign(new Error('Each image must be under 6 MB.'), { status: 400 });
  const name = `${slug}-${crypto.randomBytes(6).toString('hex')}.${IMG_EXT[m[1]]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return `/uploads/${name}`;
}

// Turn a desired photo list (mix of existing internal paths to keep + new
// data-URLs to save) into a clean list of internal paths. Anything else is
// dropped, so a caller can never point a coach photo at an external/arbitrary URL.
function resolvePhotos(list, slug) {
  const out = [];
  for (const item of Array.isArray(list) ? list.slice(0, 5) : []) {
    const s = String(item);
    if (s.startsWith('data:')) out.push(savePhotoDataUrl(s, slug));
    else if (/^\/(uploads|assets)\/[\w.\-]+$/.test(s)) out.push(s);
  }
  return out;
}

// Validate + normalise the editable coach fields shared by create and update.
function readCoachFields(body) {
  const name = String(body?.name || '').trim();
  const bio = String(body?.bio || '').trim().slice(0, 1200);
  const positions = Array.isArray(body?.positions)
    ? [...new Set(body.positions.filter(p => config.positions.includes(p)))] : [];
  const locations = Array.isArray(body?.locations)
    ? [...new Set(body.locations.filter(l => config.locations.includes(l)))] : [];
  if (name.length < 2 || name.length > 60) return { error: 'Coach name must be 2–60 characters.' };
  if (!positions.length) return { error: 'Pick at least one position group.' };
  if (!locations.length) return { error: 'Pick at least one city.' };
  return { name, bio, positions, locations, featured: body?.featured ? 1 : 0 };
}

// Has a session's slot already ended (in Helsinki time)? Only ended sessions
// may be marked "completed" — otherwise a coach could complete future sessions
// to get paid early and jump commission tiers.
function slotHasEnded(date, hour) {
  const now = helsinkiNow();
  return date < now.date || (date === now.date && hour + 1 <= now.hour);
}

// Cancelling a booking on the business side: void the invoice (remembering
// whether it was paid), settle the free-session credit, and tell the customer.
// Credit rules keep value conserved:
//  - a PAID booking cancelled -> grant ONE new goodwill credit (deduped by code)
//  - a FREE (credit-funded) booking cancelled -> return the credit that paid for
//    it to "unused" instead of minting a second one (no free-session farming).
function cancelWithCredit(booking, actorLabel) {
  db.prepare("UPDATE bookings SET status = 'cancelled', completed_at = NULL WHERE id = ?").run(booking.id);
  // Remember the pre-void invoice status so reactivation can restore paid vs sent.
  db.prepare("UPDATE invoices SET prev_status = status, status = 'void' WHERE booking_id = ? AND status != 'void'")
    .run(booking.id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(booking.coach_id);
  const customer = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(booking.customer_id);

  let creditMsg;
  if (booking.credit_applied) {
    // Free session cancelled — hand the customer's credit back, don't create one.
    db.prepare('UPDATE credits SET used_by_booking_id = NULL WHERE used_by_booking_id = ?').run(booking.id);
    creditMsg = 'Your free-session credit is available again — use it on any coach.';
  } else {
    // Paid session cancelled — one goodwill credit, but never a duplicate.
    db.prepare(`INSERT INTO credits (customer_id, reason, created_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM credits WHERE reason = ?)`)
      .run(customer.id, `cancelled:${booking.code}`, nowISO(), `cancelled:${booking.code}`);
    creditMsg = 'To make it right, your next session with ANY coach is free — the credit is ' +
      'applied automatically when you book.';
  }
  const msg = `Your session with ${coach.name} on ${booking.date} at ` +
    `${String(booking.hour).padStart(2, '0')}:00 was cancelled by ${actorLabel}. We're sorry! ${creditMsg}`;
  db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
    .run(customer.id, msg, nowISO());
  require('../mailer').sendMail({
    to: customer.email,
    subject: `${config.siteName} — session cancelled`,
    html: `<p>Hi ${escHtml(customer.name)},</p><p>${escHtml(msg)}</p>`,
  }).catch(err => console.error('[mailer]', err.message));
}

// Bringing a cancelled booking back. Returns an error string if it can't be done
// (slot re-taken, or the goodwill credit has already been spent elsewhere).
function reactivateBooking(booking) {
  const clash = db.prepare(`SELECT 1 FROM bookings
    WHERE coach_id = ? AND date = ? AND hour = ? AND status != 'cancelled' AND id != ?`)
    .get(booking.coach_id, booking.date, booking.hour, booking.id);
  if (clash) return 'That slot has since been booked by someone else.';

  if (booking.credit_applied) {
    // This was a free booking; reactivating it must re-consume an available
    // credit for this customer (the one that was returned on cancel).
    const credit = db.prepare(
      'SELECT id FROM credits WHERE customer_id = ? AND used_by_booking_id IS NULL ORDER BY id LIMIT 1')
      .get(booking.customer_id);
    if (!credit) return "The customer's free-session credit has already been used elsewhere — can't reactivate.";
    db.prepare('UPDATE credits SET used_by_booking_id = ? WHERE id = ?').run(booking.id, credit.id);
  } else {
    // This was a paid booking; the goodwill credit it generated must be unspent.
    const granted = db.prepare('SELECT id, used_by_booking_id FROM credits WHERE reason = ?')
      .get(`cancelled:${booking.code}`);
    if (granted && granted.used_by_booking_id != null) {
      return "The free-session credit from this cancellation has already been used — can't reactivate.";
    }
    if (granted) db.prepare('DELETE FROM credits WHERE id = ?').run(granted.id);
  }

  db.prepare("UPDATE bookings SET status = 'confirmed', completed_at = NULL WHERE id = ?").run(booking.id);
  // Restore the invoice to whatever it was before the void (paid stays paid).
  db.prepare("UPDATE invoices SET status = COALESCE(prev_status, 'sent'), prev_status = NULL WHERE booking_id = ? AND status = 'void'")
    .run(booking.id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(booking.coach_id);
  db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
    .run(booking.customer_id,
      `Good news — your session with ${coach.name} on ${booking.date} at ` +
      `${String(booking.hour).padStart(2, '0')}:00 is back on.`, nowISO());
  return null;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
router.get('/config', (req, res) => {
  res.json({
    siteName: config.siteName,
    tagline: config.tagline,
    locations: config.locations,
    positions: config.positions,
    focusTypes: config.focusTypes,
    pricing: config.pricing,
    hours: { start: config.dayStartHour, end: config.dayEndHour },
    bookingHorizonDays: config.bookingHorizonDays,
    emailDelivery: require('../mailer').smtpConfigured(),
    // Only the method NAME is public; the IBAN / MobilePay number live on the
    // invoice (auth-gated) so they aren't scraped from the open config endpoint.
    payment: { method: config.payment.method },
  });
});

router.get('/coaches', (req, res) => {
  const rows = db.prepare('SELECT * FROM coaches WHERE active = 1 ORDER BY display_order, id').all();
  const ratings = new Map(db.prepare(
    'SELECT coach_id, COUNT(*) n, AVG(rating) avg FROM reviews GROUP BY coach_id')
    .all().map(r => [r.coach_id, { avg: r.n ? Math.round(r.avg * 10) / 10 : null, count: r.n }]));
  res.json(rows.map(c => ({ ...coachPublic(c), rating: ratings.get(c.id) || { avg: null, count: 0 } })));
});

// Public reviews for one coach, newest first.
router.get('/coaches/:id/reviews', (req, res) => {
  const coach = db.prepare('SELECT id FROM coaches WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!coach) return res.status(404).json({ error: 'Coach not found.' });
  const reviews = db.prepare(
    `SELECT author_name, rating, body, substr(created_at,1,10) AS date
     FROM reviews WHERE coach_id = ? ORDER BY created_at DESC, id DESC`).all(coach.id);
  const agg = db.prepare('SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE coach_id = ?').get(coach.id);
  res.json({
    rating: { avg: agg.n ? Math.round(agg.avg * 10) / 10 : null, count: agg.n },
    reviews,
  });
});

// A customer posts a review for a coach they've trained with. Requires at least
// one COMPLETED session with that coach; one review per customer per coach.
router.post('/coaches/:id/reviews', requireRole('customer', 'admin'), (req, res) => {
  autoCompleteBookings();
  const coach = db.prepare('SELECT id, name FROM coaches WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!coach) return res.status(404).json({ error: 'Coach not found.' });
  const rating = Math.trunc(Number(req.body?.rating));
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Please give a rating from 1 to 5 stars.' });
  const body = String(req.body?.body || '').trim().slice(0, 600);

  const completed = db.prepare(
    "SELECT 1 FROM bookings WHERE customer_id = ? AND coach_id = ? AND status = 'completed' LIMIT 1")
    .get(req.user.id, coach.id);
  if (!completed) return res.status(403).json({ error: 'You can review a coach only after a completed session with them.' });
  const existing = db.prepare('SELECT 1 FROM reviews WHERE customer_id = ? AND coach_id = ?')
    .get(req.user.id, coach.id);
  if (existing) return res.status(409).json({ error: 'You have already reviewed this coach.' });

  try {
    db.prepare(`INSERT INTO reviews (coach_id, customer_id, author_name, rating, body, created_at)
      VALUES (?,?,?,?,?,?)`).run(coach.id, req.user.id, req.user.name, rating, body, nowISO());
  } catch (err) {
    // The partial unique index is the real guard: two simultaneous posts can
    // both pass the SELECT above, so turn the constraint hit into a clean 409.
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'You have already reviewed this coach.' });
    }
    throw err;
  }
  res.json({ ok: true });
});

// Which coaches the logged-in customer can review (completed session, not yet
// reviewed) plus the reviews they've already written.
router.get('/my-reviews', requireRole('customer', 'admin'), (req, res) => {
  autoCompleteBookings();
  const reviewable = db.prepare(`
    SELECT DISTINCT c.id, c.name FROM bookings b JOIN coaches c ON c.id = b.coach_id
    WHERE b.customer_id = ? AND b.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.customer_id = b.customer_id AND r.coach_id = c.id)
    ORDER BY c.name`).all(req.user.id);
  const mine = db.prepare(`
    SELECT c.name AS coach, r.rating, r.body, substr(r.created_at,1,10) AS date
    FROM reviews r JOIN coaches c ON c.id = r.coach_id
    WHERE r.customer_id = ? ORDER BY r.created_at DESC`).all(req.user.id);
  res.json({ reviewable, mine });
});

// Free bookable slots for one coach (availability minus active bookings, future only).
router.get('/coaches/:id/slots', (req, res) => {
  const coach = db.prepare('SELECT * FROM coaches WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!coach) return res.status(404).json({ error: 'Coach not found.' });
  const { date, hour } = helsinkiNow();
  const to = helsinkiDateOffset(config.bookingHorizonDays);
  const rows = db.prepare(`
    SELECT a.date, a.hour FROM availability a
    WHERE a.coach_id = ? AND a.date <= ?
      AND (a.date > ? OR (a.date = ? AND a.hour > ?))
      AND NOT EXISTS (SELECT 1 FROM bookings b
        WHERE b.coach_id = a.coach_id AND b.date = a.date AND b.hour = a.hour
          AND b.status != 'cancelled')
    ORDER BY a.date, a.hour`).all(coach.id, to, date, date, hour);
  res.json({ coach: coachPublic(coach), slots: rows });
});

// Client-side funnel breadcrumbs (whitelisted types only).
const TRACKABLE = new Set(['booking_started', 'booking_step', 'booking_abandoned']);
router.post('/track', (req, res) => {
  const { type, meta } = req.body || {};
  if (!TRACKABLE.has(type)) return res.status(400).json({ error: 'Unknown event type.' });
  recordEvent(req, type, typeof meta === 'object' && meta ? meta : {});
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
router.post('/auth/signup', loginThrottle, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Please give your name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists — try logging in.' });
  }
  const info = db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?,?,?,?,?)')
    .run(email, bcrypt.hashSync(password, 10), name, 'customer', nowISO());
  createSession(res, Number(info.lastInsertRowid));
  recordEvent(req, 'signup', {});
  res.json({ user: { id: Number(info.lastInsertRowid), name, email, role: 'customer' } });
});

router.post('/auth/login', loginThrottle, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  createSession(res, user.id);
  recordEvent(req, 'login', { role: user.role });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Any logged-in user can rotate their own password. Signs other sessions out.
router.post('/auth/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is wrong.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // invalidate everywhere
  createSession(res, user.id); // keep the current browser signed in
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const freeCredits = db.prepare(
    'SELECT COUNT(*) n FROM credits WHERE customer_id = ? AND used_by_booking_id IS NULL').get(req.user.id).n;
  const unreadNotifications = db.prepare(
    'SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
  // Dual roles: an admin can also have a coach profile (e.g. Kalle, Ben).
  const coachProfile = Boolean(db.prepare('SELECT 1 FROM coaches WHERE user_id = ?').get(req.user.id));
  res.json({ user: req.user, freeCredits, unreadNotifications, coachProfile });
});

router.get('/my-notifications', requireRole('customer', 'admin', 'coach'), (req, res) => {
  const rows = db.prepare(
    'SELECT id, message, created_at, read FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  const freeCredits = db.prepare(
    'SELECT COUNT(*) n FROM credits WHERE customer_id = ? AND used_by_booking_id IS NULL').get(req.user.id).n;
  res.json({ notifications: rows, freeCredits });
});

router.post('/my-notifications/read', requireRole('customer', 'admin', 'coach'), (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Booking (customers)
// ---------------------------------------------------------------------------
router.post('/bookings', requireRole('customer', 'admin'), (req, res) => {
  const coachId = Number(req.body?.coachId);
  const date = String(req.body?.date || '');
  const hour = Number(req.body?.hour);
  const position = String(req.body?.position || '');
  const focusId = String(req.body?.focus || '');
  let location = String(req.body?.location || '');

  const fail = (msg, status = 400) => {
    recordEvent(req, 'booking_failed', { reason: msg, coachId });
    return res.status(status).json({ error: msg });
  };

  const coach = db.prepare('SELECT * FROM coaches WHERE id = ? AND active = 1').get(coachId);
  if (!coach) return fail('Coach not found.', 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Invalid date.');
  if (!Number.isInteger(hour) || hour < config.dayStartHour || hour >= config.dayEndHour) {
    return fail(`Sessions run between ${config.dayStartHour}:00 and ${config.dayEndHour}:00.`);
  }
  const now = helsinkiNow();
  if (date < now.date || (date === now.date && hour <= now.hour)) return fail('That time is already in the past.');
  if (date > helsinkiDateOffset(config.bookingHorizonDays)) return fail('That date is too far ahead.');

  const focus = config.focusTypes.find(f => f.id === focusId);
  if (!focus) return fail('Please choose a session focus.');
  const coachPositions = parseJSON(coach.positions, []);
  if (!coachPositions.includes(position)) return fail('This coach does not train that position.');
  const coachLocations = parseJSON(coach.locations, []);
  if (focus.online) {
    location = 'Online';
  } else if (!coachLocations.includes(location)) {
    return fail('This coach does not train in that city.');
  }

  const slotOpen = db.prepare('SELECT 1 FROM availability WHERE coach_id = ? AND date = ? AND hour = ?')
    .get(coachId, date, hour);
  if (!slotOpen) return fail('The coach is not available at that time.');

  const price = (focus.online ? config.pricing.onlineSessionPrice : config.pricing.sessionPrice) * 100;
  let discount = Math.round(price * config.pricing.salePercent / 100);
  // A free-session credit (from a cancelled booking) beats the sale: 100% off.
  const credit = db.prepare(
    'SELECT id FROM credits WHERE customer_id = ? AND used_by_booking_id IS NULL ORDER BY id LIMIT 1')
    .get(req.user.id);
  if (credit) discount = price;
  const code = 'PBF-' + require('node:crypto').randomBytes(3).toString('hex').toUpperCase();

  let bookingId;
  try {
    const info = db.prepare(`INSERT INTO bookings
      (code, customer_id, coach_id, date, hour, location, position, focus, is_online,
       price_cents, discount_cents, total_cents, credit_applied, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',?)`)
      .run(code, req.user.id, coachId, date, hour, location, position, focus.id,
        focus.online ? 1 : 0, price, discount, price - discount, credit ? 1 : 0, nowISO());
    bookingId = Number(info.lastInsertRowid);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return fail('Someone just booked that slot — please pick another time.', 409);
    }
    throw err;
  }
  if (credit) {
    db.prepare('UPDATE credits SET used_by_booking_id = ? WHERE id = ?').run(bookingId, credit.id);
  }

  const invoice = createInvoiceForBooking(bookingId);
  recordEvent(req, 'booking_completed', { coachId, code });
  sheets.scheduleSync();

  res.status(201).json({
    booking: {
      code, date, hour, location, position, focus: focus.id, focusLabel: focus.label,
      online: focus.online, coach: coach.name,
      priceCents: price, discountCents: discount, totalCents: price - discount,
      creditApplied: Boolean(credit),
    },
    invoice: { number: invoice.number, dueDate: invoice.due_date, amountCents: invoice.amount_cents },
  });
});

router.get('/my-bookings', requireRole('customer', 'admin'), (req, res) => {
  autoCompleteBookings();
  const rows = db.prepare(`
    SELECT b.code, b.date, b.hour, b.location, b.position, b.focus, b.is_online, b.status,
           b.total_cents, c.name AS coach, i.number AS invoice_number
    FROM bookings b JOIN coaches c ON c.id = b.coach_id
    LEFT JOIN invoices i ON i.booking_id = b.id
    WHERE b.customer_id = ? ORDER BY b.date DESC, b.hour DESC`).all(req.user.id);
  res.json(rows);
});

// Customers can open their own invoices; admin can open any.
router.get('/invoices/:number', requireRole('customer', 'admin', 'coach'), (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, b.customer_id, b.coach_id FROM invoices i
    JOIN bookings b ON b.id = i.booking_id WHERE i.number = ?`).get(req.params.number);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  const isOwner = req.user.role === 'admin'
    || inv.customer_id === req.user.id
    || (req.user.role === 'coach' && db.prepare('SELECT 1 FROM coaches WHERE id = ? AND user_id = ?')
          .get(inv.coach_id, req.user.id));
  if (!isOwner) return res.status(403).json({ error: 'Not allowed.' });
  const file = path.join(OUTBOX, path.basename(inv.html_path || ''));
  if (!inv.html_path || !fs.existsSync(file)) return res.status(404).json({ error: 'Invoice file missing.' });
  res.type('html').send(fs.readFileSync(file, 'utf8'));
});

// ---------------------------------------------------------------------------
// Coach tools
// ---------------------------------------------------------------------------
function myCoach(req) {
  return db.prepare('SELECT * FROM coaches WHERE user_id = ?').get(req.user.id);
}

router.get('/coach/me', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  res.json(coachPublic(coach));
});

// Own calendar for a date range: published slots + which of them are booked.
router.get('/coach/availability', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  autoCompleteBookings();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : helsinkiNow().date;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : helsinkiDateOffset(13);
  const slots = db.prepare('SELECT date, hour FROM availability WHERE coach_id = ? AND date BETWEEN ? AND ?')
    .all(coach.id, from, to);
  const bookings = db.prepare(`
    SELECT b.date, b.hour, b.location, b.position, b.focus, b.status, u.name AS customer
    FROM bookings b JOIN users u ON u.id = b.customer_id
    WHERE b.coach_id = ? AND b.date BETWEEN ? AND ? AND b.status != 'cancelled'`)
    .all(coach.id, from, to);
  res.json({ from, to, slots, bookings });
});

// Applies an availability diff for a coach — used by the coach's own Save
// button and by the admin editing any coach's calendar.
function applyAvailabilityChanges(coachId, body) {
  const adds = Array.isArray(body?.adds) ? body.adds : [];
  const removes = Array.isArray(body?.removes) ? body.removes : [];
  if (adds.length + removes.length > 2000) return { error: 'Too many changes at once.' };

  const now = helsinkiNow();
  const horizon = helsinkiDateOffset(config.bookingHorizonDays);
  const valid = (s) => s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date))
    && Number.isInteger(s.hour) && s.hour >= config.dayStartHour && s.hour < config.dayEndHour
    && s.date <= horizon
    && (s.date > now.date || (s.date === now.date && s.hour > now.hour));

  const insSlot = db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)');
  const delSlot = db.prepare('DELETE FROM availability WHERE coach_id = ? AND date = ? AND hour = ?');
  const hasBooking = db.prepare(`SELECT 1 FROM bookings
    WHERE coach_id = ? AND date = ? AND hour = ? AND status != 'cancelled'`);

  let added = 0, removed = 0;
  const conflicts = [];
  const rejected = [];
  db.exec('BEGIN');
  try {
    for (const s of adds) {
      if (!valid(s)) { rejected.push(s); continue; }
      added += insSlot.run(coachId, s.date, s.hour, nowISO()).changes;
    }
    for (const s of removes) {
      if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !Number.isInteger(s.hour)) { rejected.push(s); continue; }
      if (hasBooking.get(coachId, s.date, s.hour)) { conflicts.push(s); continue; }
      removed += delSlot.run(coachId, s.date, s.hour).changes;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  sheets.scheduleSync();
  return { added, removed, conflicts, rejected };
}

// Save button on the coach calendar sends adds/removes as a diff.
router.put('/coach/availability', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  const result = applyAvailabilityChanges(coach.id, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.put('/coach/filters', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  const locations = Array.isArray(req.body?.locations)
    ? req.body.locations.filter(l => config.locations.includes(l)) : null;
  const positions = Array.isArray(req.body?.positions)
    ? req.body.positions.filter(p => config.positions.includes(p)) : null;
  if (!locations || !positions) return res.status(400).json({ error: 'Invalid filters.' });
  if (!locations.length) return res.status(400).json({ error: 'Pick at least one city.' });
  if (!positions.length) return res.status(400).json({ error: 'Pick at least one position group.' });
  db.prepare('UPDATE coaches SET locations = ?, positions = ? WHERE id = ?')
    .run(JSON.stringify(locations), JSON.stringify(positions), coach.id);
  sheets.scheduleSync();
  res.json({ locations, positions });
});

router.get('/coach/bookings', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  autoCompleteBookings();
  const rows = db.prepare(`
    SELECT b.code, b.date, b.hour, b.location, b.position, b.focus, b.is_online, b.status,
           b.price_cents, b.total_cents, b.credit_applied, u.name AS customer, u.email AS customer_email
    FROM bookings b JOIN users u ON u.id = b.customer_id
    WHERE b.coach_id = ?
    ORDER BY b.date DESC, b.hour DESC LIMIT 200`).all(coach.id);

  // Attach what the coach earns, in euros only (tier math stays server-side):
  // the locked amount for completed sessions, an estimate for upcoming ones
  // simulated in the booking's own month.
  const months = [...new Set(rows.filter(r => r.status === 'completed').map(r => tiers.monthOf(r.date)))];
  const payoutByMonth = new Map(months.map(m => [m, tiers.coachMonthPayouts(coach.id, m).byCode]));
  for (const r of rows) {
    if (r.status === 'completed') {
      r.earn_cents = payoutByMonth.get(tiers.monthOf(r.date))?.get(r.code) ?? null;
      r.earn_estimated = false;
    } else if (r.status === 'confirmed') {
      r.earn_cents = tiers.estimateUpcomingCents({ coach_id: coach.id, ...r });
      r.earn_estimated = true;
    } else {
      r.earn_cents = null;
      r.earn_estimated = false;
    }
    delete r.price_cents; // internal to the payout basis calc
  }
  res.json(rows);
});

// Coach's tier & earnings view. Deliberately contains NO percentages —
// only euro amounts and session counts.
router.get('/coach/tier', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  autoCompleteBookings();
  const status = tiers.coachTierStatus(coach.id);
  const monthPay = tiers.coachMonthPayouts(coach.id);
  res.json({
    month: status.month,
    sessionsThisMonth: status.sessionsThisMonth,
    tierNumber: status.tierIndex + 1,
    sessionLabel: status.tier.sessionLabel,
    sessionsToNextTier: status.sessionsToNextTier,
    nextTierNumber: status.nextTierNumber,
    earnPerSession: tiers.perSessionEarningsCents(status.tier),
    earnedThisMonthCents: monthPay.payoutCents,
    allTiers: config.coachTiers.map((t, i) => ({
      number: i + 1,
      sessions: t.sessionLabel,
      earnPerSession: tiers.perSessionEarningsCents(t),
    })),
  });
});

// The coach's own reviews (read-only), newest first, plus the average.
router.get('/coach/reviews', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  const reviews = db.prepare(
    `SELECT author_name, rating, body, substr(created_at,1,10) AS date
     FROM reviews WHERE coach_id = ? ORDER BY created_at DESC, id DESC`).all(coach.id);
  const agg = db.prepare('SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE coach_id = ?').get(coach.id);
  res.json({
    rating: { avg: agg.n ? Math.round(agg.avg * 10) / 10 : null, count: agg.n },
    reviews,
  });
});

// The status buttons on the coach's client list: current / completed / cancelled.
// Cancelling notifies the customer and grants them a free-session credit.
router.post('/coach/bookings/:code/status', requireRole('coach', 'admin'), (req, res) => {
  const coach = myCoach(req);
  if (!coach) return res.status(404).json({ error: 'No coach profile linked to this account.' });
  const to = String(req.body?.status || '');
  if (!['confirmed', 'completed', 'cancelled'].includes(to)) return res.status(400).json({ error: 'Bad status.' });
  const booking = db.prepare('SELECT * FROM bookings WHERE code = ? AND coach_id = ?')
    .get(String(req.params.code), coach.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === to) return res.json({ ok: true, status: to });
  if (to === 'completed' && !slotHasEnded(booking.date, booking.hour)) {
    return res.status(400).json({ error: "You can only mark a session complete once it has taken place." });
  }

  if (to === 'cancelled') {
    cancelWithCredit(booking, 'your coach');
  } else if (booking.status === 'cancelled') {
    const err = reactivateBooking(booking);
    if (err) return res.status(409).json({ error: err });
    if (to === 'completed') {
      db.prepare("UPDATE bookings SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(nowISO(), booking.id);
    }
  } else {
    db.prepare('UPDATE bookings SET status = ?, completed_at = ? WHERE id = ?')
      .run(to, to === 'completed' ? nowISO() : null, booking.id);
  }
  sheets.scheduleSync();
  res.json({ ok: true, status: to });
});

// ---------------------------------------------------------------------------
// Admin analytics + management
// ---------------------------------------------------------------------------
router.get('/admin/analytics', requireRole('admin'), (req, res) => {
  autoCompleteBookings();
  const today = helsinkiNow().date;
  const since = (days) => helsinkiDateOffset(-(days - 1)); // window includes today

  const one = (sql, ...params) => Object.values(db.prepare(sql).get(...params))[0] || 0;
  const windowed = (fn) => ({ d7: fn(since(7)), d30: fn(since(30)), d90: fn(since(90)), all: fn('0000-01-01') });

  const visitors = {
    pageviews: windowed(d => one('SELECT COUNT(*) FROM visits WHERE day >= ?', d)),
    unique: windowed(d => one('SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE day >= ?', d)),
  };

  const sessions = {
    pending: one("SELECT COUNT(*) FROM bookings WHERE status = 'confirmed'"),
    pendingValueCents: one("SELECT COALESCE(SUM(total_cents),0) FROM bookings WHERE status = 'confirmed'"),
    // Completed sessions are windowed on the session date, bounded to today so a
    // booking the admin marked done early (future date) can't leak into the past window.
    completed: windowed(d => one(
      "SELECT COUNT(*) FROM bookings WHERE status = 'completed' AND date >= ? AND date <= ?", d, today)),
    cancelledAll: one("SELECT COUNT(*) FROM bookings WHERE status = 'cancelled'"),
  };

  const started = windowed(d => one("SELECT COUNT(*) FROM events WHERE type = 'booking_started' AND day >= ?", d));
  const finished = windowed(d => one("SELECT COUNT(*) FROM events WHERE type = 'booking_completed' AND day >= ?", d));
  const funnel = {};
  for (const k of ['d7', 'd30', 'd90', 'all']) {
    funnel[k] = {
      started: started[k],
      completed: finished[k],
      // Clamp at 100%: "started" is a client event and "completed" is server-side,
      // so at window edges completed can slightly exceed started.
      rate: started[k] ? Math.min(100, Math.round(finished[k] / started[k] * 100)) : null,
    };
  }

  const revenue = {
    completedCents: windowed(d =>
      one("SELECT COALESCE(SUM(total_cents),0) FROM bookings WHERE status = 'completed' AND date >= ? AND date <= ?", d, today)),
    invoicesPaidCents: one("SELECT COALESCE(SUM(amount_cents),0) FROM invoices WHERE status = 'paid'"),
    invoicesOutstandingCents: one("SELECT COALESCE(SUM(amount_cents),0) FROM invoices WHERE status = 'sent'"),
  };

  const customers = {
    total: one("SELECT COUNT(*) FROM users WHERE role = 'customer'"),
    new: windowed(d => one("SELECT COUNT(*) FROM users WHERE role = 'customer' AND substr(created_at,1,10) >= ?", d)),
  };

  const horizon14 = helsinkiDateOffset(13);
  const coaches = db.prepare('SELECT * FROM coaches WHERE active = 1 ORDER BY display_order, id').all()
    .map(c => {
      const completed = windowed(d =>
        one("SELECT COUNT(*) FROM bookings WHERE coach_id = ? AND status = 'completed' AND date >= ? AND date <= ?", c.id, d, today));
      const upcoming = one("SELECT COUNT(*) FROM bookings WHERE coach_id = ? AND status = 'confirmed'", c.id);
      // Earned revenue = completed sessions only, matching the headline figure.
      const revenueCompletedCents = one(
        "SELECT COALESCE(SUM(total_cents),0) FROM bookings WHERE coach_id = ? AND status = 'completed'", c.id);
      // Booked value including upcoming (shown separately so it isn't confused with earned revenue).
      const bookedValueCents = one(
        "SELECT COALESCE(SUM(total_cents),0) FROM bookings WHERE coach_id = ? AND status != 'cancelled'", c.id);
      const slotsNext14 = one(
        'SELECT COUNT(*) FROM availability WHERE coach_id = ? AND date BETWEEN ? AND ?', c.id, today, horizon14);
      // Any non-cancelled booking in the window occupies a slot (confirmed or already completed).
      const bookedNext14 = one(
        "SELECT COUNT(*) FROM bookings WHERE coach_id = ? AND status != 'cancelled' AND date BETWEEN ? AND ?",
        c.id, today, horizon14);
      const tierStatus = tiers.coachTierStatus(c.id);
      const monthPay = tiers.coachMonthPayouts(c.id);
      return {
        id: c.id, name: c.name, slug: c.slug,
        locations: parseJSON(c.locations, []), positions: parseJSON(c.positions, []),
        completed, upcoming, revenueCompletedCents, bookedValueCents, slotsNext14, bookedNext14,
        utilization: slotsNext14 ? Math.min(100, Math.round(bookedNext14 / slotsNext14 * 100)) : null,
        // Admin-only commission view (percentages allowed here).
        tier: {
          number: tierStatus.tierIndex + 1,
          percent: tierStatus.tier.percent,
          sessionsThisMonth: tierStatus.sessionsThisMonth,
          payoutThisMonthCents: monthPay.payoutCents,
        },
      };
    });

  // 90-day daily series for the charts.
  const days = [];
  for (let i = 89; i >= 0; i--) days.push(helsinkiDateOffset(-i));
  const mapDays = (rows, key) => {
    const m = new Map(rows.map(r => [r.day || r.date, r.n]));
    return days.map(d => m.get(d) || 0);
  };
  const series = {
    days,
    pageviews: mapDays(db.prepare(
      'SELECT day, COUNT(*) n FROM visits WHERE day >= ? GROUP BY day').all(days[0])),
    completedSessions: mapDays(db.prepare(
      "SELECT date, COUNT(*) n FROM bookings WHERE status='completed' AND date >= ? AND date <= ? GROUP BY date").all(days[0], today)),
    funnelStarted: mapDays(db.prepare(
      "SELECT day, COUNT(*) n FROM events WHERE type='booking_started' AND day >= ? GROUP BY day").all(days[0])),
    funnelCompleted: mapDays(db.prepare(
      "SELECT day, COUNT(*) n FROM events WHERE type='booking_completed' AND day >= ? GROUP BY day").all(days[0])),
  };

  res.json({
    generatedAt: nowISO(), today,
    visitors, sessions, funnel, revenue, customers, coaches, series,
    sheets: sheets.status(),
    demoDataPresent: Boolean(db.prepare("SELECT 1 FROM meta WHERE key='demo_seeded'").get()),
  });
});

// Read-only view of any coach's calendar for the admin overview.
router.get('/admin/coaches/:id/calendar', requireRole('admin'), (req, res) => {
  const coach = db.prepare('SELECT * FROM coaches WHERE id = ?').get(Number(req.params.id));
  if (!coach) return res.status(404).json({ error: 'Coach not found.' });
  autoCompleteBookings();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : helsinkiNow().date;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : helsinkiDateOffset(13);
  const slots = db.prepare('SELECT date, hour FROM availability WHERE coach_id = ? AND date BETWEEN ? AND ?')
    .all(coach.id, from, to);
  const bookings = db.prepare(`
    SELECT b.date, b.hour, b.location, b.position, b.focus, b.status, u.name AS customer
    FROM bookings b JOIN users u ON u.id = b.customer_id
    WHERE b.coach_id = ? AND b.date BETWEEN ? AND ? AND b.status != 'cancelled'`)
    .all(coach.id, from, to);
  res.json({ coach: coachPublic(coach), from, to, slots, bookings });
});

// The admin can edit any coach's availability (same rules as the coach's own
// editor: only future slots within 8-20, booked slots can't be closed).
router.put('/admin/coaches/:id/availability', requireRole('admin'), (req, res) => {
  const coach = db.prepare('SELECT id FROM coaches WHERE id = ?').get(Number(req.params.id));
  if (!coach) return res.status(404).json({ error: 'Coach not found.' });
  const result = applyAvailabilityChanges(coach.id, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Full editable detail for one coach (admin coach-management modal).
router.get('/admin/coaches/:id', requireRole('admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Coach not found.' });
  const user = c.user_id ? db.prepare('SELECT email, role FROM users WHERE id = ?').get(c.user_id) : null;
  res.json({
    id: c.id, name: c.name, slug: c.slug, bio: c.bio,
    photos: parseJSON(c.photos, []),
    positions: parseJSON(c.positions, []),
    locations: parseJSON(c.locations, []),
    featured: Boolean(c.featured),
    account: { hasLogin: !!user, email: user ? user.email : null, isAdmin: user ? user.role === 'admin' : false },
  });
});

// Create a coach from the admin UI: details + photos, and optionally a login.
router.post('/admin/coaches', requireRole('admin'), (req, res) => {
  const v = readCoachFields(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const images = Array.isArray(req.body?.photos) ? req.body.photos.filter(Boolean) : [];
  if (!images.length) return res.status(400).json({ error: 'Add at least one photo (2–3 recommended).' });

  // Validate an optional login BEFORE writing any files, so a bad password
  // doesn't leave orphan images on disk.
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const wantsLogin = !!(email || password);
  if (wantsLogin) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
  }

  const slug = uniqueSlug(slugify(v.name));
  let photos;
  try { photos = resolvePhotos(images, slug); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!photos.length) return res.status(400).json({ error: 'Add at least one photo (2–3 recommended).' });

  // Create the login (if any) and the coach in one transaction, so a failure can
  // never leave a half-made coach (user row without a coach, or vice-versa).
  db.exec('BEGIN');
  try {
    let userId = null;
    if (wantsLogin) {
      // SECURITY: role is hardcoded to 'coach' — never take it from the request,
      // or an admin could mint another admin. The users CHECK constraint backs this up.
      userId = Number(db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?,?,?,?,?)')
        .run(email, bcrypt.hashSync(password, 10), v.name, 'coach', nowISO()).lastInsertRowid);
    }
    const order = db.prepare('SELECT COALESCE(MAX(display_order),0)+10 AS n FROM coaches').get().n;
    const info = db.prepare(`INSERT INTO coaches
      (user_id, name, slug, bio, photos, locations, positions, featured, display_order, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(userId, v.name, slug, v.bio, JSON.stringify(photos),
        JSON.stringify(v.locations), JSON.stringify(v.positions), v.featured, order, nowISO());
    db.exec('COMMIT');
    sheets.scheduleSync();
    return res.json({ ok: true, id: Number(info.lastInsertRowid), slug });
  } catch (err) {
    db.exec('ROLLBACK');
    // The DB write failed — delete the images we just wrote for this coach so
    // they don't pile up as orphans on the disk.
    for (const p of photos) {
      if (p.startsWith('/uploads/')) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(p))); } catch { /* ignore */ } }
    }
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That coach clashed with an existing one — please try again.' });
    }
    throw err;
  }
});

// Update a coach's details, filters, photos and featured flag.
router.put('/admin/coaches/:id', requireRole('admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Coach not found.' });
  const v = readCoachFields(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  let photos = parseJSON(c.photos, []);
  if (Array.isArray(req.body?.photos)) {
    let resolved;
    try { resolved = resolvePhotos(req.body.photos, c.slug); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    if (!resolved.length) return res.status(400).json({ error: 'A coach needs at least one photo.' });
    photos = resolved;
  }
  db.prepare('UPDATE coaches SET name=?, bio=?, locations=?, positions=?, featured=?, photos=? WHERE id=?')
    .run(v.name, v.bio, JSON.stringify(v.locations), JSON.stringify(v.positions), v.featured,
      JSON.stringify(photos), c.id);
  if (c.user_id) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(v.name, c.user_id); // keep login name in sync
  sheets.scheduleSync();
  res.json({ ok: true });
});

// Set or change a coach's login email / password. Creates a login for a
// coach that doesn't have one yet (e.g. one added without an account).
router.put('/admin/coaches/:id/account', requireRole('admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Coach not found.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address does not look right.' });
  if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (c.user_id) {
    if (!email && !password) return res.status(400).json({ error: 'Nothing to change.' });
    if (email) {
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, c.user_id)) {
        return res.status(409).json({ error: 'Another account already uses that email.' });
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, c.user_id);
    }
    if (password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), c.user_id);
      if (c.user_id === req.user.id) {
        // Admin changing their OWN linked account (e.g. Ben on the owner login):
        // drop other sessions but keep the current one so they aren't locked out.
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(c.user_id, req.sessionToken || '');
      } else {
        // Changing another coach's password signs them out so the new one takes
        // hold, and leaves them a note explaining why.
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(c.user_id);
        db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
          .run(c.user_id, 'An administrator updated your login password — please sign in with the new password.', nowISO());
      }
    }
    return res.json({ ok: true, created: false });
  }
  // No login yet — create one (both fields required).
  if (!email || !password) return res.status(400).json({ error: 'Set both an email and a password to create a login.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  const userId = Number(db.prepare('INSERT INTO users (email, password_hash, name, role, created_at) VALUES (?,?,?,?,?)')
    .run(email, bcrypt.hashSync(password, 10), c.name, 'coach', nowISO()).lastInsertRowid);
  db.prepare('UPDATE coaches SET user_id = ? WHERE id = ?').run(userId, c.id);
  res.json({ ok: true, created: true });
});

router.get('/admin/bookings', requireRole('admin'), (req, res) => {
  autoCompleteBookings();
  const status = ['confirmed', 'completed', 'cancelled'].includes(String(req.query.status))
    ? String(req.query.status) : null;
  const rows = db.prepare(`
    SELECT b.id, b.code, b.date, b.hour, b.location, b.position, b.focus, b.is_online,
           b.total_cents, b.status, b.created_at,
           c.name AS coach, u.name AS customer, u.email AS customer_email,
           i.number AS invoice_number, i.status AS invoice_status
    FROM bookings b
    JOIN coaches c ON c.id = b.coach_id
    JOIN users u ON u.id = b.customer_id
    LEFT JOIN invoices i ON i.booking_id = b.id
    ${status ? 'WHERE b.status = ?' : ''}
    ORDER BY b.date DESC, b.hour DESC LIMIT 300`).all(...(status ? [status] : []));
  res.json(rows);
});

router.post('/admin/bookings/:id/status', requireRole('admin'), (req, res) => {
  const to = String(req.body?.status || '');
  if (!['completed', 'cancelled', 'confirmed'].includes(to)) return res.status(400).json({ error: 'Bad status.' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === to) return res.json({ ok: true });
  if (to === 'completed' && !slotHasEnded(booking.date, booking.hour)) {
    return res.status(400).json({ error: 'A session can only be completed once it has taken place.' });
  }

  if (to === 'cancelled') {
    // Same customer treatment as a coach cancel: void invoice, credit, notify.
    cancelWithCredit(booking, 'the Proballers team');
  } else if (booking.status === 'cancelled') {
    const err = reactivateBooking(booking);
    if (err) return res.status(409).json({ error: err });
    if (to === 'completed') {
      db.prepare("UPDATE bookings SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(nowISO(), booking.id);
    }
  } else {
    db.prepare('UPDATE bookings SET status = ?, completed_at = ? WHERE id = ?')
      .run(to, to === 'completed' ? nowISO() : null, booking.id);
  }
  sheets.scheduleSync();
  res.json({ ok: true });
});

// CRM: every customer account with their booking history and money status,
// plus the full invoice ledger (paid / sent / void).
router.get('/admin/crm', requireRole('admin'), (req, res) => {
  autoCompleteBookings();
  const customers = db.prepare(`
    SELECT u.id, u.name, u.email, substr(u.created_at, 1, 10) AS signed_up,
      COUNT(b.id) AS bookings,
      SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN i.status = 'sent' THEN i.amount_cents ELSE 0 END), 0) AS outstanding_cents,
      (SELECT COUNT(*) FROM credits c WHERE c.customer_id = u.id AND c.used_by_booking_id IS NULL) AS free_credits,
      MAX(b.date) AS last_session
    FROM users u
    LEFT JOIN bookings b ON b.customer_id = u.id
    LEFT JOIN invoices i ON i.booking_id = b.id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC`).all();
  const invoices = db.prepare(`
    SELECT i.number, i.amount_cents, substr(i.issued_at, 1, 10) AS issued, i.due_date, i.status,
      u.name AS customer, u.email AS customer_email, b.code AS booking_code, c.name AS coach
    FROM invoices i
    JOIN bookings b ON b.id = i.booking_id
    JOIN users u ON u.id = b.customer_id
    JOIN coaches c ON c.id = b.coach_id
    ORDER BY i.id DESC LIMIT 300`).all();
  const totals = {
    paidCents: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0),
    outstandingCents: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.amount_cents, 0),
    overdue: invoices.filter(i => i.status === 'sent' && i.due_date < helsinkiNow().date).length,
  };
  const reviews = db.prepare(`
    SELECT r.id, c.name AS coach, r.author_name, r.rating, r.body,
      substr(r.created_at,1,10) AS date, r.demo
    FROM reviews r JOIN coaches c ON c.id = r.coach_id
    ORDER BY r.created_at DESC, r.id DESC LIMIT 300`).all();
  res.json({ customers, invoices, totals, reviews });
});

// Admin moderation: remove a review outright.
router.post('/admin/reviews/:id/delete', requireRole('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Review not found.' });
  res.json({ ok: true });
});

router.post('/admin/invoices/:number/paid', requireRole('admin'), (req, res) => {
  const inv = db.prepare('SELECT status FROM invoices WHERE number = ?').get(req.params.number);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  if (inv.status === 'paid') return res.json({ ok: true });
  if (inv.status !== 'sent') {
    return res.status(409).json({ error: 'This invoice is voided (its booking was cancelled) — it cannot be marked paid.' });
  }
  db.prepare("UPDATE invoices SET status = 'paid' WHERE number = ? AND status = 'sent'").run(req.params.number);
  res.json({ ok: true });
});

// CSV export of any dataset (same data the Google Sheet gets).
router.get('/admin/export/:name.csv', requireRole('admin'), (req, res) => {
  const data = require('../sheets-datasets')();
  const list = data[req.params.name];
  if (!list) return res.status(404).json({ error: 'Unknown dataset. Options: ' + Object.keys(data).join(', ') });
  res.type('text/csv').attachment(`${req.params.name}.csv`).send(require('../csv').toCSV(list));
});

router.post('/admin/sheets/sync', requireRole('admin'), async (req, res) => {
  try {
    res.json(await sheets.syncAll());
  } catch (err) {
    res.status(502).json({ error: 'Sheets sync failed: ' + err.message });
  }
});

router.post('/admin/demo-data/remove', requireRole('admin'), (req, res) => {
  require('../../scripts/seed').removeDemoData();
  res.json({ ok: true });
});

module.exports = router;
