// E2E checks for the July 15 batch: phone at signup + CRM leads, welcome /
// booking / pitch confirmation emails, review + rebook automation, email log
// endpoints, and pay-at-booking response shape. Runs a scratch server on :3459
// with SMTP disabled (every send lands in email_log as 'smtp-not-configured').
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = require('node:path').join(__dirname, '..');
const SCRATCH = __dirname;
const DATA_DIR = path.join(SCRATCH, 'e2e-data2');
const PORT = 3459;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_localtest_123';

fs.rmSync(DATA_DIR, { recursive: true, force: true });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

// Cookie-jar fetch per user.
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

function sendWebhook(payload) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return fetch(BASE + '/api/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    body: raw,
  });
}

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      DEMO_DATA: '0',
      SMTP_HOST: '',            // never send real email from tests
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
    // Wait for boot.
    let up = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const r = await fetch(BASE + '/api/config');
        if (r.ok) { up = true; break; }
      } catch { /* not yet */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('server did not boot');

    const db = new DatabaseSync(path.join(DATA_DIR, 'proballers.db'));

    // --- signup: phone validation + storage + welcome email ------------------
    const anon = client();
    let r = await anon('POST', '/auth/signup', {
      name: 'Testi Asiakas', email: 'kunde1@test.local', password: 'Password1!',
      phone: 'not-a-phone!!', area: 'Helsinki', lang: 'en',
    });
    check('signup rejects a bad phone number', r.status === 400, r);

    const cust1 = client();
    r = await cust1('POST', '/auth/signup', {
      name: 'Testi Asiakas', email: 'kunde1@test.local', password: 'Password1!',
      phone: '+358 40 123 4567', area: 'Helsinki', lang: 'en',
    });
    check('signup with phone starts a PENDING signup (no account yet)',
      r.status === 200 && r.data.pendingSignup === true, r.data);
    check('no user row before verification', !db.prepare(
      "SELECT 1 FROM users WHERE email = 'kunde1@test.local'").get(), null);
    const p1 = db.prepare("SELECT * FROM pending_signups WHERE email = 'kunde1@test.local'").get();
    check('phone parked on the pending signup', p1 && p1.phone === '+358 40 123 4567', p1 && p1.phone);
    // Since July 2026 the signup email is the VERIFICATION code; the welcome
    // email follows once the code is confirmed.
    const verify1 = db.prepare(
      "SELECT * FROM email_log WHERE type = 'verify' AND to_email = 'kunde1@test.local'").get();
    check('verification email logged at signup', Boolean(verify1), verify1);
    check('verification email logged as smtp-not-configured', verify1 && verify1.error === 'smtp-not-configured', verify1 && verify1.error);


    // The emailed code CREATES the account (and signs the browser in).
    const verifyUser = async (cli, email) => {
      const code = db.prepare('SELECT code FROM pending_signups WHERE email = ?').get(email).code;
      const vr = await cli('POST', '/auth/verify-signup', { email, code });
      if (vr.status !== 200) throw new Error('verify failed for ' + email + ': ' + JSON.stringify(vr.data));
    };
    await verifyUser(cust1, 'kunde1@test.local');
    check('user row exists only after verification', Boolean(db.prepare(
      "SELECT 1 FROM users WHERE email = 'kunde1@test.local'").get()), null);
    check('welcome email follows verification', Boolean(db.prepare(
      "SELECT 1 FROM email_log WHERE type = 'welcome' AND to_email = 'kunde1@test.local'").get()), null);

    const cust2 = client();
    r = await cust2('POST', '/auth/signup', {
      name: 'Toinen Asiakas', email: 'kunde2@test.local', password: 'Password1!', area: 'Espoo', lang: 'fi',
    });
    check('signup without phone succeeds', r.status === 200, r);
    await verifyUser(cust2, 'kunde2@test.local');

    // --- coach setup + card booking ------------------------------------------
    const coachRow = db.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id
      WHERE u.email = 'coach@test.local'`).get();
    check('seeded coach account has a coach profile', Boolean(coachRow), coachRow);
    const coachId = coachRow.id;
    db.prepare("UPDATE coaches SET locations = '[\"Helsinki\"]', positions = '[\"defenders\"]', active = 1 WHERE id = ?")
      .run(coachId);
    const tomorrow = day(2); // day after tomorrow: safe against Helsinki midnight edges
    db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, tomorrow, 10, new Date().toISOString());

    r = await cust1('POST', '/bookings', {
      coachId, date: tomorrow, hour: 10, position: 'defenders', focus: 'technical',
      location: 'Helsinki', notes: 'Vasemman jalan syötöt', lang: 'en',
    });
    check('card booking created', r.status === 201, r);
    const code = r.data.booking.code;
    const invoiceNumber = r.data.invoice.number;
    check('card booking has a pay_by deadline', Boolean(r.data.invoice.payBy), r.data.invoice);
    let bRow = db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);
    check('card booking hidden from coach before payment', bRow.coach_notified === 0, bRow.coach_notified);
    check('no booking-confirmation email before payment',
      !db.prepare("SELECT 1 FROM email_log WHERE type = 'booking' AND booking_code = ?").get(code));

    // --- payment confirms -> announce + booking email + receipt --------------
    const wh = await sendWebhook({
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', metadata: { invoice_number: invoiceNumber } } },
    });
    check('webhook accepted', wh.ok, wh.status);
    bRow = db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);
    check('booking announced to coach after payment', bRow.coach_notified === 1, bRow.coach_notified);
    check('invoice marked paid',
      db.prepare('SELECT status FROM invoices WHERE number = ?').get(invoiceNumber).status === 'paid');
    check('booking-confirmation email logged after payment',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'booking' AND booking_code = ? AND to_email = 'kunde1@test.local'").get(code)));
    check('coach booking-notice email logged after payment',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'coach_booking' AND booking_code = ? AND to_email = 'coach@test.local'").get(code)));
    check('receipt email logged after payment',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'receipt' AND booking_code = ?").get(code)));

    // --- pitch assignment -> chat line + pitch email --------------------------
    db.prepare(`INSERT INTO meta (key, value) VALUES ('pitches:v2:Helsinki', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({ fetchedAt: new Date().toISOString(), pitches: [{
        id: 123, name: 'Testikenttä', address: 'Testikatu 1, Helsinki', city: 'Helsinki',
        surface: 'artificial-turf', lighting: true, indoor: false, stadium: false, www: null,
      }] }));
    const coach = client();
    r = await coach('POST', '/auth/login', { email: 'coach@test.local', password: 'TestCoach123!' });
    check('coach can log in', r.status === 200, r);
    r = await coach('POST', `/coach/bookings/${code}/pitch`, { pitchId: 123 });
    check('coach sets the pitch', r.status === 200 && r.data.pitch.name === 'Testikenttä', r);
    check('pitch confirmation email logged',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'pitch' AND booking_code = ? AND to_email = 'kunde1@test.local'").get(code)));
    check('pitch chat line posted',
      Boolean(db.prepare("SELECT 1 FROM chat_messages WHERE body LIKE '📍%Testikenttä%'").get()));
    r = await coach('POST', `/coach/bookings/${code}/pitch`, { pitchId: 123 });
    check('re-setting the same pitch sends no second email', r.status === 200 &&
      db.prepare("SELECT COUNT(*) n FROM email_log WHERE type = 'pitch' AND booking_code = ?").get(code).n === 1);

    // --- availability editing from the coach app --------------------------------
    r = await coach('PUT', '/coach/availability', { adds: [{ date: tomorrow, hour: 15 }], removes: [] });
    check('coach can open an hour from the app', r.status === 200 && r.data.added === 1, r.data);
    r = await coach('GET', `/coach/availability?from=${tomorrow}&to=${tomorrow}`);
    check('opened hour is listed', r.status === 200 && r.data.slots.some((s) => s.hour === 15), r.data && r.data.slots);
    r = await coach('PUT', '/coach/availability', { adds: [], removes: [{ date: tomorrow, hour: 15 }] });
    check('coach can close it again', r.status === 200 && r.data.removed === 1, r.data);
    r = await coach('PUT', '/coach/availability', { adds: [], removes: [{ date: tomorrow, hour: 10 }] });
    check('a booked hour cannot be closed', r.status === 200 && r.data.removed === 0
      && r.data.conflicts.length === 1, r.data);

    // --- review + rebook automation -------------------------------------------
    const now = new Date().toISOString();
    const u1 = db.prepare("SELECT * FROM users WHERE email = 'kunde1@test.local'").get();
    const u2 = db.prepare("SELECT * FROM users WHERE email = 'kunde2@test.local'").get();
    // customer1: session 2 days ago (review due; rebook NOT due yet, and they
    // have an upcoming paid booking anyway).
    db.prepare(`INSERT INTO bookings (code, customer_id, coach_id, date, hour, location, position, focus,
      price_cents, discount_cents, total_cents, status, completed_at, created_at)
      VALUES ('PBF-TESTX2', ?, ?, ?, 10, 'Helsinki', 'defenders', 'technical', 8000, 4000, 4000,
        'completed', ?, ?)`).run(u1.id, coachId, day(-2), now, now);
    // customer2: session 4 days ago (review due — within 7-day window; rebook due).
    db.prepare(`INSERT INTO bookings (code, customer_id, coach_id, date, hour, location, position, focus,
      price_cents, discount_cents, total_cents, status, completed_at, created_at)
      VALUES ('PBF-TESTX3', ?, ?, ?, 11, 'Helsinki', 'defenders', 'technical', 8000, 4000, 4000,
        'completed', ?, ?)`).run(u2.id, coachId, day(-4), now, now);

    const admin = client();
    r = await admin('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin can log in', r.status === 200, r);
    r = await admin('POST', '/admin/emails/run', {});
    check('automation run endpoint works', r.status === 200 && r.data.ok, r);

    const x2 = db.prepare("SELECT * FROM bookings WHERE code = 'PBF-TESTX2'").get();
    const x3 = db.prepare("SELECT * FROM bookings WHERE code = 'PBF-TESTX3'").get();
    check('review flag set on the 2-day-old session', x2.review_email_sent === 1, x2.review_email_sent);
    check('review flag set on the 4-day-old session', x3.review_email_sent === 1, x3.review_email_sent);
    check('rebook flag set on the 4-day-old session', x3.rebook_email_sent === 1, x3.rebook_email_sent);
    check('rebook NOT sent to the customer with an upcoming booking', x2.rebook_email_sent === 0, x2.rebook_email_sent);
    check('review email logged for customer1',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'review' AND booking_code = 'PBF-TESTX2'").get()));
    check('rebook email logged for customer2 only',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'rebook' AND to_email = 'kunde2@test.local'").get())
      && !db.prepare("SELECT 1 FROM email_log WHERE type = 'rebook' AND to_email = 'kunde1@test.local'").get());
    // Second run: nothing new goes out.
    const before = db.prepare('SELECT COUNT(*) n FROM email_log').get().n;
    r = await admin('POST', '/admin/emails/run', {});
    check('automation is idempotent', r.data.sent.review === 0 && r.data.sent.rebook === 0
      && db.prepare('SELECT COUNT(*) n FROM email_log').get().n === before, r.data);

    // --- admin panels ----------------------------------------------------------
    r = await admin('GET', '/admin/emails');
    check('email status endpoint returns log + lastRun',
      r.status === 200 && Boolean(r.data.lastRun) && r.data.recent.length >= 5
      && r.data.counts.welcome && r.data.counts.welcome.total >= 2, r.data && { lastRun: r.data.lastRun, n: r.data.recent?.length });
    r = await cust1('GET', '/admin/emails');
    check('email status endpoint is admin-only', r.status === 401 || r.status === 403, r.status);
    r = await cust1('POST', '/admin/emails/run', {});
    check('automation run is admin-only', r.status === 401 || r.status === 403, r.status);

    r = await admin('GET', '/admin/crm');
    const crm1 = r.data.customers.find((c) => c.email === 'kunde1@test.local');
    const crm2 = r.data.customers.find((c) => c.email === 'kunde2@test.local');
    check('CRM returns the phone number', crm1 && crm1.phone === '+358 40 123 4567', crm1 && crm1.phone);
    check('CRM returns empty phone for phoneless accounts', crm2 && crm2.phone === '', crm2 && crm2.phone);
    check('lead starts as open (not called)', crm1.lead_called_at == null, crm1.lead_called_at);
    check('CRM shows when the last booking was made',
      crm1.bookings >= 1 && crm1.last_booking_made === new Date().toISOString().slice(0, 10),
      { bookings: crm1.bookings, made: crm1.last_booking_made });

    // Called / open toggle.
    r = await admin('POST', `/admin/customers/${crm1.id}/called`, { called: true });
    check('lead can be marked called', r.status === 200 && Boolean(r.data.calledAt), r);
    r = await admin('GET', '/admin/crm');
    check('CRM shows the called timestamp',
      Boolean(r.data.customers.find((c) => c.id === crm1.id).lead_called_at));
    r = await admin('POST', `/admin/customers/${crm1.id}/called`, { called: false });
    check('lead can be reopened', r.status === 200 && r.data.calledAt === null, r.data);
    r = await cust1('POST', `/admin/customers/${crm1.id}/called`, { called: true });
    check('called toggle is admin-only', r.status === 401 || r.status === 403, r.status);
    r = await admin('POST', '/admin/customers/999999/called', { called: true });
    check('called toggle 404s on unknown customer', r.status === 404, r.status);

    // --- unpaid booking release sends an email ---------------------------------
    db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, tomorrow, 12, new Date().toISOString());
    r = await cust2('POST', '/bookings', {
      coachId, date: tomorrow, hour: 12, position: 'defenders', focus: 'technical',
      location: 'Helsinki', lang: 'fi',
    });
    check('second card booking created', r.status === 201, r);
    const relCode = r.data.booking.code;
    db.prepare(`UPDATE invoices SET pay_by = ? WHERE number = ?`)
      .run(new Date(Date.now() - 60000).toISOString(), r.data.invoice.number);
    await admin('GET', '/admin/analytics'); // triggers the sweep
    check('unpaid booking was released',
      db.prepare('SELECT status FROM bookings WHERE code = ?').get(relCode).status === 'cancelled');
    check('release email logged to the customer',
      Boolean(db.prepare("SELECT 1 FROM email_log WHERE type = 'release' AND booking_code = ? AND to_email = 'kunde2@test.local'").get(relCode)));

    // --- admin hard-delete of a booking ---------------------------------------
    const delBooking = db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);
    // pretend a credit was consumed by the X2 booking, to check it comes back
    const x2id = db.prepare("SELECT id FROM bookings WHERE code = 'PBF-TESTX2'").get().id;
    db.prepare(`INSERT INTO credits (customer_id, reason, created_at, used_by_booking_id)
      VALUES (?, 'test', ?, ?)`).run(u1.id, new Date().toISOString(), x2id);

    r = await cust1('DELETE', `/admin/bookings/${delBooking.id}`);
    check('booking delete is admin-only', r.status === 401 || r.status === 403, r.status);
    r = await admin('DELETE', '/admin/bookings/999999');
    check('booking delete 404s on unknown id', r.status === 404, r.status);

    r = await admin('DELETE', `/admin/bookings/${delBooking.id}`);
    check('admin can delete a booking', r.status === 200 && r.data.ok, r);
    check('booking row is gone', !db.prepare('SELECT 1 FROM bookings WHERE id = ?').get(delBooking.id));
    check('its invoice is gone', !db.prepare('SELECT 1 FROM invoices WHERE number = ?').get(invoiceNumber));
    check('coach was told about the removed upcoming session',
      Boolean(db.prepare("SELECT 1 FROM notifications WHERE message LIKE '%was removed by the admin%'").get()));
    const slots = await (await fetch(`${BASE}/api/coaches/${coachId}/slots`)).json();
    check('the slot is bookable again', slots.slots.some((s) => s.date === tomorrow && s.hour === 10), slots.slots);

    r = await admin('DELETE', `/admin/bookings/${x2id}`);
    check('deleting a credit booking succeeds', r.status === 200, r);
    check('the consumed credit returns to the customer',
      db.prepare('SELECT used_by_booking_id FROM credits WHERE customer_id = ?').get(u1.id).used_by_booking_id === null);

    // --- admin coach-activity summary (coach-app admin mode) --------------------
    r = await admin('GET', '/admin/coach-activity');
    const act = r.data;
    check('coach-activity summary works', r.status === 200 && Array.isArray(act.coaches)
      && act.coaches.length >= 1 && 'slotsAdded7d' in act.coaches[0] && 'openSlots' in act.coaches[0]
      && Array.isArray(act.recent), act && act.coaches);
    check('activity counts the opened slots',
      act.coaches.find((c) => c.id === coachId).slotsAdded7d >= 1, act.coaches);
    check('recent bookings carry coach + customer names',
      act.recent.length >= 1 && act.recent[0].coach && act.recent[0].customer, act.recent[0]);
    r = await cust1('GET', '/admin/coach-activity');
    check('coach-activity is admin-only', r.status === 401 || r.status === 403, r.status);

    // --- spotlight ordering ----------------------------------------------------
    r = await admin('GET', `/admin/coaches/${coachId}`);
    check('coach detail returns spotlightOrder', r.status === 200 && 'spotlightOrder' in r.data, r.status);
    const base = { name: r.data.name, bio: r.data.bio, bio_en: r.data.bio_en,
      positions: r.data.positions, locations: r.data.locations };
    r = await admin('PUT', `/admin/coaches/${coachId}`, { ...base, spotlightOrder: 2 });
    check('spotlight position can be set', r.status === 200, r);
    let pub = (await (await fetch(`${BASE}/api/coaches`)).json()).find((c) => c.id === coachId);
    check('public API shows position + featured on', pub.spotlightOrder === 2 && pub.featured === true, pub);
    r = await admin('PUT', `/admin/coaches/${coachId}`, { ...base, spotlightOrder: 'abc' });
    check('bad spotlight position rejected', r.status === 400, r.status);
    r = await admin('PUT', `/admin/coaches/${coachId}`, { ...base, spotlightOrder: null });
    check('clearing the position drops the coach from the spotlight', r.status === 200
      && !(await (await fetch(`${BASE}/api/coaches`)).json()).find((c) => c.id === coachId).featured);

    // Customers export dataset includes the phone column (checked via SQL —
    // the dataset module can't be required here without its own DB handle).
    const exportRow = db.prepare(`SELECT name, email, phone, created_at,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id) AS bookings
      FROM users u WHERE role='customer' ORDER BY created_at DESC`).get();
    check('Customers export query includes phone', exportRow && 'phone' in exportRow);
  } catch (err) {
    failed++;
    console.error('FATAL', err);
    console.error(log.slice(-800));
  } finally {
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
