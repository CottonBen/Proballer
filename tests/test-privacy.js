// E2E checks for the privacy policy, the signup age gate and self-serve
// account deletion. Scratch server on :3465.
//
// The deletion tests are the ones that matter: getting them wrong either leaves
// personal data behind after someone asked for it to go, or destroys invoices
// the business is legally required to keep.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = path.join(__dirname, '..');
const PORT = 3465;
const BASE = `http://localhost:${PORT}`;
const SITE = 'https://proballerscoaching.com';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pbf-priv-'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
}

// API calls go under /api; the page() helper below fetches bare paths.
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
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, DEMO_DATA: '1', SMTP_HOST: '', SITE_URL: SITE,
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'TestAdmin123!',
      COACH_EMAIL: 'coach@test.local', COACH_PASSWORD: 'TestCoach123!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  try {
    let up = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { if ((await fetch(BASE + '/api/config')).ok) { up = true; break; } } catch { /* boot */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('no boot');
    const db = new DatabaseSync(path.join(DATA_DIR, 'proballers.db'));

    // --- the policy page -----------------------------------------------------
    const page = async (p) => {
      const r = await fetch(BASE + p);
      return { status: r.status, body: await r.text() };
    };
    let fi = await page('/privacy');
    let en = await page('/en/privacy');
    check('/privacy 200s', fi.status === 200, fi.status);
    check('/en/privacy 200s', en.status === 200, en.status);
    check('Finnish page is in Finnish', /<html lang="fi"/.test(fi.body) && /Tietosuojaseloste/.test(fi.body));
    check('English page is in English', /<html lang="en"/.test(en.body) && /Privacy policy/.test(en.body));
    check('policy canonicalises per language',
      fi.body.includes(`<link rel="canonical" href="${SITE}/privacy">`)
      && en.body.includes(`<link rel="canonical" href="${SITE}/en/privacy">`));
    check('policy declares reciprocal hreflang',
      fi.body.includes(`hreflang="en" href="${SITE}/en/privacy"`)
      && en.body.includes(`hreflang="fi" href="${SITE}/privacy"`));
    check('policy is in the sitemap, both languages',
      (await page('/sitemap.xml')).body.includes(`<loc>${SITE}/privacy</loc>`)
      && (await page('/sitemap.xml')).body.includes(`<loc>${SITE}/en/privacy</loc>`));

    // The body must be in the SERVED html — someone looking for a privacy
    // policy is exactly the sort of person browsing with scripts off.
    check('policy text is server-rendered, not script-built',
      fi.body.includes('Rekisterinpitäjä') && fi.body.includes('Evästeet'), 'missing sections');
    for (const heading of ['Terveystiedot', 'Lapset ja nuoret', 'Oikeutesi', 'Kuinka kauan säilytämme']) {
      check(`policy covers "${heading}"`, fi.body.includes(heading));
    }
    check('policy names the cookies it actually sets',
      fi.body.includes('pbf_session') && fi.body.includes('pbf_vid'));
    check('policy states the real retention periods',
      fi.body.includes(String(require('../config').privacy.invoiceYears))
      && fi.body.includes(String(require('../config').privacy.inactiveMonths)));
    // The controller must be identifiable (GDPR Art. 13) and, now that the
    // details are filled in, the draft warning must be gone.
    const P = require('../config').privacy;
    check('the policy names the controller and its address',
      fi.body.includes(P.legalName) && fi.body.includes(P.address), P);
    check('a contact address for data requests is given',
      fi.body.includes(P.contactEmail));
    check('no draft warning once the details are real',
      !fi.body.includes('Keskeneräinen') && !en.body.includes('>Draft<'), 'still draft');
    // No business ID yet — the line must be omitted, not left as a stray label.
    check('no orphan Y-tunnus label while unregistered',
      P.businessId ? fi.body.includes(P.businessId) : !fi.body.includes('Y-tunnus'), P.businessId);
    check('the SMTP processor is named', fi.body.includes(P.smtpProvider), P.smtpProvider);

    // --- signup age gate -----------------------------------------------------
    const anon = client();
    let r = await anon('POST', '/auth/signup', {
      name: 'Testi Pelaaja', email: 'age1@test.local', password: 'Testpass123', area: 'Helsinki',
    });
    check('signup refused without the age confirmation', r.status === 400
      && /13 or older/i.test(r.data.error || ''), r.data);
    r = await anon('POST', '/auth/signup', {
      name: 'Testi Pelaaja', email: 'age1@test.local', password: 'Testpass123', area: 'Helsinki',
      ageConfirmed: false,
    });
    check('an explicit false is still refused', r.status === 400, r.data);
    r = await anon('POST', '/auth/signup', {
      name: 'Testi Pelaaja', email: 'age1@test.local', password: 'Testpass123', area: 'Helsinki',
      ageConfirmed: true,
    });
    check('signup accepted with the confirmation', r.status === 200 || r.status === 201, r.data);
    const pend = db.prepare('SELECT code FROM pending_signups WHERE email = ?').get('age1@test.local');
    await anon('POST', '/auth/verify-signup', { email: 'age1@test.local', code: pend.code });
    const created = db.prepare('SELECT age_confirmed_at FROM users WHERE email = ?').get('age1@test.local');
    check('the confirmation is recorded on the account',
      Boolean(created && created.age_confirmed_at), created);

    // --- self-serve deletion -------------------------------------------------
    const cust = client();
    // A customer with history but nothing upcoming.
    const target = db.prepare(`SELECT u.email FROM users u
      WHERE u.role = 'customer' AND u.anonymised_at IS NULL
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = u.id AND b.status = 'confirmed')
      LIMIT 1`).get();
    check('found a demo customer with history', Boolean(target), target);
    await cust('POST', '/auth/login', { email: target.email, password: 'DemoCustomer1!' });
    const before = db.prepare('SELECT * FROM users WHERE email = ?').get(target.email);
    const invBefore = db.prepare(`SELECT COUNT(*) n FROM invoices i JOIN bookings b ON b.id = i.booking_id
      WHERE b.customer_id = ?`).get(before.id).n;

    r = await cust('POST', '/me/delete', { confirmEmail: 'wrong@example.com' });
    check('deletion refused without the right email', r.status === 400, r.data);
    check('nothing deleted by the refused attempt',
      db.prepare('SELECT anonymised_at FROM users WHERE id = ?').get(before.id).anonymised_at === null);

    r = await cust('POST', '/me/delete', { confirmEmail: target.email });
    check('deletion accepted', r.status === 200, r.data);

    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(before.id);
    check('name and email are gone', after.name !== before.name
      && after.email.startsWith('deleted-'), after.email);
    check('phone and address are cleared',
      !after.phone && !after.billing_address && !after.billing_city, after);
    check('the login is destroyed', after.password_hash === '', after.password_hash);
    check('deletion is stamped', Boolean(after.anonymised_at));
    check('chat messages are gone',
      db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE sender_id = ?').get(before.id).n === 0);
    check('notes and billing on bookings are wiped',
      db.prepare(`SELECT COUNT(*) n FROM bookings
        WHERE customer_id = ? AND (notes != '' OR billing_name != '')`).get(before.id).n === 0);
    check('sessions revoked',
      db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(before.id).n === 0);
    // …but the accounting survives, which is the whole reason this anonymises
    // rather than deletes.
    check('invoices are KEPT for the statutory period',
      db.prepare(`SELECT COUNT(*) n FROM invoices i JOIN bookings b ON b.id = i.booking_id
        WHERE b.customer_id = ?`).get(before.id).n === invBefore, invBefore);
    check('invoice emails are scrubbed', db.prepare(`SELECT COUNT(*) n FROM invoices i
      JOIN bookings b ON b.id = i.booking_id
      WHERE b.customer_id = ? AND i.customer_email NOT LIKE 'deleted-%'`).get(before.id).n === 0);
    check('the deleted session no longer authenticates',
      (await cust('GET', '/my-bookings')).status === 401);

    // A customer with an upcoming session must not vanish on the coach.
    const live = client();
    const withUpcoming = db.prepare(`SELECT u.email FROM users u
      WHERE u.role = 'customer' AND u.anonymised_at IS NULL
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = u.id AND b.status = 'confirmed')
      LIMIT 1`).get();
    if (withUpcoming) {
      await live('POST', '/auth/login', { email: withUpcoming.email, password: 'DemoCustomer1!' });
      r = await live('POST', '/me/delete', { confirmEmail: withUpcoming.email });
      check('deletion refused while sessions are upcoming', r.status === 409
        && /upcoming/i.test(r.data.error || ''), r.data);
    }
    db.close();
  } catch (err) {
    failed++;
    console.log('  FAIL  suite crashed —', err.message);
  } finally {
    server.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
