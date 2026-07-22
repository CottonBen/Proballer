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
check('date-only expiry -> end of day ISO', D.normExpiry('2026-07-31') === '2026-07-31T23:59:59.999Z');
check('blank expiry -> null', D.normExpiry('') === null);
check('garbage expiry -> false', D.normExpiry('not-a-date') === false);
check('list reports derived uses', (D.list().find((d) => d.code === 'OFF3') || {}).uses === 2);

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
      STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: 'whsec_x',
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
    const bk = db2.prepare("SELECT total_cents, discount_code, code_discount_cents FROM bookings WHERE customer_id=? ORDER BY id DESC LIMIT 1").get(custId);
    check('DB row stores discounted total + code', bk.total_cents === 3000 && bk.discount_code === 'WELCOME10' && bk.code_discount_cents === 1000, bk);

    // WELCOME10 now used up (max_uses 1) — admin list shows uses, reuse blocked
    r = await admin('GET', '/admin/discounts');
    const w = r.data.find((d) => d.code === 'WELCOME10');
    check('admin list shows WELCOME10 uses = 1', w && w.uses === 1, w);
    const date2 = helsinkiDate(3);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, date2, hour, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: date2, hour, location: 'Helsinki', code: 'welcome10' });
    check('second use of a max-1 code is rejected', r.status === 400 && /fully used/.test(r.data.error || ''), r.data);

    // booking still works with no code
    r = await cust('POST', '/bookings', { coachId, date: date2, hour, location: 'Helsinki' });
    check('booking without a code still works (40 € sale price)', r.status === 201 && r.data.booking.totalCents === 4000, r.data.booking);

    // expired code rejected end-to-end
    await admin('POST', '/admin/discounts', { code: 'OLD', kind: 'percent', percent: 10, expiresAt: '2020-01-01' });
    const date3 = helsinkiDate(4);
    db2.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)').run(coachId, date3, hour, new Date().toISOString());
    r = await cust('POST', '/bookings', { coachId, date: date3, hour, location: 'Helsinki', code: 'OLD' });
    check('expired code rejected at booking', r.status === 400 && /expired/.test(r.data.error || ''), r.data);

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
