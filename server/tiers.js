// Coach commission tiers. A coach's payout is computed per calendar month
// (Europe/Helsinki) from their COMPLETED sessions, progressively: the month's
// sessions #1-5 pay the Tier 1 rate, #6-15 Tier 2, #16+ Tier 3 (boundaries
// from config.coachTiers). Everything here returns euro CENTS — the coach UI
// only ever shows money, never percentages.
const config = require('../config');
const { db, helsinkiNow } = require('./db');

function tierForSessionIndex(n) {
  const tiers = config.coachTiers;
  let match = tiers[0];
  for (const t of tiers) if (n >= t.minSessionIndex) match = t;
  return match;
}

// What the coach's cut is based on: the price the client pays for the session.
// Free-credit sessions are the business's goodwill, not the coach's — for those
// the basis is what the client would normally have paid (current sale price).
function payoutBasisCents(booking) {
  if (booking.credit_applied) {
    return Math.round(booking.price_cents * (100 - config.pricing.salePercent) / 100);
  }
  return booking.total_cents;
}

const monthOf = (dateStr) => String(dateStr).slice(0, 7);
const currentMonth = () => monthOf(helsinkiNow().date);

// All completed sessions of one coach in one month, in the order they count
// towards the tiers, each with its locked-in payout.
function coachMonthPayouts(coachId, month = currentMonth()) {
  const rows = db.prepare(`
    SELECT id, code, date, hour, price_cents, total_cents, credit_applied
    FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date, 1, 7) = ?
    ORDER BY date, hour`).all(coachId, month);
  let payoutCents = 0;
  const byCode = new Map();
  rows.forEach((b, i) => {
    const tier = tierForSessionIndex(i + 1);
    const cents = Math.round(payoutBasisCents(b) * tier.percent / 100);
    payoutCents += cents;
    byCode.set(b.code, cents);
  });
  return { month, sessions: rows.length, payoutCents, byCode };
}

// The tier that applies to the coach's NEXT session this month, plus progress.
function coachTierStatus(coachId) {
  const month = currentMonth();
  const done = db.prepare(`
    SELECT COUNT(*) n FROM bookings
    WHERE coach_id = ? AND status = 'completed' AND substr(date, 1, 7) = ?`)
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
    // How many more completed sessions until the next tier's rate kicks in.
    sessionsToNextTier: nextTier ? Math.max(0, nextTier.minSessionIndex - 1 - done) : null,
    nextTierName: nextTier ? nextTier.name : null,
  };
}

// Per-session coach earnings at a given tier, in cents, based on what a client
// currently pays (sale included). This is what the coach UI displays.
function perSessionEarningsCents(tier) {
  const clientPays = (base) => Math.round(base * 100 * (100 - config.pricing.salePercent) / 100);
  return {
    onPitchCents: Math.round(clientPays(config.pricing.sessionPrice) * tier.percent / 100),
    onlineCents: Math.round(clientPays(config.pricing.onlineSessionPrice) * tier.percent / 100),
  };
}

module.exports = {
  tierForSessionIndex, payoutBasisCents, coachMonthPayouts,
  coachTierStatus, perSessionEarningsCents, currentMonth, monthOf,
};
