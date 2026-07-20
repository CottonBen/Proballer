// Group training sessions: one coach, up to `capacity` players, each buying
// their own spot (config.groupTraining.pricePerPlayer) through the same Stripe
// Checkout flow as 1-on-1 bookings. Spots are held while a card payment is in
// flight (pending + pay_by) so a session can never be oversold, and released
// by the sweep if the payment never lands.
'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { db, nowISO, helsinkiNow } = require('./db');

const genCode = (prefix) => prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

// Spots that block capacity: paid ones, plus unpaid ones still inside their
// payment window (their spot is being paid for right now).
function takenCount(groupSessionId) {
  return db.prepare(`SELECT COUNT(*) n FROM group_signups
    WHERE group_session_id = ?
      AND (status = 'confirmed' OR (status = 'pending' AND pay_by > ?))`)
    .get(groupSessionId, new Date().toISOString()).n;
}

function publicShape(gs) {
  const taken = takenCount(gs.id);
  const coach = db.prepare('SELECT name, photos FROM coaches WHERE id = ?').get(gs.coach_id);
  let photo = null;
  try { photo = (JSON.parse(coach.photos || '[]'))[0] || null; } catch { /* keep null */ }
  return {
    code: gs.code,
    date: gs.date,
    hour: gs.hour,
    location: gs.location,
    pitchName: gs.pitch_name || '',
    coach: coach ? coach.name : '',
    coachPhoto: photo,
    priceCents: gs.price_cents,
    capacity: gs.capacity,
    taken,
    spotsLeft: Math.max(0, gs.capacity - taken),
    status: gs.status,
  };
}

// Upcoming open sessions for the landing page (soonest first).
function upcomingOpen() {
  const hki = helsinkiNow();
  return db.prepare(`SELECT * FROM group_sessions
    WHERE status = 'open' AND (date > ? OR (date = ? AND hour > ?))
    ORDER BY date, hour LIMIT 24`).all(hki.date, hki.date, hki.hour).map(publicShape);
}

// Roster for the coach app / admin panel: players with signup state.
function roster(groupSessionId) {
  return db.prepare(`SELECT g.id, g.code, g.status, g.price_cents, g.paid_at, g.created_at,
      u.name, u.email FROM group_signups g JOIN users u ON u.id = g.customer_id
    WHERE g.group_session_id = ? AND g.status != 'cancelled' ORDER BY g.id`).all(groupSessionId)
    .map((r) => ({
      signupId: r.id, code: r.code, name: r.name, email: r.email,
      status: r.status, priceCents: r.price_cents,
      paid: Boolean(r.paid_at) || r.price_cents === 0,
    }));
}

// A customer claims a spot. Returns { error } or { signup }. The capacity
// check and the insert race harmlessly: the unique index stops the same
// customer doubling up, and a simultaneous over-claim is caught by re-counting
// after insert (the loser is rolled back).
function createSignup(gs, customerId) {
  if (gs.status !== 'open') return { error: 'This group session is not open for booking.' };
  const hki = helsinkiNow();
  if (gs.date < hki.date || (gs.date === hki.date && gs.hour <= hki.hour)) {
    return { error: 'That time is already in the past.' };
  }
  if (takenCount(gs.id) >= gs.capacity) return { error: 'This group session is already full.' };
  let info;
  try {
    info = db.prepare(`INSERT INTO group_signups
      (code, group_session_id, customer_id, price_cents, status, pay_by, created_at)
      VALUES (?,?,?,?, 'pending', ?, ?)`)
      .run(genCode('GSU'), gs.id, customerId, gs.price_cents,
        new Date(Date.now() + config.stripe.payWindowMinutes * 60000).toISOString(), nowISO());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { error: 'You already have a spot in this group session.' };
    }
    throw err;
  }
  const id = Number(info.lastInsertRowid);
  if (takenCount(gs.id) > gs.capacity) {
    db.prepare('DELETE FROM group_signups WHERE id = ?').run(id);
    return { error: 'This group session is already full.' };
  }
  return { signup: db.prepare('SELECT * FROM group_signups WHERE id = ?').get(id) };
}

// Payment confirmed (webhook or success-URL refresh; idempotent). If the spot
// was released (or the whole session cancelled) while the payment was in
// flight, re-claim it when there is still room — otherwise flag the admins to
// refund by hand.
function markSignupPaid(code, stripeSession) {
  const su = db.prepare('SELECT * FROM group_signups WHERE code = ?').get(code);
  if (!su || su.status === 'confirmed') return false;
  const gs = db.prepare('SELECT * FROM group_sessions WHERE id = ?').get(su.group_session_id);
  const intent = stripeSession && stripeSession.payment_intent ? String(stripeSession.payment_intent) : null;
  const hki = helsinkiNow();
  const sessionGone = !gs || gs.status !== 'open'
    || gs.date < hki.date || (gs.date === hki.date && gs.hour <= hki.hour);
  const wasReleased = su.status === 'cancelled';
  if (sessionGone || (wasReleased && takenCount(gs.id) >= gs.capacity)) {
    require('./stripe').alertAdmins(`Payment received for group spot ${su.code}, but the session `
      + `${gs ? gs.code : ''} is ${sessionGone ? 'no longer available' : 'full'} — please refund the payment in Stripe.`);
    if (intent) db.prepare('UPDATE group_signups SET stripe_payment_intent = ? WHERE id = ?').run(intent, su.id);
    return false;
  }
  db.prepare(`UPDATE group_signups SET status = 'confirmed', paid_at = ?, stripe_payment_intent = ?
    WHERE id = ?`).run(nowISO(), intent, su.id);

  // Tell the coach (in-app; the roster lives in the coach app).
  const coach = db.prepare('SELECT user_id FROM coaches WHERE id = ?').get(gs.coach_id);
  const customer = db.prepare('SELECT name FROM users WHERE id = ?').get(su.customer_id);
  if (coach && coach.user_id) {
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(coach.user_id, `New group signup: ${customer.name} joined your group session `
        + `${gs.code} on ${gs.date} at ${String(gs.hour).padStart(2, '0')}:00 `
        + `(${takenCount(gs.id)}/${gs.capacity}).`, nowISO());
  }
  require('./emails').sendGroupConfirmedEmail(su.id);
  require('./sheets').scheduleSync();
  return true;
}

// Unpaid spots past their deadline are released silently — the customer never
// completed checkout, exactly like an unpaid 1-on-1 booking, so an email
// makes the non-purchase explicit.
function expirePendingSignups() {
  const now = new Date().toISOString();
  const stale = db.prepare(`SELECT id, customer_id FROM group_signups
    WHERE status = 'pending' AND pay_by IS NOT NULL AND pay_by < ?`).all(now);
  for (const s of stale) {
    db.prepare("UPDATE group_signups SET status = 'cancelled' WHERE id = ?").run(s.id);
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(s.customer_id, 'Your group training spot was released because the payment was not '
        + 'completed. The spot is open again — you are welcome to book anew.', nowISO());
    try { require('./emails').sendGroupReleasedEmail(s.id); }
    catch (e) { console.error('[emails] group release:', e.message); }
  }
}

// Cancel one player's paid spot (admin removal or session cancellation):
// refund through Stripe when we hold the payment intent; if that fails the
// admins are alerted to refund by hand. The cancellation email states what
// happened either way.
async function cancelSignup(signupId, reasonKey /* 'removed' | 'session_cancelled' */) {
  const su = db.prepare('SELECT * FROM group_signups WHERE id = ?').get(signupId);
  if (!su || su.status === 'cancelled') return false;
  db.prepare("UPDATE group_signups SET status = 'cancelled' WHERE id = ?").run(su.id);
  let refunded = false;
  const paid = Boolean(su.paid_at) && su.price_cents > 0;
  if (paid) {
    refunded = await require('./stripe').refundPayment(su.stripe_payment_intent);
    if (!refunded) {
      require('./stripe').alertAdmins(`Group spot ${su.code} was cancelled but could not be `
        + 'refunded automatically — please refund the payment in Stripe.');
    }
  }
  require('./emails').sendGroupCancelledEmail(su.id, { reasonKey, refunded, paid });
  return true;
}

// Cancel a whole session: every active spot is cancelled + refunded, the
// coach is told, and the session closes.
async function cancelGroupSession(gs, actor /* 'coach' | 'admin' */) {
  if (gs.status === 'cancelled') return;
  db.prepare("UPDATE group_sessions SET status = 'cancelled' WHERE id = ?").run(gs.id);
  const active = db.prepare(`SELECT id FROM group_signups
    WHERE group_session_id = ? AND status != 'cancelled'`).all(gs.id);
  for (const s of active) await cancelSignup(s.id, 'session_cancelled');
  const coach = db.prepare('SELECT user_id FROM coaches WHERE id = ?').get(gs.coach_id);
  if (actor === 'admin' && coach && coach.user_id) {
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(coach.user_id, `Your group session ${gs.code} on ${gs.date} at `
        + `${String(gs.hour).padStart(2, '0')}:00 was cancelled by the admin.`, nowISO());
  }
  require('./sheets').scheduleSync();
}

module.exports = {
  takenCount, publicShape, upcomingOpen, roster,
  createSignup, markSignupPaid, expirePendingSignups,
  cancelSignup, cancelGroupSession,
};
