// Proballers coach app (/app) — a mobile-first overview for coaches.
// Single-page, hash-routed (#home #sessions #calendar #alerts #profile).
// Reads the SAME live data as the main site via the existing /coach/* and
// /my-notifications API — a coach signs in with their normal account.
'use strict';

const S = {
  me: null,          // /api/me
  coach: null,       // /api/coach/me
  bookings: [],      // /api/coach/bookings
  tier: null,        // /api/coach/tier
  notifs: [],        // /api/my-notifications
  unread: 0,
  cal: { y: null, m: null, selDate: null }, // calendar view state
};

const view = () => document.getElementById('view');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const initialOf = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();

// Local-time check (coach is in Finland ≈ Europe/Helsinki); the server is the
// real authority, this only decides whether to OFFER the "mark completed" action.
function hasEnded(b) {
  const end = new Date(`${b.date}T${String(b.hour + 1).padStart(2, '0')}:00:00`);
  return Date.now() >= end.getTime();
}
function fmtTime(hour) {
  const sep = I18N.lang === 'fi' ? '.' : ':';
  return `${String(hour).padStart(2, '0')}${sep}00`;
}
// A booking's session line: focus · position · place (all localized).
function sessionWhat(b) {
  const place = b.is_online ? t('app.session.online') : esc(I18N.server(b.location));
  return `${esc(I18N.server(b.focus))} <span class="dot">·</span> ${esc(posLabel(b.position))} <span class="dot">·</span> ${place}`;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAll() {
  const [coach, bookings, tier, notifData] = await Promise.all([
    API.get('/coach/me'),
    API.get('/coach/bookings'),
    API.get('/coach/tier').catch(() => null),
    API.get('/my-notifications').catch(() => ({ notifications: [] })),
  ]);
  S.coach = coach;
  S.bookings = bookings || [];
  S.tier = tier;
  S.notifs = notifData.notifications || [];
  S.unread = S.notifs.filter((n) => !n.read).length;
  paintBadge();
}

function paintBadge() {
  const b = document.getElementById('alert-badge');
  if (!b) return;
  b.textContent = S.unread > 9 ? '9+' : String(S.unread);
  b.hidden = S.unread === 0;
}

const byStatus = (st) => S.bookings.filter((b) => b.status === st);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const ROUTES = { home: renderHome, sessions: renderSessions, calendar: renderCalendar, alerts: renderAlerts, profile: renderProfile };

function currentTab() {
  const h = (location.hash || '#home').slice(1);
  return ROUTES[h] ? h : 'home';
}
function render() {
  const tab = currentTab();
  document.querySelectorAll('.tab').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  view().scrollTop = 0;
  ROUTES[tab]();
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function renderHome() {
  const upcoming = byStatus('confirmed').slice().sort((a, b) =>
    (a.date + a.hour).localeCompare(b.date + b.hour));
  const completed = byStatus('completed');
  const next = upcoming.slice(0, 5);
  view().innerHTML = `<div class="screen">
    <header class="app-head">
      <div class="app-kicker">${t('app.brand')}</div>
      <h1 class="app-h1">${t('app.greeting', { name: esc(firstName(S.coach.name)) })}</h1>
    </header>
    <div class="stat-grid">
      ${statTile('cal', upcoming.length, t('app.stat.upcoming'))}
      ${statTile('check', completed.length, t('app.stat.completed'), 'alt')}
    </div>
    <div class="app-section-label">${t('app.home.upcoming_title')}</div>
    ${next.length
      ? next.map((b) => sessionCard(b)).join('') +
        (upcoming.length > next.length ? `<button class="link-btn" data-goto="sessions" style="margin-top:4px">${t('app.home.seeall')}</button>` : '')
      : emptyState('cal', t('app.home.upcoming_empty'), t('app.home.upcoming_empty_sub'))}
  </div>`;
  wireSessionActions();
  view().querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => { location.hash = '#' + el.dataset.goto; }));
}

let sessTab = 'confirmed';
function renderSessions() {
  const map = { confirmed: 'app.stat.upcoming', completed: 'app.stat.completed', cancelled: 'app.stat.cancelled' };
  const list = byStatus(sessTab).slice();
  if (sessTab === 'confirmed') list.sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));
  view().innerHTML = `<div class="screen">
    <header class="app-head"><h1 class="app-h1">${t('app.sessions.title')}</h1></header>
    <div class="seg" id="sess-seg">
      ${['confirmed', 'completed', 'cancelled'].map((k) =>
        `<button data-st="${k}" class="${k === sessTab ? 'on' : ''}">${t(map[k])}</button>`).join('')}
    </div>
    <div id="sess-list">
      ${list.length ? list.map((b) => sessionCard(b)).join('') : emptyState('list', t('app.sessions.empty'))}
    </div>
  </div>`;
  view().querySelectorAll('#sess-seg button').forEach((btn) =>
    btn.addEventListener('click', () => { sessTab = btn.dataset.st; renderSessions(); }));
  wireSessionActions();
}

function renderCalendar() {
  const now = new Date();
  if (S.cal.y == null) { S.cal.y = now.getFullYear(); S.cal.m = now.getMonth(); }
  const { y, m } = S.cal;
  const monthName = new Date(y, m, 1).toLocaleDateString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB',
    { month: 'long', year: 'numeric' });
  // days (this month) that have a non-cancelled session
  const busy = new Set(S.bookings.filter((b) => b.status !== 'cancelled').map((b) => b.date));
  const wd = t('common.weekdays').split(','); // Sun-indexed
  const dow = [1, 2, 3, 4, 5, 6, 0]; // Monday-first header
  const todayISO = iso(now.getFullYear(), now.getMonth(), now.getDate());

  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first offset
  const days = new Date(y, m + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = iso(y, m, d);
    const cls = ['cal-cell'];
    if (ds === todayISO) cls.push('today');
    if (ds === S.cal.selDate) cls.push('sel');
    cells += `<div class="${cls.join(' ')}" data-date="${ds}">${d}${busy.has(ds) ? '<span class="cdot"></span>' : ''}</div>`;
  }

  const sel = S.cal.selDate;
  const daySess = sel ? S.bookings.filter((b) => b.date === sel && b.status !== 'cancelled')
    .sort((a, b) => a.hour - b.hour) : [];

  view().innerHTML = `<div class="screen">
    <div class="cal-head">
      <div class="cal-title">${cap(monthName)}</div>
      <div class="cal-nav"><button data-mv="-1" aria-label="prev">‹</button><button data-mv="1" aria-label="next">›</button></div>
    </div>
    <div class="cal-grid">
      ${dow.map((i) => `<div class="cal-dow">${esc(wd[i])}</div>`).join('')}
      ${cells}
    </div>
    ${sel ? `<div class="cal-daylabel">${esc(fmtDate(sel))} ${sel.slice(0, 4)}</div>
      ${daySess.length ? daySess.map((b) => sessionCard(b)).join('') : emptyState('cal', t('app.calendar.no_sessions'))}`
      : `<div class="empty" style="margin-top:22px"><div class="small">${t('app.calendar.legend')}</div></div>`}
  </div>`;
  view().querySelectorAll('[data-mv]').forEach((btn) => btn.addEventListener('click', () => {
    S.cal.m += Number(btn.dataset.mv);
    if (S.cal.m < 0) { S.cal.m = 11; S.cal.y--; }
    if (S.cal.m > 11) { S.cal.m = 0; S.cal.y++; }
    S.cal.selDate = null;
    renderCalendar();
  }));
  view().querySelectorAll('.cal-cell[data-date]').forEach((c) => c.addEventListener('click', () => {
    S.cal.selDate = S.cal.selDate === c.dataset.date ? null : c.dataset.date;
    renderCalendar();
  }));
  wireSessionActions();
}

async function renderAlerts() {
  view().innerHTML = `<div class="screen">
    <div class="alerts-head">
      <div>
        <h1 class="app-h1">${t('app.alerts.title')}</h1>
        ${S.unread ? `<div class="app-kicker" style="letter-spacing:.04em;margin-top:4px">${t('app.alerts.unread', { n: S.unread })}</div>` : ''}
      </div>
      ${S.unread ? `<button class="link-btn" id="mark-all">✓ ${t('app.alerts.markall')}</button>` : ''}
    </div>
    ${S.notifs.length
      ? S.notifs.map(alertCard).join('')
      : emptyState('bell', t('app.alerts.empty'))}
  </div>`;
  const mark = document.getElementById('mark-all');
  if (mark) mark.addEventListener('click', async () => {
    try {
      await API.post('/my-notifications/read', {});
      S.notifs = S.notifs.map((n) => ({ ...n, read: 1 }));
      S.unread = 0; paintBadge(); renderAlerts();
    } catch (e) { toast(I18N.server(e.message), true); }
  });
}

function renderProfile() {
  const c = S.coach;
  const counts = {
    up: byStatus('confirmed').length,
    done: byStatus('completed').length,
    canc: byStatus('cancelled').length,
  };
  const photo = (c.photos && c.photos[0]) || null;
  const tierBlock = S.tier ? `
    <div class="pf-block">
      <h4>${t('app.profile.tier_title')}</h4>
      <div class="pf-row"><span class="lab">${t('app.profile.tier', { n: S.tier.tierNumber })}</span>
        <span class="pf-tier-num">${eur(S.tier.earnPerSession.onPitchCents)}<span style="font-size:.72rem;color:var(--muted);font-family:var(--body)"> ${t('landing.persession')}</span></span></div>
      <div class="pf-row"><span class="lab">${t('app.profile.earned_month', { month: monthLabel(S.tier.month) })}</span>
        <span class="val">${eur(S.tier.earnedThisMonthCents)}</span></div>
    </div>` : '';

  view().innerHTML = `<div class="screen">
    <div class="pf-card">
      <div class="pf-avatar">${photo ? `<img src="${esc(photo)}" alt="">` : esc(initialOf(c.name))}</div>
      <div class="pf-name">${esc(c.name)}</div>
      <div class="pf-email">${esc(S.me.user.email)}</div>
    </div>

    <div class="pf-lang" id="pf-lang"></div>

    <div class="pf-block">
      <h4>${t('app.profile.stats')}</h4>
      <div class="pf-row"><span class="lab"><svg viewBox="0 0 24 24" stroke="var(--lime)"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>${t('app.stat.upcoming')}</span><span class="val">${counts.up}</span></div>
      <div class="pf-row"><span class="lab"><svg viewBox="0 0 24 24" stroke="var(--gold)"><path d="M20 6 9 17l-5-5"/></svg>${t('app.stat.completed')}</span><span class="val">${counts.done}</span></div>
      <div class="pf-row"><span class="lab"><svg viewBox="0 0 24 24" stroke="var(--danger)"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>${t('app.stat.cancelled')}</span><span class="val">${counts.canc}</span></div>
    </div>

    ${tierBlock}

    <a class="pf-link" href="/coach">${t('app.profile.manage')}
      <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    <a class="pf-link" href="/">${t('app.profile.website')}
      <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>
    <button class="pf-link pf-logout" id="pf-logout">
      <svg viewBox="0 0 24 24" stroke="var(--danger)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      ${t('app.profile.logout')}</button>
  </div>`;
  document.getElementById('pf-lang').appendChild(langToggleEl());
  document.getElementById('pf-logout').addEventListener('click', async () => {
    await API.post('/auth/logout', {});
    location.href = '/';
  });
}

// ---------------------------------------------------------------------------
// Reusable bits
// ---------------------------------------------------------------------------
function statTile(icon, num, cap, variant = '') {
  const ic = {
    cal: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  }[icon];
  return `<div class="stat-tile ${variant}">
    <div class="ic"><svg viewBox="0 0 24 24">${ic}</svg></div>
    <div class="stat-num">${num}</div>
    <div class="stat-cap">${cap}</div>
  </div>`;
}

function sessionCard(b) {
  const canCancel = b.status === 'confirmed';
  const canComplete = b.status === 'confirmed' && hasEnded(b);
  const earn = b.earn_cents != null
    ? `<div class="sess-earn ${b.earn_estimated ? 'est' : ''}">${t(b.earn_estimated ? 'app.session.earn_est' : 'app.session.earn', { amount: eur(b.earn_cents) })}</div>`
    : '';
  const actions = (canCancel || canComplete) ? `<div class="sess-actions">
      ${canComplete ? `<button class="btn btn-primary btn-sm" data-done="${esc(b.code)}">${t('app.session.mark_done')}</button>` : ''}
      ${canCancel ? `<button class="btn btn-danger btn-sm" data-cancel="${esc(b.code)}">${t('app.session.cancel')}</button>` : ''}
    </div>` : '';
  return `<div class="sess-card" data-code="${esc(b.code)}">
    <div class="sess-top">
      <div>
        <div class="sess-name">${esc(b.customer)}</div>
        <div class="sess-meta">${esc(cap(fmtDate(b.date)))} · ${fmtTime(b.hour)}<br>${sessionWhat(b)}</div>
      </div>
      <span class="pill ${b.status}">${esc(t('common.status.' + b.status))}</span>
    </div>
    ${earn}${actions}
  </div>`;
}

function alertCard(n) {
  return `<div class="alert-card ${n.read ? '' : 'unread'}">
    <div class="alert-ic"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/></svg></div>
    <div class="alert-body">
      <div class="alert-msg">${esc(I18N.server(n.message))}</div>
      <div class="alert-time">${esc(fmtDateTime(n.created_at))}</div>
    </div>
    ${n.read ? '' : '<span class="alert-unreaddot"></span>'}
  </div>`;
}

function emptyState(icon, big, small) {
  const ic = {
    cal: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  }[icon];
  return `<div class="empty">
    <div class="ic"><svg viewBox="0 0 24 24">${ic}</svg></div>
    <div class="big">${esc(big)}</div>
    ${small ? `<div class="small">${esc(small)}</div>` : ''}
  </div>`;
}

// Confirm/cancel + complete actions on any rendered session card.
function wireSessionActions() {
  view().querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(t('app.session.cancel_confirm'))) return;
    await statusAction(btn.dataset.cancel, 'cancelled', 'app.session.cancel_toast', btn);
  }));
  view().querySelectorAll('[data-done]').forEach((btn) => btn.addEventListener('click', () =>
    statusAction(btn.dataset.done, 'completed', 'app.session.done_toast', btn)));
}
async function statusAction(code, status, okKey, btn) {
  btn.disabled = true;
  try {
    await API.post(`/coach/bookings/${encodeURIComponent(code)}/status`, { status });
    toast(t(okKey));
    await loadAll();       // refresh counts + lists
    render();
  } catch (e) {
    btn.disabled = false;
    toast(I18N.server(e.message), true);
  }
}

// ---------------------------------------------------------------------------
// small date helpers
// ---------------------------------------------------------------------------
function iso(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function monthLabel(ym) { // 'YYYY-MM' -> localized month name
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB', { month: 'long' });
}
function fmtDateTime(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d)) return String(isoStr).slice(0, 16).replace('T', ' ');
  return d.toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function showGate() {
  document.getElementById('tabbar').hidden = true;
  view().innerHTML = `<div class="screen" style="text-align:center;padding-top:60px">
    <div class="pf-avatar" style="margin:0 auto 20px"><img src="/assets/logo.svg" alt="" style="object-fit:contain;padding:16px"></div>
    <h1 class="app-h1">${t('app.notcoach.title')}</h1>
    <p class="app-msg">${t('app.notcoach.body')}</p>
    <a class="btn btn-primary" href="/login?next=${encodeURIComponent('/app')}">${t('app.notcoach.login')}</a>
  </div>`;
}

(async function init() {
  try {
    S.me = await API.get('/me');
  } catch { S.me = { user: null }; }
  // Coaches (and admins with a coach profile) only.
  if (!S.me.user || !S.me.coachProfile) { showGate(); return; }

  try {
    await loadAll();
  } catch (e) {
    view().innerHTML = `<div class="app-msg">${esc(I18N.server(e.message) || t('app.error'))}</div>`;
    return;
  }
  document.getElementById('tabbar').hidden = false;
  window.addEventListener('hashchange', render);
  render();
})();
