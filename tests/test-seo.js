// E2E checks for the search-engine surface (server/seo.js). Scratch server on
// :3464 with a fixed SITE_URL, so canonical/sitemap URLs are assertable.
//
// The point of these: the <head> signals are invisible in the browser and
// nobody notices when they break. A crawler does.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PROJECT = path.join(__dirname, '..');
const PORT = 3464;
const BASE = `http://localhost:${PORT}`;
const SITE = 'https://proballerscoaching.com';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pbf-seo-'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
}

const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() };
};

(async function main() {
  const server = spawn(process.execPath, ['server/app.js'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, DEMO_DATA: '1', SMTP_HOST: '',
      SITE_URL: SITE,
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
    // Generous on purpose: this is one of only two suites that seed DEMO_DATA,
    // and the demo seed bcrypt-hashes a password for every demo account — ~50 s
    // on a laptop against ~5 s for the plain seed every other suite uses. The
    // old 15 s window was shorter than the seed itself, so the suite failed
    // with an empty log and looked like a boot crash.
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { if ((await fetch(BASE + '/robots.txt')).ok) { up = true; break; } } catch { /* boot */ }
    }
    check('server boots', up, log.slice(-400));
    if (!up) throw new Error('no boot');

    // --- robots.txt ----------------------------------------------------------
    let r = await get('/robots.txt');
    check('robots.txt served as text/plain', r.status === 200 && r.type.includes('text/plain'), r.type);
    check('robots.txt points at the sitemap', r.body.includes(`Sitemap: ${SITE}/sitemap.xml`));
    for (const priv of ['/admin', '/my-bookings', '/chats', '/api/']) {
      check(`robots.txt disallows ${priv}`, r.body.includes(`Disallow: ${priv}`));
    }
    check('robots.txt allows coach profiles', r.body.includes('Allow: /coaches/'));

    // --- sitemap.xml ---------------------------------------------------------
    r = await get('/sitemap.xml');
    check('sitemap served as XML', r.status === 200 && r.type.includes('xml'), r.type);
    check('sitemap lists the homepage', r.body.includes(`<loc>${SITE}/</loc>`));
    const locs = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    check('sitemap lists every active coach in both languages',
      locs.filter((l) => l.includes('/coaches/')).length >= 8, locs.length);
    check('sitemap lists the English homepage', locs.includes(`${SITE}/en`), locs.slice(0, 4));
    check('sitemap declares hreflang alternates',
      r.body.includes('xmlns:xhtml=') && r.body.includes('hreflang="x-default"'));
    check('sitemap URLs are absolute', locs.every((l) => l.startsWith(SITE)), locs[0]);
    // A deactivated coach must drop out — the sitemap is built from live data.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(DATA_DIR, 'proballers.db'));
    const victim = db.prepare('SELECT slug FROM coaches WHERE active = 1 ORDER BY id LIMIT 1').get();
    db.prepare('UPDATE coaches SET active = 0 WHERE slug = ?').run(victim.slug);
    r = await get('/sitemap.xml');
    check('a deactivated coach leaves the sitemap', !r.body.includes(`/coaches/${victim.slug}<`), victim.slug);
    db.prepare('UPDATE coaches SET active = 1 WHERE slug = ?').run(victim.slug);

    // --- homepage ------------------------------------------------------------
    r = await get('/');
    check('homepage 200s', r.status === 200, r.status);
    check('homepage canonical is absolute', r.body.includes(`<link rel="canonical" href="${SITE}/">`));
    check('homepage is indexable', /name="robots" content="index, follow/.test(r.body));
    check('homepage has an OG image (absolute)', /property="og:image" content="https:\/\//.test(r.body));
    check('homepage has a twitter card', r.body.includes('name="twitter:card"'));
    check('homepage keeps its i18n hook so EN still switches',
      /<title data-i18n="landing.title">/.test(r.body));

    const homeLd = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s
      .exec(r.body)[1].replace(/\\u003c/g, '<'));
    check('homepage JSON-LD is a SportsActivityLocation', homeLd['@type'] === 'SportsActivityLocation', homeLd['@type']);
    check('JSON-LD lists every city we serve',
      homeLd.areaServed.map((a) => a.name).join(',') === require('../config').locations.join(','),
      homeLd.areaServed);
    check('JSON-LD carries the live session price',
      homeLd.makesOffer.some((o) => o.price === String(require('../config').pricing.sessionPrice)),
      homeLd.makesOffer);

    // --- coach profiles ------------------------------------------------------
    const slugs = db.prepare('SELECT slug, name FROM coaches WHERE active = 1 ORDER BY id LIMIT 3').all();
    const titles = new Set();
    for (const c of slugs) {
      const p = await get(`/coaches/${c.slug}`);
      const title = /<title[^>]*>([^<]*)<\/title>/.exec(p.body)[1];
      titles.add(title);
      check(`${c.slug}: title names the coach`, title.includes(c.name), title);
      check(`${c.slug}: canonical is its own URL`,
        p.body.includes(`<link rel="canonical" href="${SITE}/coaches/${c.slug}">`));
      const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s
        .exec(p.body)[1].replace(/\\u003c/g, '<'));
      check(`${c.slug}: Person markup with the right name`,
        ld['@type'] === 'Person' && ld.name === c.name, ld.name);
      check(`${c.slug}: no i18n hook that could clobber the title`,
        !/<title[^>]+data-i18n/.test(p.body));
    }
    // The whole point: these pages used to share ONE generic title.
    check('every coach page has a DISTINCT title', titles.size === slugs.length, [...titles]);

    r = await get('/coaches/no-such-coach');
    check('unknown coach slug is noindexed', r.body.includes('content="noindex, nofollow"'));
    check('unknown coach slug has no canonical', !r.body.includes('rel="canonical"'));

    // --- English mirror ------------------------------------------------------
    // The whole reason /en exists: a crawler never clicks a language toggle, so
    // a single URL could only ever be indexed as Finnish.
    const fi = await get('/');
    const en = await get('/en');
    check('/en 200s', en.status === 200, en.status);
    check('/en declares itself English', /<html lang="en"/.test(en.body));
    check('/ stays Finnish', /<html lang="fi"/.test(fi.body));
    const enTitle = /<title[^>]*>([^<]*)<\/title>/.exec(en.body)[1];
    const fiTitle = /<title[^>]*>([^<]*)<\/title>/.exec(fi.body)[1];
    check('the two homepages have different titles', enTitle !== fiTitle, [fiTitle, enTitle]);
    check('/en title is actually in English', /football coaching/i.test(enTitle), enTitle);
    check('/en canonicalises to itself', en.body.includes(`<link rel="canonical" href="${SITE}/en">`));
    check('/en og:locale is English', en.body.includes('content="en_GB"'));

    // hreflang has to be reciprocal or Google discards the whole cluster.
    for (const [label, page] of [['fi', fi], ['en', en]]) {
      check(`${label} homepage points at the Finnish version`,
        page.body.includes(`hreflang="fi" href="${SITE}/"`));
      check(`${label} homepage points at the English version`,
        page.body.includes(`hreflang="en" href="${SITE}/en"`));
      check(`${label} homepage declares x-default`,
        page.body.includes(`hreflang="x-default" href="${SITE}/"`));
    }

    const enCoach = await get(`/en/coaches/${slugs[0].slug}`);
    check('English coach page 200s', enCoach.status === 200, enCoach.status);
    check('English coach page canonicalises under /en',
      enCoach.body.includes(`<link rel="canonical" href="${SITE}/en/coaches/${slugs[0].slug}">`));
    check('English coach title is in English',
      /football coach/i.test(/<title[^>]*>([^<]*)<\/title>/.exec(enCoach.body)[1]));
    const enLd = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s
      .exec(enCoach.body)[1].replace(/\\u003c/g, '<'));
    check('English JSON-LD uses the English job title',
      enLd.jobTitle === 'Football coach', enLd.jobTitle);

    // An English page must not link back into the Finnish site, or it reads as
    // a dead end to a crawler and silently switches language for a reader.
    const enHrefs = [...en.body.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
    const leaked = enHrefs.filter((h) => !/^\/en(\/|#|$)/.test(h)
      && !/^\/(assets|js|styles|api|uploads)/.test(h));
    check('no English page link falls back to a Finnish URL', leaked.length === 0, leaked);
    check('English assets are NOT rewritten under /en',
      enHrefs.some((h) => h === '/styles.css'), enHrefs);
    // Finnish must be untouched by all of the above.
    const fiHrefs = [...fi.body.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
    check('Finnish page keeps its bare links', fiHrefs.includes('/'), fiHrefs);

    // --- private pages -------------------------------------------------------
    for (const p of ['/admin', '/my-bookings', '/chats', '/coach', '/app', '/login']) {
      const priv = await get(p);
      check(`${p} is noindexed`, priv.body.includes('content="noindex, nofollow"'), priv.status);
      check(`${p} has no canonical`, !priv.body.includes('rel="canonical"'));
    }

    // --- the pages still actually work ---------------------------------------
    r = await get('/');
    check('homepage still ships its scripts', r.body.includes('/js/landing.js'));
    r = await get('/admin');
    check('admin page still ships its scripts', r.body.includes('/js/admin.js'));
    r = await get('/index.html');
    check('direct /index.html still serves (static untouched)', r.status === 200, r.status);
    r = await get('/styles.css');
    check('static assets still serve', r.status === 200 && r.type.includes('css'), r.type);
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
