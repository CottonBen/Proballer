// A free-session credit is compensation for a session the customer PAID FOR
// and did not get. Cancelling an unpaid booking must never hand one out —
// otherwise a customer books, never pays, gets cancelled, and walks away with
// a free session they were never charged for.
//
// This matters more since bookings stopped expiring: an unpaid booking now
// lives indefinitely, so "cancel the unpaid ones" is routine admin work rather
// than a rare event.
'use strict';

const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PROJECT = path.join(__dirname, '..');
const PORT = 3465;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pbf-credit-'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
}

function client() {
  let cookie = '';
  return async (method, p, body) => {
    const r = await fetch(BASE + '/api' + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of (r.headers.getSetCookie?.() || [])) {
      if (c.startsWith('pbf_session')) cookie = c.split(';')[0];
    }
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt.slice(0, 200); }
    return { status: r.status, data };
  };
}

const BILLING = {
  name: 'Testi Maksaja', email: 'lasku@test.local', phone: '+358 40 123 4567',
  address: 'Testikatu 1 A 2', postcode: '00100', city: 'Helsinki',
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, DEMO_DATA: '0', SMTP_HOST: '',
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'TestAdmin123!',
      COACH_EMAIL: 'coach@test.local', COACH_PASSWORD: 'TestCoach123!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  let db;
  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { if ((await fetch(BASE + '/api/config')).ok) { up = true; break; } } catch { /* boot */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('no boot');

    db = new DatabaseSync(path.join(DATA_DIR, 'proballers.db'));
    const admin = client();
    let r = await admin('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200, r.status);

    const coachId = db.prepare(
      `SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id WHERE u.email = 'coach@test.local'`).get().id;
    db.prepare(`UPDATE coaches SET locations = '["Helsinki"]',
      positions = '["goalkeepers","defenders","midfielders","attackers"]', active = 1
      WHERE id = ?`).run(coachId);

    const openSlot = (date, hour) => db.prepare(
      'INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, date, hour, new Date().toISOString());

    // A verified customer, ready to book.
    async function customer(tag) {
      const c = client();
      const email = `${tag}@test.local`;
      await c('POST', '/auth/signup',
        { ageConfirmed: true, name: tag, email, password: 'Password1!', area: 'Helsinki', lang: 'fi' });
      const code = db.prepare('SELECT code FROM pending_signups WHERE email = ?').get(email).code;
      const v = await c('POST', '/auth/verify-signup', { email, code });
      return { c, id: v.data.user.id, email };
    }
    const creditsFor = (userId) => db.prepare(
      'SELECT COUNT(*) n FROM credits WHERE customer_id = ? AND used_by_booking_id IS NULL').get(userId).n;
    const bookingRow = (code) => db.prepare('SELECT * FROM bookings WHERE code = ?').get(code);

    async function book(cust, date, hour, extra = {}) {
      openSlot(date, hour);
      const res = await cust.c('POST', '/bookings', {
        billing: BILLING, coachId, date, hour, location: 'Helsinki',
        position: 'goalkeepers', focus: 'technical', lang: 'fi', ...extra,
      });
      return res;
    }
    const cancelAsAdmin = (id) => admin('POST', `/admin/bookings/${id}/status`, { status: 'cancelled' });

    // ---------------------------------------------------------------------
    // 1. UNPAID booking cancelled -> NO free session. The whole point.
    // ---------------------------------------------------------------------
    const u = await customer('unpaid');
    r = await book(u, day(3), 10);
    check('unpaid booking created', r.status === 201, r.data);
    const unpaidCode = r.data.booking.code;
    check('it really is unpaid',
      db.prepare(`SELECT i.status FROM invoices i JOIN bookings b ON b.id = i.booking_id
        WHERE b.code = ?`).get(unpaidCode).status === 'sent');
    check('no credits before', creditsFor(u.id) === 0, creditsFor(u.id));

    r = await cancelAsAdmin(bookingRow(unpaidCode).id);
    check('admin can cancel an unpaid booking', r.status === 200, r.data);
    check('booking is cancelled', bookingRow(unpaidCode).status === 'cancelled');
    check('NO free session granted for an unpaid booking', creditsFor(u.id) === 0, creditsFor(u.id));
    check('its invoice is voided, not left owing',
      db.prepare(`SELECT i.status FROM invoices i JOIN bookings b ON b.id = i.booking_id
        WHERE b.code = ?`).get(unpaidCode).status === 'void');

    // Cancelling a second unpaid booking must not accumulate credits either.
    r = await book(u, day(4), 10);
    await cancelAsAdmin(bookingRow(r.data.booking.code).id);
    check('still no credits after a second unpaid cancellation', creditsFor(u.id) === 0, creditsFor(u.id));

    // ---------------------------------------------------------------------
    // 2. PAID booking cancelled -> one free session. The rule still works.
    // ---------------------------------------------------------------------
    const p = await customer('paid');
    r = await book(p, day(3), 11);
    const paidCode = r.data.booking.code;
    const paidInv = db.prepare(`SELECT i.number FROM invoices i JOIN bookings b ON b.id = i.booking_id
      WHERE b.code = ?`).get(paidCode).number;
    r = await admin('POST', `/admin/invoices/${encodeURIComponent(paidInv)}/paid`, {});
    check('admin marks it paid', r.status === 200, r.data);

    r = await cancelAsAdmin(bookingRow(paidCode).id);
    check('paid booking cancels', r.status === 200, r.data);
    check('a PAID cancellation does grant one free session', creditsFor(p.id) === 1, creditsFor(p.id));

    // ---------------------------------------------------------------------
    // 3. A booking made free by a 100%-off code is NOT a paid booking.
    //    Its invoice is marked paid for 0 €, which used to look like proof of
    //    payment and minted a credit out of nothing.
    // ---------------------------------------------------------------------
    await admin('POST', '/admin/discounts', { code: 'FREE100', kind: 'percent', percent: 100 });
    const z = await customer('zero');
    r = await book(z, day(3), 12, { code: 'FREE100' });
    check('100%-off booking created', r.status === 201, r.data);
    const zeroCode = r.data.booking.code;
    check('it cost nothing', bookingRow(zeroCode).total_cents === 0, bookingRow(zeroCode).total_cents);

    r = await cancelAsAdmin(bookingRow(zeroCode).id);
    check('zero-price booking cancels', r.status === 200, r.data);
    check('NO free session for a booking that cost 0 €', creditsFor(z.id) === 0, creditsFor(z.id));

    // ---------------------------------------------------------------------
    // 4. Cancelling a FREE-CREDIT booking returns the credit — it does not
    //    invent a second one, and does not swallow the first.
    // ---------------------------------------------------------------------
    const cUser = p;                       // already holds exactly one credit
    r = await book(cUser, day(5), 13);
    const freeCode = r.data.booking.code;
    check('the credit was spent on the new booking',
      bookingRow(freeCode).credit_applied === 1 && creditsFor(cUser.id) === 0, creditsFor(cUser.id));
    r = await cancelAsAdmin(bookingRow(freeCode).id);
    check('free-session booking cancels', r.status === 200, r.data);
    check('the credit comes back, exactly one', creditsFor(cUser.id) === 1, creditsFor(cUser.id));

    // ---------------------------------------------------------------------
    // 5. A booking funded by an UNPAID package is not paid either.
    // ---------------------------------------------------------------------
    const k = await customer('pkg');
    r = await book(k, day(6), 9, { package: 'pack3' });
    check('package booking created', r.status === 201, r.data);
    const pkgCode = r.data.booking.code;
    check('the package is still unpaid',
      db.prepare('SELECT status FROM packages WHERE code = ?').get(r.data.package.code).status === 'pending');
    r = await cancelAsAdmin(bookingRow(pkgCode).id);
    check('package booking cancels', r.status === 200, r.data);
    check('NO free session for an unpaid package booking', creditsFor(k.id) === 0, creditsFor(k.id));

    // ---------------------------------------------------------------------
    // 6. The coach's own cancel button follows the same rule.
    // ---------------------------------------------------------------------
    const cc = client();
    r = await cc('POST', '/auth/login', { email: 'coach@test.local', password: 'TestCoach123!' });
    check('coach logs in', r.status === 200, r.status);
    const u2 = await customer('unpaid2');
    r = await book(u2, day(7), 14);
    const coachCode = r.data.booking.code;
    r = await cc('POST', `/coach/bookings/${coachCode}/status`, { status: 'cancelled' });
    check('coach cancels an unpaid booking', r.status === 200, r.data);
    check('NO free session from a coach cancelling an unpaid booking',
      creditsFor(u2.id) === 0, creditsFor(u2.id));
  } catch (err) {
    failed++;
    console.log('  FAIL  suite crashed —', err.message);
  } finally {
    if (db) db.close();
    server.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
