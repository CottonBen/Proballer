// E2E checks for acquisition-source attribution + the /admin/sources report:
// utm/referrer capture on landing views, first-touch stamping onto signups,
// contact leads and admin-created accounts, revenue attribution through the
// existing financial records, and the consistency of the report's definitions.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = require('node:path').join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'src-data');
const PORT = 3464;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_localtest_123';
const UA = 'ProballersTestBrowser Safari'; // must not match the BOT_UA filter

fs.rmSync(DATA_DIR, { recursive: true, force: true });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

// A cookie-jar "browser" that can hit both pages and the API.
function browser() {
  const jar = {};
  const save = (res) => {
    for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const m = /^([^=]+)=([^;]*)/.exec(line);
      if (m) jar[m[1]] = m[2];
    }
  };
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    async page(p, headers = {}) {
      const res = await fetch(BASE + p, {
        headers: { 'User-Agent': UA, Cookie: cookieHeader(), ...headers },
      });
      save(res);
      return res.status;
    },
    async api(method, p, body) {
      const res = await fetch(BASE + '/api' + p, {
        method,
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: cookieHeader() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      save(res);
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, data };
    },
  };
}

function sendWebhook(metadata) {
  const raw = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata, payment_intent: 'pi_src_1' } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return fetch(BASE + '/api/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    body: raw,
  });
}

const helsinkiDate = (offset) => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Helsinki' }).format(new Date(Date.now() + offset * 86400000));

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

    // --- capture: utm wins, referrer classifies, none = direct ---------------
    const fb = browser();
    await fb.page('/?utm_source=facebook&utm_medium=post');
    const fbVid = fb.jar.pbf_vid;
    const fbRow = db.prepare('SELECT visitor_id, source FROM visits ORDER BY id DESC LIMIT 1').get();
    check('utm_source captured on the landing view', fbRow.source === 'facebook', fbRow);
    check('first view is logged under the visitor cookie id', fbRow.visitor_id === fbVid,
      { row: fbRow.visitor_id, cookie: fbVid });
    await fb.page('/', { Referer: BASE + '/' });
    check('in-site navigation logs as direct (first-touch unaffected)',
      db.prepare('SELECT source FROM visits ORDER BY id DESC LIMIT 1').get().source === 'direct');

    const goog = browser();
    await goog.page('/', { Referer: 'https://www.google.com/' });
    check('google referrer classified', db.prepare(
      'SELECT source FROM visits ORDER BY id DESC LIMIT 1').get().source === 'google');

    const fbm = browser();
    await fbm.page('/', { Referer: 'https://l.facebook.com/l.php?u=x' });
    check('facebook link-shim referrer classified', db.prepare(
      'SELECT source FROM visits ORDER BY id DESC LIMIT 1').get().source === 'facebook');

    const direct = browser();
    await direct.page('/');
    check('no referrer = direct', db.prepare(
      'SELECT source FROM visits ORDER BY id DESC LIMIT 1').get().source === 'direct');

    const odd = browser();
    await odd.page('/', { Referer: 'https://www.vauva.fi/keskustelu/123' });
    check('unknown site keeps its domain', db.prepare(
      'SELECT source FROM visits ORDER BY id DESC LIMIT 1').get().source === 'vauva.fi');

    // --- stamping: signup chain, contact lead, admin-created -----------------
    let r = await fb.api('POST', '/auth/signup', {
      name: 'Facebook Asiakas', email: 'fbcust@test.local', password: 'Password1!',
      area: 'Helsinki', lang: 'fi',
    });
    check('signup accepted', r.status === 200, r.data);
    check('pending signup carries first-touch source', db.prepare(
      "SELECT source FROM pending_signups WHERE email = 'fbcust@test.local'").get().source === 'facebook');
    const code = db.prepare("SELECT code FROM pending_signups WHERE email = 'fbcust@test.local'").get().code;
    r = await fb.api('POST', '/auth/verify-signup', { email: 'fbcust@test.local', code });
    check('account created', r.status === 200, r.data);
    check('customer stamped with first-touch source (facebook)', db.prepare(
      "SELECT source FROM users WHERE email = 'fbcust@test.local'").get().source === 'facebook');

    r = await goog.api('POST', '/contact', { contact: 'googlelead@test.local' });
    check('contact lead stamped with source (google)', r.status === 201 && db.prepare(
      "SELECT source FROM contact_requests WHERE contact = 'googlelead@test.local'").get().source === 'google');

    const admin = browser();
    r = await admin.api('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200, r.status);
    const coachId = db.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id
      WHERE u.email = 'coach@test.local'`).get().id;
    db.prepare(`UPDATE coaches SET locations = '["Helsinki"]', active = 1 WHERE id = ?`).run(coachId);
    const d3 = helsinkiDate(3);
    db.prepare('INSERT INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, d3, 10, new Date().toISOString());
    db.prepare('INSERT INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, d3, 11, new Date().toISOString());
    r = await admin.api('POST', '/admin/bookings', {
      payment: 'paid', kind: 'single', coachId, date: d3, hour: 11, location: 'Helsinki',
      customer: { name: 'Puhelin Asiakas', email: 'phone@test.local' },
    });
    check('admin-created customer stamped as admin', r.status === 201 && db.prepare(
      "SELECT source FROM users WHERE email = 'phone@test.local'").get().source === 'admin');

    // --- revenue attribution through the existing financial records ----------
    r = await fb.api('POST', '/bookings', { coachId, date: d3, hour: 10, location: 'Helsinki' });
    check('facebook customer books', r.status === 201, r.data);
    await sendWebhook({ invoice_number: r.data.invoice.number });
    check('facebook invoice paid', db.prepare(
      'SELECT status FROM invoices WHERE number = ?').get(r.data.invoice.number).status === 'paid');

    // --- the report ----------------------------------------------------------
    r = await admin.api('GET', '/admin/sources?w=d30');
    check('sources report responds', r.status === 200 && Array.isArray(r.data.rows), r.status);
    const row = (src) => r.data.rows.find((x) => x.source === src) || {};
    // Two facebook-first-touch visitors exist: the utm one (who signed up)
    // and the link-shim referrer one (who didn't).
    check('facebook: 2 visitors, 1 customer, 1 booking, 40 € revenue',
      row('facebook').visitors === 2 && row('facebook').customers === 1
      && row('facebook').bookings === 1 && row('facebook').revenueCents === 4000, row('facebook'));
    check('facebook conversion = 1 customer / 2 visitors = 50 %',
      row('facebook').conversionPct === 50, row('facebook'));
    check('google: 1 visitor, 1 lead, 0 customers',
      row('google').visitors === 1 && row('google').leads === 1
      && (row('google').customers || 0) === 0, row('google'));
    check('direct visitors counted', row('direct').visitors >= 1, row('direct'));
    check('admin-created: 1 customer, 1 booking, 40 € revenue, no visitors',
      row('admin').customers === 1 && row('admin').bookings === 1
      && row('admin').revenueCents === 4000 && (row('admin').visitors || 0) === 0, row('admin'));
    check('admin conversion undefined (no visitor denominator)', row('admin').conversionPct === null);
    const sum = (k) => r.data.rows.reduce((s, x) => s + (x[k] || 0), 0);
    check('totals equal the sum of rows',
      r.data.totals.visitors === sum('visitors') && r.data.totals.revenueCents === sum('revenueCents')
      && r.data.totals.customers === sum('customers'), r.data.totals);
    check('report totals match finance-style revenue (2 × 40 €)',
      r.data.totals.revenueCents === 8000, r.data.totals.revenueCents);

    r = await admin.api('GET', '/admin/sources'); // no window param = all time
    check('all-time window works', r.status === 200 && r.data.window === 'all'
      && r.data.rows.find((x) => x.source === 'facebook'), r.data.window);
    const cust = await fb.api('GET', '/admin/sources?w=d30');
    check('report is admin-only', cust.status === 403, cust.status);

    // --- exports carry the source column -------------------------------------
    const csvRes = await fetch(BASE + '/api/admin/export/Customers.csv', {
      headers: { Cookie: `pbf_session=${admin.jar.pbf_session}`, 'User-Agent': UA },
    });
    const csv = await csvRes.text();
    check('Customers CSV includes the source column',
      csvRes.status === 200 && /source/.test(csv.split('\n')[0]) && csv.includes('facebook'), csv.split('\n')[0]);
  } catch (err) {
    failed++;
    console.log('FAIL  suite crashed —', err.message);
  } finally {
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
