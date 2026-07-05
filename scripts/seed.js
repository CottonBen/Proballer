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
const crypto = require('node:crypto');
const config = require('../config');

// The initial password for a core account: the env var if set, otherwise a
// freshly generated strong one, printed to the log so the operator can grab it.
// No password is ever hardcoded in the source.
function initialPassword(envVar, label) {
  if (process.env[envVar]) return process.env[envVar];
  const generated = crypto.randomBytes(12).toString('base64url').slice(0, 16);
  console.log(`[seed] ${envVar} not set — generated a password for ${label}: ${generated}`);
  console.log(`[seed] Save it now, or set ${envVar} to choose your own before the first run.`);
  return generated;
}

// Sample coach reviews, keyed by coach slug: [author, rating (1-5), body].
// Seeded with customer_id NULL and demo=1 so the admin can clear them, and only
// ever inserted once (guarded by the 'starter_reviews_v2' meta marker) so a
// review the admin deletes never silently comes back on the next restart.
const REVIEW_DAYS = [15, 34, 52, 71, 96]; // "days ago" spread, for realistic dates
const REVIEWS_BY_SLUG = {
  'kalle-sundman': [
    ['Marko L.', 5, 'Kalle really knows the wing. My son’s 1v1 and crossing improved in a month.'],
    ['Hanna R.', 5, 'Nuori mutta todella ammattimainen valmentaja. Poika odottaa aina seuraavaa treeniä.'],
    ['Petri K.', 4, 'Great sessions, clear feedback. Punctual and well planned every time.'],
  ],
  'ben-cotton': [
    ['Sanna M.', 5, 'Ben is fantastic with defenders — positioning and reading the game clicked for our daughter.'],
    ['James T.', 5, 'Proper academy-level coaching. Calm, detailed, and my son loves the 1-on-1 focus.'],
    ['Laura V.', 4, 'Very good technical work on the ball. Highly recommend for centre-backs.'],
  ],
  'eero-virtanen': [
    ['Timo H.', 5, 'Best goalkeeper coach we’ve found. Footwork and shot-stopping night and day better.'],
    ['Anni P.', 4, 'Patient with young keepers and builds real confidence between the posts.'],
  ],
  'sofia-laine': [
    ['Katri S.', 5, 'Sofia’s scanning and passing drills are brilliant. Our midfielder plays with her head up now.'],
    ['Ville N.', 5, 'Creative, positive sessions. You can tell she has played at a high level.'],
    ['Emilia J.', 4, 'Great with attacking players — the final-third work is excellent.'],
  ],
  'mikko-korhonen': [
    ['Juha A.', 4, 'No-nonsense defending sessions. Lots of duels and communication work.'],
    ['Riikka L.', 5, 'Mikko turned my son into a composed defender. Great value for the 1-on-1 time.'],
  ],
  'otto-ukkonen': [
    ['Petteri K.', 5, 'Otto on loistava maalivahtivalmentaja — pojan 1v1-tilanteet ja koppivarmuus paranivat huimasti.'],
    ['Hanna V.', 5, 'Todella asiantunteva ja kärsivällinen. Selkeät harjoitteet ja hyvä ote nuoriin maalivahteihin.'],
    ['Mikael R.', 4, 'Great goalkeeper sessions — footwork, positioning and handling all improved. Recommended.'],
  ],
};

// Coaches added after launch. They have no login yet — the admin manages their
// calendar (via the admin coach-calendar editor) until they get their own
// account. Inserted idempotently by slug from both fresh seeds and migrate().
const EXTRA_COACHES = [
  {
    name: 'Otto Ukkonen', slug: 'otto-ukkonen',
    bio: 'Otto Ukkonen on 18-vuotias maalivahti, joka pelaa Puotinkylän Valtissa. ' +
      'Pelikokemusta hänelle on kertynyt B- ja A-pojista sekä myös miesten Kolmosen ' +
      'otteluista useiden vuosien ajalta. Hänen vahvuuksiaan maalivahtipelaamisessa ovat ' +
      'selustan puolustaminen sekä 1 vastaan 1 -tilanteet. Otto on toiminut Puotinkylän ' +
      'Valtin maalivahtivalmentajana toukokuusta 2025 lähtien, ja tällä hetkellä hän toimii ' +
      'kahden joukkueen maalivahtivalmentajana. Lisäksi hän on suorittanut Suomen Palloliiton ' +
      'järjestämän Maalivahti D -valmentajakoulutuksen.',
    bio_en: 'Otto Ukkonen is an 18-year-old goalkeeper who plays for Puotinkylän Valtti. ' +
      'He has gathered playing experience over several years in the B and A junior age groups ' +
      'as well as in men\'s Kolmonen (Third Division) matches. His strengths as a goalkeeper ' +
      'are covering the space behind the defensive line and 1-on-1 situations. Otto has worked ' +
      'as Puotinkylän Valtti\'s goalkeeper coach since May 2025, and he currently coaches the ' +
      'goalkeepers of two teams. He has also completed the Goalkeeper D coaching course run by ' +
      'the Football Association of Finland.',
    photos: ['/assets/otto-1.jpg', '/assets/otto-2.jpg', '/assets/otto-3.jpg'],
    locations: ['Helsinki'],
    positions: ['goalkeepers'],
    featured: 1, order: 30,
  },
];

// Insert any post-launch coaches that don't exist yet (idempotent by slug).
function ensureExtraCoaches(db, nowStr) {
  const ins = db.prepare(`INSERT OR IGNORE INTO coaches
    (user_id, name, slug, bio, bio_en, photos, locations, positions, featured, display_order, demo, created_at)
    VALUES (NULL,?,?,?,?,?,?,?,?,?,0,?)`);
  for (const c of EXTRA_COACHES) {
    ins.run(c.name, c.slug, c.bio, c.bio_en || '', JSON.stringify(c.photos),
      JSON.stringify(c.locations), JSON.stringify(c.positions), c.featured, c.order, nowStr);
  }
}

// Bilingual bio texts for coaches that were seeded before the bio_en column
// existed. `source` must EXACTLY match the stored bio — if the admin has edited
// a bio since seeding, we leave it alone (a stale translation is worse than the
// automatic fall-back to the Finnish text). `fi`/`en` are the two versions.
const BIO_I18N = [
  { slug: 'kalle-sundman',
    source: 'Kalle on 17 vuotias laitapuolustaja, joka on pelannut myös monia vuosia keskikentällä. ' +
      'Kallella on alla monia kausia SM sarjassa ja hänellä on kokemusta ja tietoa siitä mitä ' +
      'jatkuvaan kehitykseen tarvitaan.',
    en: 'Kalle is a 17-year-old full-back who has also played in midfield for many years. ' +
      'He has several seasons in the Finnish national junior league behind him, and he has ' +
      'first-hand experience and knowledge of what continuous development takes.' },
  { slug: 'otto-ukkonen',
    source: EXTRA_COACHES[0].bio,
    en: EXTRA_COACHES[0].bio_en },
  { slug: 'ben-cotton',
    source: 'Ben plays football in Somerset for Millfield School. He has previously played for ' +
      'FC Honka before his move to the UK. Ben is a central defender and mainly coaches ' +
      'attackers and defenders.',
    fi: 'Ben pelaa jalkapalloa Somersetissa Millfield Schoolin joukkueessa. Ennen muuttoaan ' +
      'Isoon-Britanniaan hän pelasi FC Hongassa. Ben on toppari, ja hän valmentaa pääasiassa ' +
      'hyökkääjiä ja puolustajia.',
    en: 'Ben plays football in Somerset for Millfield School. He has previously played for ' +
      'FC Honka before his move to the UK. Ben is a central defender and mainly coaches ' +
      'attackers and defenders.' },
  { slug: 'eero-virtanen',
    source: 'Eero is a goalkeeper specialist with ten seasons between the posts in the ' +
      'Finnish lower divisions. His sessions build shot-stopping, footwork and the ' +
      'bravery every young keeper needs.',
    fi: 'Eero on maalivahtien erikoisvalmentaja, jolla on kymmenen kauden kokemus tolppien ' +
      'välistä Suomen alemmilta sarjatasoilta. Hänen treeneissään rakennetaan torjuntoja, ' +
      'jalkatyötä ja sitä rohkeutta, jota jokainen nuori maalivahti tarvitsee.',
    en: 'Eero is a goalkeeper specialist with ten seasons between the posts in the ' +
      'Finnish lower divisions. His sessions build shot-stopping, footwork and the ' +
      'bravery every young keeper needs.' },
  { slug: 'sofia-laine',
    source: 'Sofia is an attacking midfielder who has represented Finland at youth level. ' +
      'She coaches creative players — scanning, receiving between the lines and making ' +
      'the final pass count.',
    fi: 'Sofia on hyökkäävä keskikenttäpelaaja, joka on edustanut Suomea nuorisomaajoukkueissa. ' +
      'Hän valmentaa luovia pelaajia — havainnointia, pallon vastaanottamista linjojen välissä ' +
      'ja viimeisen syötön onnistumista.',
    en: 'Sofia is an attacking midfielder who has represented Finland at youth level. ' +
      'She coaches creative players — scanning, receiving between the lines and making ' +
      'the final pass count.' },
  { slug: 'mikko-korhonen',
    source: 'Mikko spent his playing career as a no-nonsense centre back and now turns ' +
      'promising juniors into composed defenders. Expect duels, defending the box and ' +
      'plenty of communication.',
    fi: 'Mikko pelasi uransa suoraviivaisena topparina ja tekee nyt lupaavista junioreista ' +
      'rauhallisia puolustajia. Luvassa on kaksinkamppailuja, boksin puolustamista ja ' +
      'runsaasti kommunikaatiota.',
    en: 'Mikko spent his playing career as a no-nonsense centre back and now turns ' +
      'promising juniors into composed defenders. Expect duels, defending the box and ' +
      'plenty of communication.' },
];

// Seed sample reviews for the given coach slugs, skipping any coach that already
// has reviews (so it never duplicates on top of real ones).
function seedReviews(db, helsinkiDateOffset, slugs) {
  const getCoach = db.prepare('SELECT id FROM coaches WHERE slug = ?');
  const countReviews = db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE coach_id = ?');
  const insReview = db.prepare(`INSERT INTO reviews
    (coach_id, customer_id, author_name, rating, body, created_at, demo)
    VALUES (?, NULL, ?, ?, ?, ?, 1)`);
  for (const slug of slugs) {
    const coach = getCoach.get(slug);
    if (!coach || countReviews.get(coach.id).n > 0) continue;
    (REVIEWS_BY_SLUG[slug] || []).forEach(([author, rating, body], i) => {
      const day = helsinkiDateOffset(-(REVIEW_DAYS[i % REVIEW_DAYS.length]));
      insReview.run(coach.id, author, rating, body, `${day}T18:00:00.000Z`);
    });
  }
}

// Idempotent structural migrations, run on every server start. Safe on both
// fresh and existing databases.
function migrate(db, nowISO) {
  // Bilingual bios: `bio` is the Finnish canonical text, `bio_en` the English
  // version ('' = frontend falls back to `bio`). Older databases predate the
  // column, so add it here; fresh ones get it from the CREATE TABLE in db.js.
  const coachCols = db.prepare('PRAGMA table_info(coaches)').all().map(c => c.name);
  if (!coachCols.includes('bio_en')) {
    db.exec("ALTER TABLE coaches ADD COLUMN bio_en TEXT NOT NULL DEFAULT ''");
  }

  // Per-user language for invoices/emails ('fi' default — Finnish-first site).
  // Updated from the client on signup, login and booking.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('lang')) {
    db.exec("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'fi'");
  }

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

  // Add any post-launch coaches to existing databases (idempotent by slug).
  ensureExtraCoaches(db, nowISO());

  // One-time: backfill bio translations for coaches seeded before bio_en
  // existed. Each entry only applies while the stored bio still EXACTLY
  // matches the seeded source text — an admin-edited bio is never overwritten,
  // and its bio_en stays empty (the UI then falls back to the Finnish bio).
  if (!db.prepare("SELECT 1 FROM meta WHERE key = 'bios_bilingual_v1'").get()) {
    const upd = db.prepare('UPDATE coaches SET bio = ?, bio_en = ? WHERE slug = ? AND bio = ? AND bio_en = \'\'');
    for (const b of BIO_I18N) upd.run(b.fi || b.source, b.en, b.slug, b.source);
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('bios_bilingual_v1', ?)").run(nowISO());
  }

  // One-time: English bios for coaches whose Finnish bio was customised in the
  // admin UI (so bios_bilingual_v1 above skipped them) or who were added through
  // the admin panel (no seed row). Only fills bio_en where it is still empty —
  // never overwrites an English bio the admin has since typed in. Keyed by slug,
  // NOT by matching the Finnish text, so it works regardless of later edits.
  if (!db.prepare("SELECT 1 FROM meta WHERE key = 'bios_en_backfill_v2'").get()) {
    const fill = db.prepare("UPDATE coaches SET bio_en = ? WHERE slug = ? AND bio_en = ''");
    fill.run(
      'Kalle is a full-back who plays for Valtti 1946 and has also spent many years ' +
      'in midfield. He has several seasons in the national championship league ' +
      '(SM-sarja) behind him, along with the experience and know-how of what ' +
      'continuous development takes.', 'kalle-sundman');
    fill.run(
      "Aarni plays for EPS's men's first team in Ykkönen, the men's First Division. " +
      'A young centre-back, he has previously also played in midfield in Honka\'s ' +
      'BSM and P15 academy.', 'aarni-kanerva');
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('bios_en_backfill_v2', ?)").run(nowISO());
  }

  // One-time spotlight re-shuffle: every coach EXCEPT Ben and Kalle appears in
  // the homepage hero carousel. Marker-guarded so the admin's later manual
  // featured-flag choices (in Manage coach) are never overridden on restart.
  if (!db.prepare("SELECT 1 FROM meta WHERE key = 'spotlight_v1'").get()) {
    db.prepare("UPDATE coaches SET featured = 0 WHERE slug IN ('ben-cotton','kalle-sundman')").run();
    db.prepare("UPDATE coaches SET featured = 1 WHERE slug NOT IN ('ben-cotton','kalle-sundman')").run();
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('spotlight_v1', ?)").run(nowISO());
  }

  // One-time: give coaches without reviews a set of sample reviews — but ONLY
  // in demo/dev environments. A production site (DEMO_DATA=0) must never grow
  // fabricated reviews. INTENTIONAL: the marker is set even when seeding is
  // skipped, so a production DB stays permanently settled — flipping DEMO_DATA
  // later can never retroactively inject fake reviews into a live business.
  if (!db.prepare("SELECT 1 FROM meta WHERE key = 'starter_reviews_v2'").get()) {
    if (process.env.DEMO_DATA !== '0') {
      const { helsinkiDateOffset } = require('../server/db');
      seedReviews(db, helsinkiDateOffset, Object.keys(REVIEWS_BY_SLUG));
    }
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('starter_reviews_v2', ?)").run(nowISO());
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
    (user_id, name, slug, bio, bio_en, photos, locations, positions, featured, display_order, demo, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const getCoach = db.prepare('SELECT id FROM coaches WHERE slug = ?');

  // --- Core accounts -------------------------------------------------------
  // Initial passwords come from env vars (ADMIN_PASSWORD / COACH_PASSWORD), set
  // in .env locally or in the host environment in production. NO password is
  // hardcoded in the source; if an env var is missing on a fresh seed a strong
  // random one is generated and printed to the log once. The DB only ever stores
  // a bcrypt hash, and any account can be rotated later via the admin UI or
  // /api/auth/change-password.
  if (userCount === 0) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    insUser.run(adminEmail, bcrypt.hashSync(initialPassword('ADMIN_PASSWORD', `admin (${adminEmail})`), 10),
      'Benjamin Cotton', 'admin', 0, now);

    // Kalle is both an admin and a coach: admin role + a linked coach profile.
    const kalleEmail = (process.env.COACH_EMAIL || 'coach@example.com').toLowerCase();
    insUser.run(kalleEmail, bcrypt.hashSync(initialPassword('COACH_PASSWORD', `Kalle (${kalleEmail})`), 10),
      'Kalle Sundman', 'admin', 0, now);
    const kalleId = getUser.get(kalleEmail).id;
    insCoach.run(kalleId, 'Kalle Sundman', 'kalle-sundman',
      'Kalle on 17 vuotias laitapuolustaja, joka on pelannut myös monia vuosia keskikentällä. ' +
      'Kallella on alla monia kausia SM sarjassa ja hänellä on kokemusta ja tietoa siitä mitä ' +
      'jatkuvaan kehitykseen tarvitaan.',
      BIO_I18N.find(b => b.slug === 'kalle-sundman').en,
      JSON.stringify(['/assets/kalle-1.jpg', '/assets/kalle-2.jpg', '/assets/kalle-3.jpg']),
      JSON.stringify(['Helsinki', 'Espoo']),
      JSON.stringify(['midfielders', 'attackers']),
      0, 20, 0, now); // featured=0: Ben & Kalle stay out of the hero spotlight

    // Ben — first face of the site. His coach profile lives on the owner's
    // own (admin) account, so one login covers both roles.
    const benId = getUser.get(adminEmail).id;
    insCoach.run(benId, 'Ben Cotton', 'ben-cotton',
      BIO_I18N.find(b => b.slug === 'ben-cotton').fi,
      BIO_I18N.find(b => b.slug === 'ben-cotton').en,
      JSON.stringify(['/assets/ben-1.jpg', '/assets/ben-2.jpg']),
      JSON.stringify(['Helsinki', 'Espoo', 'Vantaa']),
      JSON.stringify(['attackers', 'defenders']),
      0, 10, 0, now); // featured=0: Ben & Kalle stay out of the hero spotlight
  }

  // Post-launch coaches (e.g. Otto Ukkonen). migrate() handles existing DBs;
  // this covers a fresh seed, where migrate() did not run above.
  ensureExtraCoaches(db, now);

  // A FRESH database must also run migrate() once now that the core rows
  // exist: it sets the one-time markers (spotlight_v1, starter_reviews_v2).
  // Without this, the first restart would treat the markers as pending and
  // re-shuffle featured flags the admin may have changed in between. Every
  // step inside migrate() is idempotent, so running it here is safe.
  if (userCount === 0) migrate(db, nowISO);

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
    // Demo bios are written in English above (matching BIO_I18N sources);
    // store the Finnish translation as canonical + English as bio_en.
    const b = BIO_I18N.find(x => x.slug === c.slug);
    insCoach.run(null, c.name, c.slug, b ? b.fi : c.bio, b ? b.en : '', JSON.stringify([c.photo]),
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

  // Sample reviews for every coach (real + fictional) so the cards look alive.
  seedReviews(db, helsinkiDateOffset, Object.keys(REVIEWS_BY_SLUG));
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('starter_reviews_v2', ?)").run(now);

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_seeded', ?)").run(now);
  return { seeded: true, demo: true };
}

function removeDemoData() {
  const { db } = require('../server/db');
  db.exec(`
    DELETE FROM invoices WHERE booking_id IN (SELECT id FROM bookings WHERE demo = 1);
    DELETE FROM credits WHERE demo = 1 OR customer_id IN (SELECT id FROM users WHERE demo = 1);
    DELETE FROM notifications WHERE demo = 1 OR user_id IN (SELECT id FROM users WHERE demo = 1);
    DELETE FROM reviews WHERE demo = 1 OR customer_id IN (SELECT id FROM users WHERE demo = 1) OR coach_id IN (SELECT id FROM coaches WHERE demo = 1);
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
  // still brings the demo environment back on purpose. The 'starter_reviews_v2'
  // marker is likewise left in place on purpose, so the sample reviews the admin
  // just cleared don't reappear on the next boot.
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
