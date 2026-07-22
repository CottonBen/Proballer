// E2E checks for the admin-only financial model: page + API authorisation for
// every role, cost/scenario/defaults persistence, actuals correctness, and —
// critically — proof that model operations never touch operational data.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = require('node:path').join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'fm-data');
const PORT = 3465;
const BASE = `http://localhost:${PORT}`;
const bcrypt = require(path.join(PROJECT, 'node_modules', 'bcryptjs'));

fs.rmSync(DATA_DIR, { recursive: true, force: true });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

function client() {
  const jar = {};
  const save = (res) => {
    for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const m = /^([^=]+)=([^;]*)/.exec(line);
      if (m) jar[m[1]] = m[2];
    }
  };
  const cookies = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    async api(method, p, body) {
      const res = await fetch(BASE + '/api' + p, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookies() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      save(res);
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, data };
    },
    async page(p) {
      const res = await fetch(BASE + p, {
        redirect: 'manual',
        headers: { Cookie: cookies(), 'User-Agent': 'FMTest Safari' },
      });
      save(res);
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    },
  };
}

const helsinkiDate = (offset) => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Helsinki' }).format(new Date(Date.now() + offset * 86400000));

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, DEMO_DATA: '0',
      SMTP_HOST: '', STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: 'whsec_x',
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

    // A PURE coach (the seeded coach login is dual-role admin+coach).
    db.prepare(`INSERT INTO users (email, password_hash, name, role, email_verified, created_at)
      VALUES ('purecoach@test.local', ?, 'Pure Coach', 'coach', 1, ?)`)
      .run(bcrypt.hashSync('CoachOnly123!', 10), new Date().toISOString());

    const admin = client(); const customer = client(); const coach = client(); const anon = client();
    let r = await admin.api('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200, r.status);
    r = await coach.api('POST', '/auth/login', { email: 'purecoach@test.local', password: 'CoachOnly123!' });
    check('pure coach logs in', r.status === 200 && r.data.user.role === 'coach', r.data);
    r = await customer.api('POST', '/auth/signup', {
      name: 'Malli Asiakas', email: 'malli@test.local', password: 'Password1!', area: 'Helsinki', lang: 'fi',
    });
    const code = db.prepare("SELECT code FROM pending_signups WHERE email = 'malli@test.local'").get().code;
    r = await customer.api('POST', '/auth/verify-signup', { email: 'malli@test.local', code });
    check('customer account ready', r.status === 200, r.status);

    // --- page-level authorisation -------------------------------------------
    let pg = await anon.page('/admin/financial-model');
    check('anonymous → redirected to login, no content', pg.status === 302
      && pg.location === '/login', { status: pg.status, location: pg.location });
    pg = await customer.page('/admin/financial-model');
    check('customer → redirected away, no content', pg.status === 302 && pg.location === '/', pg.location);
    pg = await coach.page('/admin/financial-model');
    check('coach → redirected away, no content', pg.status === 302 && pg.location === '/', pg.location);
    pg = await admin.page('/admin/financial-model');
    check('admin gets the page', pg.status === 200 && pg.text.includes('Talousmalli'), pg.status);
    pg = await anon.page('/financial-model'); // static server must not leak the shell
    check('shell is NOT reachable via the static server', pg.status === 404, pg.status);

    // --- API-level authorisation --------------------------------------------
    for (const [who, c] of [['anonymous', anon], ['customer', customer], ['coach', coach]]) {
      r = await c.api('GET', '/admin/financial-model/data');
      check(`${who} blocked from model data (${r.status})`, r.status === 401 || r.status === 403, r.status);
      check(`${who} response carries no financial fields`, !r.data || (!r.data.actual && !r.data.costs), r.data);
      r = await c.api('POST', '/admin/financial-model/costs', { name: 'x', kind: 'fixed', amountEur: 1 });
      check(`${who} blocked from writing costs`, r.status === 401 || r.status === 403, r.status);
      r = await c.api('POST', '/admin/financial-model/scenarios', { name: 'x', data: { price: 1 } });
      check(`${who} blocked from writing scenarios`, r.status === 401 || r.status === 403, r.status);
    }

    // --- actuals come from the real financial records ------------------------
    const coachId = db.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id
      WHERE u.email = 'coach@test.local'`).get().id;
    db.prepare(`UPDATE coaches SET locations = '["Helsinki"]', active = 1 WHERE id = ?`).run(coachId);
    db.prepare('INSERT INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, helsinkiDate(2), 10, new Date().toISOString());
    r = await admin.api('POST', '/admin/bookings', {
      payment: 'paid', kind: 'single', coachId, date: helsinkiDate(2), hour: 10, location: 'Helsinki',
      customer: { id: db.prepare("SELECT id FROM users WHERE email = 'malli@test.local'").get().id },
    });
    check('paid booking created for actuals', r.status === 201, r.data);
    r = await admin.api('GET', '/admin/financial-model/data');
    check('admin reads model data', r.status === 200, r.status);
    check('actual revenue reflects the paid invoice (40 €)',
      r.data.actual.revenueThisMonthCents >= 4000 && r.data.actual.revenue30Cents >= 4000, r.data.actual);
    check('actual customer counts present', r.data.actual.customersTotal >= 1, r.data.actual.customersTotal);

    // Snapshot of every operational table BEFORE model writes.
    const snapshot = () => ({
      bookings: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) s FROM bookings').get(),
      invoices: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s FROM invoices').get(),
      users: db.prepare('SELECT COUNT(*) n FROM users').get(),
      signups: db.prepare('SELECT COUNT(*) n FROM group_signups').get(),
      packages: db.prepare('SELECT COUNT(*) n FROM packages').get(),
      paidInvoices: db.prepare("SELECT COUNT(*) n FROM invoices WHERE status = 'paid'").get(),
    });
    const before = JSON.stringify(snapshot());

    // --- cost management ------------------------------------------------------
    r = await admin.api('POST', '/admin/financial-model/costs',
      { name: 'Render', kind: 'fixed', amountEur: 25, notes: 'hosting' });
    check('fixed cost added', r.status === 201 && r.data.id > 0, r.data);
    const renderId = r.data.id;
    r = await admin.api('POST', '/admin/financial-model/costs',
      { name: 'Stripe', kind: 'pct_revenue', percent: 1.5 });
    check('%-of-revenue cost added', r.status === 201, r.data);
    r = await admin.api('POST', '/admin/financial-model/costs',
      { name: 'Kenttävuokra', kind: 'per_session', amountEur: 5 });
    check('per-session cost added', r.status === 201, r.data);
    r = await admin.api('POST', '/admin/financial-model/costs', { name: 'Bad', kind: 'weird' });
    check('bad cost type rejected', r.status === 400, r.status);
    r = await admin.api('POST', '/admin/financial-model/costs', { name: 'Neg', kind: 'fixed', amountEur: -5 });
    check('negative amount rejected', r.status === 400, r.status);
    r = await admin.api('PUT', `/admin/financial-model/costs/${renderId}`, { amountEur: 30, active: false });
    check('cost edited + deactivated', r.status === 200, r.data);
    r = await admin.api('GET', '/admin/financial-model/data');
    const renderCost = r.data.costs.find((c) => c.name === 'Render');
    check('cost list reflects the edit', renderCost && renderCost.amountEur === 30
      && renderCost.active === false, renderCost);
    check('three model costs stored', r.data.costs.length === 3, r.data.costs.length);

    // --- scenarios + defaults -------------------------------------------------
    const assumptions = { price: 45, customers: 60, sessionsPerCustomer: 2, coachCost: 20,
      extraFixed: 500, taxRate: 20, taxBasis: 'profit' };
    r = await admin.api('POST', '/admin/financial-model/scenarios', { name: 'Hinta 45', data: assumptions });
    check('scenario saved', r.status === 201, r.data);
    const scenId = r.data.id;
    r = await admin.api('PUT', '/admin/financial-model/defaults', { data: assumptions });
    check('defaults saved', r.status === 200, r.data);
    r = await admin.api('GET', '/admin/financial-model/data');
    check('defaults round-trip', r.data.defaults && r.data.defaults.price === 45, r.data.defaults);
    check('scenario round-trips with data', r.data.scenarios.some((s) => s.id === scenId
      && s.data.customers === 60), r.data.scenarios);
    r = await admin.api('DELETE', `/admin/financial-model/scenarios/${scenId}`);
    check('scenario deleted', r.status === 200, r.status);
    r = await admin.api('POST', '/admin/financial-model/scenarios', { name: 'x' });
    check('scenario without data rejected', r.status === 400, r.status);

    // --- CRITICAL: model writes touched NOTHING operational -------------------
    const after = JSON.stringify(snapshot());
    check('bookings/invoices/users/signups/packages unchanged by ALL model operations',
      before === after, { before: JSON.parse(before), after: JSON.parse(after) });

    // model tables are where the writes landed
    check('model writes landed in fm_* tables only',
      db.prepare('SELECT COUNT(*) n FROM fm_costs').get().n === 3
      && db.prepare('SELECT COUNT(*) n FROM fm_scenarios').get().n === 0
      && Boolean(db.prepare("SELECT 1 FROM meta WHERE key = 'fm_defaults'").get()));
  } catch (err) {
    failed++;
    console.log('FAIL  suite crashed —', err.message);
  } finally {
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
