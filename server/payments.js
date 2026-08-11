// Payments. MobilePay is the only method, and nobody pays at checkout: a
// customer books, leaves their billing details, and the booking waits in
// PENDING PAYMENT until the money arrives at config.payment.mobilepay.
//
// A payment can be confirmed two ways — both land in applyPayment(), both are
// idempotent, and either can be the only one in use:
//
//   1. BY HAND (today).  A personal MobilePay number has no API: the payment
//      shows up in the owner's phone and an admin hits "mark paid" in the
//      dashboard. That calls markInvoicePaid() straight away.
//
//   2. BY WEBHOOK (when the business has a Vipps MobilePay MERCHANT
//      agreement). POST /api/mobilepay/webhook receives the notification,
//      verifies its signature, and matches it to an invoice / group spot /
//      package by the reference the payer typed. Set MOBILEPAY_WEBHOOK_SECRET
//      to switch it on; without the secret the endpoint answers 503 and the
//      manual path above carries on unchanged.
//
// Confirming a payment is what releases the booking to the coach (alert + chat
// thread) and emails the paid receipt — see markInvoicePaid().
'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { db, nowISO } = require('./db');

// The webhook is live only with a signing secret: an unauthenticated endpoint
// that marks bookings paid would be a free-sessions button for the internet.
const webhookConfigured = () => Boolean(config.mobilepay.webhookSecret);

// ---------------------------------------------------------------------------
// Reference matching
// ---------------------------------------------------------------------------
// Payers type the reference by hand into MobilePay's message field, so match
// leniently: case-insensitive and ignoring dashes, spaces and dots.
// "pbf 2026 0001", "PBF-2026-0001" and "pbf20260001" are the same reference.
const normRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const SQL_NORM = (col) => `UPPER(REPLACE(REPLACE(REPLACE(${col}, '-', ''), ' ', ''), '.', ''))`;

// What a reference points at, or null. Tried most-specific first: an invoice
// number (what the invoice tells people to type), then the booking code on the
// same document, then a group spot, then a package.
function resolveReference(ref) {
  const n = normRef(ref);
  if (!n) return null;

  const inv = db.prepare(`SELECT number FROM invoices WHERE ${SQL_NORM('number')} = ?`).get(n);
  if (inv) return { kind: 'invoice', ref: inv.number };

  const booking = db.prepare(`SELECT i.number FROM bookings b JOIN invoices i ON i.booking_id = b.id
    WHERE ${SQL_NORM('b.code')} = ?`).get(n);
  if (booking) return { kind: 'invoice', ref: booking.number };

  const su = db.prepare(`SELECT code FROM group_signups WHERE ${SQL_NORM('code')} = ?`).get(n);
  if (su) return { kind: 'group', ref: su.code };

  const pkg = db.prepare(`SELECT code FROM packages WHERE ${SQL_NORM('code')} = ?`).get(n);
  if (pkg) return { kind: 'package', ref: pkg.code };

  return null;
}

// Has this purchase already been paid for? A cancellation/refund notification
// landing on a settled purchase means something quite different from one
// landing on a pending purchase, and the admins must not be told the wrong one.
function isSettled(target) {
  if (target.kind === 'invoice') {
    const r = db.prepare('SELECT status FROM invoices WHERE number = ?').get(target.ref);
    return Boolean(r && r.status === 'paid');
  }
  if (target.kind === 'group') {
    const r = db.prepare('SELECT status FROM group_signups WHERE code = ?').get(target.ref);
    return Boolean(r && r.status === 'confirmed');
  }
  const r = db.prepare('SELECT status FROM packages WHERE code = ?').get(target.ref);
  return Boolean(r && r.status === 'active');
}

// Confirm a payment against whatever the reference points at. Idempotent at
// every target (each mark*Paid returns false when it was already paid), so a
// duplicate notification, a webhook racing an admin, or a retry are all safe.
function applyPayment(reference, method = 'mobilepay') {
  const target = resolveReference(reference);
  if (!target) return { ok: false, reason: 'unknown-reference' };
  let applied = false;
  if (target.kind === 'invoice') applied = markInvoicePaid(target.ref, method);
  else if (target.kind === 'group') applied = require('./groups').markSignupPaid(target.ref, method);
  else if (target.kind === 'package') applied = require('./packages').markPackagePaid(target.ref, method);
  // applied === false means "nothing to do" (already paid, or the purchase is
  // gone and the admins were alerted) — not a failure of the notification.
  return { ok: true, applied, kind: target.kind, ref: target.ref };
}

// ---------------------------------------------------------------------------
// Confirming a 1-on-1 invoice
// ---------------------------------------------------------------------------
// Idempotent: only a 'sent' invoice flips to paid. A successful flip fires the
// automatic receipt (regenerated document + email) — never blocks the caller.
function markInvoicePaid(invoiceNumber, method = 'mobilepay') {
  const r = db.prepare("UPDATE invoices SET status = 'paid' WHERE number = ? AND status = 'sent'")
    .run(invoiceNumber);
  if (r.changes) {
    require('./sheets').scheduleSync();
    require('./invoice').sendReceiptForInvoice(invoiceNumber, method)
      .catch((err) => console.error('[receipt]', err.message));
    // The payment is confirmed — NOW the booking goes to the coach (alert +
    // chat thread with the customer's notes). Idempotent.
    const inv = db.prepare('SELECT booking_id FROM invoices WHERE number = ?').get(invoiceNumber);
    if (inv) require('./notify').announceBookingToCoach(inv.booking_id);
    return true;
  }
  // Race: the payment landed AFTER the unpaid-booking sweep released the
  // booking. The customer HAS paid, so restore the booking if its slot is
  // still free; otherwise flag the admins — the money must be refunded by hand.
  return recoverPaidButReleased(invoiceNumber, method);
}

// One notification to every admin. Deduped on the exact message text, because
// a webhook and an admin's manual mark-paid can both fire on one payment.
function alertAdmins(message) {
  if (db.prepare('SELECT 1 FROM notifications WHERE message = ? LIMIT 1').get(message)) return;
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) {
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(a.id, message, nowISO());
  }
  console.error('[payments] ' + message);
}

function recoverPaidButReleased(invoiceNumber, method = 'mobilepay') {
  const inv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(invoiceNumber);
  if (!inv) {
    // The invoice rows are gone (customer account deleted) but the money is real.
    alertAdmins(`Payment received for invoice ${invoiceNumber}, but that invoice no longer exists `
      + '(was the customer account deleted?) — please refund the payment in MobilePay.');
    return false;
  }
  if (inv.status !== 'void') return false;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(inv.booking_id);
  if (!booking || booking.status !== 'cancelled') return false;

  // ONLY the unpaid-payment sweep's releases may be recovered. The sweep voids
  // without prev_status; a coach/admin cancellation (cancelWithCredit) stamps
  // prev_status — money landing on one of those must NOT resurrect a session
  // the coach deliberately cancelled. It needs a refund instead.
  const sweepReleased = inv.prev_status == null && inv.pay_by != null;
  if (!sweepReleased) {
    alertAdmins(`Payment received for invoice ${invoiceNumber}, but its booking ${booking.code} `
      + 'was cancelled — the booking stays cancelled; please refund the payment in MobilePay.');
    return false;
  }
  const clash = db.prepare(`SELECT 1 FROM bookings
    WHERE coach_id = ? AND date = ? AND hour = ? AND status != 'cancelled' AND id != ?`)
    .get(booking.coach_id, booking.date, booking.hour, booking.id);
  if (clash) {
    alertAdmins(`Payment received for invoice ${invoiceNumber} AFTER its booking `
      + `${booking.code} was released and the slot re-booked — please refund the payment in MobilePay.`);
    return false;
  }
  db.prepare("UPDATE bookings SET status = 'confirmed', completed_at = NULL WHERE id = ?").run(booking.id);
  // The pitch may have been taken by another session while this one was released.
  if (booking.pitch_id && db.prepare(`SELECT 1 FROM bookings WHERE pitch_id = ? AND date = ? AND hour = ?
      AND status != 'cancelled' AND id != ?`).get(booking.pitch_id, booking.date, booking.hour, booking.id)) {
    db.prepare("UPDATE bookings SET pitch_id = NULL, pitch_name = '' WHERE id = ?").run(booking.id);
  }
  db.prepare("UPDATE invoices SET status = 'paid', prev_status = NULL WHERE id = ?").run(inv.id);
  db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
    .run(booking.customer_id, `Good news — we received your payment and your booking ${booking.code} `
      + 'is confirmed again.', nowISO());
  // Restored + paid: a coach who never heard about the booking gets the normal
  // "New booking" announcement now; one who already knew (it was announced
  // before the release) gets the restore notice instead.
  if (!require('./notify').announceBookingToCoach(booking.id)) {
    const coachUser = db.prepare('SELECT user_id FROM coaches WHERE id = ?').get(booking.coach_id);
    if (coachUser && coachUser.user_id) {
      db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
        .run(coachUser.user_id, `Booking ${booking.code} on ${booking.date} at `
          + `${String(booking.hour).padStart(2, '0')}:00 is confirmed again — the payment arrived `
          + 'just after the release.', nowISO());
    }
  }
  require('./sheets').scheduleSync();
  require('./invoice').sendReceiptForInvoice(invoiceNumber, method)
    .catch((err) => console.error('[receipt]', err.message));
  return true;
}

// ---------------------------------------------------------------------------
// MobilePay webhook
// ---------------------------------------------------------------------------
// Vipps MobilePay signs each callback with an HMAC-SHA256 of the RAW body,
// keyed by the webhook secret handed out when the webhook is registered. The
// digest arrives hex- or base64-encoded depending on the product, so accept
// both and compare in constant time.
function verifySignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const raw = String(header).trim().replace(/^(sha256=|HmacSHA256\s+)/i, '');
  for (const enc of ['hex', 'base64']) {
    let given;
    try { given = Buffer.from(raw, enc); } catch { continue; }
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

// Terminal states. A MobilePay payment is money in the account once it is
// captured/completed; RESERVED/AUTHORIZED means the funds are held and the
// capture follows, which for our purposes is "the customer has paid".
const PAID_STATES = new Set(['AUTHORIZED', 'CAPTURED', 'SALE', 'RESERVED', 'COMPLETED', 'PAID', 'SETTLED']);
const FAILED_STATES = new Set(['ABORTED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED', 'REJECTED',
  'TERMINATED', 'VOIDED', 'REFUNDED', 'REVERSED']);

// The callback shape differs between Vipps MobilePay products (ePayment sends
// {reference, name}, older ones {orderId, transactionInfo.status}). Read every
// field we might be handed rather than betting on one product's schema.
function readEvent(body) {
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
  const amount = body.amount && typeof body.amount === 'object' ? body.amount.value : body.amount;
  return {
    eventId: String(pick(body.eventId, body.idempotencyKey, body.pspReference,
      body.transactionId, body.paymentId, '') || ''),
    reference: String(pick(body.reference, body.orderId, body.paymentReference,
      body.transactionText, body.message, '') || ''),
    status: String(pick(body.name, body.status, body.state, body.eventType,
      body.transactionInfo && body.transactionInfo.status, '') || '').toUpperCase(),
    amountCents: Number.isFinite(Number(amount)) ? Math.round(Number(amount)) : null,
  };
}

// Record the notification BEFORE acting on it. The unique event_id is what
// makes duplicate deliveries (the provider retries until it gets a 2xx) a
// no-op rather than a second confirmation. Returns false when already seen.
function recordEvent(ev, note) {
  // No usable id from the provider: derive one from the payload so a retry of
  // the same notification still collapses to one row.
  const id = ev.eventId || 'h' + crypto.createHash('sha256')
    .update(`${ev.reference}|${ev.status}|${ev.amountCents}`).digest('hex').slice(0, 32);
  try {
    db.prepare(`INSERT INTO payment_events (event_id, reference, status, amount_cents, note, created_at)
      VALUES (?,?,?,?,?,?)`).run(id, ev.reference, ev.status, ev.amountCents, note || '', nowISO());
    return true;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return false;
    throw err;
  }
}

// Express handler, mounted with express.raw() BEFORE the JSON body parser.
//
// Answers 200 to anything well-formed, actionable or not: a provider that gets
// an error retries forever, and "I cannot match this reference" is not a
// problem retrying will fix. Unmatched and failed payments raise an admin
// notification instead, so nothing goes silently missing.
function webhookHandler(req, res) {
  if (!webhookConfigured()) return res.status(503).json({ error: 'Webhook not configured.' });
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
  if (!verifySignature(raw, req.headers['x-mobilepay-signature'] || req.headers.authorization,
    config.mobilepay.webhookSecret)) {
    return res.status(400).json({ error: 'Bad signature.' });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad payload.' }); }

  const ev = readEvent(body && typeof body === 'object' ? body : {});
  if (!ev.status) {
    // The signature checked out, so this really is MobilePay — we just cannot
    // read it. Field names differ between Vipps products, and the FIRST live
    // notification is where that shows up. Keep the payload and shout, rather
    // than answering 200 and leaving no trace of a payment we did not
    // understand. Truncated: this is a diagnostic, not a second ledger.
    // Seed the id from the BODY: an unreadable payload has no reference or
    // status to derive one from, so every one of them would otherwise collapse
    // onto the same id and only the first would ever be kept.
    recordEvent({
      ...ev,
      status: 'UNRECOGNISED',
      eventId: ev.eventId || 'raw-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32),
    }, 'raw:' + raw.slice(0, 400));
    alertAdmins('A MobilePay notification arrived that we could not read (unrecognised '
      + 'payload shape) — the payment has NOT been applied. The raw message is in the '
      + 'payment_events table; it usually means the field names need adjusting in '
      + 'server/payments.js.');
    return res.json({ received: true, ignored: 'unrecognised-payload' });
  }
  // In-flight states (CREATED, PENDING…) are noise: nothing has happened yet.
  if (!PAID_STATES.has(ev.status) && !FAILED_STATES.has(ev.status)) {
    return res.json({ received: true, ignored: 'not-terminal' });
  }
  if (!recordEvent(ev)) return res.json({ received: true, duplicate: true });

  if (FAILED_STATES.has(ev.status)) {
    // Nothing to undo on a purchase that was never paid — it is already
    // pending and the sweep releases it at its deadline. But the SAME states
    // cover a reversal/refund of money we have already banked, so check which
    // case this is before telling the admins anything.
    const target = resolveReference(ev.reference);
    if (target) {
      alertAdmins(isSettled(target)
        ? `MobilePay reported ${ev.status} for ${target.ref}, which is already marked PAID — `
          + 'check whether that payment was reversed or refunded, and correct it by hand if so.'
        : `MobilePay reported ${ev.status} for ${target.ref} — the payment did not go through. `
          + 'The purchase stays unpaid and will be released at its deadline.');
    }
    return res.json({ received: true, status: ev.status });
  }

  const result = applyPayment(ev.reference, 'mobilepay');
  if (!result.ok) {
    // Money arrived with a reference we cannot place. Never drop it silently:
    // an admin has to look at it and either match it or refund it.
    alertAdmins('A MobilePay payment arrived with a reference we could not match'
      + `${ev.reference ? ` ("${ev.reference}")` : ' (no reference given)'} — please check MobilePay `
      + 'and mark the right booking paid, or refund it.');
    return res.json({ received: true, matched: false });
  }
  db.prepare('UPDATE payment_events SET note = ? WHERE reference = ? AND note = ?')
    .run(`${result.kind}:${result.ref}`, ev.reference, '');
  return res.json({ received: true, matched: true, applied: result.applied });
}

module.exports = {
  webhookConfigured, webhookHandler, verifySignature,
  resolveReference, applyPayment, markInvoicePaid, alertAdmins,
};
