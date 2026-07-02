// Central business configuration for Proballers Coaching Finland (working title).
// Change values here — the rest of the app reads everything from this file.

module.exports = {
  siteName: 'Proballers Coaching Finland',
  tagline: 'Pro-level 1-on-1 coaching for young footballers',

  // Europe/Helsinki drives what "today", "past session" and slot times mean,
  // regardless of which country the server is deployed in.
  timezone: 'Europe/Helsinki',

  // Training day runs 08:00–20:00 → last bookable hour starts at 19:00.
  dayStartHour: 8,
  dayEndHour: 20,

  locations: ['Helsinki', 'Espoo', 'Vantaa'],

  positions: ['goalkeepers', 'defenders', 'midfielders', 'attackers'],

  // Session focus types. `online: true` means the session is a remote video call.
  focusTypes: [
    { id: 'conditioning', label: 'Conditioning', online: false },
    { id: 'physicality',  label: 'Physicality',  online: false },
    { id: 'agility',      label: 'Agility',      online: false },
    { id: 'technical',    label: 'Technical',    online: false },
    { id: 'defending',    label: 'Defending',    online: false },
    { id: 'finishing',    label: 'Finishing',    online: false },
    { id: 'passing',      label: 'Passing',      online: false },
    { id: 'game-iq',      label: 'Game IQ (online meeting)', online: true },
  ],

  pricing: {
    currency: 'EUR',
    sessionPrice: 60,       // one-hour on-pitch session, full price
    onlineSessionPrice: 40, // Game IQ video session, full price
    salePercent: 50,        // launch sale — set to 0 to end the sale
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
    businessLine1: 'Proballers Coaching Finland (working title)',
    businessLine2: 'Helsinki · Espoo · Vantaa',
    replyEmail: 'cottonbenjaminmik@gmail.com',
  },

  // How many days ahead coaches can publish availability / customers can book.
  bookingHorizonDays: 60,
};
