// Email hook. Out of the box no external service is contacted: invoices are
// kept in data/outbox/ and the send is logged. To really email customers, set:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// (e.g. from Brevo, Mailgun, Postmark, or any SMTP provider — see README).
const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
// Delivery diagnostics, surfaced on the admin dashboard (Test email button):
// send errors are otherwise swallowed by fire-and-forget callers and only ever
// reach the host's logs, which the owner never sees.
const status = { lastError: null, lastErrorAt: null, lastSentAt: null, verified: null };

if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  // Check the connection + login once at boot so a bad host/password shows up
  // immediately in the admin email status instead of on the first lost email.
  transport.verify().then(() => {
    status.verified = true;
    console.log('[mailer] SMTP connection verified:', process.env.SMTP_HOST);
  }).catch((err) => {
    status.verified = false;
    recordError(err);
    console.error('[mailer] SMTP verify FAILED:', err.message);
  });
}

function recordError(err) {
  status.lastError = String(err && err.message || err).slice(0, 500);
  status.lastErrorAt = new Date().toISOString();
}

const fromAddress = () =>
  process.env.SMTP_FROM || `${config.siteName} <${config.invoice.replyEmail}>`;

async function sendMail({ to, subject, html }) {
  if (!transport) {
    console.log(`[mailer] SMTP not configured — "${subject}" for ${to} not emailed (see data/outbox/)`);
    return { delivered: false, reason: 'smtp-not-configured' };
  }
  try {
    await transport.sendMail({ from: fromAddress(), to, subject, html });
  } catch (err) {
    recordError(err);
    throw err;
  }
  status.lastSentAt = new Date().toISOString();
  console.log(`[mailer] "${subject}" emailed to ${to}`);
  return { delivered: true };
}

function sendInvoiceEmail({ to, number, html, lang }) {
  const { tr } = require('./i18n');
  return sendMail({ to, subject: tr(lang, 'email.invoiceSubject', { siteName: config.siteName, number }), html });
}

// Admin "Send test email" button. Returns rather than throws, so the exact
// SMTP error can be shown to the admin in the browser.
async function sendTestEmail(to) {
  if (!transport) return { delivered: false, error: 'SMTP is not configured (SMTP_HOST etc. are not set).' };
  try {
    await sendMail({
      to,
      subject: `${config.siteName} — test email`,
      html: `<p>This is a test email from ${config.siteName}.</p>
<p>If you can read this, email delivery works. Sent ${new Date().toISOString()} from ${process.env.SMTP_HOST}.</p>`,
    });
    return { delivered: true };
  } catch (err) {
    return { delivered: false, error: String(err.message || err).slice(0, 500) };
  }
}

// Snapshot for the admin dashboard. Never includes the password.
function emailStatus() {
  return {
    configured: Boolean(transport),
    host: process.env.SMTP_HOST || null,
    from: transport ? fromAddress() : null,
    verified: status.verified,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt,
    lastSentAt: status.lastSentAt,
  };
}

module.exports = { sendMail, sendInvoiceEmail, sendTestEmail, emailStatus, smtpConfigured: () => Boolean(transport) };
