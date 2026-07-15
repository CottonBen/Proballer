// Central business configuration for Proballers Coaching.
// Change values here — the rest of the app reads everything from this file.

// Load a local, gitignored .env file (KEY=value per line) so secrets — the
// payment IBAN, the initial admin/coach passwords, SMTP, etc. — stay OUT of the
// committed source. On a real host (Render) these are set as real env vars, so
// the .env is optional there. Values already present in process.env win.
(function loadDotEnv() {
  try {
    const fs = require('node:fs'), path = require('node:path');
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env file — rely on real environment variables */ }
})();

module.exports = {
  siteName: 'Proballers Coaching',
  tagline: 'Pro-level 1-on-1 coaching for young footballers',

  // Public address of the site, used for links inside emails (the scheduled
  // review/rebook emails have no browser request to take an origin from).
  siteUrl: (process.env.SITE_URL || 'https://proballerscoaching.com').replace(/\/+$/, ''),

  // Europe/Helsinki drives what "today", "past session" and slot times mean,
  // regardless of which country the server is deployed in.
  timezone: 'Europe/Helsinki',

  // Training day runs 08:00–20:00 → last bookable hour starts at 19:00.
  dayStartHour: 8,
  dayEndHour: 20,

  locations: ['Helsinki', 'Espoo', 'Vantaa'],

  positions: ['goalkeepers', 'defenders', 'midfielders', 'attackers'],

  // Session focus types. `online: true` means the session is a remote video
  // call. (Game IQ online sessions were retired 2026-07; old bookings with
  // focus 'game-iq' still render — display falls back to the stored id.)
  focusTypes: [
    { id: 'conditioning', label: 'Conditioning', online: false },
    { id: 'physicality',  label: 'Physicality',  online: false },
    { id: 'agility',      label: 'Agility',      online: false },
    { id: 'technical',    label: 'Technical',    online: false },
    { id: 'defending',    label: 'Defending',    online: false },
    { id: 'finishing',    label: 'Finishing',    online: false },
    { id: 'passing',      label: 'Passing',      online: false },
  ],

  pricing: {
    currency: 'EUR',
    sessionPrice: 80,       // one-hour on-pitch session, full price
    onlineSessionPrice: 80, // Game IQ video session — same price as on-pitch
    salePercent: 50,        // launch sale (half price = 40 €) — set to 0 to end
    saleLabel: 'LAUNCH OFFER',
    // Small-business VAT exemption (arvonlisäverolaki 3 §). If the business
    // registers for VAT, set vatPercent to the current rate (25.5).
    vatPercent: 0,
    vatNote: 'VAT 0% — small business, AVL 3 §',
  },

  invoice: {
    // Invoices are written to data/outbox/ as HTML. If SMTP_* env vars are set
    // they are also emailed to the customer (see server/mailer.js).
    dueDays: 7,
    numberPrefix: 'PBF',
    businessLine1: 'Proballers Coaching',
    businessLine2: 'Helsinki · Espoo · Vantaa',
    replyEmail: 'cottonbenjaminmik@gmail.com',
  },

  // The one and only payment method: bank transfer to the owner's account.
  // The IBAN comes from the PAYMENT_IBAN env var (kept out of the source); set
  // it in .env locally and in the host's environment in production.
  payment: {
    method: 'Bank transfer',
    payee: process.env.PAYMENT_PAYEE || 'Proballers Coaching',
    iban: process.env.PAYMENT_IBAN || 'FI00 0000 0000 0000 00',
    // Optional MobilePay number (Finnish mobile payment). Blank = not offered;
    // set PAYMENT_MOBILEPAY to a phone number to add it to invoices.
    mobilepay: process.env.PAYMENT_MOBILEPAY || '',
    // Customers use the invoice number as the payment reference (viestikenttä).
    referenceHint: 'Use the invoice number as the message/reference',
  },

  // Stripe card payments (optional). Set STRIPE_SECRET_KEY (sk_test_/sk_live_)
  // to enable the "Pay by card" flow; STRIPE_WEBHOOK_SECRET (whsec_...) lets
  // Stripe confirm payments server-to-server in production. Without keys the
  // site is bank-transfer-only, exactly as before.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    // Payment is due AT booking: the customer is sent straight to card payment
    // and the slot is held this many minutes before an unpaid booking is
    // auto-released. (Raise to e.g. 72*60 to offer a pay-later window instead —
    // reminders and all release/restore logic follow this number.)
    payWindowMinutes: 45,
  },

  // How many days ahead coaches can publish availability / customers can book.
  bookingHorizonDays: 60,

  // Coach commission tiers, based on COMPLETED sessions in the current calendar
  // month: sessions #1-5 pay the Tier 1 rate, #6-15 Tier 2, #16+ Tier 3.
  // IMPORTANT: coaches are never shown the percentages — the UI only ever shows
  // euro amounts ("you earn 15,00 € for this session"). Percentages live here
  // and in the admin views only. Tiers are plain "Tier 1/2/3" — no perks.
  coachTiers: [
    { sessionLabel: '0–5 sessions / month',  minSessionIndex: 1,  percent: 50 },
    { sessionLabel: '5–15 sessions / month', minSessionIndex: 6,  percent: 60 },
    { sessionLabel: '15+ sessions / month',  minSessionIndex: 16, percent: 70 },
  ],
};
