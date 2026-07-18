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
  cal: { y: null, m: null, selDate: null, edit: false, avail: null, booked: null, pending: null, horizon: null },
  pitch: { sel: null, q: '' },              // pitches tab: selected session code + search
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
// Chronological comparator. NOT string-concat: 'date'+10 sorts before 'date'+9.
const byWhen = (a, b) => (a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date));
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
const ROUTES = { home: renderHome, sessions: renderSessions, calendar: renderCalendar, pitches: renderPitches, chats: renderChats, alerts: renderAlerts, profile: renderProfile };

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
  const upcoming = byStatus('confirmed').slice().sort(byWhen);
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
  if (sessTab === 'confirmed') list.sort(byWhen);
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

// --- availability editing (the + button on the calendar) ---------------------
// Same mechanics as the desktop coach calendar: tap hours open or closed on
// any days, then one Save sends the whole diff to PUT /coach/availability.
const slotKey = (date, hour) => `${date}|${hour}`;

async function enterAvailEdit() {
  const now = new Date();
  const from = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const toD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 59);
  const data = await API.get(`/coach/availability?from=${from}&to=${iso(toD.getFullYear(), toD.getMonth(), toD.getDate())}`);
  S.cal.edit = true;
  S.cal.avail = new Set(data.slots.map((s) => slotKey(s.date, s.hour)));
  S.cal.booked = new Set(data.bookings.map((b) => slotKey(b.date, b.hour)));
  S.cal.pending = { adds: new Set(), removes: new Set() };
  S.cal.horizon = data.to; // last date the booking horizon allows
  renderCalendar();
}

function exitAvailEdit() {
  S.cal.edit = false;
  S.cal.avail = S.cal.booked = S.cal.pending = null;
  renderCalendar();
}

// In edit mode a day's dot means "has open (or about-to-open) hours".
function dayHasOpen(ds) {
  for (let h = 8; h < 20; h++) {
    const k = slotKey(ds, h);
    if ((S.cal.avail.has(k) && !S.cal.pending.removes.has(k)) || S.cal.pending.adds.has(k)) return true;
  }
  return false;
}

// Hour chips (8–20) for the selected day: tap toggles open/closed; booked and
// past hours are locked. Hours mirror config.dayStartHour/dayEndHour.
function availDayHTML(ds) {
  const now = new Date();
  const today = iso(now.getFullYear(), now.getMonth(), now.getDate());
  const beyond = S.cal.horizon && ds > S.cal.horizon;
  let chips = '';
  for (let h = 8; h < 20; h++) {
    const k = slotKey(ds, h);
    const past = ds < today || (ds === today && h <= now.getHours());
    const cls = ['av-hr'];
    if (S.cal.booked.has(k)) cls.push('booked');
    else if (past || beyond) cls.push('off');
    else if (S.cal.pending.adds.has(k)) cls.push('pending-add');
    else if (S.cal.pending.removes.has(k)) cls.push('pending-remove');
    else if (S.cal.avail.has(k)) cls.push('open');
    chips += `<button class="${cls.join(' ')}" data-avh="${h}"
      ${S.cal.booked.has(k) || past || beyond ? 'disabled' : ''}>${h}–${h + 1}</button>`;
  }
  return `<div class="av-hours">${chips}</div>
    <div class="av-legend">${t('app.cal.edit_legend')}</div>`;
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
    const dot = S.cal.edit ? dayHasOpen(ds) : busy.has(ds);
    cells += `<div class="${cls.join(' ')}" data-date="${ds}">${d}${dot ? '<span class="cdot"></span>' : ''}</div>`;
  }

  const sel = S.cal.selDate;
  const daySess = sel ? S.bookings.filter((b) => b.date === sel && b.status !== 'cancelled')
    .sort((a, b) => a.hour - b.hour) : [];
  const pendingCount = S.cal.edit ? S.cal.pending.adds.size + S.cal.pending.removes.size : 0;

  view().innerHTML = `<div class="screen">
    <div class="cal-head">
      <div class="cal-title">${cap(monthName)}</div>
      <div class="cal-nav">
        <button data-avedit title="${esc(t('app.cal.edit_title'))}" aria-label="${esc(t('app.cal.edit_title'))}"
          ${S.cal.edit ? 'style="border-color:var(--text)"' : ''}>${S.cal.edit ? '✕' : '+'}</button>
        <button data-mv="-1" aria-label="prev">‹</button><button data-mv="1" aria-label="next">›</button>
      </div>
    </div>
    <div class="cal-grid">
      ${dow.map((i) => `<div class="cal-dow">${esc(wd[i])}</div>`).join('')}
      ${cells}
    </div>
    ${S.cal.edit ? `
      ${sel ? `<div class="cal-daylabel">${esc(fmtDate(sel))} ${sel.slice(0, 4)}</div>${availDayHTML(sel)}`
        : `<div class="empty" style="margin-top:22px"><div class="small">${t('app.cal.edit_hint')}</div></div>`}
      <div class="av-bar">
        <button class="btn btn-primary" id="av-save" ${pendingCount ? '' : 'disabled'}>
          ${t('app.cal.save')}${pendingCount ? ` (${pendingCount})` : ''}</button>
        <button class="btn btn-ghost" id="av-cancel">${t('app.cal.cancel')}</button>
      </div>`
    : sel ? `<div class="cal-daylabel">${esc(fmtDate(sel))} ${sel.slice(0, 4)}</div>
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
  view().querySelector('[data-avedit]').addEventListener('click', () => {
    if (S.cal.edit) exitAvailEdit();
    else enterAvailEdit().catch((err) => toast(I18N.server(err.message), true));
  });
  view().querySelectorAll('[data-avh]').forEach((btn) => btn.addEventListener('click', () => {
    const k = slotKey(S.cal.selDate, Number(btn.dataset.avh));
    const p = S.cal.pending;
    if (p.adds.has(k)) p.adds.delete(k);
    else if (p.removes.has(k)) p.removes.delete(k);
    else if (S.cal.avail.has(k)) p.removes.add(k);
    else p.adds.add(k);
    renderCalendar();
  }));
  const saveBtn = view().querySelector('#av-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const toSlot = (k) => { const [date, hour] = k.split('|'); return { date, hour: Number(hour) }; };
    try {
      const r = await API.put('/coach/availability', {
        adds: [...S.cal.pending.adds].map(toSlot),
        removes: [...S.cal.pending.removes].map(toSlot),
      });
      const warn = r.conflicts && r.conflicts.length;
      toast(t('app.cal.saved', { added: r.added, removed: r.removed })
        + (warn ? ' ' + t('app.cal.conflicts', { count: r.conflicts.length }) : ''), Boolean(warn));
      exitAvailEdit();
    } catch (err) {
      saveBtn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  });
  const cancelBtn = view().querySelector('#av-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', exitAvailEdit);
  wireSessionActions();
}

// ---------------------------------------------------------------------------
// Pitches: the LIPAS directory of football venues in the session's city, with
// Proballers' own occupancy at the session time. "Free" only covers OUR
// bookings (LIPAS has no live calendars) — the note + city links say so.
// ---------------------------------------------------------------------------
function pitchSessions() {
  return byStatus('confirmed').filter((b) => !b.is_online).sort(byWhen);
}

function pitchTagLine(p) {
  const tags = [];
  for (const s of p.surface || []) {
    // Common LIPAS surface tokens are translated; rare ones show as-is.
    const key = 'app.pitches.surface.' + s;
    tags.push(esc(Object.prototype.hasOwnProperty.call(I18N_DICT, key) ? t(key) : s));
  }
  if (p.length && p.width) tags.push(`${p.length}×${p.width} m`);
  if (p.lighting) tags.push('💡 ' + t('app.pitches.lit'));
  if (p.indoor) tags.push('🏟 ' + t('app.pitches.indoor'));
  else if (p.stadium) tags.push('🏟 ' + t('app.pitches.stadium'));
  return tags.join(' · ');
}

async function renderPitches() {
  const sessions = pitchSessions();
  const isAdmin = S.me.user.role === 'admin';
  // Coaches need an upcoming session to plan a pitch for; an admin can always
  // browse and curate the list per city, sessions or not.
  if (!sessions.length && !isAdmin) {
    view().innerHTML = `<div class="screen">
      <header class="app-head"><h1 class="app-h1">${t('app.pitches.title')}</h1></header>
      ${emptyState('cal', t('app.pitches.no_sessions'), t('app.pitches.no_sessions_sub'))}
    </div>`;
    return;
  }
  let sess;
  if (sessions.length) {
    if (!S.pitch.sel || !sessions.some((b) => b.code === S.pitch.sel)) S.pitch.sel = sessions[0].code;
    sess = sessions.find((b) => b.code === S.pitch.sel);
  } else {
    // admin browse mode: city only, no session to assign to
    if (!S.pitch.city) S.pitch.city = 'Helsinki';
    sess = { code: null, location: S.pitch.city, pitch_id: null, date: null, hour: null };
  }

  view().innerHTML = `<div class="screen">
    <header class="app-head"><h1 class="app-h1">${t('app.pitches.title')}</h1></header>
    ${sessions.length ? `
    <label class="small muted" style="display:block;margin-bottom:6px">${t('app.pitches.for_session')}</label>
    <select id="pitch-sess" class="input" style="width:100%;margin-bottom:10px">
      ${sessions.map((b) => `<option value="${esc(b.code)}" ${b.code === S.pitch.sel ? 'selected' : ''}>
        ${esc(fmtDate(b.date))} ${fmtTime(b.hour)} · ${esc(b.customer)} · ${esc(I18N.server(b.location))}</option>`).join('')}
    </select>` : `
    <select id="pitch-city" class="input" style="width:100%;margin-bottom:10px">
      ${['Helsinki', 'Espoo', 'Vantaa'].map((c) => `<option value="${c}" ${c === sess.location ? 'selected' : ''}>${c}</option>`).join('')}
    </select>`}
    <input id="pitch-q" class="input" type="search" value="${esc(S.pitch.q)}"
      placeholder="${esc(t('app.pitches.search_ph'))}" style="width:100%;margin-bottom:8px">
    <p class="small muted" style="margin:0 0 12px">${t('app.pitches.note')}</p>
    ${isAdmin ? `
    <button class="btn btn-ghost btn-sm" id="pitch-add-toggle" style="margin-bottom:10px">+ ${t('app.pitches.add')}</button>
    <div class="pf-block" id="pitch-add-form" hidden style="margin-bottom:12px">
      <input id="pa-name" class="input" maxlength="80" placeholder="${esc(t('app.pitches.add_name_ph'))}" style="width:100%;margin-bottom:6px">
      <input id="pa-area" class="input" maxlength="60" placeholder="${esc(t('app.pitches.add_area_ph'))}" style="width:100%;margin-bottom:6px">
      <input id="pa-address" class="input" maxlength="120" placeholder="${esc(t('app.pitches.add_address_ph'))}" style="width:100%;margin-bottom:6px">
      <input id="pa-www" class="input" maxlength="300" placeholder="${esc(t('app.pitches.add_www_ph'))}" style="width:100%;margin-bottom:6px">
      <select id="pa-surface" class="input" style="width:100%;margin-bottom:8px">
        <option value="artificial-turf">${esc(t('app.pitches.surface.artificial-turf'))}</option>
        <option value="grass">${esc(t('app.pitches.surface.grass'))}</option>
        <option value="">${esc(t('app.pitches.surface_other'))}</option>
      </select>
      <label class="small" style="display:inline-flex;gap:6px;margin-right:14px;align-items:center"><input type="checkbox" id="pa-lit"> ${t('app.pitches.lit')}</label>
      <label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="pa-indoor"> ${t('app.pitches.indoor')}</label>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="pa-save">${t('app.pitches.add_save')}</button>
        <span class="small muted">${t('app.pitches.add_city_note', { city: esc(I18N.server(sess.location)) })}</span>
      </div>
    </div>` : ''}
    <div id="pitch-list"><div class="app-loading">${t('app.loading')}</div></div>
  </div>`;

  const sessSel = document.getElementById('pitch-sess');
  if (sessSel) sessSel.addEventListener('change', (e) => {
    S.pitch.sel = e.target.value;
    renderPitches();
  });
  const citySel = document.getElementById('pitch-city');
  if (citySel) citySel.addEventListener('change', (e) => {
    S.pitch.city = e.target.value;
    renderPitches();
  });
  document.getElementById('pitch-q').addEventListener('input', (e) => {
    S.pitch.q = e.target.value;
    if (S.pitch.data) paintPitchList(sess);
  });
  const addToggle = document.getElementById('pitch-add-toggle');
  if (addToggle) addToggle.addEventListener('click', () => {
    const f = document.getElementById('pitch-add-form');
    f.hidden = !f.hidden;
  });
  const addSave = document.getElementById('pa-save');
  if (addSave) addSave.addEventListener('click', async () => {
    addSave.disabled = true;
    try {
      await API.post('/admin/pitches', {
        city: sess.location,
        name: document.getElementById('pa-name').value,
        neighborhood: document.getElementById('pa-area').value,
        address: document.getElementById('pa-address').value,
        www: document.getElementById('pa-www').value,
        surface: document.getElementById('pa-surface').value,
        lighting: document.getElementById('pa-lit').checked,
        indoor: document.getElementById('pa-indoor').checked,
      });
      toast(t('app.pitches.added_toast'));
      renderPitches();
    } catch (e) {
      addSave.disabled = false;
      toast(I18N.server(e.message), true);
    }
  });

  // Stale response check: the coach switched sessions/cities (or tabs) mid-fetch.
  const stale = () => (sess.code ? S.pitch.sel !== sess.code : S.pitch.city !== sess.location);
  try {
    const slot = sess.code ? `&date=${sess.date}&hour=${sess.hour}` : '';
    const data = await API.get(`/coach/pitches?city=${encodeURIComponent(sess.location)}${slot}`);
    if (stale()) return;
    S.pitch.data = data;
  } catch (e) {
    if (stale()) return;
    S.pitch.data = null;
    const list = document.getElementById('pitch-list');
    if (list) list.innerHTML = `<div class="empty"><div class="big">${esc(I18N.server(e.message))}</div></div>`;
    return;
  }
  paintPitchList(sess);
}

function paintPitchList(sess) {
  const list = document.getElementById('pitch-list');
  if (!list || !S.pitch.data) return;
  const isAdmin = S.me.user.role === 'admin';
  const q = S.pitch.q.trim().toLowerCase();
  let rows = S.pitch.data.pitches;
  if (q) rows = rows.filter((p) => `${p.name} ${p.neighborhood} ${p.address}`.toLowerCase().includes(q));
  const free = rows.filter((p) => !p.takenBy).length;
  // Selected pitch first, then free before taken, alphabetical within.
  rows = rows.slice().sort((a, b) =>
    (b.id === sess.pitch_id) - (a.id === sess.pitch_id)
    || Boolean(a.takenBy) - Boolean(b.takenBy)
    || a.name.localeCompare(b.name, 'fi'));

  list.innerHTML = `
    <div class="small muted" style="margin-bottom:8px">${sess.code
      ? t('app.pitches.count', { total: rows.length, free })
      : t('app.pitches.count_plain', { total: rows.length })}
      ${isAdmin && S.pitch.data.hiddenCount ? `<br><button class="link-btn" id="pitch-restore" style="padding:2px 0">${t('app.pitches.restore', { n: S.pitch.data.hiddenCount })}</button>` : ''}
    </div>
    ${rows.slice(0, 120).map((p) => {
      const mine = p.id === sess.pitch_id;
      // Free/taken only means something at a specific session time — admin
      // browse mode shows the plain directory without status chips.
      const chip = !sess.code ? ''
        : mine
          ? `<span class="pill confirmed">✓ ${t('app.pitches.chosen')}</span>`
          : p.takenBy
            ? `<span class="pill cancelled">${t('app.pitches.taken', { coach: esc(p.takenBy.coach) })}</span>`
            : `<span class="pill completed">${t('app.pitches.free')}</span>`;
      // Assign buttons only exist when a session is selected (admin browse
      // mode has no session to attach the pitch to).
      const btn = !sess.code ? ''
        : mine
          ? `<button class="btn btn-ghost btn-sm" data-clearpitch>${t('app.pitches.clear')}</button>`
          : (!p.takenBy ? `<button class="btn btn-primary btn-sm" data-setpitch="${p.id}">${t('app.pitches.pick')}</button>` : '');
      // Admins prune the list right here: LIPAS pitches hide (restorable),
      // custom ones delete for good.
      const rmBtn = isAdmin
        ? `<button class="btn btn-ghost btn-sm" data-rmpitch="${p.id}" data-name="${esc(p.name)}" data-custom="${p.custom ? 1 : 0}">🗑 ${t(p.custom ? 'app.pitches.delete_custom' : 'app.pitches.hide')}</button>`
        : '';
      return `<div class="sess-card">
        <div class="sess-top">
          <div style="min-width:0">
            <div class="sess-name" style="font-size:.95rem">${esc(p.name)}${p.custom ? ` <span class="chip" style="font-size:.6rem">${t('app.pitches.custom_tag')}</span>` : ''}</div>
            <div class="sess-meta">${esc([p.neighborhood, p.address].filter(Boolean).join(' · '))}</div>
            ${pitchTagLine(p) ? `<div class="sess-meta">${pitchTagLine(p)}</div>` : ''}
            ${p.www ? `<div class="sess-meta"><a href="${esc(p.www)}" target="_blank" rel="noopener" style="color:var(--lime)">🔗 ${t('app.pitches.city_link')}</a></div>` : ''}
          </div>
          ${chip}
        </div>
        ${btn || rmBtn ? `<div class="sess-actions">${btn}${rmBtn}</div>` : ''}
      </div>`;
    }).join('') || `<div class="empty"><div class="big">${esc(t('app.pitches.no_match'))}</div></div>`}
    ${rows.length > 120 ? `<div class="small muted" style="margin-top:8px">${t('app.pitches.narrow', { shown: 120, total: rows.length })}</div>` : ''}`;

  const setPitch = async (pitchId) => {
    try {
      await API.post(`/coach/bookings/${encodeURIComponent(sess.code)}/pitch`, { pitchId });
      toast(t(pitchId == null ? 'app.pitches.cleared_toast' : 'app.pitches.picked_toast'));
      await loadAll();
      renderPitches();
    } catch (e) { toast(I18N.server(e.message), true); }
  };
  list.querySelectorAll('[data-setpitch]').forEach((b) =>
    b.addEventListener('click', () => setPitch(Number(b.dataset.setpitch))));
  list.querySelectorAll('[data-clearpitch]').forEach((b) =>
    b.addEventListener('click', () => setPitch(null)));
  list.querySelectorAll('[data-rmpitch]').forEach((b) => b.addEventListener('click', async () => {
    const custom = b.dataset.custom === '1';
    if (!confirm(t(custom ? 'app.pitches.delete_custom_confirm' : 'app.pitches.hide_confirm', { name: b.dataset.name }))) return;
    try {
      await API.del(`/admin/pitches/${b.dataset.rmpitch}`);
      toast(t('app.pitches.removed_toast'));
      renderPitches();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
  const restore = document.getElementById('pitch-restore');
  if (restore) restore.addEventListener('click', async () => {
    try {
      await API.post('/admin/pitches/restore-hidden', {});
      toast(t('app.pitches.restored_toast'));
      renderPitches();
    } catch (e) { toast(I18N.server(e.message), true); }
  });
}

let openChatId = null;
async function renderChats() {
  const v = view();
  if (openChatId) {
    let data;
    try { data = await API.get(`/chats/${openChatId}/messages`); }
    catch { openChatId = null; return renderChats(); }
    const c = data.chat;
    const mineIsCoach = S.me.user.id === c.coachUserId;
    v.innerHTML = `<div class="screen">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <button class="btn btn-ghost btn-sm" id="chat-back">${t('chat.back')}</button>
        <strong>${mineIsCoach ? esc(c.customerName) : `${esc(c.customerName)} ↔ ${esc(c.coachName)}`}</strong>
      </div>
      <div id="app-msgs" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
        ${data.messages.map((m) => m.system
          ? `<div class="msg-system" style="align-self:center;color:var(--muted);font-size:.75rem;border:1px dashed var(--line);border-radius:999px;padding:3px 12px">${m.body.startsWith('📍')
              ? `📍 ${t('chat.system_pitch')} · ${esc(m.body.replace(/^📍\s*/, ''))}`
              : `📅 ${t('chat.system_booking')} · ${esc(m.body.replace(/^📅\s*/, ''))}`}</div>`
          : `<div style="align-self:${m.mine ? 'flex-end' : 'flex-start'};max-width:80%">
              ${m.mine ? '' : `<div class="small muted">${esc(m.senderName || '?')}</div>`}
              <div style="padding:8px 13px;border-radius:14px;font-size:.9rem;white-space:pre-wrap;word-break:break-word;
                background:${m.mine ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)'};
                border:1px solid ${m.mine ? 'rgba(255,255,255,0.3)' : 'var(--line)'}">${esc(m.body)}</div>
            </div>`).join('')}
      </div>
      <form id="app-compose" style="display:flex;gap:8px">
        <input id="app-chat-input" maxlength="2000" autocomplete="off" placeholder="${esc(t('chat.input_placeholder'))}"
          style="flex:1;background:rgba(255,255,255,0.05);border:1px solid var(--line);border-radius:999px;
          color:var(--text);font-family:var(--body);font-size:.95rem;padding:10px 16px;outline:none">
        <button class="btn btn-primary btn-sm" type="submit">${t('chat.send')}</button>
      </form>
    </div>`;
    v.scrollTop = v.scrollHeight;
    document.getElementById('chat-back').addEventListener('click', () => { openChatId = null; renderChats(); });
    document.getElementById('app-compose').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('app-chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await API.post(`/chats/${openChatId}/messages`, { message: text }); renderChats(); }
      catch (err) { input.value = text; toast(I18N.server(err.message), true); }
    });
    paintChatBadge();
    return;
  }
  let chats = [];
  try { chats = await API.get('/chats'); } catch { /* empty */ }
  v.innerHTML = `<div class="screen">
    <header class="app-head"><h1 class="app-h1">${t('chat.heading')}</h1></header>
    ${chats.length ? chats.map((c) => `
      <button class="sess-card" data-chat="${c.id}" style="width:100%;text-align:left;cursor:pointer;display:flex;gap:12px;align-items:center;font-family:var(--body);color:var(--text)">
        <span style="width:42px;height:42px;border-radius:50%;overflow:hidden;flex-shrink:0;display:grid;place-items:center;background:rgba(255,255,255,0.1)">
          ${c.coachPhoto ? `<img src="${esc(c.coachPhoto)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '💬'}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-weight:700">${S.me.user.id === c.customerId ? esc(c.coachName) : esc(c.customerName)}</span>
          <span class="small muted" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((c.lastMessage || '').slice(0, 44))}</span>
        </span>
        ${c.unread ? `<span class="tab-badge" style="position:static">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
      </button>`).join('') : emptyState('bell', t('chat.empty'))}
  </div>`;
  v.querySelectorAll('[data-chat]').forEach((b) =>
    b.addEventListener('click', () => { openChatId = Number(b.dataset.chat); renderChats(); }));
  paintChatBadge();
}

async function paintChatBadge() {
  const el = document.getElementById('chat-badge');
  if (!el) return;
  try {
    const me = await API.get('/me');
    el.textContent = me.unreadChats > 9 ? '9+' : String(me.unreadChats || 0);
    el.hidden = !me.unreadChats;
  } catch { /* leave as-is */ }
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
  // Pitch line: shown once picked; upcoming on-pitch sessions get a picker link.
  const canPickPitch = b.status === 'confirmed' && !b.is_online;
  const pitchLine = (b.pitch_name || canPickPitch)
    ? `<div class="sess-meta" style="margin-top:6px">📍 ${b.pitch_name ? esc(b.pitch_name) : `<span class="muted">${t('app.pitches.none')}</span>`}
        ${canPickPitch ? `<button class="link-btn" data-pickpitch="${esc(b.code)}" style="padding:0 0 0 6px">${t(b.pitch_name ? 'app.pitches.change' : 'app.pitches.choose')}</button>` : ''}
      </div>` : '';
  return `<div class="sess-card" data-code="${esc(b.code)}">
    <div class="sess-top">
      <div>
        <div class="sess-name">${esc(b.customer)}</div>
        <div class="sess-meta">${esc(cap(fmtDate(b.date)))} · ${fmtTime(b.hour)}<br>${sessionWhat(b)}</div>
        ${pitchLine}
        ${b.notes ? `<div class="sess-meta" style="margin-top:6px;padding:6px 10px;background:rgba(255,255,255,0.04);border-left:2px solid var(--lime);border-radius:6px">📝 ${esc(b.notes)}</div>` : ''}
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
  // "Choose pitch" jumps to the Pitches tab with this session preselected.
  view().querySelectorAll('[data-pickpitch]').forEach((btn) => btn.addEventListener('click', () => {
    S.pitch.sel = btn.dataset.pickpitch;
    S.pitch.q = '';
    location.hash = '#pitches';
  }));
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
    <div class="pf-avatar" style="margin:0 auto 20px"><img src="/assets/logo.svg?v=2" alt="" style="object-fit:contain;padding:16px"></div>
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
  paintChatBadge();
  render();
})();
