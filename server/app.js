// Proballers Coaching Finland — application entrypoint.
//   npm start          -> serves the site on PORT (default 3000)
// First run auto-seeds the core logins (+ demo data unless DEMO_DATA=0).
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { db, DATA_DIR, helsinkiNow, nowISO } = require('./db');
const { sessionMiddleware, parseCookies } = require('./auth');
const sheets = require('./sheets');

// Seed on first run so a fresh deployment works out of the box.
require('../scripts/seed').seed({ demo: process.env.DEMO_DATA !== '0' });

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Render/Fly/nginx
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; font-src 'self'; connect-src 'self'",
  });
  next();
});

// Identify the user (from the session cookie) BEFORE parsing the body, so the
// large-body allowance below can be limited to authenticated admins.
app.use(sessionMiddleware);

// Stripe webhook needs the RAW request body for signature verification, so it
// mounts before the JSON parsers below.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }),
  require('./stripe').webhookHandler);

// Most requests carry tiny JSON; only an ADMIN creating/updating a coach carries
// base64 photos, so only those get the larger limit (images are downscaled
// client-side first). Everyone else — including anonymous callers hitting the
// same path — is capped at 64kb, so the big limit can't be used to exhaust memory.
const jsonSmall = express.json({ limit: '64kb' });
const jsonLarge = express.json({ limit: '12mb' });
app.use((req, res, next) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const needsLarge = isAdmin && req.method !== 'GET' && /^\/api\/admin\/coaches(\/\d+)?$/.test(req.path);
  return (needsLarge ? jsonLarge : jsonSmall)(req, res, next);
});

// ---------------------------------------------------------------------------
// Visitor tracking: anonymous cookie + one row per page view. Only public
// acquisition pages are counted (not dashboards/login), and admin/coach traffic
// is excluded, so the dashboard reflects real (potential) customers.
// ---------------------------------------------------------------------------
const ACQUISITION_PAGES = new Set(['/', '/index.html']);
const BOT_UA = /bot|crawl|spider|slurp|monitor|curl|wget|python-requests|headless|preview|facebookexternalhit|uptime/i;
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  let vid = cookies.pbf_vid;
  const hadCookie = vid && /^[a-f0-9]{24}$/.test(vid);
  if (!hadCookie) {
    vid = crypto.randomBytes(12).toString('hex');
    res.append('Set-Cookie', `pbf_vid=${vid}; Path=/; SameSite=Lax; Max-Age=${365 * 86400}` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  }
  req.visitorId = vid;

  const ua = req.headers['user-agent'] || '';
  if (req.method === 'GET' && ACQUISITION_PAGES.has(req.path) && !BOT_UA.test(ua)
      && !(req.user && (req.user.role === 'admin' || req.user.role === 'coach'))) {
    const { date } = helsinkiNow();
    // A real browser's FIRST view is logged under its freshly minted cookie id
    // — that view carries the campaign's utm/referrer, and first-touch source
    // attribution must find it under the same id later requests use. (It also
    // stops first-time humans counting as two uniques: hash id + cookie id.)
    // Only UA-less scripts (which never keep cookies) still get the stable
    // IP+day hash, so their repeated hits collapse to one unique instead of
    // minting a fresh id per request.
    const countId = hadCookie || ua ? vid
      : 'h' + crypto.createHash('sha256').update(`${req.ip}|${ua}|${date}`).digest('hex').slice(0, 23);
    db.prepare('INSERT INTO visits (visitor_id, path, day, ts, source) VALUES (?,?,?,?,?)')
      .run(countId, req.path, date, nowISO(), require('./attribution').requestSource(req));
  }
  next();
});

app.use('/api', require('./routes/api'));

// Admin-uploaded coach photos, served from the persistent data disk. Uploads
// get a unique random filename each time, so they are safe to cache for long.
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d' }));

// Static assets + the pages (kept as clean paths). Code files (html/js/css)
// use no-cache: the browser keeps a copy but revalidates on every load (a cheap
// 304 when unchanged), so a deploy is visible immediately instead of visitors
// running up to an hour of stale JS. Heavy rarely-changing assets cache 7 days.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control',
      /\.(html|js|css)$/.test(filePath) ? 'no-cache' : 'public, max-age=604800');
  },
}));
// sendFile bypasses the static middleware's setHeaders, so set the same
// no-cache policy here — pages must revalidate after every deploy.
const page = (file) => (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, file));
};
app.get('/login', page('login.html'));
app.get('/coach', page('coach.html'));
app.get('/app', page('app.html'));   // mobile coach app (coach/admin-gated client-side)
app.get('/chats', page('chats.html'));
app.get('/admin', page('admin.html'));
app.get('/my-bookings', page('my-bookings.html'));
// Public coach profile pages, e.g. /coaches/otto-ukkonen (the client script
// resolves the slug; an unknown slug renders its own not-found state).
app.get('/coaches/:slug', page('coach-profile.html'));

app.use((req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Central error handler — never leak stack traces to visitors.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Oversized / malformed request bodies are the caller's fault, not a server
  // fault — answer 413/400 rather than a generic 500.
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// Hourly Google Sheets sync when configured (plus debounced sync after writes).
if (sheets.configured()) {
  sheets.syncAll().catch(e => console.error('[sheets]', e.message));
  setInterval(() => sheets.syncAll().catch(e => console.error('[sheets]', e.message)), 3600000);
}

// Scheduled customer emails (review request the day after a session, book-again
// nudge 3 days after — both at 12:00 Helsinki). Checked every 5 minutes; each
// email is one-shot flagged, so the sweep is idempotent. The admin dashboard
// has a "send due emails now" button that runs the same sweep on demand.
const runEmails = () => {
  try { require('./emails').runEmailAutomation(); }
  catch (e) { console.error('[emails]', e.message); }
};
setTimeout(runEmails, 15000); // shortly after boot (catches up if the host slept over noon)
setInterval(runEmails, 5 * 60000);

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`${config.siteName} running on http://localhost:${PORT}`);
  console.log(`Google Sheets sync: ${sheets.configured() ? 'ON' : 'not configured (see README)'}`);
});
