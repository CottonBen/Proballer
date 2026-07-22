// Unit + offline-integration tests for the Attio CRM sync (server/attio.js).
// No network: pure payload builders, DB-backed stats, and a full dry-run pass
// (ATTIO_DRY_RUN=1) that walks person + deal upserts end to end.
'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Isolated scratch DB, and make sure no real Attio credentials leak in.
const DATA = path.join(__dirname, `attio-data-${process.pid}`);
fs.rmSync(DATA, { recursive: true, force: true });
process.env.DATA_DIR = DATA;
delete process.env.ATTIO_API_KEY;
delete process.env.ATTIO_DRY_RUN;

const { db, nowISO } = require('../server/db');
const attio = require('../server/attio');

let passed = 0, failed = 0;
const check = (n, c, x) => {
  if (c) { passed++; console.log(`  ok  ${n}`); }
  else { failed++; console.log(`FAIL  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); }
};
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- phone formatting --------------------------------------------------------
check('phone with + is kept as-is', deep(attio.phoneValue('+358449872431'), { original_phone_number: '+358449872431' }));
check('local phone gets FI country code', deep(attio.phoneValue('044 987 2431'), { original_phone_number: '044 987 2431', country_code: 'FI' }));

// --- buildPersonValues (no custom schema) ------------------------------------
const pv = attio.buildPersonValues({
  name: 'Matti Meikäläinen', email: 'Matti@Example.COM', phone: '+358401234567',
  source: 'instagram', area: 'Espoo', lang: 'fi', stage: 'Customer',
  since: '2026-07-01', sessions: 3, lifetimeEur: 120,
}, false);
check('full_name set', pv.name[0].full_name === 'Matti Meikäläinen');
check('first/last name split', pv.name[0].first_name === 'Matti' && pv.name[0].last_name === 'Meikäläinen');
check('email is lowercased', pv.email_addresses[0].email_address === 'matti@example.com');
check('phone included', pv.phone_numbers[0].original_phone_number === '+358401234567');
check('description carries source/area/stage', /Customer/.test(pv.description[0].value)
  && /instagram/.test(pv.description[0].value) && /Espoo/.test(pv.description[0].value)
  && /3 sessions/.test(pv.description[0].value) && /€120/.test(pv.description[0].value));
check('no pb_* custom fields when schema not ready', pv.pb_source === undefined && pv.pb_sessions === undefined);

// --- buildPersonValues (custom schema ready) ---------------------------------
const pvs = attio.buildPersonValues({
  name: 'Liisa', email: 'liisa@example.com', source: 'google', area: 'Helsinki',
  lang: 'en', stage: 'Lead', sessions: 0, lifetimeEur: 0,
}, true);
check('custom pb_source written', deep(pvs.pb_source, [{ value: 'google' }]));
check('custom pb_language uppercased', deep(pvs.pb_language, [{ value: 'EN' }]));
check('custom pb_stage written', deep(pvs.pb_stage, [{ value: 'Lead' }]));
check('custom pb_sessions numeric zero written', deep(pvs.pb_sessions, [{ value: 0 }]));
check('single-word name → empty last name', pvs.name[0].last_name === '');
check('zero sessions omitted from summary text', !/session/.test(pvs.description[0].value));

// A Set writes ONLY the fields that exist (a field that failed to create is skipped).
const pvSet = attio.buildPersonValues({
  name: 'Osku', email: 'osku@example.com', source: 'tiktok', area: 'Vantaa', lang: 'fi', stage: 'Customer', sessions: 2,
}, new Set(['pb_source', 'pb_area']));
check('Set: writes pb_source (in set)', deep(pvSet.pb_source, [{ value: 'tiktok' }]));
check('Set: writes pb_area (in set)', deep(pvSet.pb_area, [{ value: 'Vantaa' }]));
check('Set: skips pb_stage (not in set)', pvSet.pb_stage === undefined);
check('Set: skips pb_sessions (not in set)', pvSet.pb_sessions === undefined);
check('Set: still writes standard fields + description', !!pvSet.email_addresses && !!pvSet.description);

// --- buildDealValues ---------------------------------------------------------
const dv = attio.buildDealValues({ name: '1-on-1 · Ben · Paid [PBF-AB12CD]', euros: 40, personRecordId: 'rec_123' });
check('deal name set', dv.name[0].value.includes('Ben'));
check('deal value is EUR currency', deep(dv.value, [{ currency_value: 40, currency_code: 'EUR' }]));
check('deal links to person', deep(dv.associated_people, [{ target_object: 'people', target_record_id: 'rec_123' }]));
const dv2 = attio.buildDealValues({ name: 'x' });
check('deal without value/person omits those keys', dv2.value === undefined && dv2.associated_people === undefined);

// --- lifecycle + no-op guarding ---------------------------------------------
check('stage = Customer when active', attio.lifecycleStage(true) === 'Customer');
check('stage = Signed up when not', attio.lifecycleStage(false) === 'Signed up');
check('disabled without key or dry-run', attio.enabled() === false);
check('syncPerson is a no-op when disabled', attio.syncPerson(1) === undefined);
check('syncBooking is a no-op when disabled', attio.syncBooking(1) === undefined);
check('syncLead is a no-op when disabled', attio.syncLead({ contact: 'a@b.co', kind: 'email' }) === undefined);

// --- personStats (reads the DB) ----------------------------------------------
db.prepare(`INSERT INTO users (email, password_hash, name, role, lang, created_at, source, phone, area)
  VALUES (?,?,?,?,?,?,?,?,?)`)
  .run('cust@example.com', 'x', 'Testi Käyttäjä', 'customer', 'fi', nowISO(), 'instagram', '+358401112222', 'Espoo');
const uid = db.prepare("SELECT id FROM users WHERE email = 'cust@example.com'").get().id;
db.prepare("INSERT INTO coaches (name, slug, created_at) VALUES ('Ben Coach', 'ben-coach', ?)").run(nowISO());
const cid = db.prepare("SELECT id FROM coaches WHERE slug = 'ben-coach'").get().id;
db.prepare(`INSERT INTO bookings (code, customer_id, coach_id, date, hour, location, position, focus,
  price_cents, discount_cents, total_cents, status, created_at)
  VALUES ('PBF-TST01', ?, ?, '2026-07-25', 15, 'Espoo', '', '', 8000, 4000, 4000, 'confirmed', ?)`).run(uid, cid, nowISO());
const bid = db.prepare("SELECT id FROM bookings WHERE code = 'PBF-TST01'").get().id;
db.prepare(`INSERT INTO invoices (booking_id, number, customer_email, amount_cents, issued_at, due_date, status)
  VALUES (?, 'PBF-INV01', 'cust@example.com', 4000, ?, '2026-08-01', 'sent')`).run(bid, nowISO());

const st = attio.personStats(uid);
check('personStats counts the confirmed booking', st.sessions === 1, st);
check('personStats sums lifetime cents (4000)', st.lifetimeCents === 4000, st);
check('personStats hasActivity is true', st.hasActivity === true);

// --- dry-run end-to-end (person + deal upsert, idempotency, exclusions) -------
process.env.ATTIO_DRY_RUN = '1';
check('enabled in dry-run mode', attio.enabled() === true);

(async () => {
  const rid = await attio.pushPerson(db.prepare('SELECT * FROM users WHERE id = ?').get(uid));
  check('pushPerson returns a record id', typeof rid === 'string' && rid.startsWith('dry-'), rid);

  const did = await attio.pushBooking(bid);
  check('pushBooking returns a deal id', typeof did === 'string' && did.startsWith('dry-'), did);
  check('dry-run never persists to attio_map', !db.prepare("SELECT 1 FROM attio_map WHERE kind = 'booking' AND local_id = ?").get(bid));

  // A pre-existing mapping is reused via PATCH (idempotent update, no new deal).
  db.prepare("INSERT INTO attio_map (kind, local_id, record_id, updated_at) VALUES ('booking', 4242, 'rec_existing', ?)").run(nowISO());
  const reused = await attio.upsertDeal('booking', 4242, { name: 'Updated', euros: 25, personRecordId: 'rec_p' });
  check('existing mapping → PATCH reuses the record id', reused === 'rec_existing', reused);

  const coachRes = await attio.pushPerson({ id: 999, role: 'coach', name: 'Staff', email: 'staff@x.co', demo: 0 });
  check('coaches are never synced as people', coachRes === null);
  const demoRes = await attio.pushPerson({ id: 998, role: 'customer', name: 'Demo', email: 'demo@x.co', demo: 1 });
  check('demo rows are never synced', demoRes === null);

  const leadId = await attio.pushLead({ contact: 'lead@example.com', kind: 'email', source: 'facebook' });
  check('pushLead (email) returns a record id', typeof leadId === 'string' && leadId.startsWith('dry-'), leadId);

  process.env.ATTIO_DRY_RUN = '';
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
