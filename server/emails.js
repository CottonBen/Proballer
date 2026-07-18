// Customer lifecycle emails — the site's main channel to clients.
//
// Transactional (fire-and-forget, never block the caller):
//   welcome  — right after signup
//   booking  — the moment a booking is definitely ON. Sent from the same
//              chokepoint that tells the coach (server/notify.js): free and
//              bank-transfer bookings immediately, card bookings when the
//              payment confirms.
//   pitch    — the coach picked the pitch for a session
// Scheduled (runEmailAutomation — every few minutes from server/app.js, plus
// the admin dashboard's "send due emails now" button):
//   review   — the day AFTER a completed session, from 12:00 Helsinki
//   rebook   — 3 days after a completed session, from 12:00 Helsinki,
//              skipped when the customer already has an upcoming booking
// Every send is recorded in email_log (ok / error), shown on the admin page.
'use strict';

const config = require('../config');
const { db, nowISO, helsinkiNow, autoCompleteBookings } = require('./db');
const { sendMail } = require('./mailer');
const { tr, trCfg, focusLabel, localDate, hourRange, pickLang } = require('./i18n');

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Rendering: one shared shell so every email looks like the brand.
// ---------------------------------------------------------------------------
function shell(lang, title, bodyHtml) {
  return `<!doctype html>
<html lang="${lang}"><body style="margin:0;background:#f0f0f1;padding:26px 12px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#18181b;border:1px solid #e4e4e7">
    <div style="background:#0a0a0b;padding:16px 28px">
      <span style="color:#ffffff;font-weight:800;letter-spacing:.08em;font-size:.95rem">
        ${esc(config.siteName).toUpperCase()}</span>
    </div>
    <div style="padding:26px 28px 18px">
      <h2 style="margin:0 0 14px;font-size:1.4rem">${esc(title)}</h2>
      ${bodyHtml}
      <p style="color:#6b6b70;font-size:.9rem;margin-top:26px">${esc(tr(lang, 'email.signoff'))}</p>
    </div>
  </div>
</body></html>`;
}

const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="background:#0a0a0b;color:#ffffff;
    text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;display:inline-block">
    ${esc(label)}</a></p>`;

const detailBox = (lines) =>
  `<div style="background:#f4f4f5;border-radius:10px;padding:14px 18px;margin:14px 0">
    ${lines.map((l) => `<p style="margin:4px 0"><strong>${esc(l)}</strong></p>`).join('')}</div>`;

// ---------------------------------------------------------------------------
// Delivery. Fire-and-forget: callers never await or crash on email problems.
// The mailer itself records every attempt (success or failure) in email_log.
// ---------------------------------------------------------------------------
function deliver({ type, userId = null, bookingCode = null, to, subject, html }) {
  sendMail({ to, subject, html, log: { type, userId, bookingCode } })
    .catch((err) => console.error(`[emails] ${type} -> ${to}:`, err.message));
}

// Booking + customer + coach in one go, ready for template params.
function bookingBundle(bookingId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b) return null;
  const customer = db.prepare('SELECT id, name, email, lang FROM users WHERE id = ?').get(b.customer_id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(b.coach_id);
  if (!customer || !coach) return null;
  const focus = config.focusTypes.find((f) => f.id === b.focus) || b.focus;
  return { b, customer, coach, focus, lang: pickLang(customer.lang) };
}

// ---------------------------------------------------------------------------
// Transactional emails
// ---------------------------------------------------------------------------
function sendWelcomeEmail(userId) {
  const u = db.prepare('SELECT id, name, email, lang FROM users WHERE id = ?').get(userId);
  if (!u) return;
  const lang = pickLang(u.lang);
  const subject = tr(lang, 'email.welcome.subject', { siteName: config.siteName });
  const html = shell(lang, tr(lang, 'email.welcome.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: u.name }))}</p>
     <p>${esc(tr(lang, 'email.welcome.body'))}</p>
     ${button(`${config.siteUrl}/#coaches`, tr(lang, 'email.welcome.cta'))}`);
  deliver({ type: 'welcome', userId: u.id, to: u.email, subject, html });
}

function sendBookingConfirmedEmail(bookingId) {
  const x = bookingBundle(bookingId);
  if (!x) return;
  const { b, customer, coach, focus, lang } = x;
  const subject = tr(lang, 'email.booking.subject',
    { siteName: config.siteName, date: localDate(lang, b.date) });
  const html = shell(lang, tr(lang, 'email.booking.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: customer.name }))}</p>
     <p>${esc(tr(lang, 'email.booking.body'))}</p>
     ${detailBox([
       tr(lang, 'email.booking.line', {
         coach: coach.name, date: localDate(lang, b.date), hours: hourRange(lang, b.hour),
         focus: focusLabel(lang, focus), location: trCfg(lang, b.location),
       }),
       tr(lang, 'email.booking.ref', { code: b.code }),
     ])}
     ${b.is_online ? '' : `<p style="color:#6b6b70">${esc(tr(lang, 'email.booking.pitchNote'))}</p>`}
     ${button(`${config.siteUrl}/my-bookings`, tr(lang, 'email.booking.cta'))}`);
  deliver({ type: 'booking', userId: customer.id, bookingCode: b.code, to: customer.email, subject, html });
}

// `pitch` = { name, address? } — already resolved by the pitch endpoint.
function sendPitchConfirmedEmail(bookingId, pitch) {
  const x = bookingBundle(bookingId);
  if (!x) return;
  const { b, customer, coach, lang } = x;
  const subject = tr(lang, 'email.pitch.subject', { siteName: config.siteName, pitch: pitch.name });
  const html = shell(lang, tr(lang, 'email.pitch.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: customer.name }))}</p>
     <p>${esc(tr(lang, 'email.pitch.body', {
       coach: coach.name, date: localDate(lang, b.date), hours: hourRange(lang, b.hour) }))}</p>
     ${detailBox([pitch.name + (pitch.address ? ' · ' + pitch.address : '')])}
     ${button(`${config.siteUrl}/my-bookings`, tr(lang, 'email.pitch.cta'))}`);
  deliver({ type: 'pitch', userId: customer.id, bookingCode: b.code, to: customer.email, subject, html });
}

// The coach's copy of a confirmed booking: sent the moment the booking is
// announced (payment confirmed), with marching orders — open the coach app,
// pick the pitch, message the player. Skipped for coaches without a login.
function sendCoachBookingEmail(bookingId) {
  const x = bookingBundle(bookingId);
  if (!x) return;
  const { b, customer, focus } = x;
  const coachUser = db.prepare(`SELECT u.name, u.email, u.lang FROM coaches c
    JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(b.coach_id);
  if (!coachUser) return;
  const lang = pickLang(coachUser.lang);
  const subject = tr(lang, 'email.coachbooking.subject',
    { siteName: config.siteName, date: localDate(lang, b.date) });
  const html = shell(lang, tr(lang, 'email.coachbooking.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: coachUser.name }))}</p>
     <p>${esc(tr(lang, 'email.coachbooking.body', { customer: customer.name }))}</p>
     ${detailBox([
       tr(lang, 'email.booking.line', {
         coach: customer.name, date: localDate(lang, b.date), hours: hourRange(lang, b.hour),
         focus: focusLabel(lang, focus), location: trCfg(lang, b.location),
       }),
       tr(lang, 'email.coachbooking.ref', { code: b.code }),
     ])}
     ${b.notes ? `<p>${esc(tr(lang, 'email.coachbooking.notes', { notes: b.notes }))}</p>` : ''}
     <p>${esc(tr(lang, b.is_online ? 'email.coachbooking.steps_online' : 'email.coachbooking.steps'))}</p>
     ${button(`${config.siteUrl}/app`, tr(lang, 'email.coachbooking.cta'))}`);
  deliver({ type: 'coach_booking', bookingCode: b.code, to: coachUser.email, subject, html });
}

// The unpaid-booking sweep cancelled this booking (payment never completed):
// tell the customer plainly that nothing is booked and nothing was charged,
// so an interrupted checkout can't be mistaken for a confirmed session.
function sendBookingReleasedEmail(bookingId) {
  const x = bookingBundle(bookingId);
  if (!x) return;
  const { b, customer, coach, lang } = x;
  const subject = tr(lang, 'email.release.subject', { siteName: config.siteName });
  const html = shell(lang, tr(lang, 'email.release.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: customer.name }))}</p>
     <p>${esc(tr(lang, 'email.release.body', {
       code: b.code, date: localDate(lang, b.date), hours: hourRange(lang, b.hour), coach: coach.name }))}</p>
     <p style="color:#6b6b70">${esc(tr(lang, 'email.release.note'))}</p>
     ${button(`${config.siteUrl}/#coaches`, tr(lang, 'email.release.cta'))}`);
  deliver({ type: 'release', userId: customer.id, bookingCode: b.code, to: customer.email, subject, html });
}

// ---------------------------------------------------------------------------
// Scheduled follow-ups
// ---------------------------------------------------------------------------

// 'YYYY-MM-DD' + n days (calendar arithmetic, DST-safe).
function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function sendReviewRequestEmail(r) {
  const lang = pickLang(r.lang);
  const subject = tr(lang, 'email.review.subject', { siteName: config.siteName });
  const html = shell(lang, tr(lang, 'email.review.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: r.name }))}</p>
     <p>${esc(tr(lang, 'email.review.body', { coach: r.coach, date: localDate(lang, r.date) }))}</p>
     ${button(`${config.siteUrl}/my-bookings`, tr(lang, 'email.review.cta'))}`);
  deliver({ type: 'review', userId: r.customer_id, bookingCode: r.code, to: r.email, subject, html });
}

function sendRebookEmail(r) {
  const lang = pickLang(r.lang);
  const subject = tr(lang, 'email.rebook.subject', { siteName: config.siteName });
  const html = shell(lang, tr(lang, 'email.rebook.title'),
    `<p>${esc(tr(lang, 'email.greeting', { name: r.name }))}</p>
     <p>${esc(tr(lang, 'email.rebook.body', { coach: r.coach, date: localDate(lang, r.date) }))}</p>
     ${button(`${config.siteUrl}/#coaches`, tr(lang, 'email.rebook.cta'))}`);
  deliver({ type: 'rebook', userId: r.customer_id, bookingCode: r.code, to: r.email, subject, html });
}

// The automation sweep. Runs on an interval and from the admin button; both
// paths are idempotent — each booking's flag is set BEFORE its email is handed
// to the mailer, so a failed send never causes a duplicate blast later (the
// failure still lands in email_log for the admin to see).
function runEmailAutomation() {
  autoCompleteBookings(); // sessions complete lazily — settle statuses first
  const hki = helsinkiNow();
  // Due when Helsinki time has reached 12:00 on (session date + days).
  const dueAtNoon = (sessionDate, days) => {
    const target = addDays(sessionDate, days);
    return hki.date > target || (hki.date === target && hki.hour >= 12);
  };
  const sent = { review: 0, rebook: 0 };

  // Review request — day after the session at noon. The date window keeps a
  // fresh deployment from blasting emails about months-old sessions.
  const reviewRows = db.prepare(`
    SELECT b.id, b.code, b.date, b.customer_id, u.name, u.email, u.lang, c.name AS coach
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    JOIN coaches c ON c.id = b.coach_id
    WHERE b.status = 'completed' AND b.review_email_sent = 0
      AND b.demo = 0 AND u.demo = 0 AND u.role = 'customer'
      AND b.date >= ?`).all(addDays(hki.date, -7));
  for (const r of reviewRows) {
    if (!dueAtNoon(r.date, 1)) continue;
    db.prepare('UPDATE bookings SET review_email_sent = 1 WHERE id = ?').run(r.id);
    sendReviewRequestEmail(r);
    sent.review += 1;
  }

  // Book-again nudge — 3 days after the session at noon, only for customers
  // with nothing upcoming (someone who already rebooked isn't nagged). One
  // email per customer per run, even if several sessions come due at once.
  const rebookRows = db.prepare(`
    SELECT b.id, b.code, b.date, b.customer_id, u.name, u.email, u.lang, c.name AS coach
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    JOIN coaches c ON c.id = b.coach_id
    WHERE b.status = 'completed' AND b.rebook_email_sent = 0
      AND b.demo = 0 AND u.demo = 0 AND u.role = 'customer'
      AND b.date >= ?
      AND NOT EXISTS (SELECT 1 FROM bookings f
        WHERE f.customer_id = b.customer_id AND f.status = 'confirmed' AND f.date >= ?)
    ORDER BY b.date DESC`).all(addDays(hki.date, -10), hki.date);
  const nudged = new Set();
  for (const r of rebookRows) {
    if (!dueAtNoon(r.date, 3)) continue;
    db.prepare('UPDATE bookings SET rebook_email_sent = 1 WHERE id = ?').run(r.id);
    if (nudged.has(r.customer_id)) continue; // flag every row, email once
    nudged.add(r.customer_id);
    sendRebookEmail(r);
    sent.rebook += 1;
  }

  db.prepare(`INSERT INTO meta (key, value) VALUES ('email_automation:last_run', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(nowISO());
  return sent;
}

// Snapshot for the admin dashboard: last sweep time, per-type counters, and
// the most recent sends (including failures, with the SMTP error).
function automationStatus() {
  const lastRun = db.prepare("SELECT value FROM meta WHERE key = 'email_automation:last_run'").get();
  const counts = {};
  for (const r of db.prepare(
    'SELECT type, COUNT(*) AS total, COALESCE(SUM(ok),0) AS ok FROM email_log GROUP BY type').all()) {
    counts[r.type] = { total: r.total, ok: r.ok };
  }
  const recent = db.prepare(`SELECT type, booking_code, to_email, subject, ok, error, created_at
    FROM email_log ORDER BY id DESC LIMIT 20`).all();
  return { lastRun: lastRun ? lastRun.value : null, counts, recent };
}

module.exports = {
  sendWelcomeEmail,
  sendBookingConfirmedEmail,
  sendCoachBookingEmail,
  sendPitchConfirmedEmail,
  sendBookingReleasedEmail,
  runEmailAutomation,
  automationStatus,
};
