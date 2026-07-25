// Daily-brief endpoint: token gate, JSON shape, ?format=html, ?send=1 email.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = path.join(__dirname, '..');
const DATA = path.join(__dirname, `brief-data-${process.pid}`);
fs.rmSync(DATA, { recursive: true, force: true });
const PORT = 3479;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'test-brief-token-abc';
const helsinkiDate = (o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(new Date(Date.now() + o * 86400000));

let passed = 0, failed = 0;
const check = (n, c, x) => {
  if (c) { passed++; console.log(`  ok  ${n}`); }
  else { failed++; console.log(`FAIL  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); }
};

async function get(p) {
  const res = await fetch(BASE + p);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: DATA, DEMO_DATA: '0', SMTP_HOST: '',
      BRIEF_TOKEN: TOKEN,
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

    const db = new DatabaseSync(path.join(DATA, 'proballers.db'));
    const now = new Date().toISOString();
    // A coach + customer + a completed session TODAY (Helsinki) for content/revenue.
    db.prepare("INSERT INTO users (email,password_hash,name,role,created_at) VALUES ('c@t.co','x','Cust','customer',?)").run(now);
    const uid = db.prepare("SELECT id FROM users WHERE email='c@t.co'").get().id;
    db.prepare("INSERT INTO coaches (name,slug,created_at) VALUES ('Ben','ben',?)").run(now);
    const cid = db.prepare("SELECT id FROM coaches WHERE slug='ben'").get().id;
    const today = helsinkiDate(0);
    db.prepare(`INSERT INTO bookings (code,customer_id,coach_id,date,hour,location,position,focus,
      price_cents,discount_cents,total_cents,status,created_at,completed_at)
      VALUES ('PBF-BR1',?,?,?,15,'Helsinki','','',8000,4000,4000,'completed',?,?)`).run(uid, cid, today, now, now);

    // --- token gate ---
    check('no token -> 401', (await get('/api/brief')).status === 401);
    check('wrong token -> 401', (await get('/api/brief?token=nope')).status === 401);

    // --- JSON brief ---
    const r = await get(`/api/brief?token=${TOKEN}`);
    check('correct token -> 200', r.status === 200, r.status);
    const b = r.body;
    check('brief has today Helsinki date', b.date === today, b.date);
    check('brief exposes the expected sections', !!(b.today && b.month && b.upcoming7 && b.attention), Object.keys(b));
    check("today's completed session is listed", b.today.sessions.some((s) => s.code === 'PBF-BR1' && s.coach === 'Ben'), b.today.sessions);
    check("today's revenue counts the completed session (40 €)", b.today.revenueCents === 4000, b.today.revenueCents);
    check('month revenue includes it', b.month.revenueCents === 4000, b.month.revenueCents);

    // --- HTML ---
    const h = await get(`/api/brief?token=${TOKEN}&format=html`);
    check('?format=html returns HTML', h.status === 200 && /kooste/i.test(h.body) && /<html/i.test(h.body));

    // --- email ---
    const e = await get(`/api/brief?token=${TOKEN}&send=1`);
    check('?send=1 reports recipients', e.status === 200 && e.body.emailed && e.body.emailed.recipients >= 1, e.body.emailed);
    const briefLogs = db.prepare("SELECT COUNT(*) n FROM email_log WHERE type='brief'").get().n;
    check('a brief email was logged', briefLogs >= 1, briefLogs);

    db.close?.();
    console.log(`\n${passed} passed, ${failed} failed`);
    server.kill('SIGKILL');
    fs.rmSync(DATA, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.log('error:', err.message, '\n', log.slice(-600));
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
