// Daily brief — the day's key numbers for the owner, as JSON (for the scheduled
// dashboard) or HTML (for the evening email). READ-ONLY: it never changes any
// operational state. Served at GET /api/brief, gated by the BRIEF_TOKEN env var
// (the endpoint is off entirely when the token isn't set), so a scheduler can
// fetch it without a login.
'use strict';

const { db, helsinkiNow, helsinkiDateOffset } = require('./db');
const config = require('../config');
const { sendMail } = require('./mailer');

const eur = (cents) => (cents / 100).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The day's numbers. "Today" is the Helsinki calendar day (the business runs on
// Helsinki time regardless of when/where the brief is read).
function buildBrief() {
  const today = helsinkiNow().date;
  const monthStart = today.slice(0, 7) + '-01';
  const weekEnd = helsinkiDateOffset(7);
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  const sessionsToday = db.prepare(`
    SELECT b.code, b.hour, b.location, b.status, c.name AS coach, u.name AS customer
    FROM bookings b JOIN coaches c ON c.id = b.coach_id JOIN users u ON u.id = b.customer_id
    WHERE b.demo = 0 AND b.date = ? AND b.status != 'cancelled' ORDER BY b.hour, b.id`).all(today);

  const groupsToday = db.prepare(`
    SELECT g.code, g.hour, g.location, g.capacity, c.name AS coach,
      (SELECT COUNT(*) FROM group_signups s WHERE s.group_session_id = g.id AND s.status = 'confirmed') AS players
    FROM group_sessions g JOIN coaches c ON c.id = g.coach_id
    WHERE g.demo = 0 AND g.date = ? AND g.status != 'cancelled' ORDER BY g.hour, g.id`).all(today);

  const revToday = one("SELECT COALESCE(SUM(total_cents),0) c FROM bookings WHERE demo=0 AND status='completed' AND date=?", today).c;
  const revMonth = one("SELECT COALESCE(SUM(total_cents),0) c FROM bookings WHERE demo=0 AND status='completed' AND date>=? AND date<=?", monthStart, today).c;
  const completedMonth = one("SELECT COUNT(*) n FROM bookings WHERE demo=0 AND status='completed' AND date>=? AND date<=?", monthStart, today).n;

  const upcoming = one("SELECT COUNT(*) n FROM bookings WHERE demo=0 AND status='confirmed' AND date>? AND date<=?", today, weekEnd).n;
  const upcomingGroups = one("SELECT COUNT(*) n FROM group_sessions WHERE demo=0 AND status='open' AND date>? AND date<=?", today, weekEnd).n;

  // New today via the events table, whose `day` is the Helsinki date (accurate
  // right up to Helsinki midnight, unlike a UTC created_at).
  const newCustomers = one("SELECT COUNT(*) n FROM events WHERE type='signup' AND day=? AND demo=0", today).n;
  const newLeads = one("SELECT COUNT(*) n FROM events WHERE type='contact_request' AND day=? AND demo=0", today).n;
  const openLeads = one("SELECT COUNT(*) n FROM contact_requests WHERE handled_at IS NULL").n;

  const unpaid = one("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) c FROM invoices WHERE status='sent'");
  const atSession = one("SELECT COUNT(*) n FROM invoices WHERE status='sent' AND at_session=1").n;
  const lowPackages = one(`SELECT COUNT(*) n FROM packages p WHERE p.demo=0 AND p.status='active'
    AND (p.sessions_total + p.adjust_sessions
         - (SELECT COUNT(*) FROM bookings b WHERE b.package_id=p.id AND b.status!='cancelled')) = 1`).n;

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    today: {
      sessions: sessionsToday.map((s) => ({ time: hhmm(s.hour), coach: s.coach, customer: s.customer, location: s.location, code: s.code, status: s.status })),
      groups: groupsToday.map((g) => ({ time: hhmm(g.hour), coach: g.coach, location: g.location, players: g.players, capacity: g.capacity, code: g.code })),
      revenueCents: revToday, newCustomers, newLeads,
    },
    month: { revenueCents: revMonth, sessionsCompleted: completedMonth },
    upcoming7: { sessions: upcoming, groups: upcomingGroups },
    attention: { unpaidInvoices: unpaid.n, unpaidCents: unpaid.c, atSessionUnpaid: atSession, openLeads, lowPackages },
  };
}

// Self-contained, inline-styled HTML (renders in an email client and a browser).
function renderBriefHTML(b) {
  const card = (label, value, sub) => `<td style="padding:6px">
    <div style="background:#f4f7f2;border-radius:10px;padding:12px 14px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">${esc(label)}</div>
      <div style="font-size:22px;font-weight:700;color:#14321e">${esc(value)}</div>
      ${sub ? `<div style="font-size:12px;color:#6b7280">${esc(sub)}</div>` : ''}
    </div></td>`;
  const sessionRows = b.today.sessions.length
    ? b.today.sessions.map((s) => `<tr><td style="padding:4px 10px">${esc(s.time)}</td><td style="padding:4px 10px">${esc(s.coach)}</td>
        <td style="padding:4px 10px">${esc(s.customer)}</td><td style="padding:4px 10px;color:#6b7280">${esc(s.location)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="padding:8px 10px;color:#6b7280">Ei 1-on-1-treenejä tänään.</td></tr>';
  const groupRows = b.today.groups.map((g) => `<tr><td style="padding:4px 10px">${esc(g.time)}</td><td style="padding:4px 10px">${esc(g.coach)}</td>
        <td style="padding:4px 10px">${esc(g.location)}</td><td style="padding:4px 10px;color:#6b7280">${g.players}/${g.capacity} pelaajaa</td></tr>`).join('');
  const attn = [];
  if (b.attention.unpaidInvoices) attn.push(`${b.attention.unpaidInvoices} maksamatonta laskua (${eur(b.attention.unpaidCents)})${b.attention.atSessionUnpaid ? `, joista ${b.attention.atSessionUnpaid} maksetaan treenillä` : ''}`);
  if (b.attention.openLeads) attn.push(`${b.attention.openLeads} avointa liidiä / yhteydenottoa`);
  if (b.attention.lowPackages) attn.push(`${b.attention.lowPackages} pakettia, joissa 1 treeni jäljellä`);

  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Päivän kooste ${esc(b.date)}</title></head>
<body style="margin:0;background:#eef2ec;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#14321e">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;margin:0 0 2px">Proballers Coaching — päivän kooste</h1>
    <p style="margin:0 0 18px;color:#6b7280;font-size:13px">${esc(b.date)}</p>
    <table style="width:100%;border-collapse:collapse"><tr>
      ${card('Tänään treenejä', String(b.today.sessions.length + b.today.groups.length))}
      ${card('Liikevaihto tänään', eur(b.today.revenueCents))}
    </tr><tr>
      ${card('Kuukausi (kk)', eur(b.month.revenueCents), `${b.month.sessionsCompleted} pidettyä treeniä`)}
      ${card('Uudet tänään', `${b.today.newCustomers} asiakasta`, `${b.today.newLeads} liidiä`)}
    </tr></table>

    <h2 style="font-size:15px;margin:22px 0 6px">Tänään</h2>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:14px">
      ${sessionRows}${groupRows}
    </table>

    <h2 style="font-size:15px;margin:22px 0 6px">Seuraavat 7 päivää</h2>
    <p style="margin:0;font-size:14px">${b.upcoming7.sessions} varattua 1-on-1-treeniä · ${b.upcoming7.groups} avointa ryhmätreeniä</p>

    ${attn.length ? `<h2 style="font-size:15px;margin:22px 0 6px">Huomioitavaa</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px">${attn.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}

    <p style="margin:24px 0 0;color:#9aa4a0;font-size:11px">Automaattinen kooste · ${esc(config.siteUrl)}</p>
  </div>
</body></html>`;
}

// Build + render + email the brief to every admin. Returns { recipients }.
async function sendBriefEmail() {
  const b = buildBrief();
  const html = renderBriefHTML(b);
  const to = [...new Set(db.prepare("SELECT email FROM users WHERE role='admin' AND demo=0").all().map((a) => a.email))];
  const subject = `Proballers — päivän kooste ${b.date}`;
  for (const email of to) {
    try { await sendMail({ to: email, subject, html, log: { type: 'brief' } }); }
    catch (e) { console.error('[brief] send to', email, e.message); }
  }
  return { recipients: to.length };
}

// ---- Daily brief email scheduler -------------------------------------------
// The app is always-on (Render web service), so it emails the brief itself at
// 20:30 Europe/London — no external cron needed (a scheduled cloud agent can't
// reach the site). Europe/London here is DST-aware, so it stays 20:30 local
// through BST and GMT. Restart-safe with no double-send: the meta key
// 'brief_last_sent' records the London date the brief last went out.
const BRIEF_TZ = 'Europe/London';
const BRIEF_MINUTE = 20 * 60 + 30; // 20:30 local

function localNow(tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour === '24' ? 0 : p.hour) * 60 + Number(p.minute) };
}

let schedulerStarted = false;
function startDailyBrief() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = () => {
    try {
      const { date, minutes } = localNow(BRIEF_TZ);
      if (minutes < BRIEF_MINUTE) return;                 // not yet 20:30 London
      const last = db.prepare("SELECT value FROM meta WHERE key = 'brief_last_sent'").get();
      if (last && last.value === date) return;            // already sent for this London day
      // Mark first, then send: a slow send can't be double-fired by the next tick.
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('brief_last_sent', ?)").run(date);
      sendBriefEmail().catch((e) => console.error('[brief] daily send:', e.message));
    } catch (e) { console.error('[brief] scheduler:', e.message); }
  };
  const iv = setInterval(tick, 5 * 60 * 1000);
  if (iv.unref) iv.unref();
  tick(); // also check just after boot (covers a restart shortly after 20:30)
}

module.exports = { buildBrief, renderBriefHTML, sendBriefEmail, startDailyBrief };
