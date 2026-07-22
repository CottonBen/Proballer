// E2E checks for ADMIN-CREATED bookings: customer pick/create, 1-on-1 + group,
// the three payment modes (email pay link / already paid / pay at session),
// the login-free /api/pay/:token endpoints, and the sweep interplay.
// Scratch server on :3463 with SMTP disabled and a dummy Stripe key —
// Checkout creation fails (that path is exercised for its error page) but
// payments confirm through the signed webhook, like production.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = require('node:path').join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'ab-data');
const PORT = 3463;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_localtest_123';

fs.rmSync(DATA_DIR, { recursive: true, force: true });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

function client() {
  let cookies = {};
  return async function req(method, p, body) {
    const res = await fetch(BASE + '/api' + p, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const m = /^([^=]+)=([^;]*)/.exec(line);
      if (m) cookies[m[1]] = m[2];
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  };
}

// Plain page fetch (no cookies, no redirect following) for /api/pay pages.
async function page(p) {
  const res = await fetch(BASE + p, { redirect: 'manual' });
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}

function sendWebhook(metadata, paymentIntent) {
  const raw = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata, payment_intent: paymentIntent || 'pi_test_1' } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return fetch(BASE + '/api/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    body: raw,
  });
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const helsinkiDate = (offset) => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Helsinki' }).format(new Date(Date.now() + offset * 86400000));
const helsinkiHour = () => Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false }).format(new Date()));

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, DEMO_DATA: '0',
      SMTP_HOST: '',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'TestAdmin123!',
      COACH_EMAIL: 'coach@test.local', COACH_PASSWORD: 'TestCoach123!',
      SITE_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { if ((await fetch(BASE + '/api/config')).ok) { up = true; break; } } catch { /* boot */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('no boot');

    const db = new DatabaseSync(path.join(DATA_DIR, 'proballers.db'));
    const emailCount = (type) => db.prepare('SELECT COUNT(*) n FROM email_log WHERE type = ?').get(type).n;

    // --- setup ---------------------------------------------------------------
    const admin = client(); const coach = client();
    let r = await admin('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200 && r.data.user.role === 'admin', r.status);
    r = await coach('POST', '/auth/login', { email: 'coach@test.local', password: 'TestCoach123!' });
    check('coach logs in', r.status === 200, r.status);
    const coachId = db.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id
      WHERE u.email = 'coach@test.local'`).get().id;
    db.prepare(`UPDATE coaches SET locations = '["Helsinki"]', positions = '["defenders"]', active = 1
      WHERE id = ?`).run(coachId);
    const addSlot = (date, hour) => db.prepare(
      'INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, date, hour, new Date().toISOString());

    // One pre-existing verified customer.
    const cust = client();
    r = await cust('POST', '/auth/signup', {
      name: 'Vanha Asiakas', email: 'vanha@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi',
    });
    const code0 = db.prepare("SELECT code FROM pending_signups WHERE email = 'vanha@test.local'").get().code;
    r = await cust('POST', '/auth/verify-signup', { email: 'vanha@test.local', code: code0 });
    check('existing customer account ready', r.status === 200, r.data);
    const custId = r.data.user.id;

    r = await admin('GET', '/config');
    check('config exposes adminPayLinkHours', r.data.adminPayLinkHours === 72, r.data.adminPayLinkHours);

    // --- customer search -----------------------------------------------------
    r = await admin('GET', '/admin/customers');
    check('customer list returns the account', r.status === 200
      && r.data.some((u) => u.email === 'vanha@test.local'), r.data);
    r = await admin('GET', '/admin/customers?q=vanha');
    check('customer search matches by email fragment', r.status === 200
      && r.data.length === 1 && r.data[0].id === custId, r.data);
    r = await cust('GET', '/admin/customers');
    check('customer search is admin-only', r.status === 403, r.status);

    // --- validation ----------------------------------------------------------
    r = await admin('POST', '/admin/bookings', { kind: 'single', customer: { id: custId } });
    check('missing payment mode rejected', r.status === 400
      && r.data.error === 'Choose how the payment is handled.', r.data);
    r = await admin('POST', '/admin/bookings', { payment: 'paid', kind: 'nope', customer: { id: custId } });
    check('bad kind rejected', r.status === 400 && r.data.error === 'Choose the session type.', r.data);
    // Slot validation now runs BEFORE the customer side, so the slot must be
    // real for the duplicate-email check to be reached.
    const dDup = helsinkiDate(2);
    addSlot(dDup, 10);
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'single', coachId, date: dDup, hour: 10, location: 'Helsinki',
      customer: { name: 'Tupla Tili', email: 'vanha@test.local' },
    });
    check('new customer with an existing email rejected', r.status === 409
      && /pick it from the existing customers/.test(r.data.error), r.data);
    r = await cust('POST', '/admin/bookings', { payment: 'paid', kind: 'single', customer: { id: custId } });
    check('create endpoint is admin-only', r.status === 403, r.status);

    // --- 1-on-1, payment 'link', NEW customer --------------------------------
    const d2 = helsinkiDate(2);
    addSlot(d2, 10); addSlot(d2, 11); addSlot(d2, 12); addSlot(d2, 13);
    const payreqBefore = emailCount('payreq');
    r = await admin('POST', '/admin/bookings', {
      payment: 'link', kind: 'single', coachId, date: d2, hour: 10, location: 'Helsinki',
      notes: 'Vasemman jalan laukaukset',
      customer: { name: 'Uusi Pelaaja', email: 'uusi@test.local', phone: '040 1234567', area: 'Espoo', lang: 'fi' },
    });
    check('link booking created for a new customer', r.status === 201 && r.data.customer.created === true, r.data);
    const linkCode = r.data.code;
    const newUser = db.prepare("SELECT * FROM users WHERE email = 'uusi@test.local'").get();
    check('new account exists, verified, customer role', Boolean(newUser)
      && newUser.role === 'customer' && newUser.email_verified === 1 && newUser.area === 'Espoo'
      && newUser.password_hash.length > 20, newUser && newUser.role);
    const linkBooking = db.prepare('SELECT * FROM bookings WHERE code = ?').get(linkCode);
    const linkInv = db.prepare('SELECT * FROM invoices WHERE booking_id = ?').get(linkBooking.id);
    check('link booking holds the slot, coach not yet told',
      linkBooking.status === 'confirmed' && linkBooking.coach_notified === 0, linkBooking.coach_notified);
    check('link invoice: sent, 72h window, token, not at-session',
      linkInv.status === 'sent' && linkInv.at_session === 0 && /^[0-9a-f]{32}$/.test(linkInv.pay_token || '')
      && linkInv.pay_by > new Date(Date.now() + 71 * 3600000).toISOString()
      && linkInv.pay_by < new Date(Date.now() + 73 * 3600000).toISOString(), linkInv);
    check('price is the sale price 40 €', linkBooking.total_cents === 4000, linkBooking.total_cents);
    check('payment-request email sent', emailCount('payreq') === payreqBefore + 1, emailCount('payreq'));
    check('booking-confirmed email NOT sent yet', emailCount('booking') === 0, emailCount('booking'));

    // Pay link with a broken Stripe key -> "not completed" page with retry (502).
    let pg = await page(`/api/pay/${linkInv.pay_token}`);
    check('pay link: checkout failure shows retry page', pg.status === 502
      && pg.text.includes('Maksua ei viimeistelty'), pg.status);
    pg = await page(`/api/pay/${linkInv.pay_token}/return`);
    check('return page before payment: still pending', pg.status === 200
      && pg.text.includes('Maksua ei viimeistelty'), pg.status);

    // Payment lands through the webhook.
    await sendWebhook({ invoice_number: linkInv.number });
    const linkInvAfter = db.prepare('SELECT status FROM invoices WHERE id = ?').get(linkInv.id);
    const linkBookingAfter = db.prepare('SELECT coach_notified FROM bookings WHERE id = ?').get(linkBooking.id);
    check('webhook marks the link invoice paid', linkInvAfter.status === 'paid', linkInvAfter);
    check('coach announced after the payment', linkBookingAfter.coach_notified === 1);
    check('customer got the booking-confirmed email', emailCount('booking') === 1, emailCount('booking'));
    check('coach got the booking email', emailCount('coach_booking') === 1, emailCount('coach_booking'));
    check('admin got the booking copy', emailCount('admin_booking') === 1, emailCount('admin_booking'));
    const adminCopy = db.prepare(
      "SELECT to_email FROM email_log WHERE type = 'admin_booking' ORDER BY id DESC LIMIT 1").get();
    check('admin copy goes to the admin address', adminCopy.to_email === 'admin@test.local', adminCopy);
    pg = await page(`/api/pay/${linkInv.pay_token}`);
    check('pay link after payment: thank-you page', pg.status === 200
      && pg.text.includes('maksu vastaanotettu'), pg.text.slice(0, 200));

    // --- 1-on-1, payment 'paid', existing customer ---------------------------
    const receiptBefore = emailCount('receipt');
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'single', coachId, date: d2, hour: 11, location: 'Helsinki',
      customer: { id: custId },
    });
    check('prepaid booking created', r.status === 201 && r.data.customer.created === false, r.data);
    const paidInv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(r.data.invoice.number);
    const paidBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(paidInv.booking_id);
    check('prepaid invoice is paid from the start, no deadline',
      paidInv.status === 'paid' && paidInv.pay_by === null && paidInv.at_session === 0, paidInv);
    check('prepaid: coach announced immediately', paidBooking.coach_notified === 1);
    check('prepaid: receipt emailed', emailCount('receipt') === receiptBefore + 1, emailCount('receipt'));
    check('prepaid: coach + admin copies sent',
      emailCount('coach_booking') === 2 && emailCount('admin_booking') === 2,
      { coach: emailCount('coach_booking'), admin: emailCount('admin_booking') });
    const paidReceiptHtml = fs.readFileSync(path.join(DATA_DIR, 'outbox', `${paidInv.number}.html`), 'utf8');
    check('prepaid receipt shows the manual method', paidReceiptHtml.includes('Maksu vastaanotettu'));

    // Double-booking the same slot fails cleanly.
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'single', coachId, date: d2, hour: 11, location: 'Helsinki',
      customer: { id: custId },
    });
    check('same slot twice → 409', r.status === 409 && /Someone just booked/.test(r.data.error), r.data);

    // --- 1-on-1, payment 'at_session' ----------------------------------------
    r = await admin('POST', '/admin/bookings', {
      payment: 'at_session', kind: 'single', coachId, date: d2, hour: 12, location: 'Helsinki',
      customer: { id: custId },
    });
    check('at-session booking created', r.status === 201, r.data);
    const atInv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(r.data.invoice.number);
    const atBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(atInv.booking_id);
    check('at-session invoice: sent, NO pay_by (sweep-proof), flagged',
      atInv.status === 'sent' && atInv.pay_by === null && atInv.at_session === 1 && atInv.pay_token === null, atInv);
    check('at-session: coach announced immediately', atBooking.coach_notified === 1);
    check('at-session invoice due on the session date', atInv.due_date === d2, atInv.due_date);

    // The sweep must leave it alone.
    r = await admin('GET', '/admin/bookings');
    const atRow = r.data.find((b) => b.code === atBooking.code);
    check('sweep leaves the at-session booking confirmed', atRow && atRow.status === 'confirmed', atRow && atRow.status);
    check('admin list flags pay-at-session', atRow && atRow.invoice_at_session === 1, atRow);

    // Collect the money later: mark paid -> receipt says "Maksu vastaanotettu".
    r = await admin('POST', `/admin/invoices/${atInv.number}/paid`, {});
    check('at-session invoice marked paid', r.status === 200, r.data);
    await new Promise((s) => setTimeout(s, 300)); // receipt regenerates async
    const atReceipt = fs.readFileSync(path.join(DATA_DIR, 'outbox', `${atInv.number}.html`), 'utf8');
    check('at-session receipt shows the manual method', atReceipt.includes('Maksu vastaanotettu'));

    // --- the 24 h lead does NOT apply to admins ------------------------------
    const hh = helsinkiHour();
    // Pick a within-24h slot at a valid business hour (08–19). Clamp the low
    // end so a run just after midnight doesn't land on e.g. 02:00 and get
    // rejected for being outside business hours before the 24h rule is tested.
    const soon = hh <= 17 ? { date: helsinkiDate(0), hour: Math.max(hh + 2, 8) } : { date: helsinkiDate(1), hour: 8 };
    addSlot(soon.date, soon.hour);
    r = await cust('POST', '/bookings', { coachId, date: soon.date, hour: soon.hour, location: 'Helsinki' });
    check('public booking inside 24 h is rejected', r.status === 400
      && /24 hours in advance/.test(r.data.error), r.data);
    r = await admin('POST', '/admin/bookings', {
      payment: 'at_session', kind: 'single', coachId, date: soon.date, hour: soon.hour,
      location: 'Helsinki', customer: { id: custId },
    });
    check('admin books the same inside-24h slot fine', r.status === 201, r.data);

    // --- group session: the three modes --------------------------------------
    const d3 = helsinkiDate(3);
    addSlot(d3, 10);
    r = await coach('POST', '/coach/groups', { date: d3, hour: 10, location: 'Helsinki' });
    check('coach opens a group session', r.status === 201, r.data);
    const grpCode = r.data.code;
    const grpId = r.data.id;

    // a) already paid
    const groupMailBefore = emailCount('group_booking');
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'group', groupCode: grpCode, customer: { id: custId },
    });
    check('group spot (paid) confirmed', r.status === 201, r.data);
    const suPaid = db.prepare('SELECT * FROM group_signups WHERE code = ?').get(r.data.code);
    check('paid spot: confirmed + paid_at + full price', suPaid.status === 'confirmed'
      && Boolean(suPaid.paid_at) && suPaid.price_cents === 2500, suPaid);
    check('group confirmation email sent', emailCount('group_booking') === groupMailBefore + 1);
    check('group spot: coach + admin copies sent',
      emailCount('coach_group') === 1 && emailCount('admin_group') === 1,
      { coach: emailCount('coach_group'), admin: emailCount('admin_group') });

    // b) duplicate spot for the same player
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'group', groupCode: grpCode, customer: { id: custId },
    });
    check('same player twice → 409', r.status === 409, r.data);

    // c) at the session
    r = await admin('POST', '/admin/bookings', {
      payment: 'at_session', kind: 'group', groupCode: grpCode,
      customer: { name: 'Kentällä Maksaja', email: 'kentta@test.local' },
    });
    check('group spot (at session) confirmed', r.status === 201, r.data);
    const suAt = db.prepare('SELECT * FROM group_signups WHERE code = ?').get(r.data.code);
    check('at-session spot: confirmed, unpaid, holds capacity',
      suAt.status === 'confirmed' && suAt.paid_at === null && suAt.price_cents === 2500, suAt);
    r = await admin('GET', '/admin/groups');
    let roster = r.data.find((g) => g.code === grpCode).players;
    check('roster shows the unpaid at-session spot', roster.some((p) => p.email === 'kentta@test.local' && !p.paid), roster);
    r = await admin('POST', `/admin/group-signups/${suAt.id}/paid`, {});
    check('group spot marked paid on the pitch', r.status === 200
      && Boolean(db.prepare('SELECT paid_at FROM group_signups WHERE id = ?').get(suAt.id).paid_at), r.data);

    // d) payment link
    const payreq2 = emailCount('payreq');
    r = await admin('POST', '/admin/bookings', {
      payment: 'link', kind: 'group', groupCode: grpCode,
      customer: { name: 'Linkki Maksaja', email: 'linkki@test.local', lang: 'fi' },
    });
    check('group spot (link) pending', r.status === 201, r.data);
    const suLink = db.prepare('SELECT * FROM group_signups WHERE code = ?').get(r.data.code);
    check('link spot: pending, 72h window, token', suLink.status === 'pending'
      && /^[0-9a-f]{32}$/.test(suLink.pay_token || '')
      && suLink.pay_by > new Date(Date.now() + 71 * 3600000).toISOString(), suLink);
    check('group payment-request email sent', emailCount('payreq') === payreq2 + 1);
    await sendWebhook({ group_signup: suLink.code }, 'pi_group_link');
    const suLinkAfter = db.prepare('SELECT status, paid_at FROM group_signups WHERE id = ?').get(suLink.id);
    check('webhook confirms the linked group spot', suLinkAfter.status === 'confirmed' && Boolean(suLinkAfter.paid_at), suLinkAfter);
    pg = await page(`/api/pay/${suLink.pay_token}`);
    check('group pay link after payment: thank-you page', pg.status === 200
      && pg.text.includes('maksu vastaanotettu'), pg.status);

    // e) capacity: 3 spots taken, 1 left, then full
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'group', groupCode: grpCode,
      customer: { name: 'Neljäs Pelaaja', email: 'neljas@test.local' },
    });
    check('4th spot fills the session', r.status === 201, r.data);
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'group', groupCode: grpCode,
      customer: { name: 'Viides Pelaaja', email: 'viides@test.local' },
    });
    check('5th spot → full 409', r.status === 409 && /full/.test(r.data.error), r.data);
    // Review fix: the failed attempt must NOT leave an orphan account behind,
    // and the identical retry must hit the same clean 409 (not "account exists").
    check('failed attempt leaves no orphan account',
      !db.prepare("SELECT 1 FROM users WHERE email = 'viides@test.local'").get());
    r = await admin('POST', '/admin/bookings', {
      payment: 'paid', kind: 'group', groupCode: grpCode,
      customer: { name: 'Viides Pelaaja', email: 'viides@test.local' },
    });
    check('retry repeats the real error, not "account exists"',
      r.status === 409 && /full/.test(r.data.error), r.data);

    // --- pay-link lifecycle: bad tokens + sweep release ----------------------
    pg = await page('/api/pay/deadbeefdeadbeefdeadbeefdeadbeef');
    check('unknown token → 404 page', pg.status === 404, pg.status);
    pg = await page('/api/pay/nonsense');
    check('malformed token → 404 page', pg.status === 404, pg.status);

    const sweepMailBefore = emailCount('release');
    r = await admin('POST', '/admin/bookings', {
      payment: 'link', kind: 'single', coachId, date: d2, hour: 13, location: 'Helsinki',
      customer: { name: 'Unohtaja', email: 'unohtaja@test.local' },
    });
    check('second link booking created', r.status === 201, r.data);
    const expInv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(r.data.invoice.number);
    db.prepare("UPDATE invoices SET pay_by = ? WHERE id = ?")
      .run(new Date(Date.now() - 60000).toISOString(), expInv.id);
    await admin('GET', '/admin/bookings'); // triggers the sweep
    const expAfter = db.prepare(`SELECT i.status AS inv, b.status AS bk FROM invoices i
      JOIN bookings b ON b.id = i.booking_id WHERE i.id = ?`).get(expInv.id);
    check('unpaid link booking released at its deadline',
      expAfter.inv === 'void' && expAfter.bk === 'cancelled', expAfter);
    check('release email sent', emailCount('release') === sweepMailBefore + 1);
    pg = await page(`/api/pay/${expInv.pay_token}`);
    check('pay link after release → gone page', pg.status === 410
      && pg.text.includes('ei ole enää voimassa'), pg.status);

    // --- review fixes: search, reactivate window, past-session pendings ------
    db.prepare(`INSERT INTO users (email, password_hash, name, role, email_verified, created_at)
      VALUES ('orjan@test.local', 'x', 'Örjan Öhman', 'customer', 1, ?)`).run(new Date().toISOString());
    r = await admin('GET', '/admin/customers?q=öhman');
    check('search matches Finnish Ö names (ASCII lower() bypassed)',
      r.status === 200 && r.data.some((u) => u.email === 'orjan@test.local'), r.data);

    // Cancel + reactivate must not SHORTEN a pay-link's 72 h window to 45 min.
    addSlot(d2, 14);
    r = await admin('POST', '/admin/bookings', {
      payment: 'link', kind: 'single', coachId, date: d2, hour: 14, location: 'Helsinki',
      customer: { id: custId },
    });
    check('link booking for the reactivate check', r.status === 201, r.data);
    const reInv = db.prepare('SELECT * FROM invoices WHERE number = ?').get(r.data.invoice.number);
    const reBooking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(reInv.booking_id);
    await admin('POST', `/admin/bookings/${reBooking.id}/status`, { status: 'cancelled' });
    r = await admin('POST', `/admin/bookings/${reBooking.id}/status`, { status: 'confirmed' });
    check('cancel → reactivate succeeds', r.status === 200, r.data);
    const reInvAfter = db.prepare('SELECT status, pay_by FROM invoices WHERE id = ?').get(reInv.id);
    check('reactivation keeps the 72 h pay-link window',
      reInvAfter.status === 'sent'
      && reInvAfter.pay_by > new Date(Date.now() + 47 * 3600000).toISOString(), reInvAfter);

    // A pending (unpaid link) group spot on a session that already started is
    // cancelled silently — no "book anew" email days after the fact.
    addSlot(d3, 12);
    r = await coach('POST', '/coach/groups', { date: d3, hour: 12, location: 'Helsinki' });
    const grp2 = r.data;
    r = await admin('POST', '/admin/bookings', {
      payment: 'link', kind: 'group', groupCode: grp2.code,
      customer: { name: 'Nukkuja Nieminen', email: 'nukkuja@test.local' },
    });
    check('pending link spot on session #2', r.status === 201, r.data);
    const suSleep = db.prepare('SELECT * FROM group_signups WHERE code = ?').get(r.data.code);
    // sid smoke check while the spot is still pending: a bogus sid must not crash.
    pg = await page(`/api/pay/${suSleep.pay_token}/return?sid=cs_bogus123`);
    check('bogus ?sid on the return page degrades to pending', pg.status === 200
      && pg.text.includes('Maksua ei viimeistelty'), pg.status);
    const releaseBefore2 = emailCount('group_release');
    db.prepare('UPDATE group_sessions SET date = ? WHERE id = ?').run(helsinkiDate(-1), grp2.id);
    await admin('GET', '/groups'); // any sweep-triggering read
    const suSleepAfter = db.prepare('SELECT status FROM group_signups WHERE id = ?').get(suSleep.id);
    check('pending spot on a started session is cancelled', suSleepAfter.status === 'cancelled', suSleepAfter);
    check('…without a "book anew" release email', emailCount('group_release') === releaseBefore2);

    // --- money model stays sane ---------------------------------------------
    r = await admin('GET', '/admin/finance');
    const thisMonth = r.data.months[r.data.months.length - 1];
    check('finance: 1-on-1 revenue includes admin-created paid invoices',
      thisMonth.oneOnOneCents >= 12000, thisMonth); // link 40 + paid 40 + at-session 40
    check('finance: group revenue includes the paid spots', thisMonth.groupCents >= 10000, thisMonth);

    r = await admin('GET', '/admin/crm');
    check('CRM sees the admin-created accounts',
      r.data.customers.some((c) => c.email === 'uusi@test.local'), r.data.customers.length);
  } catch (err) {
    failed++;
    console.log('FAIL  suite crashed —', err.message);
  } finally {
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
