// Prepaid 1-on-1 session packages (3/5/8 sessions, invoiced and paid upfront
// by MobilePay before the sessions become bookable).
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

// What one session of this package is worth, for coach-payout purposes. Uses
// the pre-discount (list) price — a promo code lowers what the CUSTOMER paid,
// but the coach is still paid the full per-session value (owner's call), and
// consistently across the first and later sessions of a discounted package.
const perSessionCents = (pkg) => Math.round((pkg.price_cents + (pkg.code_discount_cents || 0)) / pkg.sessions_total);

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

// A new pending purchase, held until pay_by like an unpaid booking. A promo
// code (if any) is applied by the caller afterwards via UPDATE, so this stays
// discount-agnostic — discount_code / code_discount_cents default to '' / 0.
function createPackagePurchase(customerId, optionId) {
  const opt = findOption(optionId);
  if (!opt) return null;
  const info = db.prepare(`INSERT INTO packages
    (code, customer_id, sessions_total, price_cents, status, pay_by, created_at)
    VALUES (?,?,?,?, 'pending', ?, ?)`)
    .run(genCode('PKG'), customerId, opt.sessions, opt.price * 100,
      new Date(Date.now() + (config.payment.holdHours || 72) * 3600000).toISOString(), nowISO());
  return db.prepare('SELECT * FROM packages WHERE id = ?').get(Number(info.lastInsertRowid));
}

// Payment confirmed (MobilePay webhook or an admin marking it paid; both call
// this, idempotent). A package is not slot-bound, so even a payment landing
// after the pending-purchase sweep voided it simply activates it — the
// customer paid, the sessions are theirs. Any linked wizard booking is
// announced to its coach if the slot survived; if not, the sessions stay
// usable anyway.
function markPackagePaid(code) {
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

// Prepaid packages are never voided for non-payment either, and their linked
// booking is never released. An unpaid package simply grants no sessions: the
// booking it was bought alongside stays confirmed, shows as unpaid (the
// customer dashboard and the admin debtor list both read package_status), and
// is settled whenever the customer pays — the package code is the reference.
//
// Releasing it used to be necessary because the purchase had a deadline. Now
// that payment has no deadline, cancelling the session would take away a slot
// the customer still intends to use and still owes for.
function expirePendingPackages() { /* nothing expires — see the note above */ }

module.exports = {
  packageOptions, findOption, perSessionCents,
  remainingSessions, usedSessions, pickPackageForBooking, customerPackageSummary,
  createPackagePurchase, markPackagePaid, afterPackageChange,
  expirePendingPackages,
};
