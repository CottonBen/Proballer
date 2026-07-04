// Admin dashboard: analytics, coach performance, bookings, exports.
'use strict';

let A = null;              // analytics payload
let CONFIG = null;         // /config payload (positions, cities)
let WIN = 'd30';           // selected window
const WIN_LABEL = { d7: 'past 7 days', d30: 'past 30 days', d90: 'past 90 days', all: 'all time' };

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  if (user.role !== 'admin') { location.href = DASH_FOR_ROLE[user.role] || '/'; return; }

  document.querySelectorAll('#window-pills button').forEach((b) =>
    b.addEventListener('click', () => {
      WIN = b.dataset.w;
      document.querySelectorAll('#window-pills button').forEach((x) => x.classList.toggle('on', x === b));
      renderStats();
    }));

  document.querySelectorAll('#booking-filter button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#booking-filter button').forEach((x) => x.classList.toggle('on', x === b));
      loadBookings(b.dataset.s);
    }));

  document.getElementById('cal-close').addEventListener('click', () =>
    document.getElementById('cal-backdrop').classList.remove('open'));
  document.getElementById('cal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'cal-backdrop') e.currentTarget.classList.remove('open');
  });

  document.getElementById('coach-close').addEventListener('click', () =>
    document.getElementById('coach-backdrop').classList.remove('open'));
  document.getElementById('coach-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'coach-backdrop') e.currentTarget.classList.remove('open');
  });
  document.getElementById('add-coach').addEventListener('click', () => openCoachEditor(null));

  document.getElementById('sheets-sync').addEventListener('click', syncSheets);
  document.getElementById('remove-demo').addEventListener('click', removeDemo);

  document.querySelectorAll('#invoice-filter button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#invoice-filter button').forEach((x) => x.classList.toggle('on', x === b));
      INVOICE_FILTER = b.dataset.f;
      renderCRM();
    }));

  CONFIG = await API.get('/config');
  await refresh();
  await loadBookings('');
  await loadCRM();
})().catch((e) => toast(e.message, true));

async function refresh() {
  A = await API.get('/admin/analytics');
  document.getElementById('gen-time').textContent =
    `Everything about the business, live · updated ${new Date(A.generatedAt).toLocaleTimeString('fi-FI')}`;
  document.getElementById('demo-note').hidden = !A.demoDataPresent;
  renderStats();
  renderCharts();
  renderCoachTable();
  renderExports();
}

// --- headline stats ---------------------------------------------------------
function miniRow(obj, fmt = (v) => v) {
  return `<div class="sub">7d ${fmt(obj.d7)} · 30d ${fmt(obj.d30)} · 90d ${fmt(obj.d90)} · all ${fmt(obj.all)}</div>`;
}

function renderStats() {
  const conv = A.funnel[WIN];
  const cards = [
    { label: 'Unique visitors', value: A.visitors.unique[WIN], sub: miniRow(A.visitors.unique) },
    { label: 'Page views', value: A.visitors.pageviews[WIN], sub: miniRow(A.visitors.pageviews) },
    { label: 'Booked, not completed', value: A.sessions.pending,
      sub: `<div class="sub">upcoming sessions worth ${eur(A.sessions.pendingValueCents)}</div>` },
    { label: 'Completed sessions', value: A.sessions.completed[WIN], sub: miniRow(A.sessions.completed) },
    { label: 'Booking conversion', value: conv.rate === null ? '—' : conv.rate + '%',
      sub: `<div class="sub">${conv.completed} booked of ${conv.started} who tried (${WIN_LABEL[WIN]})</div>` },
    { label: 'Revenue (completed)', value: eur(A.revenue.completedCents[WIN]),
      sub: miniRow(A.revenue.completedCents, (v) => Math.round(v / 100) + '€') },
    { label: 'New customers', value: WIN === 'all' ? A.customers.total : A.customers.new[WIN],
      sub: `<div class="sub">${A.customers.total} customer accounts in total</div>` },
    { label: 'Invoices outstanding', value: eur(A.revenue.invoicesOutstandingCents),
      sub: `<div class="sub">${eur(A.revenue.invoicesPaidCents)} already paid</div>` },
  ];
  document.getElementById('stat-cards').innerHTML = cards.map((c) => `
    <div class="card stat-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      ${c.sub || ''}
    </div>`).join('');
}

// --- charts (hand-rolled SVG, no libraries) ----------------------------------
function lineChart(series, labels, colors) {
  const Wd = 620, Ht = 200, pad = 8;
  const max = Math.max(1, ...series.flat());
  const pts = (arr) => arr.map((v, i) =>
    `${pad + i * (Wd - 2 * pad) / (arr.length - 1)},${Ht - pad - v * (Ht - 2 * pad) / max}`).join(' ');
  const area = (arr) => `${pad},${Ht - pad} ${pts(arr)} ${Wd - pad},${Ht - pad}`;
  return `<svg viewBox="0 0 ${Wd} ${Ht + 26}" preserveAspectRatio="none" role="img">
    ${[0.25, 0.5, 0.75].map((f) =>
      `<line x1="${pad}" x2="${Wd - pad}" y1="${Ht - pad - f * (Ht - 2 * pad)}" y2="${Ht - pad - f * (Ht - 2 * pad)}"
        stroke="rgba(255,255,255,0.06)"/>`).join('')}
    ${series.map((arr, i) => `
      ${i === 0 ? `<polygon points="${area(arr)}" fill="${colors[i]}" opacity="0.12"/>` : ''}
      <polyline points="${pts(arr)}" fill="none" stroke="${colors[i]}" stroke-width="2.5"
        stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <text x="${pad}" y="${Ht + 18}" fill="#94a49a" font-size="12">${labels.from}</text>
    <text x="${Wd - pad}" y="${Ht + 18}" fill="#94a49a" font-size="12" text-anchor="end">${labels.to}</text>
    <text x="${Wd - pad}" y="${pad + 12}" fill="#94a49a" font-size="12" text-anchor="end">peak ${max}</text>
  </svg>`;
}

function renderCharts() {
  const s = A.series;
  const range = { from: fmtDate(s.days[0]), to: fmtDate(s.days[s.days.length - 1]) };
  const legend = (items) => `<div class="small muted">${items.map(([c, t]) =>
    `<span style="color:${c}">●</span> ${t}`).join(' &nbsp; ')}</div>`;
  document.getElementById('charts').innerHTML = `
    <div class="card chart-card">
      <div class="chart-title"><h3 style="margin:0">Visitors — last 90 days</h3></div>
      ${legend([['#3ee586', 'page views per day']])}
      ${lineChart([s.pageviews], range, ['#3ee586'])}
    </div>
    <div class="card chart-card">
      <div class="chart-title"><h3 style="margin:0">Sessions completed</h3></div>
      ${legend([['#4ade80', 'sessions per day']])}
      ${lineChart([s.completedSessions], range, ['#4ade80'])}
    </div>
    <div class="card chart-card">
      <div class="chart-title"><h3 style="margin:0">Booking funnel</h3></div>
      ${legend([['#7fb5fb', 'started booking'], ['#3ee586', 'finished booking']])}
      ${lineChart([s.funnelStarted, s.funnelCompleted], range, ['#7fb5fb', '#3ee586'])}
    </div>`;
}

// --- coach performance table -------------------------------------------------
function renderCoachTable() {
  const t = document.getElementById('coach-table');
  t.innerHTML = `
    <tr><th>Coach</th><th>Trains</th><th>Cities</th><th>Completed<br><span style="font-weight:400">7 / 30 / 90 / all</span></th>
      <th>Upcoming</th><th>Open slots<br>next 14 d</th><th>Utilization</th>
      <th>Tier<br><span style="font-weight:400">this month</span></th>
      <th>Coach payout<br><span style="font-weight:400">this month</span></th>
      <th>Earned<br><span style="font-weight:400">completed</span></th>
      <th>Booked value<br><span style="font-weight:400">incl. upcoming</span></th><th></th></tr>` +
    A.coaches.map((c) => `
      <tr data-coach="${c.id}">
        <td><a href="#" data-cal="${c.id}"><strong>${esc(c.name)}</strong></a></td>
        <td>${c.positions.map((p) => esc(cap(p).slice(0, 3))).join(', ')}</td>
        <td>${c.locations.map(esc).join(', ')}</td>
        <td>${c.completed.d7} / ${c.completed.d30} / ${c.completed.d90} / <strong>${c.completed.all}</strong></td>
        <td>${c.upcoming}</td>
        <td>${c.slotsNext14}</td>
        <td>${c.utilization === null ? '<span class="muted">no slots</span>' : c.utilization + '%'}</td>
        <td title="${c.tier.sessionsThisMonth} sessions this month">
          <span class="chip" style="font-size:.7rem">T${c.tier.number} · ${c.tier.percent}%</span></td>
        <td>${eur(c.tier.payoutThisMonthCents)}</td>
        <td>${eur(c.revenueCompletedCents)}</td>
        <td class="muted">${eur(c.bookedValueCents)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-cal="${c.id}">Calendar</button>
          <button class="btn btn-ghost btn-sm" data-manage="${c.id}">Manage</button></td>
      </tr>`).join('');
  const openCal = (id) => openCoachCalendar(id).catch((err) => {
    document.getElementById('cal-backdrop').classList.remove('open');
    toast(err.message, true);
  });
  t.querySelectorAll('[data-cal]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault(); openCal(Number(el.dataset.cal));
  }));
  t.querySelectorAll('[data-manage]').forEach((btn) => btn.addEventListener('click', () =>
    openCoachEditor(Number(btn.dataset.manage))));
}

// --- add / manage a coach ----------------------------------------------------
const COACH_MAX_PHOTOS = 5;

// Downscale a picked image to a modest JPEG data-URL so uploads stay small
// (a few hundred KB) and the payload fits comfortably in the request. Reads via
// FileReader (a data: URL) rather than URL.createObjectURL, because the page CSP
// allows img-src 'self' data: but not blob:.
function fileToResizedDataURL(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale); height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result; // data: URL — allowed by the CSP
    };
    reader.readAsDataURL(file);
  });
}

// Add (id = null) or manage (id set) a coach: photos, bio, cities/positions,
// featured flag, and — for existing coaches — the login email/password.
async function openCoachEditor(id) {
  const bd = document.getElementById('coach-backdrop');
  const box = document.getElementById('coach-modal-body');
  bd.classList.add('open');
  box.innerHTML = '<p class="muted">Loading…</p>';

  // New coaches default INTO the hero spotlight (featured) — untick to hide.
  let coach = { name: '', bio: '', positions: [], locations: [], featured: true, photos: [],
    account: { hasLogin: false, email: null, isAdmin: false } };
  if (id) {
    try { coach = await API.get(`/admin/coaches/${id}`); }
    catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  }
  const overview = id && A ? A.coaches.find((c) => c.id === id) : null;
  const photos = coach.photos.slice(); // working list: existing paths and/or new data URLs

  const pickOn = (sel) => [...box.querySelectorAll(`${sel} .chip-toggle.on`)].map((c) => c.dataset.v);

  function renderPhotos() {
    const wrap = box.querySelector('#ce-photos');
    wrap.innerHTML = photos.map((src, i) => `
      <div style="position:relative">
        <img src="${esc(src)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">
        <button data-rm="${i}" title="Remove" style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:var(--danger);color:#fff;cursor:pointer;line-height:1;font-size:.85rem">×</button>
      </div>`).join('') || '<span class="small muted">No photos yet — add 2–3.</span>';
    wrap.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      photos.splice(Number(b.dataset.rm), 1); renderPhotos();
    }));
  }

  function accountSection() {
    const a = coach.account;
    return `
      <div style="border-top:1px dashed var(--line);margin-top:18px;padding-top:14px">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Login</div>
        ${a.isAdmin ? '<p class="small" style="color:#f7a13a;margin:0 0 8px">⚠ This coach is also an admin — changing these credentials changes an admin login.</p>' : ''}
        ${a.hasLogin
          ? `<input type="email" id="ce-acc-email" value="${esc(a.email)}" autocomplete="off">
             <input type="password" id="ce-acc-pass" placeholder="new password (leave blank to keep)" autocomplete="new-password" style="margin-top:8px">`
          : `<p class="small muted" style="margin:0 0 8px">No login yet — set an email + password so this coach can sign in and manage their own calendar.</p>
             <input type="email" id="ce-acc-email" placeholder="coach email" autocomplete="off">
             <input type="password" id="ce-acc-pass" placeholder="password (min 8 characters)" autocomplete="new-password" style="margin-top:8px">`}
        <div class="form-error" id="ce-acc-msg"></div>
        <button class="btn btn-ghost btn-sm" id="ce-acc-save" style="margin-top:6px">${a.hasLogin ? 'Update login' : 'Create login'}</button>
      </div>`;
  }

  function render() {
    const chip = (val, label, on) => `<span class="chip chip-toggle ${on ? 'on' : ''}" data-v="${esc(val)}">${esc(label)}</span>`;
    const posSet = new Set(coach.positions), locSet = new Set(coach.locations);
    box.innerHTML = `
      <h2 style="font-size:1.5rem;margin-bottom:4px">${id ? 'Manage ' + esc(coach.name) : 'Add a coach'}</h2>
      ${overview ? `<p class="small muted" style="margin:0 0 12px">
        ${overview.completed.all} sessions all-time · ${overview.upcoming} upcoming ·
        ${overview.utilization === null ? 'no open slots' : overview.utilization + '% booked'} ·
        tier T${overview.tier.number} · payout this month ${eur(overview.tier.payoutThisMonthCents)}
        <button class="btn btn-ghost btn-sm" id="ce-cal" style="margin-left:6px">Edit calendar →</button></p>` : ''}

      <label class="small muted">Photos <span style="opacity:.7">(2–3 recommended)</span></label>
      <div id="ce-photos" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"></div>
      <input type="file" id="ce-file" accept="image/*" multiple style="margin-bottom:14px">

      <label class="small muted">Name</label>
      <input type="text" id="ce-name" value="${esc(coach.name)}" maxlength="60" style="margin:4px 0 12px">

      <label class="small muted">Bio</label>
      <textarea id="ce-bio" rows="4" maxlength="1200" style="margin:4px 0 12px">${esc(coach.bio)}</textarea>

      <label class="small muted">Positions they coach</label>
      <div id="ce-pos" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px">
        ${CONFIG.positions.map((p) => chip(p, cap(p), posSet.has(p))).join('')}</div>

      <label class="small muted">Cities</label>
      <div id="ce-loc" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px">
        ${CONFIG.locations.map((l) => chip(l, l, locSet.has(l))).join('')}</div>

      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" id="ce-featured" ${coach.featured ? 'checked' : ''} style="width:auto">
        <span class="small">Feature in the homepage hero carousel</span></label>

      ${!id ? `<div class="small muted" style="border-top:1px dashed var(--line);padding-top:12px;margin-bottom:6px">
          Give them a login (optional — you can add it later)</div>
        <input type="email" id="ce-email" placeholder="coach email" autocomplete="off" style="margin-bottom:8px">
        <input type="password" id="ce-pass" placeholder="password (min 8 characters)" autocomplete="new-password" style="margin-bottom:12px">` : ''}

      <div class="form-error" id="ce-msg"></div>
      <button class="btn btn-primary" id="ce-save" style="width:100%">${id ? 'Save details' : 'Create coach'}</button>
      ${id ? accountSection() : ''}`;

    renderPhotos();
    box.querySelectorAll('.chip-toggle').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));

    box.querySelector('#ce-file').addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        if (photos.length >= COACH_MAX_PHOTOS) { toast(`Up to ${COACH_MAX_PHOTOS} photos.`, true); break; }
        try { photos.push(await fileToResizedDataURL(f)); } catch (err) { toast(err.message, true); }
      }
      renderPhotos();
    });

    const calBtn = box.querySelector('#ce-cal');
    if (calBtn) calBtn.addEventListener('click', () => {
      bd.classList.remove('open');
      openCoachCalendar(id).catch((err) => toast(err.message, true));
    });

    box.querySelector('#ce-save').addEventListener('click', async () => {
      const msg = box.querySelector('#ce-msg'); msg.textContent = '';
      const payload = {
        name: box.querySelector('#ce-name').value.trim(),
        bio: box.querySelector('#ce-bio').value.trim(),
        positions: pickOn('#ce-pos'),
        locations: pickOn('#ce-loc'),
        featured: box.querySelector('#ce-featured').checked,
        photos,
      };
      if (!id) {
        const email = box.querySelector('#ce-email').value.trim();
        const pass = box.querySelector('#ce-pass').value;
        if (email || pass) { payload.email = email; payload.password = pass; }
      }
      const btn = box.querySelector('#ce-save'); btn.disabled = true;
      const orig = btn.textContent; btn.textContent = 'Saving…';
      try {
        if (id) await API.put(`/admin/coaches/${id}`, payload);
        else await API.post('/admin/coaches', payload);
        toast(id ? 'Coach updated.' : 'Coach added.');
        bd.classList.remove('open');
        await refresh();
      } catch (err) { msg.textContent = err.message; btn.disabled = false; btn.textContent = orig; }
    });

    if (id) box.querySelector('#ce-acc-save').addEventListener('click', async () => {
      const msg = box.querySelector('#ce-acc-msg'); msg.textContent = '';
      const email = box.querySelector('#ce-acc-email').value.trim();
      const pass = box.querySelector('#ce-acc-pass').value;
      const body = {}; if (email) body.email = email; if (pass) body.password = pass;
      const btn = box.querySelector('#ce-acc-save'); btn.disabled = true;
      try {
        const r = await API.put(`/admin/coaches/${id}/account`, body);
        toast(r.created ? 'Login created.' : 'Login updated.');
        coach.account.hasLogin = true;
        if (email) coach.account.email = email;
        render();
      } catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }

  render();
}

// Editable two-week calendar for one coach: the admin can open and close
// slots exactly like the coach can (booked and past cells stay locked).
async function openCoachCalendar(id) {
  const bd = document.getElementById('cal-backdrop');
  const box = document.getElementById('cal-modal-body');
  bd.classList.add('open');
  box.innerHTML = '<p class="muted">Loading calendar…</p>';
  const [data, site] = await Promise.all([
    API.get(`/admin/coaches/${id}/calendar`),
    API.get('/config'),
  ]);
  const avail = new Set(data.slots.map((s) => `${s.date}|${s.hour}`));
  const booked = new Map(data.bookings.map((b) => [`${b.date}|${b.hour}`, b]));
  const pending = new Map(); // "date|hour" -> 'add' | 'remove'
  const days = [];
  for (let d = new Date(data.from + 'T12:00:00Z'); days.length < 14; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  function paint() {
    let grid = '<div class="cal" style="grid-template-columns:64px repeat(14, minmax(52px,1fr));min-width:900px">';
    grid += '<div></div>' + days.map((d) => `
      <div class="hd ${d === data.from ? 'today' : ''}"><div class="dow">${fmtDate(d).split(' ')[0]}</div>
      <div class="num" style="font-size:1rem">${d.slice(8)}</div></div>`).join('');
    for (let h = site.hours.start; h < site.hours.end; h++) {
      grid += `<div class="hr">${String(h).padStart(2, '0')}</div>`;
      for (const d of days) {
        const k = `${d}|${h}`;
        const b = booked.get(k);
        let cls = 'cal-cell';
        if (b) cls += ' booked';
        else if (pending.get(k) === 'add') cls += ' pending-add';
        else if (pending.get(k) === 'remove') cls += ' pending-remove';
        else if (avail.has(k)) cls += ' avail';
        grid += `<div class="${cls}" data-k="${k}" style="height:26px" data-label=""
          title="${b ? esc(`${b.customer} · ${cap(b.position)} · ${b.focus}`) : ''}"></div>`;
      }
    }
    grid += '</div>';
    box.innerHTML = `
      <h2 style="font-size:1.7rem">${esc(data.coach.name)} — next 14 days</h2>
      <p class="muted small">${data.coach.locations.map(esc).join(', ')} ·
        trains ${data.coach.positions.map((p) => esc(cap(p))).join(', ')} ·
        click hours to open/close them for booking</p>
      <div class="cal-scroll">${grid}</div>
      <div class="cal-legend">
        <span><i style="background:rgba(255,255,255,0.05);border:1px solid var(--line)"></i>Not available</span>
        <span><i style="background:rgba(62,229,134,0.25)"></i>Open for booking</span>
        <span><i style="background:var(--lime)"></i>Booked (hover for details)</span>
        <span><i style="background:rgba(62,229,134,0.5)"></i>Unsaved change</span>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary btn-sm" id="cal-save" ${pending.size ? '' : 'disabled'}>
          ${pending.size ? `Save changes (${pending.size})` : 'Save changes'}</button>
      </div>`;

    box.querySelectorAll('.cal-cell').forEach((cell) => cell.addEventListener('click', () => {
      const k = cell.dataset.k;
      if (cell.classList.contains('booked')) return;
      if (pending.has(k)) pending.delete(k);
      else pending.set(k, avail.has(k) ? 'remove' : 'add');
      paint();
    }));

    const saveBtn = box.querySelector('#cal-save');
    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true; // guard against double-submit
      saveBtn.textContent = 'Saving…';
      const adds = [], removes = [];
      for (const [k, op] of pending) {
        const [date, hour] = k.split('|');
        (op === 'add' ? adds : removes).push({ date, hour: Number(hour) });
      }
      try {
        const r = await API.put(`/admin/coaches/${id}/availability`, { adds, removes });
        let msg = `Saved — ${r.added} opened, ${r.removed} closed.`;
        if (r.conflicts.length) msg += ` ${r.conflicts.length} could not be closed (booked).`;
        if (r.rejected.length) msg += ` ${r.rejected.length} skipped (past hours).`;
        toast(msg, r.conflicts.length > 0);
        await refresh();
        if (document.getElementById('cal-backdrop').classList.contains('open')) {
          openCoachCalendar(id).catch((err) => toast(err.message, true)); // reload with saved state
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = `Save changes (${pending.size})`;
        toast(err.message, true);
      }
    });
  }
  paint();
}

// --- bookings table -----------------------------------------------------------
async function loadBookings(status) {
  const rows = await API.get('/admin/bookings' + (status ? `?status=${status}` : ''));
  const t = document.getElementById('bookings-table');
  t.innerHTML = `
    <tr><th>Ref</th><th>When</th><th>Coach</th><th>Customer</th><th>Session</th>
      <th>Total</th><th>Status</th><th>Invoice</th><th></th></tr>` +
    rows.map((b) => `
      <tr>
        <td class="muted">${esc(b.code)}</td>
        <td>${esc(fmtDate(b.date))} ${String(b.hour).padStart(2, '0')}:00</td>
        <td>${esc(b.coach)}</td>
        <td title="${esc(b.customer_email)}">${esc(b.customer)}</td>
        <td>${esc(cap(b.position))} · ${esc(b.focus)}${b.is_online ? ' · online' : ' · ' + esc(b.location)}</td>
        <td>${eur(b.total_cents)}</td>
        <td><span class="status-tag status-${esc(b.status)}">${esc(b.status)}</span></td>
        <td>${b.invoice_number
          ? `<a href="/api/invoices/${encodeURIComponent(b.invoice_number)}" target="_blank">${esc(b.invoice_number)}</a>
             <span class="muted small">${esc(b.invoice_status)}</span>` : '—'}</td>
        <td style="white-space:nowrap">
          ${b.status === 'confirmed' ? `
            <button class="btn btn-ghost btn-sm" data-act="completed" data-id="${b.id}"
              ${b.date > A.today ? 'disabled title="Available after the session has taken place"' : ''}>Done</button>
            <button class="btn btn-danger btn-sm" data-act="cancelled" data-id="${b.id}">Cancel</button>` : ''}
          ${b.invoice_status === 'sent' ? `<button class="btn btn-ghost btn-sm" data-paid="${esc(b.invoice_number)}">Mark paid</button>` : ''}
        </td>
      </tr>`).join('');

  t.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.act === 'cancelled' && !confirm('Cancel this booking? The invoice will be voided and the customer gets a free-session credit.')) return;
    btn.disabled = true;
    try {
      await API.post(`/admin/bookings/${btn.dataset.id}/status`, { status: btn.dataset.act });
      toast('Booking updated.');
      await Promise.all([refresh(), loadBookings(status), loadCRM()]);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  }));
  t.querySelectorAll('[data-paid]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await API.post(`/admin/invoices/${encodeURIComponent(btn.dataset.paid)}/paid`, {});
      toast('Invoice marked as paid.');
      await Promise.all([refresh(), loadBookings(status), loadCRM()]);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  }));
}

// --- CRM: customers + invoices -------------------------------------------------
let CRM = null;
let INVOICE_FILTER = '';

async function loadCRM() {
  CRM = await API.get('/admin/crm');
  renderCRM();
}

function renderCRM() {
  if (!CRM) return;
  document.getElementById('crm-stats').innerHTML = [
    { label: 'Invoices paid', value: eur(CRM.totals.paidCents) },
    { label: 'Outstanding', value: eur(CRM.totals.outstandingCents),
      sub: `<div class="sub">${CRM.totals.overdue} overdue</div>` },
    { label: 'Customer accounts', value: CRM.customers.length },
  ].map((c) => `<div class="card stat-card"><div class="label">${c.label}</div>
    <div class="value" style="font-size:2rem">${c.value}</div>${c.sub || ''}</div>`).join('');

  const ct = document.getElementById('crm-customers');
  document.getElementById('crm-empty').hidden = CRM.customers.length > 0;
  ct.innerHTML = CRM.customers.length ? `
    <tr><th>Customer</th><th>Email</th><th>Signed up</th><th>Bookings</th>
      <th>Done / upcoming / cancelled</th><th>Paid</th><th>Outstanding</th>
      <th>Free credits</th><th>Last session</th></tr>` +
    CRM.customers.map((c) => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
        <td>${esc(c.signed_up)}</td>
        <td><strong>${c.bookings}</strong></td>
        <td>${c.completed || 0} / ${c.upcoming || 0} / ${c.cancelled || 0}</td>
        <td>${eur(c.paid_cents)}</td>
        <td>${c.outstanding_cents ? `<strong style="color:#f7a13a">${eur(c.outstanding_cents)}</strong>` : eur(0)}</td>
        <td>${c.free_credits || ''}</td>
        <td class="muted">${c.last_session ? esc(fmtDate(c.last_session)) : '—'}</td>
      </tr>`).join('') : '';

  const today = A ? A.today : '';
  const rows = CRM.invoices.filter((i) => !INVOICE_FILTER || i.status === INVOICE_FILTER);
  document.getElementById('crm-invoices').innerHTML = `
    <tr><th>Invoice</th><th>Customer</th><th>Coach</th><th>Amount</th>
      <th>Issued</th><th>Due</th><th>Status</th><th></th></tr>` +
    rows.map((i) => {
      const overdue = i.status === 'sent' && today && i.due_date < today;
      return `
      <tr>
        <td><a href="/api/invoices/${encodeURIComponent(i.number)}" target="_blank">${esc(i.number)}</a></td>
        <td title="${esc(i.customer_email)}">${esc(i.customer)}</td>
        <td>${esc(i.coach)}</td>
        <td>${eur(i.amount_cents)}</td>
        <td class="muted">${esc(i.issued)}</td>
        <td class="${overdue ? '' : 'muted'}" ${overdue ? 'style="color:var(--danger)"' : ''}>
          ${esc(i.due_date)}${overdue ? ' ⚠' : ''}</td>
        <td><span class="status-tag ${i.status === 'paid' ? 'status-completed' : i.status === 'void' ? 'status-cancelled' : 'status-confirmed'}">${esc(i.status)}</span></td>
        <td>${i.status === 'sent'
          ? `<button class="btn btn-ghost btn-sm" data-crm-paid="${esc(i.number)}">Mark paid</button>` : ''}</td>
      </tr>`;
    }).join('');

  document.querySelectorAll('[data-crm-paid]').forEach((btn) => btn.addEventListener('click', async () => {
    await API.post(`/admin/invoices/${encodeURIComponent(btn.dataset.crmPaid)}/paid`, {});
    toast('Invoice marked as paid.');
    await Promise.all([refresh(), loadCRM(), loadBookings('')]);
  }));

  const reviews = CRM.reviews || [];
  document.getElementById('crm-reviews-empty').hidden = reviews.length > 0;
  document.getElementById('crm-reviews').innerHTML = reviews.length ? `
    <tr><th>Coach</th><th>Rating</th><th>Reviewer</th><th>Review</th><th>Date</th><th></th></tr>` +
    reviews.map((r) => `
      <tr>
        <td>${esc(r.coach)}</td>
        <td>${starsHTML(r.rating)} <span class="muted small">${r.rating}</span></td>
        <td>${esc(r.author_name)}${r.demo ? ' <span class="chip gray" style="font-size:.65rem">demo</span>' : ''}</td>
        <td class="muted">${r.body ? esc(r.body) : '<em>no comment</em>'}</td>
        <td class="muted">${esc(r.date)}</td>
        <td><button class="btn btn-ghost btn-sm" data-del-review="${r.id}">Delete</button></td>
      </tr>`).join('') : '';

  document.querySelectorAll('[data-del-review]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this review permanently?')) return;
    btn.disabled = true;
    try {
      await API.post(`/admin/reviews/${btn.dataset.delReview}/delete`, {});
      toast('Review deleted.');
      await loadCRM();
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  }));
}

// --- data & export ------------------------------------------------------------
function renderExports() {
  const names = ['Bookings', 'Invoices', 'Coaches', 'CoachPayouts', 'Availability', 'VisitsDaily', 'Funnel', 'Customers', 'Reviews'];
  document.getElementById('csv-links').innerHTML = names.map((n) =>
    `<a class="btn btn-ghost btn-sm" href="/api/admin/export/${n}.csv">${n}.csv</a>`).join('');
  const st = A.sheets;
  document.getElementById('sheets-status').innerHTML = st.configured
    ? `Connected ✓ — last sync: ${st.lastSync ? new Date(st.lastSync).toLocaleString('fi-FI') : 'not yet'}`
    : 'Not connected yet — data stays local until you connect a sheet.';
}

async function syncSheets() {
  try {
    const res = await API.post('/admin/sheets/sync', {});
    if (res.synced) { toast(`Synced ${res.tabs.length} tabs to Google Sheets.`); await refresh(); }
    else toast('Google Sheets is not connected yet — see the README for the 2-minute setup.', true);
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeDemo() {
  if (!confirm('Remove ALL demo data (example coaches, bookings, visits)? Your real accounts stay.')) return;
  await API.post('/admin/demo-data/remove', {});
  toast('Demo data removed — dashboard now shows only real activity.');
  await refresh();
  await loadBookings('');
}
