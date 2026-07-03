// Coach commission tiers. A coach's payout is computed per calendar month
// (Europe/Helsinki) from their COMPLETED sessions, progressively: the month's
// sessions #1-5 pay the Tier 1 rate, #6-15 Tier 2, #16+ Tier 3 (boundaries
// from config.coachTiers). Everything here returns euro CENTS — the coach UI
// only ever shows money, never percentages.
//
// A session's payout is LOCKED when it completes (bookings.earn_cents /
// payout_basis_cents) and never recomputed afterwards, so a coach's settled
// earnings can't drift when other sessions complete or prices/sales change.
const config = require('../config');
const { db, helsinkiNow } = require('./db');

function tierForSessionIndex(n) {
  const tiers = config.coachTiers;
  let match = tiers[0];
  for (const t of tiers) if (n >= t.minSessionIndex) match = t;
  return match;
}

// The amount a session's commission is based on. Non-credit bookings use the
// locked total the client paid; free (credit) sessions are the business's
// goodwill, so the coach is still paid on the normal price the client would
// have paid at the time — captured here for snapshotting.
function payoutBasisForRow(b) {
  if (b.credit_applied) {
    return Math.round(b.price_cents * (100 - config.pricing.salePercent) / 100);
  }
  return b.total_cents;
}

const monthOf = (dateStr) => String(dateStr).slice(0, 7);
const currentMonth = () => monthOf(helsinkiNow().date);

// Lock the payout for any completed booking that hasn't been snapshotted yet.
// The tier index = the number of already-locked completed sessions that coach
// has that month, plus one (so it's the Nth session you complete that month).
function snapshotPendingPayouts() {
  const pending = db.prepare(`
    SELECT id, coach_id, date, price_cents, total_cents, credit_applied
    FROM bookings
    WHERE status = 'completed' AND earn_cents IS NULL
    ORDER BY coach_id, date, hour, id`).all();
  if (!pending.length) return;
  const priorStmt = db.prepare(`SELECT COUNT(*) n FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date,1,7) = ? AND earn_cents IS NOT NULL`);
  const lock = db.prepare('UPDATE bookings SET earn_cents = ?, payout_basis_cents = ? WHERE id = ?');
  for (const b of pending) {
    const month = monthOf(b.date);
    const index = priorStmt.get(b.coach_id, month).n + 1;
    const tier = tierForSessionIndex(index);
    const basis = payoutBasisForRow(b);
    lock.run(Math.round(basis * tier.percent / 100), basis, b.id);
  }
}

// Locked payouts for one coach's completed sessions in a month.
function coachMonthPayouts(coachId, month = currentMonth()) {
  snapshotPendingPayouts();
  const rows = db.prepare(`
    SELECT code, COALESCE(earn_cents, 0) AS earn_cents FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date,1,7) = ?`).all(coachId, month);
  return {
    month,
    sessions: rows.length,
    payoutCents: rows.reduce((s, r) => s + r.earn_cents, 0),
    byCode: new Map(rows.map(r => [r.code, r.earn_cents])),
  };
}

// The tier that applies to the coach's NEXT session this month, plus progress.
function coachTierStatus(coachId) {
  snapshotPendingPayouts();
  const month = currentMonth();
  const done = db.prepare(`
    SELECT COUNT(*) n FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date,1,7) = ?`)
    .get(coachId, month).n;
  const tiers = config.coachTiers;
  const tier = tierForSessionIndex(done + 1);
  const tierIndex = tiers.indexOf(tier);
  const nextTier = tiers[tierIndex + 1] || null;
  return {
    month,
    sessionsThisMonth: done,
    tier,
    tierIndex,
    sessionsToNextTier: nextTier ? Math.max(0, nextTier.minSessionIndex - 1 - done) : null,
    // Tiers are just numbered 1/2/3, so the "next tier" is this index + 2.
    nextTierNumber: nextTier ? tierIndex + 2 : null,
  };
}

// Estimated payout for an UPCOMING (confirmed) booking: simulate the tier index
// it would land at in ITS OWN month (completed sessions already locked that
// month + earlier-scheduled confirmed sessions before it), so an estimate for a
// future month isn't wrongly charged at this month's tier.
function estimateUpcomingCents(booking) {
  const month = monthOf(booking.date);
  const completedThatMonth = db.prepare(`SELECT COUNT(*) n FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date,1,7) = ?`).get(booking.coach_id, month).n;
  const earlierConfirmed = db.prepare(`SELECT COUNT(*) n FROM bookings
    WHERE coach_id = ? AND status = 'confirmed' AND substr(date,1,7) = ?
      AND (date < ? OR (date = ? AND (hour < ? OR (hour = ? AND id < ?))))`)
    .get(booking.coach_id, month, booking.date, booking.date, booking.hour, booking.hour, booking.id).n;
  const tier = tierForSessionIndex(completedThatMonth + earlierConfirmed + 1);
  return Math.round(payoutBasisForRow(booking) * tier.percent / 100);
}

// Per-session coach earnings at a given tier, in cents, based on what a client
// currently pays (sale included). Forward-looking display for the tier card.
function perSessionEarningsCents(tier) {
  const clientPays = (base) => Math.round(base * 100 * (100 - config.pricing.salePercent) / 100);
  return {
    onPitchCents: Math.round(clientPays(config.pricing.sessionPrice) * tier.percent / 100),
    onlineCents: Math.round(clientPays(config.pricing.onlineSessionPrice) * tier.percent / 100),
  };
}

module.exports = {
  tierForSessionIndex, payoutBasisForRow, snapshotPendingPayouts,
  coachMonthPayouts, coachTierStatus, estimateUpcomingCents,
  perSessionEarningsCents, currentMonth, monthOf,
};
