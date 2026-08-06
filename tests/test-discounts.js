// Discount / promo codes: unit tests for the pricing module (scratch DB) plus
// an E2E pass that boots a real server and redeems a code through the API.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (n, c, x) => {
  if (c) { passed++; console.log(`  ok  ${n}`); }
  else { failed++; console.log(`FAIL  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); }
};

// ===========================================================================
// Part 1 — unit tests against an isolated scratch DB
// ===========================================================================
const UDATA = path.join(__dirname, `disc-unit-data-${process.pid}`);
fs.rmSync(UDATA, { recursive: true, force: true });
process.env.DATA_DIR = UDATA;
const { db, nowISO } = require('../server/db');
const D = require('../server/discounts');

// FK parents for the booking rows used to test derived usage.
db.prepare("INSERT INTO users (email, password_hash, name, role, created_at) VALUES ('u@x.co','x','U','customer',?)").run(nowISO());
const uid = db.prepare("SELECT id FROM users WHERE email='u@x.co'").get().id;
db.prepare("INSERT INTO coaches (name, slug, created_at) VALUES ('C','c',?)").run(nowISO());
const cid = db.prepare("SELECT id FROM coaches WHERE slug='c'").get().id;
let bseq = 0;
function addBooking(code, status) {
  bseq++;
  db.prepare(`INSERT INTO bookings (code, customer_id, coach_id, date, hour, location, position, focus,
    price_cents, discount_cents, total_cents, status, discount_code, created_at)
    VALUES (?,?,?,?,?,?,'','',4000,0,3200,?,?,?)`)
    .run('B' + bseq, uid, cid, '2026-08-01', 8 + bseq, 'Helsinki', status, code, nowISO());
}

// create() validation
check('create rejects a too-short code', !!D.create({ code: 'A', kind: 'percent', percent: 10 }).error);
check('create rejects percent > 100', !!D.create({ code: 'BADPCT', kind: 'percent', percent: 150 }).error);
check('create rejects fixed with 0 amount', !!D.create({ code: 'ZERO', kind: 'fixed', amountCents: 0 }).error);
check('create makes a percent code', !!D.create({ code: 'summer20', kind: 'percent', percent: 20 }).id);
check('code is stored uppercase', !!D.find('SUMMER20') && D.find('summer20').code === 'SUMMER20');
check('duplicate code rejected', !!D.create({ code: 'SUMMER20', kind: 'percent', percent: 30 }).error);
check('create makes a fixed code', !!D.create({ code: 'TENOFF', kind: 'fixed', amountCents: 1000 }).id);

// computeCents / apply
const pct = D.find('SUMMER20');
const fix = D.find('TENOFF');
check('percent off 40 € = 8 € (800c)', D.computeCents(pct, 4000) === 800);
check('percent off rounds', D.computeCents(pct, 4001) === 800);
check('fixed off = 10 € (1000c)', D.computeCents(fix, 4000) === 1000);
check('fixed never exceeds base (cap)', D.computeCents(fix, 600) === 600);
check('nothing off a 0 base', D.computeCents(pct, 0) === 0);
check('empty code = clean no-op', JSON.stringify(D.apply(4000, '')) === JSON.stringify({ code: '', discountCents: 0, finalCents: 4000 }));
let a = D.apply(4000, 'summer20');
check('apply percent: 800 off, 3200 left', a.discountCents === 800 && a.finalCents === 3200 && a.code === 'SUMMER20');
check('apply unknown code errors', !!D.apply(4000, 'NOPE').error);

// validate: inactive / expired / maxed
D.create({ code: 'OFF3', kind: 'percent', percent: 30, maxUses: 2 });
check('OFF3 valid at 0 uses', !D.validate('OFF3').error);
addBooking('OFF3', 'confirmed'); addBooking('OFF3', 'confirmed');
check('OFF3 usesOf = 2', D.usesOf('OFF3') === 2);
check('OFF3 blocked once max_uses hit', /fully used/.test(D.validate('OFF3').error || ''));
addBooking('OFF3', 'cancelled');
check('cancelled booking does NOT count toward uses', D.usesOf('OFF3') === 2);
D.create({ code: 'GONE', kind: 'percent', percent: 10, expiresAt: '2020-01-01' });
check('expired code rejected', /expired/.test(D.validate('GONE').error || ''));
const inactiveId = D.create({ code: 'PAUSED', kind: 'percent', percent: 10 }).id;
D.update(inactiveId, { active: false });
check('inactive code rejected', /no longer active/.test(D.validate('PAUSED').error || ''));
D.update(inactiveId, { active: true });
check('re-activated code valid again', !D.validate('PAUSED').error);

// label + expiry normalisation
check('percent label', D.label(pct) === '20 %');
check('fixed label', D.label(fix) === '10,00 €');
check('date-only expiry -> end of Helsinki day, summer/UTC+3', D.normExpiry('2026-07-31') === '2026-07-31T20:59:59.999Z');
check('date-only expiry -> end of Helsinki day, winter/UTC+2', D.normExpiry('2026-01-15') === '2026-01-15T21:59:59.999Z');
check('blank expiry -> null', D.normExpiry('') === null);
check('garbage expiry -> false', D.normExpiry('not-a-date') === false);

// Package coach-payout basis (finding #1): a promo code on a package must NOT
// dock the coach — per-session value uses the pre-discount (list) price, the
// same for the first and later sessions of a discounted package.
const P = require('../server/packages');
check('perSessionCents uses list price when a code was applied', P.perSessionCents({ price_cents: 9120, code_discount_cents: 2280, sessions_total: 3 }) === 3800);
check('perSessionCents unchanged with no code', P.perSessionCents({ price_cents: 11400, sessions_total: 3 }) === 3800);
check('list reports derived uses', (D.list().find((d) => d.code === 'OFF3') || {}).uses === 2);

// ---- Per-customer cap (max_per_customer): "first booking only" -------------
db.prepare("INSERT INTO users (email, password_hash, name, role, created_at) VALUES ('u2@x.co','x','U2','customer',?)").run(nowISO());
const uid2 = db.prepare("SELECT id FROM users WHERE email='u2@x.co'").get().id;
function addBookingFor(code, status, customerId) {
  bseq++;
  db.prepare(`INSERT INTO bookings (code, customer_id, coach_id, date, hour, location, position, focus,
    price_cents, discount_cents, total_cents, status, discount_code, created_at)
    VALUES (?,?,?,?,?,?,'','',4000,0,3200,?,?,?)`)
    .run('BC' + bseq, customerId, cid, '2026-09-01', 8 + (bseq % 12), 'Helsinki', status, code, nowISO());
}
D.create({ code: 'FIRST1', kind: 'percent', percent: 15, maxPerCustomer: 1 });
check('create stores max_per_customer = 1', D.find('FIRST1').max_per_customer === 1);
check('unlimited when the field is omitted', D.find('SUMMER20').max_per_customer === null);
check('FIRST1 valid for customer A at 0 uses', !D.validate('FIRST1', uid).error);
check('validate with no customer context stays generic (no per-customer block)', !D.validate('FIRST1').error);
addBookingFor('FIRST1', 'confirmed', uid);
check('usesByCustomer counts A once', D.usesByCustomer('FIRST1', uid) === 1);
check('usesByCustomer is 0 for a customer who never used it', D.usesByCustomer('FIRST1', uid2) === 0);
check('FIRST1 now blocked for A', /already used/.test(D.validate('FIRST1', uid).error || ''));
check('FIRST1 still valid for a DIFFERENT customer B', !D.validate('FIRST1', uid2).error);
addBookingFor('FIRST1', 'cancelled', uid);
check('a cancelled booking does not add to the per-customer count', D.usesByCustomer('FIRST1', uid) === 1);
check('apply() enforces the cap for A', !!D.apply(4000, 'FIRST1', uid).error);
check('apply() still discounts for B (15% of 40 € = 6 €)', D.apply(4000, 'FIRST1', uid2).discountCents === 600);

D.create({ code: 'TWICE', kind: 'percent', percent: 10, maxPerCustomer: 2 });
addBookingFor('TWICE', 'confirmed', uid);
check('cap 2: still valid for A after 1 use', !D.validate('TWICE', uid).error);
addBookingFor('TWICE', 'confirmed', uid);
check('cap 2: blocked for A after 2 uses', /already used/.test(D.validate('TWICE', uid).error || ''));
const twiceId = D.find('TWICE').id;
D.update(twiceId, { maxPerCustomer: null });
check('update() can clear the cap back to unlimited', D.find('TWICE').max_per_customer === null && !D.validate('TWICE', uid).error);
D.update(twiceId, { maxPerCustomer: 3 });
check('update() can set a new cap', D.find('TWICE').max_per_customer === 3);
check('update() leaves the cap untouched when the field is omitted', (D.update(twiceId, { notes: 'x' }), D.find('TWICE').max_per_customer === 3));

db.close?.();
fs.rmSync(UDATA, { recursive: true, force: true });

// ===========================================================================
// Part 2 — E2E through the real API
// ===========================================================================
const EDATA = path.join(__dirname, `disc-e2e-data-${process.pid}`);
fs.rmSync(EDATA, { recursive: true, force: true });
const PORT = 3477;
const BASE = `http://localhost:${PORT}`;
const helsinkiDate = (o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(new Date(Date.now() + o * 86400000));

function client() {
  let cookies = {};
  return async function reqf(method, p, body) {
    const res = await fetch(BASE + '/api' + p, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const m = /^([^=]+)=([^;]*)/.exec(line); if (m) cookies[m[1]] = m[2];
    }
    let data = null; try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, data };
  };
}

(async function e2e() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: EDATA, DEMO_DATA: '0', SMTP_HOST: '',
      MOBILEPAY_WEBHOOK_SECRET: 'whsec_x',
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'TestAdmin123!',
      COACH_EMAIL: 'coach@test.local', COACH_PASSWORD: 'TestCoach123!', SITE_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { if ((await fetch(BASE + '/api/config')).ok) { up = true; break; } } catch { /* boot */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('no boot');

    const db2 = new DatabaseSync(path.join(EDATA, 'proballers.db'));
    const admin = client();
    let r = await admin('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200, r.status);
    const coachId = db2.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id=c.user_id WHERE u.email='coach@test.local'`).get().id;
    db2.prepare(`UPDATE coaches SET locations='["Helsinki"]', active=1 WHERE id=?`).run(coachId);

    // admin creates codes
    r = await admin('POST', '/admin/discounts', { code: 'welcome10', kind: 'fixed', amount: 10, maxUses: 1 });
    check('admin creates a fixed 10 € code (max 1 use)', r.status === 201, r.data);
    r = await admin('POST', '/admin/discounts', { code: 'HALF', kind: 'percent', percent: 50 });
    check('admin creates a 50% code', r.status === 201, r.data);
    r = await admin('POST', '/admin/discounts', { code: 'HALF', kind: 'percent', percent: 25 });
    check('duplicate code rejected via API', r.status === 400, r.data);

    // customer signs up + verifies
    const cust = client();
    await cust('POST', '/auth/signup', { name: 'Pelaaja', email: 'p@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi' });
    const vcode = db2.prepare("SELECT code FROM pending_signups WHERE email='p@test.local'").get().code;
    r = await cust('POST', '/auth/verify-signup', { email: 'p@test.local', code: vcode });
    check('customer verified', r.status === 200, r.data);
    const custId = r.data.user.id;

    // validate endpoint: 40 € sale price, HALF -> 20 € off
    r = await cust('POST', '/discounts/validate', { code: 'half', baseCents: 4000 });
    check('validate: HALF gives 2000 off on 4000', r.data.valid && r.data.discountCents === 2000 && r.data.finalCents === 2000, r.data);
    r = await cust('POST', '/discounts/validate', { code: 'NOPE', baseCents: 4000 });
    check('validate: unknown code invalid', r.data.valid === false && !!r.data.error, r.data);

    // book a 1-on-1 with WELCOME10 (40 € sale -> 30 €)
    const date = helsinkiDate(2);
    const hour = 10;
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, date, hour, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date, hour, location: 'Helsinki', code: 'welcome10' });
    check('booking with code accepted', r.status === 201, r.data);
    check('booking total is 40 € − 10 € = 30 € (3000c)', r.data.booking.totalCents === 3000, r.data.booking);
    check('booking reports the code + saving', r.data.booking.discountCode === 'WELCOME10' && r.data.booking.codeDiscountCents === 1000, r.data.booking);
    const bk = db2.prepare("SELECT id, total_cents, discount_code, code_discount_cents FROM bookings WHERE customer_id=? ORDER BY id DESC LIMIT 1").get(custId);
    check('DB row stores discounted total + code', bk.total_cents === 3000 && bk.discount_code === 'WELCOME10' && bk.code_discount_cents === 1000, bk);

    // A pending, unpaid card checkout must NOT count as a use yet (the bug the
    // admin hit: a fresh code showing 1/1 the moment checkout opened).
    r = await admin('GET', '/admin/discounts');
    let w = r.data.find((d) => d.code === 'WELCOME10');
    check('pending unpaid booking does NOT count (still 0 used)', w && w.uses === 0, w);

    // Mark the invoice paid -> now it is a genuine redemption and counts.
    const invNum = db2.prepare('SELECT number FROM invoices WHERE booking_id = ?').get(bk.id).number;
    r = await admin('POST', `/admin/invoices/${invNum}/paid`);
    check('admin marks the booking paid', r.status === 200, r.data);
    r = await admin('GET', '/admin/discounts');
    w = r.data.find((d) => d.code === 'WELCOME10');
    check('paid booking counts as a use (1 used)', w && w.uses === 1, w);

    // WELCOME10 now used up (max_uses 1) — reuse blocked
    const date2 = helsinkiDate(3);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, date2, hour, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: date2, hour, location: 'Helsinki', code: 'welcome10' });
    check('second use of a max-1 code is rejected', r.status === 400 && /fully used/.test(r.data.error || ''), r.data);

    // booking still works with no code — and the price is a flat 40 € with NO
    // automatic sale (price == total, zero sale discount).
    r = await cust('POST', '/bookings', { coachId, date: date2, hour, location: 'Helsinki' });
    check('plain booking is a flat 40 € — no sale discount',
      r.status === 201 && r.data.booking.totalCents === 4000
      && r.data.booking.priceCents === 4000 && r.data.booking.discountCents === 0, r.data.booking);

    // expired code rejected end-to-end
    await admin('POST', '/admin/discounts', { code: 'OLD', kind: 'percent', percent: 10, expiresAt: '2020-01-01' });
    const date3 = helsinkiDate(4);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, date3, hour, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: date3, hour, location: 'Helsinki', code: 'OLD' });
    check('expired code rejected at booking', r.status === 400 && /expired/.test(r.data.error || ''), r.data);

    // --- Per-customer cap end-to-end: "first booking only" -------------------
    r = await admin('POST', '/admin/discounts', { code: 'firstonly', kind: 'percent', percent: 20, maxPerCustomer: 1 });
    check('admin creates a 1-per-customer code', r.status === 201, r.data);
    r = await admin('GET', '/admin/discounts');
    check('per-customer cap stored + listed', (r.data.find((d) => d.code === 'FIRSTONLY') || {}).max_per_customer === 1, r.data);

    const dA = helsinkiDate(6);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, dA, 11, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: dA, hour: 11, location: 'Helsinki', code: 'firstonly' });
    check('customer A books with the 1-per-customer code', r.status === 201 && r.data.booking.discountCode === 'FIRSTONLY', r.data);
    const bkA = db2.prepare("SELECT id FROM bookings WHERE customer_id=? AND discount_code='FIRSTONLY' ORDER BY id DESC LIMIT 1").get(custId);
    // Unpaid it does not count yet — mark it paid so it becomes A's one redemption.
    const invA = db2.prepare('SELECT number FROM invoices WHERE booking_id = ?').get(bkA.id).number;
    await admin('POST', `/admin/invoices/${invA}/paid`);

    const dA2 = helsinkiDate(7);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, dA2, 11, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: dA2, hour: 11, location: 'Helsinki', code: 'firstonly' });
    check('same customer is blocked from reusing a 1-per-customer code', r.status === 400 && /already used/.test(r.data.error || ''), r.data);

    // A DIFFERENT customer can still redeem the same code (per-customer, not global).
    const cust2 = client();
    await cust2('POST', '/auth/signup', { name: 'Toinen', email: 'p2@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi' });
    const v2 = db2.prepare("SELECT code FROM pending_signups WHERE email='p2@test.local'").get().code;
    await cust2('POST', '/auth/verify-signup', { email: 'p2@test.local', code: v2 });
    r = await cust2('POST', '/bookings', { coachId, date: dA2, hour: 11, location: 'Helsinki', code: 'firstonly' });
    check('a different customer can still use the code', r.status === 201 && r.data.booking.discountCode === 'FIRSTONLY', r.data);

    // --- Cancellation credit only for GENUINELY PAID bookings ----------------
    // A €0 booking (100%-off code) is stamped 'paid' as a zero receipt; cancelling
    // it must NOT mint a goodwill free session — that's only owed when real money
    // was paid. The genuinely-paid path must keep granting one.
    await admin('POST', '/admin/discounts', { code: 'free100', kind: 'percent', percent: 100 });

    // (a) genuinely PAID booking cancelled -> one goodwill credit (unchanged path).
    const paidCust = client();
    await paidCust('POST', '/auth/signup', { name: 'Maksaja', email: 'paid@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi' });
    const pv = db2.prepare("SELECT code FROM pending_signups WHERE email='paid@test.local'").get().code;
    const paidCustId = (await paidCust('POST', '/auth/verify-signup', { email: 'paid@test.local', code: pv })).data.user.id;
    const pd = helsinkiDate(8);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, pd, 12, new Date().toISOString());
    await paidCust('POST', '/bookings', { coachId, date: pd, hour: 12, location: 'Helsinki' });
    const paidBid = db2.prepare('SELECT id FROM bookings WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(paidCustId).id;
    const paidInvNum = db2.prepare('SELECT number FROM invoices WHERE booking_id=?').get(paidBid).number;
    await admin('POST', `/admin/invoices/${paidInvNum}/paid`);
    await admin('POST', `/admin/bookings/${paidBid}/status`, { status: 'cancelled' });
    check('cancelling a genuinely PAID booking grants a goodwill credit',
      db2.prepare('SELECT COUNT(*) n FROM credits WHERE customer_id=?').get(paidCustId).n === 1,
      db2.prepare('SELECT COUNT(*) n FROM credits WHERE customer_id=?').get(paidCustId).n);

    // (b) €0 (100%-off) booking cancelled -> NO credit (the bug fix).
    const freeCust = client();
    await freeCust('POST', '/auth/signup', { name: 'Ilmainen', email: 'free@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi' });
    const fv = db2.prepare("SELECT code FROM pending_signups WHERE email='free@test.local'").get().code;
    const freeCustId = (await freeCust('POST', '/auth/verify-signup', { email: 'free@test.local', code: fv })).data.user.id;
    const fd = helsinkiDate(9);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, fd, 12, new Date().toISOString());
    r = await freeCust('POST', '/bookings', { coachId, date: fd, hour: 12, location: 'Helsinki', code: 'free100' });
    check('100%-off booking is €0 and not credit-funded', r.data.booking.totalCents === 0 && r.data.booking.creditApplied === false, r.data.booking);
    const freeBid = db2.prepare('SELECT id FROM bookings WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(freeCustId).id;
    check('its invoice is a €0 "paid" receipt (no money moved)',
      (db2.prepare('SELECT amount_cents FROM invoices WHERE booking_id=?').get(freeBid) || {}).amount_cents === 0);
    await admin('POST', `/admin/bookings/${freeBid}/status`, { status: 'cancelled' });
    check('cancelling a €0 (unpaid) booking mints NO free session',
      db2.prepare('SELECT COUNT(*) n FROM credits WHERE customer_id=?').get(freeCustId).n === 0,
      db2.prepare('SELECT COUNT(*) n FROM credits WHERE customer_id=?').get(freeCustId).n);

    db2.close?.();
    console.log(`\n${passed} passed, ${failed} failed`);
    server.kill('SIGKILL');
    fs.rmSync(EDATA, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.log('E2E error:', e.message, '\n', log.slice(-600));
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
