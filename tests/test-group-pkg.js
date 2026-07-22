// E2E checks for group training + prepaid session packages. Scratch server on
// :3462 with SMTP disabled and a dummy Stripe key: Checkout creation fails
// (payUrl null) but payments are confirmed through the signed webhook, exactly
// like production's server-to-server path.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = require('node:path').join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'gp-data');
const PORT = 3462;
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

    // --- accounts -----------------------------------------------------------
    const admin = client(); const coach = client();
    let r = await admin('POST', '/auth/login', { email: 'admin@test.local', password: 'TestAdmin123!' });
    check('admin logs in', r.status === 200 && r.data.user.role === 'admin', r.status);
    r = await coach('POST', '/auth/login', { email: 'coach@test.local', password: 'TestCoach123!' });
    check('coach logs in', r.status === 200 && ['coach', 'admin'].includes(r.data.user.role),
      r.data && r.data.user);
    const coachId = db.prepare(`SELECT c.id FROM coaches c JOIN users u ON u.id = c.user_id
      WHERE u.email = 'coach@test.local'`).get().id;
    db.prepare(`UPDATE coaches SET locations = '["Helsinki"]', positions = '["defenders"]', active = 1
      WHERE id = ?`).run(coachId);

    const customers = [];
    for (let i = 0; i < 7; i++) {
      const c = client();
      r = await c('POST', '/auth/signup', {
        name: `Pelaaja ${i}`, email: `pelaaja${i}@test.local`, password: 'Password1!', area: 'Helsinki', lang: 'fi',
      });
      check(`customer ${i} signs up`, r.status === 200, r.status);
      const code = db.prepare('SELECT code FROM pending_signups WHERE email = ?').get(`pelaaja${i}@test.local`).code;
      r = await c('POST', '/auth/verify-signup', { email: `pelaaja${i}@test.local`, code });
      check(`customer ${i} verifies email (account created)`, r.status === 200 && r.data.user.role === 'customer', r.data);
      customers.push(c);
    }
    const D3 = day(3), D4 = day(4), D5 = day(5);

    // ========================================================================
    // GROUP TRAINING
    // ========================================================================
    // Coach opens 1-on-1 availability on the group hour — creating the group
    // must swallow it so no 1-on-1 can land on top.
    r = await coach('PUT', '/coach/availability', { adds: [{ date: D3, hour: 10 }], removes: [] });
    r = await coach('POST', '/coach/groups', { date: D3, hour: 10, location: 'Helsinki' });
    check('coach creates a group session', r.status === 201 && /^GRP-/.test(r.data.code), r.data);
    check('capacity 4 and price 25 € from config', r.data.capacity === 4 && r.data.priceCents === 2500, r.data);
    const G1 = r.data.code;
    const g1id = r.data.id;
    check('availability row swallowed by the group', !db.prepare(
      'SELECT 1 FROM availability WHERE coach_id = ? AND date = ? AND hour = 10').get(coachId, D3), null);

    r = await coach('POST', '/coach/groups', { date: D3, hour: 10, location: 'Helsinki' });
    check('duplicate group slot rejected', r.status === 400, r.status);

    r = await customers[0]('POST', '/bookings', {
      coachId, date: D3, hour: 10, position: 'defenders', focus: 'technical', location: 'Helsinki', lang: 'fi',
    });
    check('1-on-1 on the group hour rejected', r.status === 400
      && /not available/.test(r.data.error), r.data);

    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('public list shows the session with 4 spots', r.sessions.length === 1 && r.sessions[0].spotsLeft === 4, r.sessions);

    // Four players join and pay; the fifth bounces. The duplicate check runs
    // while the session still has room (a full session reports "full" first).
    const signupCodes = [];
    for (let i = 0; i < 4; i++) {
      r = await customers[i]('POST', `/groups/${G1}/join`, { ageGroup: '10-13' });
      check(`player ${i} claims a spot (pending)`, r.status === 201 && /^GSU-/.test(r.data.signup.code), r.data);
      signupCodes.push(r.data.signup.code);
      if (i === 0) {
        const dup = await customers[0]('POST', `/groups/${G1}/join`, { ageGroup: '10-13' });
        check('duplicate spot rejected', dup.status === 409 && /already have a spot/.test(dup.data.error), dup.data);
      }
      await sendWebhook({ group_signup: r.data.signup.code }, `pi_g${i}`);
    }
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('session is full after 4 paid spots', r.sessions.length === 1 && r.sessions[0].spotsLeft === 0, r.sessions);
    check('4 group confirmation emails logged', emailCount('group_booking') === 4, emailCount('group_booking'));

    r = await customers[4]('POST', `/groups/${G1}/join`, { ageGroup: '10-13' });
    check('5th player rejected — full', r.status === 409 && /full/.test(r.data.error), r.data);

    r = await coach('GET', '/coach/groups');
    check('coach sees roster of 4 with names', r.data[0].players.length === 4
      && r.data[0].players.every((p) => p.name.startsWith('Pelaaja')), r.data[0].players);
    r = await customers[0]('GET', '/my-groups');
    check('player sees a confirmed spot', r.data.length === 1 && r.data[0].status === 'confirmed', r.data);

    // Admin: attendance, remove a player (refund fails with dummy key -> alert),
    // move the session, add a walk-in by email.
    r = await admin('GET', '/admin/groups');
    check('admin sees attendance 4/4', r.data[0].attendance === 4 && r.data[0].taken === 4, r.data[0]);
    const sid3 = r.data[0].players.find((p) => p.email === 'pelaaja3@test.local').signupId;
    r = await admin('DELETE', `/admin/groups/${g1id}/players/${sid3}`);
    check('admin removes a player', r.status === 200, r.status);
    check('cancellation email sent to the removed player', emailCount('group_cancel') === 1, emailCount('group_cancel'));
    check('failed auto-refund alerts the admins', Boolean(db.prepare(
      `SELECT 1 FROM notifications WHERE message LIKE '%could not be refunded automatically%'`).get()), null);

    r = await admin('PUT', `/admin/groups/${g1id}`, { date: D4, hour: 11, location: 'Helsinki' });
    check('admin moves the session', r.status === 200 && r.data.date === D4 && r.data.hour === 11, r.data);
    check('players notified about the move', db.prepare(
      `SELECT COUNT(*) n FROM notifications WHERE message LIKE '%has moved%'`).get().n === 3, null);

    r = await admin('POST', `/admin/groups/${g1id}/players`, { email: 'pelaaja5@test.local' });
    check('admin adds a walk-in by email', r.status === 201 && r.data.taken === 4, r.data);
    r = await admin('POST', `/admin/groups/${g1id}/players`, { email: 'nobody@test.local' });
    check('unknown email rejected', r.status === 404, r.status);

    // Cancel the whole session: every active spot cancelled + emailed.
    const cancelBefore = emailCount('group_cancel');
    r = await admin('POST', `/admin/groups/${g1id}/cancel`, {});
    check('admin cancels the session', r.status === 200, r.status);
    check('all remaining players got cancellation emails',
      emailCount('group_cancel') === cancelBefore + 4, emailCount('group_cancel'));
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('cancelled session gone from the public list', r.sessions.length === 0, r.sessions.length);

    // Unpaid-spot expiry: pending signup past its deadline is released.
    r = await coach('POST', '/coach/groups', { date: D4, hour: 14, location: 'Helsinki' });
    const G2 = r.data.code;
    r = await customers[6]('POST', `/groups/${G2}/join`, { ageGroup: '7-10' });
    const expCode = r.data.signup.code;
    db.prepare(`UPDATE group_signups SET pay_by = '2000-01-01T00:00:00Z' WHERE code = ?`).run(expCode);
    await fetch(BASE + '/api/groups'); // any read runs the sweeps
    const expRow = db.prepare('SELECT status FROM group_signups WHERE code = ?').get(expCode);
    check('unpaid spot released by the sweep', expRow.status === 'cancelled', expRow);
    check('release email logged', emailCount('group_release') === 1, emailCount('group_release'));
    // Coach cancels their own session.
    r = await coach('POST', `/coach/groups/${G2}/cancel`, {});
    check('coach cancels own session', r.status === 200, r.status);

    // ========================================================================
    // PACKAGES
    // ========================================================================
    const G = customers[5]; // fresh customer, no credits
    r = await G('GET', '/my-package');
    check('fresh customer has no package', r.data.remaining === 0 && r.data.packages.length === 0, r.data);

    for (const [d, h] of [[D3, 12], [D3, 13], [D4, 12], [D4, 13], [D5, 12]]) {
      db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
        .run(coachId, d, h, new Date().toISOString());
    }

    // Wizard: buy a 3-pack together with the first booking.
    r = await G('POST', '/bookings', {
      coachId, date: D3, hour: 12, position: 'defenders', focus: 'technical',
      location: 'Helsinki', package: 'pack3', lang: 'fi',
    });
    check('pack3 purchase rides with the booking', r.status === 201
      && r.data.package && /^PKG-/.test(r.data.package.code) && r.data.package.funded === false, r.data.package);
    check('no invoice for a package booking', r.data.invoice === null, r.data.invoice);
    const PKG1 = r.data.package.code;
    const B1 = r.data.booking.code;
    let bRow = db.prepare('SELECT * FROM bookings WHERE code = ?').get(B1);
    check('booking waits unannounced for the package payment',
      bRow.status === 'confirmed' && bRow.coach_notified === 0, bRow);
    check('per-session value on the booking (114/3 = 38 €)', bRow.total_cents === 3800, bRow.total_cents);

    await sendWebhook({ package: PKG1 }, 'pi_pkg1');
    bRow = db.prepare('SELECT * FROM bookings WHERE code = ?').get(B1);
    check('payment activates package + announces booking', bRow.coach_notified === 1, bRow);
    check('package purchase email logged', emailCount('package') === 1, emailCount('package'));
    r = await G('GET', '/my-package');
    check('2 of 3 sessions remain after the first booking', r.data.remaining === 2, r.data);

    // Second booking is auto-funded; remaining 1 fires the low-balance email.
    r = await G('POST', '/bookings', {
      coachId, date: D3, hour: 13, position: 'defenders', focus: 'technical', location: 'Helsinki', lang: 'fi',
    });
    check('active package funds the next booking', r.data.package
      && r.data.package.funded === true && r.data.package.remaining === 1, r.data.package);
    check('funded booking announced immediately', db.prepare(
      'SELECT coach_notified FROM bookings WHERE code = ?').get(r.data.booking.code).coach_notified === 1, null);
    check('"1 session left" email fired', emailCount('package_low') === 1, emailCount('package_low'));
    const B2 = r.data.booking.code;

    // Third booking drains it; the fully-used email fires.
    r = await G('POST', '/bookings', {
      coachId, date: D4, hour: 12, position: 'defenders', focus: 'technical', location: 'Helsinki', lang: 'fi',
    });
    check('last package session used', r.data.package && r.data.package.remaining === 0, r.data.package);
    check('"package fully used" email fired', emailCount('package_done') === 1, emailCount('package_done'));

    // With the balance at zero the next booking is a normal single (invoice).
    r = await G('POST', '/bookings', {
      coachId, date: D4, hour: 13, position: 'defenders', focus: 'technical', location: 'Helsinki', lang: 'fi',
    });
    check('empty balance falls back to pay-per-session', r.data.package === null
      && r.data.invoice && r.data.invoice.amountCents === 4000, r.data);

    // A cancelled package booking returns its session — and mints NO credit.
    r = await coach('POST', `/coach/bookings/${B2}/status`, { status: 'cancelled' });
    check('coach cancels a package booking', r.status === 200, r.data);
    r = await G('GET', '/my-package');
    check('cancelled booking returns the session', r.data.remaining === 1, r.data);
    const gUserId = db.prepare("SELECT id FROM users WHERE email = 'pelaaja5@test.local'").get().id;
    check('no goodwill credit for a package booking', db.prepare(
      'SELECT COUNT(*) n FROM credits WHERE customer_id = ?').get(gUserId).n === 0, null);

    // Admin view + manual adjustment.
    r = await admin('GET', '/admin/packages');
    const aRow = r.data.find((p) => p.code === PKG1);
    check('admin sees the package with live balance', aRow && aRow.remaining === 1 && aRow.used === 2, aRow);
    r = await admin('POST', `/admin/packages/${aRow.id}/adjust`, { delta: 1 });
    check('admin +1 adjustment', r.status === 200 && r.data.remaining === 2, r.data);
    r = await admin('POST', `/admin/packages/${aRow.id}/adjust`, { delta: -10 });
    check('over-negative adjustment rejected', r.status === 409, r.status);

    // Dashboard buy with a broken checkout leaves no orphan pending row.
    r = await G('POST', '/packages/buy', { package: 'pack8' });
    check('dashboard buy fails cleanly with a dead Stripe key', r.status === 502, r.status);
    check('no orphan pending package', db.prepare(
      "SELECT COUNT(*) n FROM packages WHERE status = 'pending' AND customer_id = ?").get(gUserId).n === 0, null);

    // Pending-package expiry releases the linked booking…
    const H = customers[6];
    r = await H('POST', '/bookings', {
      coachId, date: D5, hour: 12, position: 'defenders', focus: 'technical',
      location: 'Helsinki', package: 'pack5', lang: 'fi',
    });
    const PKG2 = r.data.package.code;
    const B3 = r.data.booking.code;
    db.prepare("UPDATE packages SET pay_by = '2000-01-01T00:00:00Z' WHERE code = ?").run(PKG2);
    await G('GET', '/my-package'); // trigger sweeps
    check('unpaid package voided by the sweep', db.prepare(
      'SELECT status FROM packages WHERE code = ?').get(PKG2).status === 'void', null);
    check('its booking released + customer emailed', db.prepare(
      'SELECT status FROM bookings WHERE code = ?').get(B3).status === 'cancelled'
      && emailCount('release') >= 1, null);

    // …but a payment landing after the void still activates the package and
    // restores the booking (the slot is still free).
    await sendWebhook({ package: PKG2 }, 'pi_pkg2');
    check('late payment reactivates the package', db.prepare(
      'SELECT status FROM packages WHERE code = ?').get(PKG2).status === 'active', null);
    check('and restores the released booking', db.prepare(
      'SELECT status, coach_notified FROM bookings WHERE code = ?').get(B3).status === 'confirmed', null);

    // ========================================================================
    // BATCH 3: verification gate, age groups, player-started groups,
    // optional position/focus, contact leads, finance model
    // ========================================================================
    // An unverified account cannot book or join.
    const unv = client();
    r = await unv('POST', '/auth/signup', {
      name: 'Ei Vahvistettu', email: 'unverified@test.local', password: 'Password1!',
      area: 'Vantaa', lang: 'fi',
    });
    check('signup with area accepted', r.status === 200, r.data);
    check('signup is pending — NO account yet', r.data.pendingSignup === true
      && !db.prepare("SELECT 1 FROM users WHERE email = 'unverified@test.local'").get(), r.data);
    db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,16,?)')
      .run(coachId, D5, new Date().toISOString());
    // A refresh mid-signup leaves nothing to act with: no session, no account.
    r = await unv('POST', '/bookings', { coachId, date: D5, hour: 16, location: 'Helsinki', lang: 'fi' });
    check('pending signup cannot book (not logged in)', r.status === 401, r.status);
    r = await unv('POST', '/auth/verify-signup', { email: 'unverified@test.local', code: '000000' });
    check('wrong code rejected, still no account', r.status === 400
      && !db.prepare("SELECT 1 FROM users WHERE email = 'unverified@test.local'").get(), r.status);
    const unvCode = db.prepare("SELECT code FROM pending_signups WHERE email = 'unverified@test.local'").get().code;
    r = await unv('POST', '/auth/verify-signup', { email: 'unverified@test.local', code: unvCode });
    check('right code creates the verified account', r.status === 200
      && db.prepare("SELECT email_verified FROM users WHERE email = 'unverified@test.local'").get().email_verified === 1, r.data);
    check('pending row cleaned up', !db.prepare(
      "SELECT 1 FROM pending_signups WHERE email = 'unverified@test.local'").get(), null);
    check('welcome email follows verification', db.prepare(
      "SELECT COUNT(*) n FROM email_log WHERE type = 'welcome' AND to_email = 'unverified@test.local'").get().n === 1, null);
    check('verification email was logged', db.prepare(
      "SELECT COUNT(*) n FROM email_log WHERE type = 'verify' AND to_email = 'unverified@test.local'").get().n >= 1, null);

    // Booking without position/focus (the new wizard shape) succeeds.
    r = await unv('POST', '/bookings', { coachId, date: D5, hour: 16, location: 'Helsinki', lang: 'fi' });
    check('booking without position/focus succeeds', r.status === 201 && r.data.booking.focus === '', r.data.booking);
    const plainCode = r.data.booking.code;
    check('plain booking has an invoice (single flow)', Boolean(r.data.invoice), r.data.invoice);

    // Player-started group session from a free slot >= 5 days ahead.
    const D6 = day(6), D7 = day(7);
    for (const [d, h] of [[D6, 10], [D7, 11]]) {
      db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
        .run(coachId, d, h, new Date().toISOString());
    }
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    const startable = r.startable.find((c) => c.coachId === coachId);
    check('free far-out slots are startable', Boolean(startable)
      && startable.slots.some((sl) => sl.date === D6 && sl.hour === 10), r.startable);

    r = await customers[0]('POST', '/groups/start', {
      coachId, date: day(2), hour: 12, location: 'Helsinki', ageGroup: '7-10',
    });
    check('start under 5 days ahead rejected', r.status === 400 && /5 days/.test(r.data.error), r.data);

    r = await customers[0]('POST', '/groups/start', {
      coachId, date: D6, hour: 10, location: 'Helsinki', ageGroup: '7-10',
    });
    check('player starts a group on a free slot', r.status === 201 && /^GRP-/.test(r.data.session), r.data);
    const G3 = r.data.session;
    const g3row = db.prepare('SELECT * FROM group_sessions WHERE code = ?').get(G3);
    check('player-started session carries the age group', g3row.age_group === '7-10'
      && g3row.created_by === 'player', g3row);
    check('the free slot was consumed', !db.prepare(
      'SELECT 1 FROM availability WHERE coach_id = ? AND date = ? AND hour = 10').get(coachId, D6), null);
    await sendWebhook({ group_signup: db.prepare(
      'SELECT code FROM group_signups WHERE group_session_id = ?').get(g3row.id).code }, 'pi_start1');

    // A different age group cannot join it.
    r = await customers[1]('POST', `/groups/${G3}/join`, { ageGroup: '13-16' });
    check('age-group mismatch rejected', r.status === 409 && /different age group/.test(r.data.error), r.data);
    r = await customers[1]('POST', `/groups/${G3}/join`, { ageGroup: '7-10' });
    check('same age group joins fine', r.status === 201, r.data);

    // Fill-before-start: while the coach's session has room, no new session
    // can be started and their free hours leave the startable list.
    r = await customers[2]('POST', '/groups/start', {
      coachId, date: D7, hour: 11, location: 'Helsinki', ageGroup: '7-10',
    });
    check('second group blocked while one has room', r.status === 409
      && /already has an open group session/.test(r.data.error), r.data);
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('coach with an open joinable session leaves the startable list',
      !r.startable.some((c) => c.coachId === coachId), r.startable.map((c) => c.coachId));
    // Once the session is FULL it no longer blocks: filling one opens the next.
    db.prepare('UPDATE group_sessions SET capacity = 2 WHERE code = ?').run(G3);
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('a full session frees the coach for a new start',
      r.startable.some((c) => c.coachId === coachId), r.startable.map((c) => c.coachId));
    r = await customers[2]('POST', '/groups/start', {
      coachId, date: D7, hour: 11, location: 'Helsinki', ageGroup: '13-16',
    });
    check('new group can start once the previous one is full', r.status === 201, r.data);

    // Get-in-touch leads land in the CRM.
    r = await fetch(BASE + '/api/contact', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact: 'not valid' }) });
    check('bad contact rejected', r.status === 400, r.status);
    r = await fetch(BASE + '/api/contact', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact: '+358 40 999 8877' }) });
    check('phone contact accepted', r.status === 201, r.status);
    r = await admin('GET', '/admin/crm');
    const lead = (r.data.contactRequests || []).find((x) => x.contact === '+358 40 999 8877');
    check('contact request shows in the CRM', Boolean(lead) && lead.kind === 'phone', r.data.contactRequests);
    r = await admin('POST', `/admin/contact-requests/${lead.id}/handled`, {});
    check('contact request can be marked handled', r.status === 200, r.status);

    // Finance model adds up.
    r = await admin('GET', '/admin/finance');
    check('finance has 6 months + totals + outlook', r.data.months.length === 6
      && typeof r.data.totals.revenueCents === 'number'
      && typeof r.data.outlook.prepaidSessionsOwed === 'number', r.data && Object.keys(r.data));
    const thisMonth = r.data.months[r.data.months.length - 1];
    // Refunded (cancelled) spots drop out of revenue — only live confirmed
    // spots and active packages count.
    check('group + package revenue counted this month',
      thisMonth.groupCents >= 2500 && thisMonth.packageCents >= 11400, thisMonth);

    // ========================================================================
    // 24-HOUR MINIMUM LEAD: no bookings inside the next day
    // ========================================================================
    const helsinkiDate = (offset) => new Intl.DateTimeFormat('en-CA',
      { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(Date.now() + offset * 86400000));
    const hh = helsinkiHour();
    // A slot that is in the future but < 24 h away, whatever the clock says.
    const soon = hh < 8 ? { date: helsinkiDate(0), hour: 10 }
      : hh <= 18 ? { date: helsinkiDate(0), hour: hh + 1 }
      : { date: helsinkiDate(1), hour: 19 };
    db.prepare('INSERT OR IGNORE INTO availability (coach_id, date, hour, created_at) VALUES (?,?,?,?)')
      .run(coachId, soon.date, soon.hour, new Date().toISOString());
    r = await customers[0]('POST', '/bookings', {
      coachId, date: soon.date, hour: soon.hour, location: 'Helsinki', lang: 'fi',
    });
    check('booking under 24 h ahead rejected', r.status === 400
      && /24 hours/.test(r.data.error), r.data);
    r = await fetch(BASE + `/api/coaches/${coachId}/slots`).then((x) => x.json());
    check('slot inside 24 h hidden from the picker',
      !r.slots.some((sl) => sl.date === soon.date && sl.hour === soon.hour), soon);
    db.prepare('DELETE FROM availability WHERE coach_id = ? AND date = ? AND hour = ?')
      .run(coachId, soon.date, soon.hour);

    // Group spots are EXEMPT (owner's rule): the session happens anyway, so
    // it stays public and joinable until the very last minute.
    db.prepare(`INSERT INTO group_sessions
        (code, coach_id, date, hour, location, capacity, price_cents, status, age_group, created_by, created_at)
      VALUES ('GRP-SOON1', ?, ?, ?, 'Helsinki', 4, 2500, 'open', '10-13', 'coach', ?)`)
      .run(coachId, soon.date, soon.hour, new Date().toISOString());
    r = await fetch(BASE + '/api/groups').then((x) => x.json());
    check('a session inside 24 h stays on the public list',
      r.sessions.some((g) => g.code === 'GRP-SOON1'), r.sessions.map((g) => g.code));
    r = await customers[3]('POST', '/groups/GRP-SOON1/join', { ageGroup: '10-13' });
    check('group join under 24 h accepted', r.status === 201
      && /^GSU-/.test(r.data.signup.code), r.data);
    db.prepare("UPDATE group_signups SET status = 'cancelled' WHERE group_session_id = (SELECT id FROM group_sessions WHERE code = 'GRP-SOON1')").run();
    db.prepare("UPDATE group_sessions SET status = 'cancelled' WHERE code = 'GRP-SOON1'").run();

    // ========================================================================
    // D-1 REMINDERS (only send from 12:00 Helsinki — conditional check)
    // ========================================================================
    db.prepare(`UPDATE bookings SET date = ? WHERE code = ?`).run(day(1), B1);
    r = await admin('POST', '/admin/emails/run', {});
    if (helsinkiHour() >= 12) {
      check('day-before reminder sent for tomorrow\'s booking', emailCount('reminder') >= 1, emailCount('reminder'));
    } else {
      console.log('  --  reminder check skipped (before 12:00 Helsinki); automation ran:', r.status === 200);
      check('automation endpoint runs', r.status === 200, r.status);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
  } catch (err) {
    console.error('SUITE ERROR:', err);
    failed++;
  } finally {
    server.kill();
    process.exit(failed ? 1 : 0);
  }
})();
