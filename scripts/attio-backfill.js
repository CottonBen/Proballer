// One-time backfill: push every existing customer, lead, booking, group spot
// and package into Attio. Safe to re-run — people upsert by email and deals are
// idempotent via the local attio_map table, so a second run updates instead of
// duplicating.
//
//   ATTIO_API_KEY=<token> node scripts/attio-backfill.js            # go live
//   ATTIO_API_KEY=<token> node scripts/attio-backfill.js --limit 1  # smoke test
//   node scripts/attio-backfill.js --dry-run                        # print only
//
// Flags:
//   --dry-run       print every Attio payload instead of sending it (no key needed)
//   --limit N       only the first N rows of each type (great for a 1-record test)
//   --people-only   skip deals (people + leads only)
'use strict';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PEOPLE_ONLY = args.includes('--people-only');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

if (DRY) process.env.ATTIO_DRY_RUN = '1'; // must be set BEFORE requiring attio

const { db } = require('../server/db');
const attio = require('../server/attio');

if (!attio.enabled()) {
  console.error('ATTIO_API_KEY is not set. Set it (or pass --dry-run) and try again.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cap = (rows) => (Number.isFinite(LIMIT) ? rows.slice(0, LIMIT) : rows);

async function each(label, rows, fn) {
  let ok = 0;
  const fails = [];
  for (const row of cap(rows)) {
    try { await fn(row); ok++; }
    catch (e) { fails.push(`${label} ${row.id ?? row.contact}: ${e.message}`); }
    await sleep(120); // gentle pacing for Attio's rate limits
  }
  console.log(`  ${label}: ${ok}/${cap(rows).length} ok${fails.length ? `, ${fails.length} failed` : ''}`);
  return fails;
}

async function main() {
  console.log(`Attio backfill${DRY ? ' (dry run)' : ''}${Number.isFinite(LIMIT) ? ` — limit ${LIMIT}/type` : ''}`);

  console.log('Ensuring custom People fields exist…');
  const schemaReady = await attio.ensurePeopleSchema();
  console.log(`  custom fields: ${schemaReady ? 'ready' : 'skipped (standard fields only)'}`);

  const fails = [];

  const customers = db.prepare("SELECT * FROM users WHERE role = 'customer' AND demo = 0 ORDER BY id").all();
  fails.push(...await each('customers', customers, (u) => attio.pushPerson(u)));

  const leads = db.prepare("SELECT contact, kind, source FROM contact_requests WHERE handled_at IS NULL ORDER BY id").all();
  fails.push(...await each('leads', leads, (l) => attio.pushLead(l)));

  if (!PEOPLE_ONLY) {
    const bookings = db.prepare("SELECT id FROM bookings WHERE demo = 0 AND status IN ('confirmed','completed') ORDER BY id").all();
    fails.push(...await each('bookings', bookings, (b) => attio.pushBooking(b.id)));

    const signups = db.prepare("SELECT id FROM group_signups WHERE demo = 0 AND status = 'confirmed' ORDER BY id").all();
    fails.push(...await each('group signups', signups, (s) => attio.pushGroupSignup(s.id)));

    const pkgs = db.prepare("SELECT id FROM packages WHERE demo = 0 AND status = 'active' ORDER BY id").all();
    fails.push(...await each('packages', pkgs, (p) => attio.pushPackage(p.id)));
  }

  console.log(`\nDone.${fails.length ? ` ${fails.length} item(s) failed:` : ' No failures.'}`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
