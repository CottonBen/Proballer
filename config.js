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

  // Training day runs 08:00–22:00 → last bookable hour starts at 21:00.
  dayStartHour: 8,
  dayEndHour: 22,

  locations: ['Helsinki', 'Espoo', 'Vantaa', 'Kirkkonummi'],

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
    sessionPrice: 40,       // one-hour on-pitch session
    onlineSessionPrice: 40, // Game IQ video session — same price as on-pitch
    salePercent: 0,         // no automatic sale; raise above 0 to run one again
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
    businessLine2: 'Helsinki · Espoo · Vantaa · Kirkkonummi',
    replyEmail: 'proballerscoaching@gmail.com',
  },

  // The one and only payment method: MobilePay. Nobody pays at checkout —
  // the customer books, gives their billing details, and the booking waits in
  // PENDING PAYMENT until the money arrives. The invoice carries the MobilePay
  // number below and the invoice number as the reference (viestikenttä).
  payment: {
    method: 'MobilePay',
    payee: process.env.PAYMENT_PAYEE || 'Proballers Coaching',
    // Where the money goes. Override with PAYMENT_MOBILEPAY.
    mobilepay: process.env.PAYMENT_MOBILEPAY || '+358 44 9872431',
    // Optional bank-transfer alternative, printed under the MobilePay block.
    // Blank (the default) = MobilePay only.
    iban: process.env.PAYMENT_IBAN || '',
    referenceHint: 'Use the invoice number as the message/reference',
    // 1-on-1 bookings are NEVER cancelled for non-payment — the money is a
    // separate ledger that stays open until it is settled. This window only
    // still bounds the capacity-limited purchases (a group spot, a prepaid
    // package), where an unpaid hold would block a real player or sit on
    // sessions nobody can use.
    holdHours: 72,
  },

  // Data-protection identity, printed on the privacy policy (/privacy). GDPR
  // Art. 13 requires the controller to be identifiable and contactable, so
  // these must be real before the policy goes live — the page says so out loud
  // while any of them are still placeholders.
  privacy: {
    // Who the data controller is. GDPR Art. 13 needs a name and a way to reach
    // them; a business ID is NOT required by the regulation, so businessId may
    // be blank and the policy simply omits the line. legalName and address are
    // required — while either is still 'TODO:' the page shows a draft warning
    // instead of pretending to be complete.
    legalName: process.env.PRIVACY_LEGAL_NAME || 'Proballers Coaching',
    // Y-tunnus, once the business is registered. Blank = the line is omitted.
    businessId: process.env.PRIVACY_BUSINESS_ID || '',
    address: process.env.PRIVACY_ADDRESS || 'Koirasaarentie 37 A, Helsinki',
    // Where data-protection requests go. Defaults to the normal reply address.
    contactEmail: process.env.PRIVACY_EMAIL || 'proballerscoaching@gmail.com',
    // Named processors. Anything that receives personal data must be listed —
    // if you switch another integration on (Attio, say), add it here too.
    smtpProvider: process.env.PRIVACY_SMTP_PROVIDER || 'Brevo (Sendinblue)',
    // Bookkeeping retention (Finnish Accounting Act: 6 years from year end).
    invoiceYears: 6,
    // Everything not needed for accounting goes after this long inactive.
    inactiveMonths: 24,
    // Bumped by hand when the policy text changes.
    updated: '2026-08-12',
  },

  // Vipps MobilePay MERCHANT integration (optional, off by default).
  //
  // A PERSONAL MobilePay number — the +358 number above — has no API and no
  // webhooks: those payments land in the owner's phone and an admin marks the
  // invoice paid in the dashboard. That is the flow the site runs today.
  //
  // With a Vipps MobilePay merchant agreement, set MOBILEPAY_WEBHOOK_SECRET
  // (and MOBILEPAY_MERCHANT_SERIAL) and POST /api/mobilepay/webhook starts
  // confirming payments automatically: each notification is matched to an
  // invoice / group spot / package by the reference the payer typed. Nothing
  // else changes — the manual path keeps working alongside it.
  mobilepay: {
    webhookSecret: process.env.MOBILEPAY_WEBHOOK_SECRET || '',
    merchantSerial: process.env.MOBILEPAY_MERCHANT_SERIAL || '',
  },

  // Group training: one coach, up to `capacity` players, each paying
  // `pricePerPlayer` euros for their own spot. Players can START a group
  // session on any coach's free hour at least `minLeadDays` days ahead; the
  // first booker sets the session's age group.
  groupTraining: {
    pricePerPlayer: 25,
    capacity: 4,
    minLeadDays: 5,
    ageGroups: ['7-10', '10-13', '13-16'],
  },

  // Prepaid 1-on-1 session packages, paid upfront in one card payment.
  // `single` is the normal pay-per-session flow (its live price comes from
  // pricing.* above — listed here only so the wizard renders all options from
  // one place). Future products (group packages, memberships, camps) follow
  // the same shape: a code, a session count and an upfront price.
  packages: [
    { id: 'single', sessions: 1, price: 40 },
    { id: 'pack3',  sessions: 3, price: 114 },
    { id: 'pack5',  sessions: 5, price: 185 },
    { id: 'pack8',  sessions: 8, price: 280 },
  ],

  // How many days ahead coaches can publish availability / customers can book.
  bookingHorizonDays: 60,

  // 1-on-1 sessions must be booked at least this many hours before they start
  // (the coach needs time to plan, pick the pitch and message the player).
  // Group-session SPOTS are exempt — they can be joined until the session
  // starts, since the coach is coming anyway. Multiples of 24 only.
  bookingMinLeadHours: 24,

  // Admin-created bookings with "send a payment request by email": how long
  // the customer has to pay through the emailed link before the reservation
  // is released (the session start is always a deadline too, whichever comes
  // first). Longer than the normal at-booking window on purpose — the
  // customer isn't sitting in the checkout when the email arrives.
  adminPayLinkHours: 72,

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
