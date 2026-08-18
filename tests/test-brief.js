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

    // --- cancellations made today -------------------------------------------
    // Reported by WHEN THEY WERE CANCELLED, not by session date: a coach
    // dropping next week's session is today's news. A coach cancelling and the
    // office cancelling must be distinguishable — the coach ones are the point.
    const soon = helsinkiDate(4);
    const mkCancelled = (code, hour, by, cancelledAt) => db.prepare(`INSERT INTO bookings
      (code,customer_id,coach_id,date,hour,location,position,focus,price_cents,discount_cents,
       total_cents,status,created_at,cancelled_at,cancelled_by)
      VALUES (?,?,?,?,?,'Helsinki','','',4000,0,4000,'cancelled',?,?,?)`)
      .run(code, uid, cid, soon, hour, now, cancelledAt, by);
    mkCancelled('PBF-CX1', 9, 'coach', now);
    mkCancelled('PBF-CX2', 10, 'team', now);
    // Cancelled a week ago — must NOT appear in today's brief.
    mkCancelled('PBF-CX3', 11, 'coach', new Date(Date.now() - 7 * 86400000).toISOString());

    const c = (await get(`/api/brief?token=${TOKEN}`)).body;
    const codes = c.today.cancellations.map((x) => x.code);
    check("today's cancellations are listed", codes.includes('PBF-CX1') && codes.includes('PBF-CX2'), codes);
    check('an older cancellation is not', !codes.includes('PBF-CX3'), codes);
    const coachOne = c.today.cancellations.find((x) => x.code === 'PBF-CX1');
    check('a coach cancellation is tagged as such', coachOne.by === 'coach', coachOne);
    check('an office cancellation is tagged separately',
      c.today.cancellations.find((x) => x.code === 'PBF-CX2').by === 'team');
    check('it carries the session date, not the cancellation date',
      coachOne.sessionDate === soon, coachOne.sessionDate);
    check('and how much notice was given', coachOne.noticeDays === 4, coachOne.noticeDays);
    check('coach cancellations are counted for the attention list',
      c.attention.coachCancellations === 1, c.attention);
    // A cancelled booking must not leak into the day's session list.
    check('cancellations stay out of the sessions list',
      !c.today.sessions.some((x) => x.code.startsWith('PBF-CX')), c.today.sessions);

    // Helsinki runs 2–3 h ahead of UTC, so between local midnight and UTC
    // midnight a cancellation carries YESTERDAY's UTC date. Comparing that
    // string against the Helsinki day dropped it from today's brief — and
    // yesterday's had already been sent, so it was never reported at all.
    // Build that exact instant rather than trusting the clock: the old bug only
    // showed itself if the suite happened to run after 01:00 Finnish time.
    const utcOffsetHours = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false,
    }).format(new Date(today + 'T12:00:00Z'))) - 12;
    const justAfterLocalMidnight =
      new Date(Date.parse(today + 'T00:30:00Z') - utcOffsetHours * 3600000).toISOString();
    check('the boundary fixture really straddles UTC midnight',
      justAfterLocalMidnight.slice(0, 10) !== today, justAfterLocalMidnight);
    mkCancelled('PBF-CX4', 12, 'coach', justAfterLocalMidnight);
    const mid = (await get(`/api/brief?token=${TOKEN}`)).body;
    check('a cancellation just after Helsinki midnight is still today\'s news',
      mid.today.cancellations.some((x) => x.code === 'PBF-CX4'),
      mid.today.cancellations.map((x) => x.code));
    check('and it counts towards the coach-cancellation tally',
      mid.attention.coachCancellations === 2, mid.attention.coachCancellations);

    // --- HTML ---
    const h = await get(`/api/brief?token=${TOKEN}&format=html`);
    check('?format=html returns HTML', h.status === 200 && /kooste/i.test(h.body) && /<html/i.test(h.body));
    check('the HTML names the coach cancellation', /valmentaja/i.test(h.body) && h.body.includes('PBF-CX1') === false
      && /valmentajan perumaa/i.test(h.body), 'coach cancellation block missing');

    // --- email ---
    const e = await get(`/api/brief?token=${TOKEN}&send=1`);
    check('?send=1 reports recipients', e.status === 200 && e.body.emailed && e.body.emailed.recipients >= 1, e.body.emailed);
    const briefLogs = db.prepare("SELECT COUNT(*) n FROM email_log WHERE type='brief'").get().n;
    check('a brief email was logged', briefLogs >= 1, briefLogs);

    // --- on-demand in-app dashboard (/api/admin/brief, admin-authed) ---
    check('admin brief requires auth', (await get('/api/admin/brief')).status === 401);
    let cookie = '';
    const login = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'TestAdmin123!' }),
    });
    for (const line of login.headers.getSetCookie ? login.headers.getSetCookie() : []) {
      const m = /^([^=]+)=([^;]*)/.exec(line); if (m) cookie += `${m[1]}=${m[2]}; `;
    }
    check('admin logs in', login.status === 200, login.status);
    const dash = await fetch(BASE + '/api/admin/brief', { headers: { Cookie: cookie } });
    const dashBody = await dash.text();
    check('admin brief returns the HTML dashboard', dash.status === 200 && /<html/i.test(dashBody) && /kooste/i.test(dashBody), dash.status);

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
