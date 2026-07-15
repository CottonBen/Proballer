// Stripe card payments (Checkout redirect flow) — no SDK, plain REST calls via
// the built-in fetch, keeping the project dependency-free. Enabled only when
// STRIPE_SECRET_KEY is set; the site falls back to bank-transfer-only without it.
//
// Flow: POST /api/invoices/:number/pay -> Checkout Session (metadata: invoice
// number) -> customer pays on Stripe's hosted page -> BOTH of these mark the
// invoice paid (whichever happens first, both idempotent):
//   1. webhook checkout.session.completed  (production path, signature-verified)
//   2. the success-URL return pings /refresh-payment which re-reads the session
//      (works locally without any webhook configured)
const crypto = require('node:crypto');
const config = require('../config');
const { db } = require('./db');

const API = 'https://api.stripe.com/v1';
const enabled = () => Boolean(config.stripe.secretKey);

// application/x-www-form-urlencoded with Stripe's bracket notation.
function form(params) {
  const out = new URLSearchParams();
  const walk = (prefix, val) => {
    if (val === null || val === undefined) return;
    if (typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, v] of Object.entries(val)) walk(prefix ? `${prefix}[${k}]` : k, v);
    } else if (Array.isArray(val)) {
      val.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else {
      out.append(prefix, String(val));
    }
  };
  walk('', params);
  return out;
}

async function stripeRequest(method, path, params) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : form(params),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body && body.error && body.error.message ? body.error.message : `Stripe error (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return body;
}

// One-off Checkout Session for an invoice. `description` is shown on Stripe's
// payment page; `origin` builds the return URLs.
function createCheckoutSession({ invoiceNumber, amountCents, description, customerEmail, origin, lang }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    locale: lang === 'fi' ? 'fi' : 'en',
    // Each Checkout session dies after 30 min (Stripe's minimum). The booking
    // itself is held for config.stripe.payWindowMinutes — clicking "Pay" again
    // simply mints a fresh session; an unpaid booking is released by
    // expireUnpaidBookings() at its deadline.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    customer_email: customerEmail,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: amountCents,
        product_data: { name: description },
      },
    }],
    metadata: { invoice_number: invoiceNumber },
    success_url: `${origin}/my-bookings?paid=${encodeURIComponent(invoiceNumber)}`,
    cancel_url: `${origin}/my-bookings?paycancel=1`,
  });
}

const retrieveSession = (id) => stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(id)}`);

// Idempotent: only a 'sent' invoice flips to paid. A successful flip fires the
// automatic receipt (regenerated document + email) — never blocks the caller.
function markInvoicePaid(invoiceNumber) {
  const r = db.prepare("UPDATE invoices SET status = 'paid' WHERE number = ? AND status = 'sent'")
    .run(invoiceNumber);
  if (r.changes) {
    require('./sheets').scheduleSync();
    require('./invoice').sendReceiptForInvoice(invoiceNumber, 'card')
      .catch((err) => console.error('[receipt]', err.message));
    // The payment is confirmed — NOW the booking goes to the coach (alert +
    // chat thread with the customer's notes). Idempotent.
    const inv = db.prepare('SELECT booking_id FROM invoices WHERE number = ?').get(invoiceNumber);
    if (inv) require('./notify').announceBookingToCoach(inv.booking_id);
    return true;
  }
  // Race: the payment landed AFTER the unpaid-booking sweep released the
  // booking (a Checkout session lives up to 30 min past the deadline). The
  // customer HAS paid, so restore the booking if its slot is still free;
  // otherwise flag the admins — the money must be refunded by hand.
  return recoverPaidButReleased(invoiceNumber);
}

// One notification to every admin. Deduped on the exact message text, because
// the webhook AND the success-URL refresh both fire on a normal payment.
function alertAdmins(message) {
  const { nowISO } = require('./db');
  if (db.prepare('SELECT 1 FROM notifications WHERE message = ? LIMIT 1').get(message)) return;
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) {
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(a.id, message, nowISO());
  }
  console.error('[stripe] ' + message);
}

function recoverPaidButReleased(invoiceNumber) {
  const { nowISO } = require('./db');
  const inv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(invoiceNumber);
  if (!inv) {
    // The invoice rows are gone (customer account deleted) but the money is real.
    alertAdmins(`Payment received for invoice ${invoiceNumber}, but that invoice no longer exists `
      + '(was the customer account deleted?) — please refund the payment in Stripe.');
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
      + 'was cancelled — the booking stays cancelled; please refund the payment in Stripe.');
    return false;
  }
  const clash = db.prepare(`SELECT 1 FROM bookings
    WHERE coach_id = ? AND date = ? AND hour = ? AND status != 'cancelled' AND id != ?`)
    .get(booking.coach_id, booking.date, booking.hour, booking.id);
  if (clash) {
    alertAdmins(`Payment received for invoice ${invoiceNumber} AFTER its booking `
      + `${booking.code} was released and the slot re-booked — please refund the payment in Stripe.`);
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
  require('./invoice').sendReceiptForInvoice(invoiceNumber, 'card')
    .catch((err) => console.error('[receipt]', err.message));
  return true;
}

// Stripe-Signature: t=<ts>,v1=<hmac>. HMAC-SHA256 of `${t}.${rawBody}` with the
// webhook signing secret; 5-minute replay tolerance.
function verifySignature(rawBody, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const given = Buffer.from(String(parts.v1 || ''), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// Express handler, mounted with express.raw() BEFORE the JSON body parser.
function webhookHandler(req, res) {
  if (!enabled() || !config.stripe.webhookSecret) return res.status(503).json({ error: 'Webhook not configured.' });
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
  if (!verifySignature(raw, req.headers['stripe-signature'], config.stripe.webhookSecret)) {
    return res.status(400).json({ error: 'Bad signature.' });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad payload.' }); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data && event.data.object;
    if (s && s.payment_status === 'paid' && s.metadata && s.metadata.invoice_number) {
      markInvoicePaid(s.metadata.invoice_number);
    }
  }
  res.json({ received: true });
}

module.exports = { enabled, createCheckoutSession, retrieveSession, markInvoicePaid, webhookHandler };
