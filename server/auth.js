// Session + role middleware. Sessions are random tokens in an httpOnly cookie,
// stored in SQLite so they survive server restarts.
const crypto = require('node:crypto');
const { db, nowISO } = require('./db');

const SESSION_COOKIE = 'pbf_session';
const SESSION_DAYS = 30;

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, nowISO(), expires.toISOString());
  res.append('Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  return token;
}

function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// "Last live on the site" tracking: the middleware below runs on EVERY request
// (including static assets and polling), so we stamp users.last_seen_at at most
// once every few minutes per account via this in-memory throttle — the same
// pattern as loginThrottle. A DB write on every request would be pure waste.
const lastSeenWrite = new Map();               // userId -> ms of last stamp
const LAST_SEEN_THROTTLE_MS = 5 * 60000;
function markSeen(userId) {
  const nowMs = Date.now();
  if (nowMs - (lastSeenWrite.get(userId) || 0) < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWrite.set(userId, nowMs);
  if (lastSeenWrite.size > 10000) lastSeenWrite.clear();   // crude memory bound
  // Non-critical + on the hot path: never let it break a request.
  try { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowISO(), userId); }
  catch { /* ignore */ }
}

// Attaches req.user = {id,email,name,role} (or null) and req.sessionToken to
// every request.
function sessionMiddleware(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.email, u.name, u.role FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(token, nowISO());
    if (row) { req.user = row; req.sessionToken = token; markSeen(row.id); }
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed.' });
    next();
  };
}

// Basic in-memory login throttle: 10 attempts per 15 minutes per IP+email.
const attempts = new Map();
function loginThrottle(req, res, next) {
  const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, resetAt: now + 15 * 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60000; }
  if (entry.count >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  entry.count++;
  attempts.set(key, entry);
  if (attempts.size > 5000) attempts.clear(); // crude memory bound
  next();
}

module.exports = {
  parseCookies, createSession, destroySession,
  sessionMiddleware, requireRole, loginThrottle,
};
