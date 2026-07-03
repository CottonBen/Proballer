// Seeds the database. Called automatically on first server start, or manually:
//   npm run seed:demo         -> add demo data to an existing DB
//   npm run reset             -> wipe DB, reseed core accounts + demo data
//   npm run reset:production  -> wipe DB, core accounts only (go-live state)
//
// "Core" rows (demo=0): the admin login, coach Kalle Sundman, coach profile Ben.
// "Demo" rows (demo=1): fictional coaches, customers, bookings, visits — so the
// admin dashboard has something to show. Remove them any time with reset:production.
const bcrypt = require('bcryptjs');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');

// Idempotent structural migrations, run on every server start. Safe on both
// fresh and existing databases.
function migrate(db, nowISO) {
  // Kalle is both an admin and a coach (his coach profile stays linked).
  db.prepare("UPDATE users SET role = 'admin' WHERE email = 'kalle.sundman@icloud.com' AND role = 'coach'").run();

  // Ben's coach profile belongs on the owner's own account — retire the old
  // separate ben@proballers.fi login if it exists.
  const owner = db.prepare("SELECT id FROM users WHERE email = 'cottonbenjaminmik@gmail.com'").get();
  const oldBen = db.prepare("SELECT id FROM users WHERE email = 'ben@proballers.fi'").get();
  if (owner) {
    if (oldBen) {
      db.prepare("UPDATE coaches SET user_id = ? WHERE slug = 'ben-cotton' AND user_id = ?").run(owner.id, oldBen.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(oldBen.id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(oldBen.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(oldBen.id);
    } else {
      db.prepare("UPDATE coaches SET user_id = ? WHERE slug = 'ben-cotton' AND user_id IS NULL").run(owner.id);
    }
  }
}

function seed({ demo = true, reset = false } = {}) {
  if (reset) {
    const { DATA_DIR } = require('../server/db');
    // Close nothing — reset is only used from the CLI before the server runs.
    for (const f of ['proballers.db', 'proballers.db-wal', 'proballers.db-shm']) {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    }
    delete require.cache[require.resolve('../server/db')];
  }
  const { db, nowISO, helsinkiDateOffset } = require('../server/db');

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) migrate(db, nowISO);
  if (userCount > 0 && !demo) return { seeded: false };

  const now = nowISO();
  const insUser = db.prepare(
    'INSERT OR IGNORE INTO users (email, password_hash, name, role, demo, created_at) VALUES (?,?,?,?,?,?)');
  const getUser = db.prepare('SELECT id FROM users WHERE email = ?');
  const insCoach = db.prepare(`INSERT OR IGNORE INTO coaches
    (user_id, name, slug, bio, photos, locations, positions, featured, display_order, demo, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const getCoach = db.prepare('SELECT id FROM coaches WHERE slug = ?');

  // --- Core accounts -------------------------------------------------------
  // Passwords come from env vars in production (set ADMIN_PASSWORD etc. on the
  // host); the values you specified are the local/dev defaults. Either way the
  // DB only ever stores a bcrypt hash, and any account can be rotated later via
  // the authenticated /api/auth/change-password endpoint.
  if (userCount === 0) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'cottonbenjaminmik@gmail.com').toLowerCase();
    insUser.run(adminEmail, bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Castagne20!', 10),
      'Benjamin Cotton', 'admin', 0, now);

    // Kalle is both an admin and a coach: admin role + a linked coach profile.
    const kalleEmail = (process.env.COACH_EMAIL || 'kalle.sundman@icloud.com').toLowerCase();
    insUser.run(kalleEmail, bcrypt.hashSync(process.env.COACH_PASSWORD || 'Kaakeli.09', 10),
      'Kalle Sundman', 'admin', 0, now);
    const kalleId = getUser.get(kalleEmail).id;
    insCoach.run(kalleId, 'Kalle Sundman', 'kalle-sundman',
      'Kalle on 17 vuotias laitapuolustaja, joka on pelannut myös monia vuosia keskikentällä. ' +
      'Kallella on alla monia kausia SM sarjassa ja hänellä on kokemusta ja tietoa siitä mitä ' +
      'jatkuvaan kehitykseen tarvitaan.',
      JSON.stringify(['/assets/kalle-1.jpg', '/assets/kalle-2.jpg', '/assets/kalle-3.jpg']),
      JSON.stringify(['Helsinki', 'Espoo']),
      JSON.stringify(['midfielders', 'attackers']),
      1, 20, 0, now);

    // Ben — first face of the site. His coach profile lives on the owner's
    // own (admin) account, so one login covers both roles.
    const benId = getUser.get(adminEmail).id;
    insCoach.run(benId, 'Ben Cotton', 'ben-cotton',
      'Ben plays football in Somerset for Millfield School. He has previously played for ' +
      'FC Honka before his move to the UK. Ben is a central defender and mainly coaches ' +
      'attackers and defenders.',
      JSON.stringify(['/assets/ben-1.jpg', '/assets/ben-2.jpg']),
      JSON.stringify(['Helsinki', 'Espoo', 'Vantaa']),
      JSON.stringify(['attackers', 'defenders']),
      1, 10, 0, now);
  }

  // --- Demo data ------------------------------------------------------------
  if (!demo) return { seeded: true, demo: false };
  const already = db.prepare("SELECT value FROM meta WHERE key = 'demo_seeded'").get();
  if (already) return { seeded: true, demo: 'already' };

  const fictional = [
    {
      name: 'Eero Virtanen', slug: 'eero-virtanen', photo: '/assets/coach-eero.svg',
      bio: 'Eero is a goalkeeper specialist with ten seasons between the posts in the ' +
        'Finnish lower divisions. His sessions build shot-stopping, footwork and the ' +
        'bravery every young keeper needs.',
      locations: ['Helsinki', 'Vantaa'], positions: ['goalkeepers'], order: 30,
    },
    {
      name: 'Sofia Laine', slug: 'sofia-laine', photo: '/assets/coach-sofia.svg',
      bio: 'Sofia is an attacking midfielder who has represented Finland at youth level. ' +
        'She coaches creative players — scanning, receiving between the lines and making ' +
        'the final pass count.',
      locations: ['Espoo'], positions: ['midfielders', 'attackers'], order: 40,
    },
    {
      name: 'Mikko Korhonen', slug: 'mikko-korhonen', photo: '/assets/coach-mikko.svg',
      bio: 'Mikko spent his playing career as a no-nonsense centre back and now turns ' +
        'promising juniors into composed defenders. Expect duels, defending the box and ' +
        'plenty of communication.',
      locations: ['Helsinki', 'Espoo', 'Vantaa'], positions: ['defenders', 'midfielders'], order: 50,
    },
  ];
  for (const c of fictional) {
    insCoach.run(null, c.name, c.slug, c.bio, JSON.stringify([c.photo]),
      JSON.stringify(c.locations), JSON.stringify(c.positions), 1, c.order, 1, now);
  }

  // Deterministic pseudo-random so reseeding produces the same demo dataset.
  let rngState = 42;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // Demo customers.
  const customerNames = ['Onni Mäkelä', 'Aino Nieminen', 'Elias Heikkinen', 'Emma Koskinen',
    'Leo Järvinen', 'Sara Lehtonen', 'Väinö Salmi', 'Ella Rantanen'];
  const customerIds = [];
  customerNames.forEach((name, i) => {
    const email = `demo.customer${i + 1}@example.com`;
    insUser.run(email, bcrypt.hashSync('DemoCustomer1!', 10), name, 'customer', 1, now);
    customerIds.push(getUser.get(email).id);
  });

  const demoCoachIds = fictional.map(c => getCoach.get(c.slug).id);
  const insAvail = db.prepare(
    'INSERT OR IGNORE INTO availability (coach_id, date, hour, demo, created_at) VALUES (?,?,?,1,?)');
  const insVisit = db.prepare(
    'INSERT INTO visits (visitor_id, path, day, ts, demo) VALUES (?,?,?,?,1)');
  const insEvent = db.prepare(
    'INSERT INTO events (visitor_id, user_id, type, meta, day, ts, demo) VALUES (?,?,?,?,?,?,1)');
  const insBooking = db.prepare(`INSERT OR IGNORE INTO bookings
    (code, customer_id, coach_id, date, hour, location, position, focus, is_online,
     price_cents, discount_cents, total_cents, status, created_at, completed_at, demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  const insInvoice = db.prepare(`INSERT OR IGNORE INTO invoices
    (booking_id, number, customer_email, amount_cents, issued_at, due_date, status)
    VALUES (?,?,?,?,?,?,?)`);

  // Upcoming availability for fictional coaches (next 14 days, a few slots/day).
  for (const coachId of demoCoachIds) {
    for (let d = 0; d <= 14; d++) {
      const date = helsinkiDateOffset(d);
      for (let h = config.dayStartHour; h < config.dayEndHour; h++) {
        if (rnd() < 0.28) insAvail.run(coachId, date, h, now);
      }
    }
  }

  // 120 days of history: visits, funnel events, bookings, invoices.
  const focusIds = config.focusTypes.map(f => f.id);
  let bookingSeq = 1;
  let invoiceSeq = 1;
  for (let d = 120; d >= 1; d--) {
    const day = helsinkiDateOffset(-d);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    // Site slowly growing, busier on weekends.
    const visitors = Math.round((6 + (120 - d) * 0.25) * (weekend ? 1.5 : 1) * (0.7 + rnd() * 0.6));
    for (let v = 0; v < visitors; v++) {
      const vid = `demo-${day}-${v}`;
      const ts = `${day}T${String(9 + Math.floor(rnd() * 11)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00.000Z`;
      insVisit.run(vid, '/', day, ts);
      if (rnd() < 0.5) insVisit.run(vid, '/#coaches', day, ts);

      // Booking funnel: ~18% start, ~62% of starters finish.
      if (rnd() < 0.18) {
        insEvent.run(vid, null, 'booking_started', '{}', day, ts);
        if (rnd() < 0.62) {
          const coachId = pick(demoCoachIds);
          const customerId = pick(customerIds);
          const hour = config.dayStartHour + Math.floor(rnd() * (config.dayEndHour - config.dayStartHour));
          const focus = pick(focusIds);
          const online = focus === 'game-iq';
          const price = (online ? config.pricing.onlineSessionPrice : config.pricing.sessionPrice) * 100;
          const discount = Math.round(price * config.pricing.salePercent / 100);
          const code = `PBF-D${String(bookingSeq++).padStart(4, '0')}`;
          const res = insBooking.run(code, customerId, coachId, day, hour,
            online ? 'Online' : pick(config.locations),
            pick(config.positions), focus, online ? 1 : 0,
            price, discount, price - discount,
            'completed', ts, `${day}T${String(hour + 1).padStart(2, '0')}:00:00+02:00`);
          if (res.changes > 0) {
            insEvent.run(vid, customerId, 'booking_completed',
              JSON.stringify({ coachId, code }), day, ts);
            insInvoice.run(res.lastInsertRowid, `${config.invoice.numberPrefix}-D${String(invoiceSeq++).padStart(4, '0')}`,
              'demo.customer@example.com', price - discount, ts, day, rnd() < 0.85 ? 'paid' : 'sent');
          }
        }
      }
    }
  }

  // A few upcoming demo bookings (pending sessions for the dashboard).
  for (let i = 0; i < 7; i++) {
    const d = 1 + Math.floor(rnd() * 10);
    const date = helsinkiDateOffset(d);
    const coachId = pick(demoCoachIds);
    const hour = config.dayStartHour + Math.floor(rnd() * (config.dayEndHour - config.dayStartHour));
    const focus = pick(focusIds);
    const online = focus === 'game-iq';
    const price = (online ? config.pricing.onlineSessionPrice : config.pricing.sessionPrice) * 100;
    const discount = Math.round(price * config.pricing.salePercent / 100);
    const code = `PBF-U${String(i + 1).padStart(3, '0')}`;
    const res = insBooking.run(code, pick(customerIds), coachId, date, hour,
      online ? 'Online' : pick(config.locations), pick(config.positions), focus,
      online ? 1 : 0, price, discount, price - discount, 'confirmed', now, null);
    if (res.changes > 0) {
      insAvail.run(coachId, date, hour, now); // the slot they booked was published
      insInvoice.run(res.lastInsertRowid, `${config.invoice.numberPrefix}-U${String(i + 1).padStart(3, '0')}`,
        'demo.customer@example.com', price - discount, now, helsinkiDateOffset(d + 7), 'sent');
    }
  }

  // Upcoming demo clients for the real coaches too, so their dashboards show
  // the client list from day one (flagged demo, removable in the admin).
  const realCoaches = [
    { id: getCoach.get('kalle-sundman').id, positions: ['midfielders', 'attackers'], locations: ['Helsinki', 'Espoo'] },
    { id: getCoach.get('ben-cotton').id, positions: ['attackers', 'defenders'], locations: ['Helsinki', 'Espoo', 'Vantaa'] },
  ];
  let realSeq = 1;
  for (const rc of realCoaches) {
    for (let i = 0; i < 3; i++) {
      const n = realSeq++;
      const d = 2 + Math.floor(rnd() * 9);
      const date = helsinkiDateOffset(d);
      const hour = config.dayStartHour + Math.floor(rnd() * (config.dayEndHour - config.dayStartHour));
      const focus = pick(focusIds);
      const online = focus === 'game-iq';
      const price = (online ? config.pricing.onlineSessionPrice : config.pricing.sessionPrice) * 100;
      const discount = Math.round(price * config.pricing.salePercent / 100);
      const res = insBooking.run(`PBF-R${String(n).padStart(3, '0')}`, pick(customerIds), rc.id, date, hour,
        online ? 'Online' : pick(rc.locations), pick(rc.positions), focus,
        online ? 1 : 0, price, discount, price - discount, 'confirmed', now, null);
      if (res.changes > 0) {
        insAvail.run(rc.id, date, hour, now);
        insInvoice.run(res.lastInsertRowid, `${config.invoice.numberPrefix}-R${String(n).padStart(3, '0')}`,
          'demo.customer@example.com', price - discount, now, helsinkiDateOffset(d + 7), 'sent');
      }
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_seeded', ?)").run(now);
  return { seeded: true, demo: true };
}

function removeDemoData() {
  const { db } = require('../server/db');
  db.exec(`
    DELETE FROM invoices WHERE booking_id IN (SELECT id FROM bookings WHERE demo = 1);
    DELETE FROM credits WHERE demo = 1 OR customer_id IN (SELECT id FROM users WHERE demo = 1);
    DELETE FROM notifications WHERE demo = 1 OR user_id IN (SELECT id FROM users WHERE demo = 1);
    DELETE FROM bookings WHERE demo = 1;
    DELETE FROM availability WHERE demo = 1;
    DELETE FROM visits WHERE demo = 1;
    DELETE FROM events WHERE demo = 1;
    DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo = 1);
    DELETE FROM coaches WHERE demo = 1;
    DELETE FROM users WHERE demo = 1;
  `);
  // Leave a marker (instead of deleting the key) so a server restart does NOT
  // quietly reseed the demo data the admin just removed. `npm run reset`
  // still brings the demo environment back on purpose.
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_seeded', 'removed-by-admin')")
    .run();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const result = seed({
    demo: !args.includes('--no-demo'),
    reset: args.includes('--reset'),
  });
  console.log('Seed result:', result);
}

module.exports = { seed, removeDemoData };
