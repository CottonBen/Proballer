// Prepaid 1-on-1 session packages (3/5/8 sessions, paid upfront by card).
//
// The core invariant: a package's remaining balance is DERIVED, never stored —
//   remaining = sessions_total + adjust_sessions − COUNT(non-cancelled
//               bookings with bookings.package_id = package.id)
// so a cancelled booking returns its session automatically and the balance can
// never drift. Bookings funded by a package carry the package's per-session
// value in total_cents (that keeps the coach-payout basis honest) but create
// NO invoice — the package purchase itself was the payment.
'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { db, nowISO, helsinkiNow } = require('./db');

const genCode = (prefix) => prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

// Multi-session package options (the 'single' entry is the pay-per-session flow).
const packageOptions = () => config.packages.filter((p) => p.sessions > 1);
const findOption = (id) => packageOptions().find((p) => p.id === id);

// What one session of this package is worth, for coach-payout purposes.
const perSessionCents = (pkg) => Math.round(pkg.price_cents / pkg.sessions_total);

function usedSessions(packageId) {
  return db.prepare(`SELECT COUNT(*) n FROM bookings
    WHERE package_id = ? AND status != 'cancelled'`).get(packageId).n;
}

function remainingSessions(pkg) {
  if (pkg.status !== 'active') return 0;
  return Math.max(0, pkg.sessions_total + pkg.adjust_sessions - usedSessions(pkg.id));
}

// The package that funds the customer's next booking: oldest active one with
// sessions left, so balances are spent in purchase order.
function pickPackageForBooking(customerId) {
  const rows = db.prepare(`SELECT * FROM packages
    WHERE customer_id = ? AND status = 'active' ORDER BY id`).all(customerId);
  return rows.find((p) => remainingSessions(p) > 0) || null;
}

// Everything the customer dashboard needs: live balance + purchase history.
function customerPackageSummary(customerId) {
  const rows = db.prepare(`SELECT * FROM packages
    WHERE customer_id = ? AND status != 'void' ORDER BY id DESC`).all(customerId);
  const shaped = rows.map((p) => ({
    code: p.code,
    sessions: p.sessions_total,
    priceCents: p.price_cents,
    status: p.status,
    remaining: remainingSessions(p),
    used: usedSessions(p.id),
    adjusted: p.adjust_sessions,
    purchasedAt: (p.paid_at || p.created_at).slice(0, 10),
    pending: p.status === 'pending',
  }));
  return {
    remaining: shaped.filter((p) => p.status === 'active').reduce((s, p) => s + p.remaining, 0),
    packages: shaped,
  };
}

// A new pending purchase, held until pay_by like an unpaid booking.
function createPackagePurchase(customerId, optionId) {
  const opt = findOption(optionId);
  if (!opt) return null;
  const info = db.prepare(`INSERT INTO packages
    (code, customer_id, sessions_total, price_cents, status, pay_by, created_at)
    VALUES (?,?,?,?, 'pending', ?, ?)`)
    .run(genCode('PKG'), customerId, opt.sessions, opt.price * 100,
      new Date(Date.now() + config.stripe.payWindowMinutes * 60000).toISOString(), nowISO());
  return db.prepare('SELECT * FROM packages WHERE id = ?').get(Number(info.lastInsertRowid));
}

// Payment confirmed (webhook or success-URL refresh; both call this,
// idempotent). A package is not slot-bound, so even a payment landing after
// the pending-purchase sweep voided it simply activates it — the customer
// paid, the sessions are theirs. Any linked wizard booking is announced to
// its coach if the slot survived; if not, the sessions stay usable anyway.
function markPackagePaid(code, stripeSession) {
  const pkg = db.prepare('SELECT * FROM packages WHERE code = ?').get(code);
  if (!pkg || pkg.status === 'active') return false;
  db.prepare("UPDATE packages SET status = 'active', paid_at = ? WHERE id = ?").run(nowISO(), pkg.id);
  // Mirror the purchased package into the CRM (no-op without ATTIO_API_KEY).
  require('./attio').syncPackage(pkg.id);

  // The wizard's "buy a package + book the first session" flow: the booking
  // was created pointing at this (then-pending) package and the coach has not
  // heard about it yet. Confirm it now — unless the sweep already released it.
  const linked = db.prepare(`SELECT id, status, coach_notified FROM bookings
    WHERE package_id = ? ORDER BY id`).all(pkg.id);
  for (const b of linked) {
    if (b.status === 'confirmed' && !b.coach_notified) {
      require('./notify').announceBookingToCoach(b.id);
    } else if (b.status === 'cancelled') {
      // Released while the payment was in flight; try to restore the slot.
      const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id);
      const clash = db.prepare(`SELECT 1 FROM bookings
        WHERE coach_id = ? AND date = ? AND hour = ? AND status != 'cancelled' AND id != ?`)
        .get(row.coach_id, row.date, row.hour, row.id);
      const hki = helsinkiNow();
      const inPast = row.date < hki.date || (row.date === hki.date && row.hour <= hki.hour);
      if (!clash && !inPast) {
        db.prepare("UPDATE bookings SET status = 'confirmed', completed_at = NULL WHERE id = ?").run(row.id);
        require('./notify').announceBookingToCoach(row.id);
      }
      // Slot gone: nothing to restore — the paid sessions remain on the
      // package balance for the customer to book with.
    }
  }
  require('./emails').sendPackagePurchasedEmail(pkg.id);
  require('./sheets').scheduleSync();
  return true;
}

// After a booking consumed (or returned) a package session: send the one-shot
// "1 session left" / "package fully used" notices at the right moments.
function afterPackageChange(packageId) {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(packageId);
  if (!pkg || pkg.status !== 'active') return;
  const remaining = remainingSessions(pkg);
  if (remaining === 1 && !pkg.low_email_sent) {
    db.prepare('UPDATE packages SET low_email_sent = 1 WHERE id = ?').run(pkg.id);
    require('./emails').sendPackageLowEmail(pkg.id);
  } else if (remaining === 0 && !pkg.used_email_sent) {
    db.prepare('UPDATE packages SET used_email_sent = 1 WHERE id = ?').run(pkg.id);
    require('./emails').sendPackageUsedEmail(pkg.id);
  }
}

// Unpaid purchases past their deadline: void the package and release any
// wizard booking that was waiting on it (slot free again, customer emailed —
// same promise as the unpaid-invoice sweep).
function expirePendingPackages() {
  const now = new Date().toISOString();
  const hki = helsinkiNow();
  const stale = db.prepare(`SELECT id FROM packages
    WHERE status = 'pending' AND pay_by IS NOT NULL AND pay_by < ?`).all(now);
  for (const p of stale) {
    db.prepare("UPDATE packages SET status = 'void' WHERE id = ?").run(p.id);
    releaseLinkedBookings(p.id);
  }
  // A package-funded booking whose session starts before the payment deadline:
  // release it at session start, exactly like the invoice sweep does.
  const early = db.prepare(`SELECT DISTINCT b.package_id AS id FROM bookings b
    JOIN packages p ON p.id = b.package_id
    WHERE p.status = 'pending' AND b.status = 'confirmed' AND b.coach_notified = 0
      AND (b.date < ? OR (b.date = ? AND b.hour <= ?))`).all(hki.date, hki.date, hki.hour);
  for (const p of early) releaseLinkedBookings(p.id, true);
}

function releaseLinkedBookings(packageId, onlyStarted = false) {
  const hki = helsinkiNow();
  const rows = db.prepare(`SELECT id, date, hour, customer_id FROM bookings
    WHERE package_id = ? AND status = 'confirmed' AND coach_notified = 0`).all(packageId);
  for (const b of rows) {
    if (onlyStarted && !(b.date < hki.date || (b.date === hki.date && b.hour <= hki.hour))) continue;
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(b.customer_id, 'Your booking was cancelled because the payment was not completed. '
        + 'The slot is open again — you are welcome to book a new time.', nowISO());
    try { require('./emails').sendBookingReleasedEmail(b.id); }
    catch (e) { console.error('[emails] release:', e.message); }
  }
}

module.exports = {
  packageOptions, findOption, perSessionCents,
  remainingSessions, usedSessions, pickPackageForBooking, customerPackageSummary,
  createPackagePurchase, markPackagePaid, afterPackageChange,
  expirePendingPackages,
};
