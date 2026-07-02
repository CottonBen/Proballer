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
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return addDays(iso, -((d.getDay() + 6) % 7));
};

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  if (user.role !== 'coach') { location.href = DASH_FOR_ROLE[user.role] || '/'; return; }

  state.site = await API.get('/config');
  try {
    state.coach = await API.get('/coach/me');
  } catch (err) {
    document.getElementById('coach-sub').textContent = err.message;
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

  document.getElementById('prev-week').addEventListener('click', () => moveWeek(-7));
  document.getElementById('next-week').addEventListener('click', () => moveWeek(7));
  document.getElementById('save-avail').addEventListener('click', saveAvailability);
  document.getElementById('save-filters').addEventListener('click', saveFilters);
})().catch((e) => toast(e.message, true));

function moveWeek(days) {
  const target = addDays(state.weekStart, days);
  if (target < mondayOf(state.today)) return; // the past is not editable
  if (state.pending.size &&
      !confirm('You have unsaved availability changes on this week. Discard them?')) return;
  state.pending.clear();
  state.weekStart = target;
  loadWeek().catch((e) => toast(e.message, true));
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
    html += `<div class="hr">${String(h).padStart(2, '0')}:00</div>`;
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
        title="${booked ? esc(`${booked.customer} · ${cap(booked.position)} · ${booked.focus}`) : ''}"></div>`;
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
  btn.textContent = state.pending.size ? `Save changes (${state.pending.size})` : 'Save changes';
}

async function saveAvailability() {
  const adds = [], removes = [];
  for (const [k, op] of state.pending) {
    const [date, hour] = k.split('|');
    (op === 'add' ? adds : removes).push({ date, hour: Number(hour) });
  }
  const btn = document.getElementById('save-avail');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await API.put('/coach/availability', { adds, removes });
    state.pending.clear();
    await loadWeek();
    let msg = `Saved — ${res.added} opened, ${res.removed} closed.`;
    if (res.conflicts.length) msg += ` ${res.conflicts.length} could not be closed (already booked).`;
    if (res.rejected.length) msg += ` ${res.rejected.length} skipped (past or out of range).`;
    toast(msg, res.conflicts.length > 0);
  } catch (err) {
    toast(err.message, true);
    renderCalendar();
  }
}

// --- filters ----------------------------------------------------------------
function buildFilters() {
  const locBox = document.getElementById('loc-chips');
  const posBox = document.getElementById('pos-chips');
  locBox.innerHTML = state.site.locations.map((l) => `
    <span class="chip chip-toggle ${state.coach.locations.includes(l) ? 'on' : ''}" data-v="${esc(l)}">${esc(l)}</span>`).join('');
  posBox.innerHTML = state.site.positions.map((p) => `
    <span class="chip chip-toggle ${state.coach.positions.includes(p) ? 'on' : ''}" data-v="${esc(p)}">${esc(cap(p))}</span>`).join('');
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
    toast('Filters saved — players now see your updated options.');
  } catch (err) {
    msg.textContent = err.message;
  }
}

// --- sessions list ----------------------------------------------------------
async function loadSessions() {
  const list = document.getElementById('sessions-list');
  const rows = await API.get('/coach/bookings');
  if (!rows.length) { list.innerHTML = '<p class="muted">No sessions booked yet.</p>'; return; }
  const upcoming = rows.filter((r) => r.status === 'confirmed').reverse();
  const done = rows.filter((r) => r.status === 'completed');
  const item = (r) => `
    <div class="review-row">
      <span>${esc(fmtDate(r.date))} ${String(r.hour).padStart(2, '0')}:00
        <span class="muted">· ${esc(r.customer)} · ${esc(cap(r.position))} · ${esc(r.focus)}
        ${r.is_online ? '· online' : '· ' + esc(r.location)}</span></span>
      <span class="status-tag status-${esc(r.status)}">${esc(r.status)}</span>
    </div>`;
  list.innerHTML =
    `<div class="small muted" style="margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">Upcoming (${upcoming.length})</div>` +
    (upcoming.map(item).join('') || '<p class="muted">Nothing upcoming.</p>') +
    `<div class="small muted" style="margin:14px 0 4px;text-transform:uppercase;letter-spacing:.08em">Completed (${done.length})</div>` +
    done.slice(0, 8).map(item).join('');
}
