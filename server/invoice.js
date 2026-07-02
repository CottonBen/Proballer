// Invoice generation. Every confirmed booking gets an invoice:
//  - stored as a row in `invoices`
//  - rendered to a printable HTML file in data/outbox/
//  - emailed to the customer if SMTP is configured (see mailer.js)
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const { db, DATA_DIR, nowISO, helsinkiDateOffset } = require('./db');
const { sendInvoiceEmail } = require('./mailer');

const OUTBOX = path.join(DATA_DIR, 'outbox');
fs.mkdirSync(OUTBOX, { recursive: true });

const esc = (s) => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

function nextInvoiceNumber() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM invoices').get();
  const year = new Date().getFullYear();
  return `${config.invoice.numberPrefix}-${year}-${String(row.n + 1).padStart(4, '0')}`;
}

function renderInvoiceHTML(inv, booking, customer, coachName, focusLabel) {
  const sale = booking.discount_cents > 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Invoice ${esc(inv.number)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 40px auto; max-width: 640px; }
  h1 { letter-spacing: 1px; } .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  td, th { padding: 10px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  td:last-child, th:last-child { text-align: right; }
  .total td { font-weight: 700; font-size: 1.1em; border-top: 2px solid #111; }
  .badge { background: #e8f8d0; color: #33691e; padding: 2px 8px; border-radius: 4px; font-size: .85em; }
</style></head><body>
  <h1>${esc(config.siteName)}</h1>
  <p class="muted">${esc(config.invoice.businessLine2)} · ${esc(config.invoice.replyEmail)}</p>
  <h2>Invoice ${esc(inv.number)}</h2>
  <p><strong>Billed to:</strong> ${esc(customer.name)} &lt;${esc(customer.email)}&gt;<br>
     <strong>Issued:</strong> ${esc(inv.issued_at.slice(0, 10))} ·
     <strong>Due:</strong> ${esc(inv.due_date)}<br>
     <strong>Booking reference:</strong> ${esc(booking.code)}</p>
  <table>
    <tr><th>Item</th><th>Amount</th></tr>
    <tr><td>1-on-1 coaching session — ${esc(focusLabel)} (${esc(booking.position)})<br>
      <span class="muted">${esc(coachName)} · ${esc(booking.date)} ${String(booking.hour).padStart(2, '0')}:00–${String(booking.hour + 1).padStart(2, '0')}:00 · ${esc(booking.location)}</span></td>
      <td>${eur(booking.price_cents)}</td></tr>
    ${sale ? `<tr><td><span class="badge">${esc(config.pricing.saleLabel)} −${config.pricing.salePercent}%</span></td>
      <td>−${eur(booking.discount_cents)}</td></tr>` : ''}
    <tr class="total"><td>Total due</td><td>${eur(booking.total_cents)}</td></tr>
  </table>
  <p class="muted">${esc(config.pricing.vatNote)}</p>
  <p>Payment instructions will be confirmed by your coach. Questions? Reply to
     ${esc(config.invoice.replyEmail)}.</p>
  <p class="muted">Thank you for training with us — see you on the pitch!</p>
</body></html>`;
}

// Creates the invoice row + HTML file, and fires the email hook (non-blocking).
function createInvoiceForBooking(bookingId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  const customer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(booking.customer_id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(booking.coach_id);
  const focus = config.focusTypes.find(f => f.id === booking.focus);

  const inv = {
    number: nextInvoiceNumber(),
    issued_at: nowISO(),
    due_date: helsinkiDateOffset(config.invoice.dueDays),
  };
  const html = renderInvoiceHTML(inv, booking, customer, coach.name, focus ? focus.label : booking.focus);
  const fileName = `${inv.number}.html`;
  const htmlPath = path.join(OUTBOX, fileName);
  fs.writeFileSync(htmlPath, html);

  const res = db.prepare(`INSERT INTO invoices
    (booking_id, number, customer_email, amount_cents, issued_at, due_date, status, html_path)
    VALUES (?,?,?,?,?,?,'sent',?)`)
    .run(bookingId, inv.number, customer.email, booking.total_cents, inv.issued_at, inv.due_date, fileName);

  // Fire-and-forget: never let email problems break a booking.
  sendInvoiceEmail({ to: customer.email, number: inv.number, html })
    .catch(err => console.error('[mailer]', err.message));

  return { id: res.lastInsertRowid, ...inv, amount_cents: booking.total_cents, htmlFile: fileName };
}

module.exports = { createInvoiceForBooking, OUTBOX };
