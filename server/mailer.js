// Email hook. Out of the box no external service is contacted: invoices are
// kept in data/outbox/ and the send is logged. To really email customers, set:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// (e.g. from Brevo, Mailgun, Postmark, or any SMTP provider — see README).
const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, html }) {
  if (!transport) {
    console.log(`[mailer] SMTP not configured — "${subject}" for ${to} not emailed (see data/outbox/)`);
    return { delivered: false, reason: 'smtp-not-configured' };
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || `${config.siteName} <${config.invoice.replyEmail}>`,
    to, subject, html,
  });
  console.log(`[mailer] "${subject}" emailed to ${to}`);
  return { delivered: true };
}

function sendInvoiceEmail({ to, number, html }) {
  return sendMail({ to, subject: `${config.siteName} — invoice ${number}`, html });
}

module.exports = { sendMail, sendInvoiceEmail, smtpConfigured: () => Boolean(transport) };
