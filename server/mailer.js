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

// The sender line customers see. SMTP_FROM may be a bare address
// (info@example.com) or a full "Name <address>"; a bare address gets the site
// name as its display name so inboxes show "Proballers Coaching" either way.
// NOTE for Gmail SMTP: Gmail only honors a From that is the login account or
// one of its verified "Send mail as" aliases — anything else is rewritten
// back to the login address.
const fromAddress = () => {
  const raw = process.env.SMTP_FROM || config.invoice.replyEmail;
  return raw.includes('<') ? raw : `${config.siteName} <${raw}>`;
};

// Every attempt lands in email_log so the admin dashboard can show exactly
// what was (not) sent and why. `log` = { type, userId, bookingCode }, all
// optional — plain calls are recorded as type 'other'.
function recordLog(log, to, subject, ok, error) {
  try {
    const { db, nowISO } = require('./db');
    db.prepare(`INSERT INTO email_log (type, user_id, booking_code, to_email, subject, ok, error, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run((log && log.type) || 'other', (log && log.userId) ?? null, (log && log.bookingCode) ?? null,
        to, subject, ok ? 1 : 0, error || null, nowISO());
  } catch (e) {
    console.error('[mailer] email_log write failed:', e.message);
  }
}

// Plain-text twin of an HTML email. HTML-only messages are a classic spam
// signal, so every send carries both parts. Links keep their URLs.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n')
    .replace(/<a [^>]*href=["'](http[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text ? `${text}: ${href}` : href;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendMail({ to, subject, html, log }) {
  if (!transport) {
    console.log(`[mailer] SMTP not configured — "${subject}" for ${to} not emailed (see data/outbox/)`);
    recordLog(log, to, subject, false, 'smtp-not-configured');
    return { delivered: false, reason: 'smtp-not-configured' };
  }
  try {
    await transport.sendMail({
      from: fromAddress(), to, subject, html,
      text: htmlToText(html),
      // Replies always go to the business mailbox — matters once the From
      // address moves to the domain (no real inbox behind info@...).
      replyTo: config.invoice.replyEmail,
    });
  } catch (err) {
    recordError(err);
    recordLog(log, to, subject, false, String(err.message || err).slice(0, 300));
    throw err;
  }
  status.lastSentAt = new Date().toISOString();
  recordLog(log, to, subject, true, null);
  console.log(`[mailer] "${subject}" emailed to ${to}`);
  return { delivered: true };
}

function sendInvoiceEmail({ to, number, html, lang, log }) {
  const { tr } = require('./i18n');
  return sendMail({ to, subject: tr(lang, 'email.invoiceSubject', { siteName: config.siteName, number }),
    html, log: { type: 'invoice', ...log } });
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
      log: { type: 'test' },
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

module.exports = { sendMail, sendInvoiceEmail, sendTestEmail, emailStatus, htmlToText, smtpConfigured: () => Boolean(transport) };
