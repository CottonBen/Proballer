// Invoice + receipt generation, in the customer's language (users.lang).
//
// With Stripe configured, payment is due AT booking: the invoice row is
// created but NOT emailed; once the payment lands (webhook or return-URL
// check), the document is regenerated as a PAID RECEIPT and emailed
// automatically. Zero-amount (free-credit) bookings get their receipt
// immediately. Without Stripe the legacy flow remains: the invoice itself is
// emailed with bank-transfer instructions.
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const { db, DATA_DIR, nowISO, helsinkiDateOffset, helsinkiNow } = require('./db');
const { sendMail, sendInvoiceEmail } = require('./mailer');
const { tr, trCfg, positionLabel, focusLabel, localDate, hourRange, pickLang } = require('./i18n');

const OUTBOX = path.join(DATA_DIR, 'outbox');
fs.mkdirSync(OUTBOX, { recursive: true });

const esc = (s) => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

function nextInvoiceNumber() {
  // Derive from the highest existing sequence for this year, not COUNT(*):
  // COUNT(*) collides after demo-data (or any invoice) removal.
  const year = new Date().getFullYear();
  const prefix = `${config.invoice.numberPrefix}-${year}-`;
  const row = db.prepare(
    'SELECT number FROM invoices WHERE number LIKE ? ORDER BY LENGTH(number) DESC, number DESC LIMIT 1'
  ).get(prefix + '%');
  const last = row ? Number(String(row.number).slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(last + 1).padStart(4, '0')}`;
}

// One renderer for both documents. `paid` = { method: 'card'|'credit'|'bank',
// date: 'YYYY-MM-DD' } turns the invoice into a receipt: PAID badge, payment
// summary instead of the "how to pay" bank block.
function renderInvoiceHTML(inv, booking, customer, coachName, focus, lang, paid = null) {
  const L = (key, params) => tr(lang, key, params);
  const sale = booking.discount_cents > 0;
  const docTitle = paid ? L('receipt.title', { number: inv.number }) : L('invoice.title', { number: inv.number });
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(docTitle)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 40px auto; max-width: 640px; }
  h1 { letter-spacing: 1px; } .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  td, th { padding: 10px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  td:last-child, th:last-child { text-align: right; }
  .total td { font-weight: 700; font-size: 1.1em; border-top: 2px solid #111; }
  .badge { background: #e8f8d0; color: #33691e; padding: 2px 8px; border-radius: 4px; font-size: .85em; }
  .paidstamp { display: inline-block; border: 3px solid #2e7d32; color: #2e7d32; font-weight: 800;
    padding: 4px 14px; border-radius: 8px; letter-spacing: .12em; transform: rotate(-3deg); }
</style></head><body>
  <h1>${esc(config.siteName)}</h1>
  <p class="muted">${esc(config.invoice.businessLine2)} · ${esc(config.invoice.replyEmail)}</p>
  <h2>${esc(docTitle)} ${paid ? `<span class="paidstamp">${esc(L('receipt.badge'))}</span>` : ''}</h2>
  <p><strong>${esc(L('invoice.billedTo'))}:</strong> ${esc(customer.name)} &lt;${esc(customer.email)}&gt;<br>
     <strong>${esc(L('invoice.issued'))}:</strong> ${esc(localDate(lang, inv.issued_at.slice(0, 10)))}${paid ? '' : ` ·
     <strong>${esc(L('invoice.due'))}:</strong> ${esc(localDate(lang, inv.due_date))}`}<br>
     <strong>${esc(L('invoice.bookingRef'))}:</strong> ${esc(booking.code)}</p>
  <table>
    <tr><th>${esc(L('invoice.item'))}</th><th>${esc(L('invoice.amount'))}</th></tr>
    <tr><td>${esc(L('invoice.lineItem', {
      focus: focusLabel(lang, focus), position: positionLabel(lang, booking.position) }))}<br>
      <span class="muted">${esc(coachName)} · ${esc(localDate(lang, booking.date))} ${esc(hourRange(lang, booking.hour))} · ${esc(trCfg(lang, booking.location))}</span></td>
      <td>${eur(booking.price_cents)}</td></tr>
    ${sale ? `<tr><td><span class="badge">${booking.credit_applied
        ? esc(L('invoice.freeSession'))
        : esc(trCfg(lang, config.pricing.saleLabel)) + ' −' + config.pricing.salePercent + '%'}</span></td>
      <td>−${eur(booking.discount_cents)}</td></tr>` : ''}
    <tr class="total"><td>${esc(paid ? L('receipt.totalPaid') : L('invoice.totalDue'))}</td><td>${eur(booking.total_cents)}</td></tr>
  </table>
  <p class="muted">${esc(trCfg(lang, config.pricing.vatNote))}</p>
  ${paid ? `
  <table>
    <tr><td>${esc(L('receipt.paidRow'))}</td><td><strong>${esc(localDate(lang, paid.date))}</strong></td></tr>
    <tr><td>${esc(L('invoice.paymentMethod'))}</td><td><strong>${esc(L('method.' + paid.method))}</strong></td></tr>
    <tr><td>${esc(L('invoice.reference'))}</td><td>${esc(inv.number)}</td></tr>
  </table>
  <p class="muted">${esc(L('receipt.keepNote'))}</p>` : `
  <h3>${esc(L('invoice.howToPay'))}</h3>
  <table>
    <tr><td>${esc(L('invoice.paymentMethod'))}</td><td>${esc(trCfg(lang, config.payment.method))}${config.payment.mobilepay ? esc(L('invoice.orMobilePay')) : esc(L('invoice.onlyMethod'))}</td></tr>
    <tr><td>${esc(L('invoice.payee'))}</td><td>${esc(config.payment.payee)}</td></tr>
    <tr><td>${esc(L('invoice.ibanRow'))}</td><td><strong>${esc(config.payment.iban)}</strong></td></tr>
    ${config.payment.mobilepay ? `<tr><td>${esc(L('invoice.mobilepayRow'))}</td><td><strong>${esc(config.payment.mobilepay)}</strong></td></tr>` : ''}
    <tr><td>${esc(L('invoice.reference'))}</td><td><strong>${esc(inv.number)}</strong></td></tr>
    <tr><td>${esc(L('invoice.amount'))}</td><td><strong>${eur(booking.total_cents)}</strong></td></tr>
    <tr><td>${esc(L('invoice.dueDate'))}</td><td>${esc(localDate(lang, inv.due_date))}</td></tr>
  </table>
  <p class="muted">${esc(L('invoice.matchNote', {
    hint: trCfg(lang, config.payment.referenceHint), email: config.invoice.replyEmail }))}</p>`}
  <p class="muted">${esc(L('invoice.thanks'))}</p>
</body></html>`;
}

// Shared loader for a full invoice + its booking/customer/coach context.
function loadInvoiceBundle(invoiceNumber) {
  const inv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(invoiceNumber);
  if (!inv) return null;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(inv.booking_id);
  const customer = db.prepare('SELECT name, email, lang FROM users WHERE id = ?').get(booking.customer_id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(booking.coach_id);
  const focus = config.focusTypes.find(f => f.id === booking.focus) || booking.focus;
  return { inv, booking, customer, coach, focus, lang: pickLang(customer.lang) };
}

// Regenerate the document as a PAID receipt and email it. Method: 'card'
// (Stripe), 'credit' (free session), 'bank' (admin marked a transfer paid).
async function sendReceiptForInvoice(invoiceNumber, method) {
  const b = loadInvoiceBundle(invoiceNumber);
  if (!b) return { delivered: false, reason: 'not-found' };
  const paid = {
    method: b.booking.credit_applied ? 'credit' : (method || 'card'),
    date: helsinkiNow().date,
  };
  const html = renderInvoiceHTML(b.inv, b.booking, b.customer, b.coach.name, b.focus, b.lang, paid);
  fs.writeFileSync(path.join(OUTBOX, path.basename(b.inv.html_path)), html);
  return sendMail({
    to: b.customer.email,
    subject: tr(b.lang, 'email.receiptSubject', { siteName: config.siteName, number: b.inv.number }),
    html,
  });
}

// Creates the invoice row + HTML file. Email policy:
//  - free (0 €) booking          -> mark paid, send the receipt right away
//  - Stripe configured, amount>0 -> no email yet (receipt follows the payment)
//  - no Stripe (legacy)          -> email the bank-transfer invoice
function createInvoiceForBooking(bookingId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  const customer = db.prepare('SELECT name, email, lang FROM users WHERE id = ?').get(booking.customer_id);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(booking.coach_id);
  const focus = config.focusTypes.find(f => f.id === booking.focus);
  const lang = pickLang(customer.lang);

  const inv = {
    number: nextInvoiceNumber(),
    issued_at: nowISO(),
    due_date: helsinkiDateOffset(config.invoice.dueDays),
  };
  const free = booking.total_cents === 0;
  const html = renderInvoiceHTML(inv, booking, customer, coach.name, focus || booking.focus, lang,
    free ? { method: 'credit', date: helsinkiNow().date } : null);
  const fileName = `${inv.number}.html`;
  fs.writeFileSync(path.join(OUTBOX, fileName), html);

  const res = db.prepare(`INSERT INTO invoices
    (booking_id, number, customer_email, amount_cents, issued_at, due_date, status, html_path)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(bookingId, inv.number, customer.email, booking.total_cents, inv.issued_at, inv.due_date,
      free ? 'paid' : 'sent', fileName);

  // Fire-and-forget: never let email problems break a booking.
  if (free) {
    sendMail({
      to: customer.email,
      subject: tr(lang, 'email.receiptSubject', { siteName: config.siteName, number: inv.number }),
      html,
    }).catch(err => console.error('[mailer]', err.message));
  } else if (!config.stripe.secretKey) {
    sendInvoiceEmail({ to: customer.email, number: inv.number, html, lang })
      .catch(err => console.error('[mailer]', err.message));
  }

  return { id: res.lastInsertRowid, ...inv, amount_cents: booking.total_cents, htmlFile: fileName };
}

module.exports = { createInvoiceForBooking, sendReceiptForInvoice, OUTBOX };
