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

// Idempotent: only a 'sent' invoice flips to paid.
function markInvoicePaid(invoiceNumber) {
  const r = db.prepare("UPDATE invoices SET status = 'paid' WHERE number = ? AND status = 'sent'")
    .run(invoiceNumber);
  if (r.changes) require('./sheets').scheduleSync();
  return r.changes > 0;
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
