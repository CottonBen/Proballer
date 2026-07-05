// Coach dashboard: week availability calendar (diff + Save), filters, sessions.
'use strict';

const state = {
  site: null, coach: null,
  weekStart: null,          // Monday (YYYY-MM-DD) of the visible week
  saved: new Set(),         // "date|hour" currently saved as available
  pending: new Map(),       // "date|hour" -> 'add' | 'remove'
  booked: new Map(),        // "date|hour" -> booking info
  today: null, nowHour: 0,
};

const key = (d, h) => `${d}|${h}`;
// Date math done in UTC (noon anchor) so it is independent of the browser's
// timezone — a plain YYYY-MM-DD string in, a correct YYYY-MM-DD string out.
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};
// FI uses a period as the hour separator ('8.00'), EN a colon ('8:00').
const hourSep = I18N.lang === 'fi' ? '.' : ':';
// Focus id -> /api/config label; labels are server-sent, translated at display time.
const focusLabel = (id) => {
  const f = state.site.focusTypes.find((x) => x.id === id);
  return I18N.server(f ? f.label : id);
};

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  // Coaches and admins-with-a-coach-profile belong here; customers don't.
  if (user.role === 'customer') { location.href = '/my-bookings'; return; }

  state.site = await API.get('/config');
  try {
    state.coach = await API.get('/coach/me');
  } catch (err) {
    document.getElementById('coach-sub').innerHTML =
      esc(I18N.server(err.message)) + (user.role === 'admin' ? t('coachdash.err.backadmin') : '');
    return;
  }
  document.getElementById('coach-name').textContent = state.coach.name;

  // Server "today" comes from the availability endpoint (Helsinki time there).
  const probe = await API.get('/coach/availability');
  state.today = probe.from;
  state.weekStart = mondayOf(state.today);

  buildFilters();
  await loadWeek();
  await loadSessions();
  await loadTier();
  await loadReviews();

  document.getElementById('prev-week').addEventListener('click', () => moveWeek(-7));
  document.getElementById('next-week').addEventListener('click', () => moveWeek(7));
  document.getElementById('save-avail').addEventListener('click', saveAvailability);
  document.getElementById('save-filters').addEventListener('click', saveFilters);
})().catch((e) => toast(I18N.server(e.message), true));

function moveWeek(days) {
  const target = addDays(state.weekStart, days);
  if (target < mondayOf(state.today)) return; // the past is not editable
  if (state.pending.size &&
      !confirm(t('coachdash.cal.confirm_discard'))) return;
  state.pending.clear();
  state.weekStart = target;
  loadWeek().catch((e) => toast(I18N.server(e.message), true));
}

async function loadWeek() {
  const from = state.weekStart;
  const to = addDays(from, 6);
  const data = await API.get(`/coach/availability?from=${from}&to=${to}`);
  state.saved = new Set(data.slots.map((s) => key(s.date, s.hour)));
  state.booked = new Map(data.bookings.map((b) => [key(b.date, b.hour), b]));
  renderCalendar();
}

function renderCalendar() {
  const { site } = state;
  const cal = document.getElementById('cal');
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  document.getElementById('week-label').textContent =
    `${fmtDate(days[0])} – ${fmtDate(days[6])}`;

  let html = '<div></div>' + days.map((d) => `
    <div class="hd ${d === state.today ? 'today' : ''}">
      <div class="dow">${fmtDate(d).split(' ')[0]}</div>
      <div class="num">${d.slice(8)}.${Number(d.slice(5, 7))}.</div>
    </div>`).join('');

  for (let h = site.hours.start; h < site.hours.end; h++) {
    html += `<div class="hr">${String(h).padStart(2, '0')}${hourSep}00</div>`;
    for (const d of days) {
      const k = key(d, h);
      const isPast = d < state.today; // whole past days; today's past hours handled server-side
      const booked = state.booked.get(k);
      let cls = 'cal-cell';
      let label = '';
      if (booked) {
        cls += ' booked';
        label = booked.customer.split(' ')[0];
      } else if (state.pending.get(k) === 'add') cls += ' pending-add';
      else if (state.pending.get(k) === 'remove') cls += ' pending-remove';
      else if (state.saved.has(k)) cls += ' avail';
      if (isPast) cls += ' past';
      html += `<div class="${cls}" data-k="${k}" data-label="${esc(label)}"
        title="${booked ? esc(`${booked.customer} · ${posLabel(booked.position)} · ${focusLabel(booked.focus)}`) : ''}"></div>`;
    }
  }
  cal.innerHTML = html;

  cal.querySelectorAll('.cal-cell').forEach((cell) => cell.addEventListener('click', () => {
    const k = cell.dataset.k;
    if (cell.classList.contains('booked') || cell.classList.contains('past')) return;
    const saved = state.saved.has(k);
    const cur = state.pending.get(k);
    if (cur) state.pending.delete(k);            // undo the pending change
    else state.pending.set(k, saved ? 'remove' : 'add');
    renderCalendar();
  }));

  const btn = document.getElementById('save-avail');
  btn.disabled = state.pending.size === 0;
  btn.textContent = state.pending.size
    ? t('coachdash.cal.save_n', { n: state.pending.size })
    : t('coachdash.cal.save');
}

async function saveAvailability() {
  const adds = [], removes = [];
  for (const [k, op] of state.pending) {
    const [date, hour] = k.split('|');
    (op === 'add' ? adds : removes).push({ date, hour: Number(hour) });
  }
  const btn = document.getElementById('save-avail');
  btn.disabled = true; btn.textContent = t('coachdash.cal.saving');
  try {
    const res = await API.put('/coach/availability', { adds, removes });
    state.pending.clear();
    await loadWeek();
    let msg = t('coachdash.cal.saved', { added: res.added, removed: res.removed });
    if (res.conflicts.length) msg += ' ' + t('coachdash.cal.saved_conflicts', { n: res.conflicts.length });
    if (res.rejected.length) msg += ' ' + t('coachdash.cal.saved_rejected', { n: res.rejected.length });
    toast(msg, res.conflicts.length > 0);
  } catch (err) {
    toast(I18N.server(err.message), true);
    renderCalendar();
  }
}

// --- tier & earnings ----------------------------------------------------------
// Shows only euro amounts and session counts — never commission percentages.
async function loadTier() {
  const box = document.getElementById('tier-body');
  let tier; // NB: not `t` — that would shadow the i18n helper
  try { tier = await API.get('/coach/tier'); }
  catch (err) { box.innerHTML = `<p class="muted">${esc(I18N.server(err.message))}</p>`; return; }

  const monthName = new Date(tier.month + '-15T12:00:00Z')
    .toLocaleDateString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB', { month: 'long', timeZone: 'UTC' });
  const tierName = (n) => t('coachdash.tier.name', { n });
  const progress = tier.sessionsToNextTier !== null
    ? `<div class="small muted" style="margin-top:4px">${t(
        tier.sessionsToNextTier === 1 ? 'coachdash.tier.progress_one' : 'coachdash.tier.progress_many',
        { n: tier.sessionsToNextTier,
          next: `<strong style="color:var(--lime)">${tierName(tier.nextTierNumber)}</strong>` })}</div>`
    : `<div class="small" style="margin-top:4px;color:var(--lime)">${t('coachdash.tier.top')}</div>`;

  box.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div class="display" style="font-size:1.5rem;color:var(--lime)">${tierName(tier.tierNumber)}</div>
      <span class="chip gray">${esc(I18N.server(tier.sessionLabel))}</span>
    </div>
    <div class="small muted">${t(
      tier.sessionsThisMonth === 1 ? 'coachdash.tier.month_count_one' : 'coachdash.tier.month_count_many',
      { n: tier.sessionsThisMonth, month: esc(monthName) })}</div>
    ${progress}
    <div class="review-row" style="margin-top:10px"><span class="muted">${t('coachdash.tier.earn_onpitch')}</span>
      <strong style="color:var(--lime)">${eur(tier.earnPerSession.onPitchCents)}</strong></div>
    <div class="review-row"><span class="muted">${t('coachdash.tier.earn_online')}</span>
      <strong>${eur(tier.earnPerSession.onlineCents)}</strong></div>
    <div class="review-row"><span class="muted">${t('coachdash.tier.earned_month', { month: esc(monthName) })}</span>
      <strong>${eur(tier.earnedThisMonthCents)}</strong></div>
    <div class="small muted" style="margin:14px 0 4px;text-transform:uppercase;letter-spacing:.08em">${t('coachdash.tier.all')}</div>
    ${tier.allTiers.map((x) => `
      <div style="padding:8px 0;border-top:1px dashed var(--line);${x.number === tier.tierNumber ? '' : 'opacity:.65'}">
        <strong>${tierName(x.number)}</strong>
        <span class="muted">· ${esc(I18N.server(x.sessions))}</span><br>
        <span class="muted">${t('coachdash.tier.per_session')}</span> ${eur(x.earnPerSession.onPitchCents)}
        <span class="muted">${t('coachdash.tier.onpitch')} ·</span> ${eur(x.earnPerSession.onlineCents)} <span class="muted">${t('coachdash.tier.online')}</span>
      </div>`).join('')}`;
}

// --- reviews (read-only for the coach) ---------------------------------------
async function loadReviews() {
  const box = document.getElementById('reviews-body');
  let data;
  try { data = await API.get('/coach/reviews'); }
  catch (err) { box.innerHTML = `<p class="muted">${esc(I18N.server(err.message))}</p>`; return; }
  const header = `<div class="rating-line" style="margin-bottom:10px">${ratingLine(data.rating)}</div>`;
  box.innerHTML = header + (data.reviews.length
    ? data.reviews.map(reviewHTML).join('')
    : `<p class="muted">${t('coachdash.reviews.empty')}</p>`);
}

// --- filters ----------------------------------------------------------------
function buildFilters() {
  const locBox = document.getElementById('loc-chips');
  const posBox = document.getElementById('pos-chips');
  locBox.innerHTML = state.site.locations.map((l) => `
    <span class="chip chip-toggle ${state.coach.locations.includes(l) ? 'on' : ''}" data-v="${esc(l)}">${esc(l)}</span>`).join('');
  posBox.innerHTML = state.site.positions.map((p) => `
    <span class="chip chip-toggle ${state.coach.positions.includes(p) ? 'on' : ''}" data-v="${esc(p)}">${esc(posLabel(p))}</span>`).join('');
  [locBox, posBox].forEach((box) => box.querySelectorAll('.chip-toggle').forEach((chip) =>
    chip.addEventListener('click', () => chip.classList.toggle('on'))));
}

async function saveFilters() {
  const pickOn = (id) => [...document.querySelectorAll(`#${id} .chip-toggle.on`)].map((c) => c.dataset.v);
  const msg = document.getElementById('filters-msg');
  msg.textContent = '';
  try {
    const res = await API.put('/coach/filters', {
      locations: pickOn('loc-chips'),
      positions: pickOn('pos-chips'),
    });
    state.coach.locations = res.locations;
    state.coach.positions = res.positions;
    toast(t('coachdash.filters.saved'));
  } catch (err) {
    msg.textContent = I18N.server(err.message);
  }
}

// --- clients & sessions list --------------------------------------------------
// Every booking shows the client's details plus three status buttons:
// Current (confirmed) · Completed · Cancelled. Cancelling notifies the client
// and gives them their next session free.
async function loadSessions() {
  const list = document.getElementById('sessions-list');
  const rows = await API.get('/coach/bookings');
  if (!rows.length) { list.innerHTML = `<p class="muted">${t('coachdash.clients.empty')}</p>`; return; }

  const upcoming = rows.filter((r) => r.status === 'confirmed').slice().reverse();
  const past = rows.filter((r) => r.status !== 'confirmed');

  // Status labels: Finnish text, but the raw English value keeps driving the
  // status-${status} CSS classes and the API calls.
  const statusText = (s) => s === 'confirmed' ? t('coachdash.status.current') : t('common.status.' + s);

  // "Completed" only makes sense once the session has taken place — the server
  // rejects earlier, so disable it for clearly-future dates to match.
  const isFuture = (r) => r.date > state.today;
  const statusBtns = (r) => ['confirmed', 'completed', 'cancelled'].map((s) => {
    const label = cap(statusText(s));
    const on = r.status === s;
    const lockFuture = s === 'completed' && isFuture(r);
    const cls = on ? 'btn-primary' : s === 'cancelled' ? 'btn-danger' : 'btn-ghost';
    return `<button class="btn btn-sm ${cls}" data-status="${s}" data-code="${esc(r.code)}"
      ${on || lockFuture ? 'disabled' : ''} ${lockFuture ? `title="${t('coachdash.clients.lock_future')}"` : ''}>${esc(label)}</button>`;
  }).join(' ');

  const item = (r) => `
    <div class="client-row" style="border-bottom:1px dashed var(--line);padding:12px 0">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
        <strong>${esc(fmtDate(r.date))} ${String(r.hour).padStart(2, '0')}${hourSep}00–${String(r.hour + 1).padStart(2, '0')}${hourSep}00</strong>
        <span class="status-tag status-${esc(r.status)}">${esc(statusText(r.status))}</span>
      </div>
      <div style="margin:4px 0 2px"><strong>${esc(r.customer)}</strong>
        <a class="small" href="mailto:${esc(r.customer_email)}">${esc(r.customer_email)}</a></div>
      <div class="small muted">${esc(posLabel(r.position))} · ${esc(focusLabel(r.focus))} ·
        ${r.is_online ? esc(I18N.server('Online')) : esc(r.location)} ·
        ${r.credit_applied ? t('coachdash.clients.pays_credit') : t('coachdash.clients.pays', { amount: esc(eur(r.total_cents)) })}</div>
      ${r.earn_cents != null ? `<div class="small" style="color:var(--lime);margin-top:2px">
        ${t('coachdash.clients.earn', { amount: esc(eur(r.earn_cents)) })}${r.earn_estimated ? ' ' + t('coachdash.clients.earn_estimate') : ''}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${statusBtns(r)}</div>
    </div>`;

  list.innerHTML =
    `<div class="small muted" style="margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">${t('coachdash.clients.upcoming', { n: upcoming.length })}</div>` +
    (upcoming.map(item).join('') || `<p class="muted">${t('coachdash.clients.none_upcoming')}</p>`) +
    `<div class="small muted" style="margin:16px 0 4px;text-transform:uppercase;letter-spacing:.08em">${t('coachdash.clients.past', { n: past.length })}</div>` +
    past.slice(0, 10).map(item).join('');

  list.querySelectorAll('[data-status]').forEach((btn) => btn.addEventListener('click', async () => {
    const to = btn.dataset.status;
    if (to === 'cancelled' && !confirm(t('coachdash.clients.confirm_cancel'))) return;
    btn.disabled = true;
    try {
      await API.post(`/coach/bookings/${encodeURIComponent(btn.dataset.code)}/status`, { status: to });
      toast(to === 'cancelled'
        ? t('coachdash.clients.cancelled_toast')
        : t('coachdash.clients.marked', { status: statusText(to) }));
      await loadSessions();
      await loadWeek(); // a cancelled slot becomes bookable again
      await loadTier(); // completions move the monthly tier forward
    } catch (err) {
      btn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  }));
}
