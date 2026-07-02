// Proballers Coaching Finland — application entrypoint.
//   npm start          -> serves the site on PORT (default 3000)
// First run auto-seeds the core logins (+ demo data unless DEMO_DATA=0).
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { db, helsinkiNow, nowISO } = require('./db');
const { sessionMiddleware, parseCookies } = require('./auth');
const sheets = require('./sheets');

// Seed on first run so a fresh deployment works out of the box.
require('../scripts/seed').seed({ demo: process.env.DEMO_DATA !== '0' });

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Render/Fly/nginx
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

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

app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Visitor tracking: anonymous cookie + one row per page view. Admin and coach
// traffic is not counted, so the dashboard reflects real (potential) customers.
// ---------------------------------------------------------------------------
const PAGES = new Set(['/', '/index.html', '/login', '/coach', '/admin', '/my-bookings']);
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  let vid = cookies.pbf_vid;
  if (!vid || !/^[a-f0-9]{24}$/.test(vid)) {
    vid = crypto.randomBytes(12).toString('hex');
    res.append('Set-Cookie', `pbf_vid=${vid}; Path=/; SameSite=Lax; Max-Age=${365 * 86400}` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  }
  req.visitorId = vid;
  if (req.method === 'GET' && PAGES.has(req.path)
      && !(req.user && (req.user.role === 'admin' || req.user.role === 'coach'))) {
    const { date } = helsinkiNow();
    db.prepare('INSERT INTO visits (visitor_id, path, day, ts) VALUES (?,?,?,?)')
      .run(vid, req.path, date, nowISO());
  }
  next();
});

app.use('/api', require('./routes/api'));

// Static assets + the four pages (kept as clean paths).
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', extensions: ['html'] }));
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/login', page('login.html'));
app.get('/coach', page('coach.html'));
app.get('/admin', page('admin.html'));
app.get('/my-bookings', page('my-bookings.html'));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

// Central error handler — never leak stack traces to visitors.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// Hourly Google Sheets sync when configured (plus debounced sync after writes).
if (sheets.configured()) {
  sheets.syncAll().catch(e => console.error('[sheets]', e.message));
  setInterval(() => sheets.syncAll().catch(e => console.error('[sheets]', e.message)), 3600000);
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`${config.siteName} running on http://localhost:${PORT}`);
  console.log(`Google Sheets sync: ${sheets.configured() ? 'ON' : 'not configured (see README)'}`);
});
