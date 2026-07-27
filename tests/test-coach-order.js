// Coach ordering: Ben and Kalle run the business and only coach to fill gaps,
// so they must never be promoted ahead of the real coaching roster — not in the
// coaches grid, not in a coach dropdown, not in the hero carousel. This guards
// both the fresh-seed values and the one-time migration that moves them on a
// database where they still lead (as production did).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const PROJECT = path.join(__dirname, '..');
const DATA = path.join(__dirname, `coachorder-data-${process.pid}`);
fs.rmSync(DATA, { recursive: true, force: true });
process.env.DATA_DIR = DATA;
process.env.ADMIN_EMAIL = 'admin@test.local'; process.env.ADMIN_PASSWORD = 'TestAdmin123!';
process.env.COACH_EMAIL = 'coach@test.local'; process.env.COACH_PASSWORD = 'TestCoach123!';

const STAFF = new Set(['ben-cotton', 'kalle-sundman']);
let passed = 0, failed = 0;
const check = (n, c, x) => {
  if (c) { passed++; console.log(`  ok  ${n}`); }
  else { failed++; console.log(`FAIL  ${n}${x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); }
};

// Re-runs seed() the way a server restart would.
function boot() {
  for (const m of ['scripts/seed.js', 'server/db.js']) {
    const p = require.resolve(path.join(PROJECT, m));
    delete require.cache[p];
  }
  require(path.join(PROJECT, 'scripts/seed.js')).seed({ demo: true });
}
const open = () => new DatabaseSync(path.join(DATA, 'proballers.db'));
// The same ordering the public /coaches list and every coach dropdown use.
const listed = (db) => db.prepare(
  `SELECT slug, display_order, featured, spotlight_order FROM coaches
   WHERE active = 1 ORDER BY display_order, id`).all();
const staffAreLast = (rows) => {
  const staff = rows.map((r, i) => [r, i]).filter(([r]) => STAFF.has(r.slug)).map(([, i]) => i);
  const others = rows.map((r, i) => [r, i]).filter(([r]) => !STAFF.has(r.slug)).map(([, i]) => i);
  return { ok: staff.length > 0 && others.length > 0 && Math.min(...staff) > Math.max(...others), staff, others };
};

try {
  // --- a fresh database ------------------------------------------------------
  boot();
  let db = open();
  let rows = listed(db);
  let r = staffAreLast(rows);
  check('fresh seed: Ben & Kalle sort LAST among coaches', r.ok, { order: rows.map((x) => x.slug) });
  check('fresh seed: neither is featured in the hero carousel',
    rows.filter((x) => STAFF.has(x.slug)).every((x) => x.featured === 0));
  check('fresh seed: real coaches ARE featured',
    rows.filter((x) => !STAFF.has(x.slug)).some((x) => x.featured === 1));

  // --- a database that still has the OLD layout (what production had) --------
  db.prepare("UPDATE coaches SET display_order = 10, featured = 1, spotlight_order = 1 WHERE slug = 'ben-cotton'").run();
  db.prepare("UPDATE coaches SET display_order = 20, featured = 1, spotlight_order = 2 WHERE slug = 'kalle-sundman'").run();
  db.prepare("DELETE FROM meta WHERE key = 'staff_last_v1'").run();
  rows = listed(db);
  check('sanity: the old layout really put them first', STAFF.has(rows[0].slug) && STAFF.has(rows[1].slug),
    rows.slice(0, 2).map((x) => x.slug));
  db.close();

  boot();                                   // = the next production boot
  db = open();
  rows = listed(db);
  r = staffAreLast(rows);
  check('upgrade boot: they are moved to the BACK', r.ok, { order: rows.map((x) => x.slug) });
  check('upgrade boot: dropped out of the hero (featured 0, no spotlight number)',
    rows.filter((x) => STAFF.has(x.slug)).every((x) => x.featured === 0 && x.spotlight_order === null),
    rows.filter((x) => STAFF.has(x.slug)));

  // --- the admin must stay in control ---------------------------------------
  db.prepare("UPDATE coaches SET display_order = 5 WHERE slug = 'ben-cotton'").run();
  db.close();
  boot();
  db = open();
  check('idempotent: a later manual reorder in the admin is not overwritten',
    db.prepare("SELECT display_order FROM coaches WHERE slug = 'ben-cotton'").get().display_order === 5);
  db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.log('error:', err.message);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(1);
}
