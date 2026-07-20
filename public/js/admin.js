// Admin dashboard: analytics, coach performance, bookings, exports.
'use strict';

let A = null;              // analytics payload
let CONFIG = null;         // /config payload (positions, cities)
let WIN = 'd30';           // selected window
const WIN_LABEL = {
  d7: t('admin.window.label.d7'), d30: t('admin.window.label.d30'),
  d90: t('admin.window.label.d90'), all: t('admin.window.label.all'),
};

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

  // "Send due emails now": runs the same sweep the server runs automatically.
  document.getElementById('emails-run').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await API.post('/admin/emails/run', {});
      toast(t('admin.emails.run.done', { review: r.sent.review, rebook: r.sent.rebook }));
      await loadEmails();
    } catch (err) {
      toast(I18N.server(err.message), true);
    }
    btn.disabled = false;
  });

  CONFIG = await API.get('/config');
  await refresh();
  await loadBookings('');
  await loadCRM();
  await loadFinance();
  await loadGroups();
  await loadPackages();
  await loadEmails();
})().catch((e) => toast(I18N.server(e.message), true));

// --- group training: sessions, rosters, attendance, edit/cancel ---------------
let groupEditId = null;
async function loadGroups() {
  const rows = await API.get('/admin/groups');
  const tbl = document.getElementById('groups-table');
  document.getElementById('groups-empty').hidden = rows.length > 0;
  if (!rows.length) { tbl.innerHTML = ''; return; }
  const hourSep = I18N.lang === 'fi' ? '.' : ':';
  tbl.innerHTML = `
    <tr><th>${t('admin.groups.th.when')}</th><th>${t('admin.groups.th.coach')}</th><th>${t('admin.groups.th.where')}</th>
      <th>${t('admin.groups.th.players')}</th><th>${t('admin.groups.th.status')}</th><th></th></tr>` +
    rows.map((g) => {
      const editing = groupEditId === g.id;
      const whenCell = editing
        ? `<input type="date" class="input" id="ge-date" value="${esc(g.date)}" style="width:140px">
           <select class="input" id="ge-hour" style="width:90px">${Array.from({ length: 12 }, (_, i) => 8 + i).map((h) =>
             `<option value="${h}" ${h === g.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}${hourSep}00</option>`).join('')}</select>`
        : `${esc(fmtDate(g.date))} ${String(g.hour).padStart(2, '0')}${hourSep}00`;
      const whereCell = editing
        ? `<select class="input" id="ge-city" style="width:110px">${(CONFIG.locations || []).map((c) =>
            `<option ${c === g.location ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
        : esc(g.location);
      const players = g.players.map((p) =>
        `<span class="chip ${p.paid ? '' : 'gray'}" title="${esc(p.email)}">${esc(p.name)}${
          g.status === 'open'
            ? `<button class="link-btn" data-rmplayer="${g.id}:${p.signupId}" data-name="${esc(p.name)}"
                 style="padding:0 0 0 5px">×</button>` : ''}</span>`).join(' ');
      const actions = g.status !== 'open' ? '' : (editing
        ? `<button class="btn btn-primary btn-sm" data-gsave="${g.id}">${t('admin.groups.save')}</button>`
        : `<button class="btn btn-ghost btn-sm" data-gedit="${g.id}">${t('admin.groups.edit')}</button>
           <button class="btn btn-ghost btn-sm" data-gaddp="${g.id}">${t('admin.groups.addplayer')}</button>
           <button class="btn btn-ghost btn-sm" data-gdel="${g.id}" data-code="${esc(g.code)}">${t('admin.groups.cancel_btn')}</button>`);
      return `<tr>
        <td style="white-space:nowrap">${whenCell}<br><span class="muted small">${esc(g.code)}</span></td>
        <td>${esc(g.coach)}</td>
        <td>${whereCell}</td>
        <td>${g.taken}/${g.capacity} · ${t('admin.groups.attendance', { n: g.attendance })}<br>${players}</td>
        <td><span class="status-tag status-${g.status === 'open' ? 'confirmed' : esc(g.status)}">${t('admin.groups.status.' + g.status)}</span></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');

  tbl.querySelectorAll('[data-gedit]').forEach((b) => b.addEventListener('click', () => {
    groupEditId = Number(b.dataset.gedit);
    loadGroups();
  }));
  tbl.querySelectorAll('[data-gsave]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await API.put(`/admin/groups/${b.dataset.gsave}`, {
        date: document.getElementById('ge-date').value,
        hour: Number(document.getElementById('ge-hour').value),
        location: document.getElementById('ge-city').value,
      });
      groupEditId = null;
      await loadGroups();
    } catch (e) { b.disabled = false; toast(I18N.server(e.message), true); }
  }));
  tbl.querySelectorAll('[data-gaddp]').forEach((b) => b.addEventListener('click', async () => {
    const email = prompt(t('admin.groups.addplayer_prompt'));
    if (!email) return;
    try {
      await API.post(`/admin/groups/${b.dataset.gaddp}/players`, { email });
      await loadGroups();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
  tbl.querySelectorAll('[data-rmplayer]').forEach((b) => b.addEventListener('click', async () => {
    const [gid, sid] = b.dataset.rmplayer.split(':');
    if (!confirm(t('admin.groups.removeplayer_confirm', { name: b.dataset.name }))) return;
    try {
      await API.del(`/admin/groups/${gid}/players/${sid}`);
      await loadGroups();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
  tbl.querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('admin.groups.cancel_confirm', { code: b.dataset.code }))) return;
    b.disabled = true;
    try {
      await API.post(`/admin/groups/${b.dataset.gdel}/cancel`, {});
      await loadGroups();
    } catch (e) { b.disabled = false; toast(I18N.server(e.message), true); }
  }));
}

// --- prepaid packages: balances + manual +1/−1 corrections --------------------
async function loadPackages() {
  const rows = await API.get('/admin/packages');
  const tbl = document.getElementById('packages-table');
  document.getElementById('packages-empty').hidden = rows.length > 0;
  if (!rows.length) { tbl.innerHTML = ''; return; }
  tbl.innerHTML = `
    <tr><th>${t('admin.pkg.th.customer')}</th><th>${t('admin.pkg.th.package')}</th><th>${t('admin.pkg.th.remaining')}</th>
      <th>${t('admin.pkg.th.purchased')}</th><th>${t('admin.pkg.th.status')}</th><th></th></tr>` +
    rows.map((p) => `
      <tr>
        <td>${esc(p.customer)}<br><span class="muted small">${esc(p.email)}</span></td>
        <td>${t('admin.pkg.row', { n: p.sessions, price: eur(p.priceCents) })}<br><span class="muted small">${esc(p.code)}</span></td>
        <td><strong>${p.remaining}</strong> <span class="muted small">${t('mybookings.pkg.used',
          { used: p.used, total: p.sessions + p.adjusted })}</span></td>
        <td class="muted">${esc(p.purchasedAt)}</td>
        <td><span class="status-tag status-${p.status === 'active' ? 'confirmed' : 'cancelled'}">${t(
          'mybookings.pkg.status.' + (p.status === 'active' ? 'active' : 'pending'))}</span></td>
        <td style="white-space:nowrap">${p.status === 'active'
          ? `<button class="btn btn-ghost btn-sm" data-padj="${p.id}:1">+1</button>
             <button class="btn btn-ghost btn-sm" data-padj="${p.id}:-1">−1</button>` : ''}</td>
      </tr>`).join('');
  tbl.querySelectorAll('[data-padj]').forEach((b) => b.addEventListener('click', async () => {
    const [id, delta] = b.dataset.padj.split(':');
    b.disabled = true;
    try {
      const r = await API.post(`/admin/packages/${id}/adjust`, { delta: Number(delta) });
      toast(t('admin.pkg.adjusted', { n: r.remaining }));
      await loadPackages();
    } catch (e) { b.disabled = false; toast(I18N.server(e.message), true); }
  }));
}

// --- email communications: automation status + send log ----------------------
async function loadEmails() {
  const data = await API.get('/admin/emails');
  const typeLabel = (ty) => {
    const key = 'admin.emails.type.' + ty;
    return I18N_DICT[key] ? t(key) : ty;
  };
  const counts = Object.entries(data.counts || {})
    .map(([ty, c]) => `${typeLabel(ty)} ${c.ok}/${c.total}`).join(' · ');
  document.getElementById('emails-status').textContent =
    (data.lastRun
      ? t('admin.emails.lastrun', { time: new Date(data.lastRun).toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB') })
      : t('admin.emails.norun'))
    + (counts ? ` · ${t('admin.emails.counts')}: ${counts}` : '');

  const recent = data.recent || [];
  document.getElementById('email-log-empty').hidden = recent.length > 0;
  document.getElementById('email-log').innerHTML = recent.length ? `
    <tr><th>${t('admin.emails.log.time')}</th><th>${t('admin.emails.log.type')}</th><th>${t('admin.emails.log.to')}</th>
      <th>${t('admin.emails.log.subject')}</th><th>${t('admin.emails.log.status')}</th></tr>` +
    recent.map((r) => `
      <tr>
        <td class="muted">${esc(new Date(r.created_at).toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB'))}</td>
        <td>${esc(typeLabel(r.type))}${r.booking_code ? ` <span class="muted small">${esc(r.booking_code)}</span>` : ''}</td>
        <td>${esc(r.to_email)}</td>
        <td class="muted">${esc(r.subject)}</td>
        <td>${r.ok ? '<span style="color:var(--lime)">✓</span>'
          : `<span style="color:#ff6b6b" title="${esc(r.error || '')}">✗ ${esc((r.error || '').slice(0, 40))}</span>`}</td>
      </tr>`).join('') : '';
}

async function refresh() {
  A = await API.get('/admin/analytics');
  document.getElementById('gen-time').textContent = t('admin.subtitle.updated',
    { time: new Date(A.generatedAt).toLocaleTimeString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB') });
  document.getElementById('demo-note').hidden = !A.demoDataPresent;
  renderStats();
  renderCharts();
  renderCoachTable();
  renderExports();
  renderEmailStatus();
}

// --- email delivery status + test button -------------------------------------
// Customer emails fail SILENTLY (fire-and-forget) — this banner surfaces the
// last SMTP error and lets the admin send themselves a test email.
function renderEmailStatus() {
  const box = document.getElementById('email-note');
  if (!box || !A.email) return;
  const e = A.email;
  const bad = !e.configured || e.verified === false || Boolean(e.lastError);
  box.hidden = false;
  box.style.borderColor = bad ? 'rgba(255,107,107,.5)' : 'var(--line)';
  box.innerHTML = `
    <strong style="color:${bad ? '#ff6b6b' : 'var(--lime)'}">📧 ${bad ? t('admin.email.problem') : t('admin.email.ok')}</strong>
    <span class="muted small">${e.configured
      ? t('admin.email.host', { host: esc(e.host || '?') })
        + (e.lastSentAt ? ` · ${t('admin.email.lastsent', { time: new Date(e.lastSentAt).toLocaleString() })}` : '')
      : t('admin.email.notconfigured')}</span>
    ${e.lastError ? `<div class="small" style="color:#ff6b6b;margin-top:6px">${esc(e.lastError)}
      <span class="muted">(${esc(e.lastErrorAt ? new Date(e.lastErrorAt).toLocaleString() : '')})</span></div>` : ''}
    ${e.configured ? `<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="test-email">${t('admin.email.test')}</button>
      <span class="small muted" id="test-email-result"></span></div>` : ''}`;
  const btn = document.getElementById('test-email');
  if (btn) btn.addEventListener('click', async () => {
    const out = document.getElementById('test-email-result');
    btn.disabled = true;
    out.style.color = '';
    out.textContent = t('admin.email.testing');
    try {
      const r = await API.post('/admin/test-email', {});
      out.style.color = r.delivered ? 'var(--lime)' : '#ff6b6b';
      out.textContent = r.delivered ? t('admin.email.test_ok', { to: r.to }) : (r.error || t('admin.email.test_fail'));
    } catch (err) {
      out.style.color = '#ff6b6b';
      out.textContent = I18N.server(err.message);
    }
    btn.disabled = false;
  });
}

// --- headline stats ---------------------------------------------------------
function miniRow(obj, fmt = (v) => v) {
  return `<div class="sub">${t('admin.stats.minirow',
    { d7: fmt(obj.d7), d30: fmt(obj.d30), d90: fmt(obj.d90), all: fmt(obj.all) })}</div>`;
}

function renderStats() {
  const conv = A.funnel[WIN];
  const cards = [
    { label: t('admin.stats.visitors'), value: A.visitors.unique[WIN], sub: miniRow(A.visitors.unique) },
    { label: t('admin.stats.pageviews'), value: A.visitors.pageviews[WIN], sub: miniRow(A.visitors.pageviews) },
    { label: t('admin.stats.pending'), value: A.sessions.pending,
      sub: `<div class="sub">${t('admin.stats.pending.sub', { amount: eur(A.sessions.pendingValueCents) })}</div>` },
    { label: t('admin.stats.completed'), value: A.sessions.completed[WIN], sub: miniRow(A.sessions.completed) },
    { label: t('admin.stats.conversion'), value: conv.rate === null ? '—' : t('admin.percent', { pct: conv.rate }),
      sub: `<div class="sub">${t('admin.stats.conversion.sub',
        { completed: conv.completed, started: conv.started, window: WIN_LABEL[WIN] })}</div>` },
    { label: t('admin.stats.revenue'), value: eur(A.revenue.completedCents[WIN]),
      sub: miniRow(A.revenue.completedCents, (v) => Math.round(v / 100) + '€') },
    { label: t('admin.stats.newcustomers'), value: WIN === 'all' ? A.customers.total : A.customers.new[WIN],
      sub: `<div class="sub">${t('admin.stats.newcustomers.sub', { count: A.customers.total })}</div>` },
    { label: t('admin.stats.outstanding'), value: eur(A.revenue.invoicesOutstandingCents),
      sub: `<div class="sub">${t('admin.stats.outstanding.sub', { amount: eur(A.revenue.invoicesPaidCents) })}</div>` },
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
    <text x="${pad}" y="${Ht + 18}" fill="#a6a6ab" font-size="12">${labels.from}</text>
    <text x="${Wd - pad}" y="${Ht + 18}" fill="#a6a6ab" font-size="12" text-anchor="end">${labels.to}</text>
    <text x="${Wd - pad}" y="${pad + 12}" fill="#a6a6ab" font-size="12" text-anchor="end">${t('admin.chart.peak', { max })}</text>
  </svg>`;
}

// The funnel/sessions/visitors charts were replaced with plain numbers
// (owner's call): the same series, summed over the visible window.
function renderCharts() {
  const s = A.series;
  const range = { from: fmtDate(s.days[0]), to: fmtDate(s.days[s.days.length - 1]) };
  const sum = (arr) => (arr || []).reduce((a, b) => a + b, 0);
  const num = (label, value) => `
    <div class="card stat-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${esc(range.from)} – ${esc(range.to)}</div>
    </div>`;
  document.getElementById('charts').innerHTML =
    num(t('admin.numbers.pageviews'), sum(s.pageviews))
    + num(t('admin.numbers.sessions'), sum(s.completedSessions))
    + num(t('admin.numbers.started'), sum(s.funnelStarted))
    + num(t('admin.numbers.completed'), sum(s.funnelCompleted));
}

// --- financial model: revenue by product, payouts, net — per month -----------
async function loadFinance() {
  let f;
  try { f = await API.get('/admin/finance'); } catch { return; }
  const tbl = document.getElementById('finance-table');
  if (!tbl) return;
  const money = (c) => eur(c);
  tbl.innerHTML = `
    <tr><th>${t('admin.finance.th.month')}</th><th>${t('admin.finance.th.oneonone')}</th>
      <th>${t('admin.finance.th.groups')}</th><th>${t('admin.finance.th.packages')}</th>
      <th>${t('admin.finance.th.revenue')}</th><th>${t('admin.finance.th.payouts')}</th>
      <th>${t('admin.finance.th.net')}</th></tr>` +
    f.months.map((m) => `
      <tr>
        <td class="muted">${esc(m.month)}</td>
        <td>${money(m.oneOnOneCents)}</td>
        <td>${money(m.groupCents)}</td>
        <td>${money(m.packageCents)}</td>
        <td><strong>${money(m.revenueCents)}</strong></td>
        <td>${money(m.payoutCents)}</td>
        <td><strong style="color:${m.netCents >= 0 ? 'var(--lime)' : '#ff6b6b'}">${money(m.netCents)}</strong></td>
      </tr>`).join('') + `
      <tr style="border-top:2px solid var(--line)">
        <td class="muted">Σ</td><td></td><td></td><td></td>
        <td><strong>${money(f.totals.revenueCents)}</strong></td>
        <td>${money(f.totals.payoutCents)}</td>
        <td><strong style="color:${f.totals.netCents >= 0 ? 'var(--lime)' : '#ff6b6b'}">${money(f.totals.netCents)}</strong></td>
      </tr>`;
  document.getElementById('finance-outlook').innerHTML =
    `${t('admin.finance.upcoming', { n: f.outlook.upcomingSessions, sum: eur(f.outlook.upcomingPayoutCents) })}
     · ${t('admin.finance.owed', { n: f.outlook.prepaidSessionsOwed })}`;
}

// --- get-in-touch requests from the landing menu ------------------------------
function renderContactRequests() {
  const tbl = document.getElementById('crm-contact');
  if (!tbl) return;
  const rows = (CRM.contactRequests || []).filter((r) => !r.handled_at);
  document.getElementById('crm-contact-empty').hidden = rows.length > 0;
  tbl.innerHTML = rows.length ? rows.map((r) => `
    <tr>
      <td><strong>${esc(r.contact)}</strong> <span class="muted small">${r.kind === 'email' ? '✉️' : '📞'}</span></td>
      <td class="muted">${esc(r.date)}</td>
      <td><button class="btn btn-ghost btn-sm" data-handled="${r.id}">${t('admin.crm.contact.mark')}</button></td>
    </tr>`).join('') : '';
  tbl.querySelectorAll('[data-handled]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await API.post(`/admin/contact-requests/${b.dataset.handled}/handled`, {});
      await loadCRM();
    } catch (e) { b.disabled = false; toast(I18N.server(e.message), true); }
  }));
}

// --- coach performance table -------------------------------------------------
function renderCoachTable() {
  const tbl = document.getElementById('coach-table');
  tbl.innerHTML = `
    <tr><th>${t('mybookings.table.coach')}</th><th>${t('admin.coachtable.trains')}</th><th>${t('admin.coachtable.cities')}</th><th>${t('admin.coachtable.completed')}<br><span style="font-weight:400">${t('admin.coachtable.completed.sub')}</span></th>
      <th>${t('admin.coachtable.upcoming')}</th><th>${t('admin.coachtable.openslots')}<br>${t('admin.coachtable.openslots.sub')}</th><th>${t('admin.coachtable.utilization')}</th>
      <th>${t('admin.coachtable.tier')}<br><span style="font-weight:400">${t('admin.coachtable.thismonth')}</span></th>
      <th>${t('admin.coachtable.payout')}<br><span style="font-weight:400">${t('admin.coachtable.thismonth')}</span></th>
      <th>${t('admin.coachtable.earned')}<br><span style="font-weight:400">${t('admin.coachtable.earned.sub')}</span></th>
      <th>${t('admin.coachtable.bookedvalue')}<br><span style="font-weight:400">${t('admin.coachtable.bookedvalue.sub')}</span></th><th></th></tr>` +
    A.coaches.map((c) => `
      <tr data-coach="${c.id}">
        <td><a href="#" data-cal="${c.id}"><strong>${esc(c.name)}</strong></a></td>
        <td>${c.positions.map((p) => esc(posLabel(p).slice(0, 3))).join(', ')}</td>
        <td>${c.locations.map(esc).join(', ')}</td>
        <td>${c.completed.d7} / ${c.completed.d30} / ${c.completed.d90} / <strong>${c.completed.all}</strong></td>
        <td>${c.upcoming}</td>
        <td>${c.slotsNext14}</td>
        <td>${c.utilization === null ? `<span class="muted">${t('admin.coachtable.noslots')}</span>` : t('admin.percent', { pct: c.utilization })}</td>
        <td title="${t('admin.coachtable.tier.title', { count: c.tier.sessionsThisMonth })}">
          <span class="chip" style="font-size:.7rem">T${c.tier.number} · ${t('admin.percent', { pct: c.tier.percent })}</span></td>
        <td>${eur(c.tier.payoutThisMonthCents)}</td>
        <td>${eur(c.revenueCompletedCents)}</td>
        <td class="muted">${eur(c.bookedValueCents)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-cal="${c.id}">${t('admin.coachtable.calendar')}</button>
          <button class="btn btn-ghost btn-sm" data-manage="${c.id}">${t('admin.coachtable.manage')}</button></td>
      </tr>`).join('');
  const openCal = (id) => openCoachCalendar(id).catch((err) => {
    document.getElementById('cal-backdrop').classList.remove('open');
    toast(I18N.server(err.message), true);
  });
  tbl.querySelectorAll('[data-cal]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault(); openCal(Number(el.dataset.cal));
  }));
  tbl.querySelectorAll('[data-manage]').forEach((btn) => btn.addEventListener('click', () =>
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
    if (!/^image\//.test(file.type)) return reject(new Error(t('admin.photo.notimage')));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('admin.photo.readfail')));
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
      img.onerror = () => reject(new Error(t('admin.photo.readfail')));
      img.src = reader.result; // data: URL — allowed by the CSP
    };
    reader.readAsDataURL(file);
  });
}

// Add (id = null) or manage (id set) a coach: photos, bios, cities/positions,
// featured flag, and — for existing coaches — the login email/password.
async function openCoachEditor(id) {
  const bd = document.getElementById('coach-backdrop');
  const box = document.getElementById('coach-modal-body');
  bd.classList.add('open');
  box.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;

  // New coaches default INTO the hero spotlight (featured) — untick to hide.
  let coach = { name: '', bio: '', bio_en: '', positions: [], locations: [], featured: true, photos: [],
    account: { hasLogin: false, email: null, isAdmin: false } };
  if (id) {
    try { coach = await API.get(`/admin/coaches/${id}`); }
    catch (err) { box.innerHTML = `<p class="muted">${esc(I18N.server(err.message))}</p>`; return; }
  }
  const overview = id && A ? A.coaches.find((c) => c.id === id) : null;
  const photos = coach.photos.slice(); // working list: existing paths and/or new data URLs

  const pickOn = (sel) => [...box.querySelectorAll(`${sel} .chip-toggle.on`)].map((c) => c.dataset.v);

  function renderPhotos() {
    const wrap = box.querySelector('#ce-photos');
    wrap.innerHTML = photos.map((src, i) => `
      <div style="position:relative">
        <img src="${esc(src)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">
        <button data-rm="${i}" title="${t('admin.editor.photos.remove')}" style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:var(--danger);color:#fff;cursor:pointer;line-height:1;font-size:.85rem">×</button>
      </div>`).join('') || `<span class="small muted">${t('admin.editor.photos.none')}</span>`;
    wrap.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      photos.splice(Number(b.dataset.rm), 1); renderPhotos();
    }));
  }

  function accountSection() {
    const a = coach.account;
    return `
      <div style="border-top:1px dashed var(--line);margin-top:18px;padding-top:14px">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${t('admin.editor.login.label')}</div>
        ${a.isAdmin ? `<p class="small" style="color:#f7a13a;margin:0 0 8px">${t('admin.editor.login.adminwarn')}</p>` : ''}
        ${a.hasLogin
          ? `<input type="email" id="ce-acc-email" value="${esc(a.email)}" autocomplete="off">
             <input type="password" id="ce-acc-pass" placeholder="${t('admin.editor.login.newpass.ph')}" autocomplete="new-password" style="margin-top:8px">`
          : `<p class="small muted" style="margin:0 0 8px">${t('admin.editor.login.none')}</p>
             <input type="email" id="ce-acc-email" placeholder="${t('admin.editor.login.email.ph')}" autocomplete="off">
             <input type="password" id="ce-acc-pass" placeholder="${t('admin.editor.login.pass.ph')}" autocomplete="new-password" style="margin-top:8px">`}
        <div class="form-error" id="ce-acc-msg"></div>
        <button class="btn btn-ghost btn-sm" id="ce-acc-save" style="margin-top:6px">${a.hasLogin ? t('admin.editor.login.update') : t('admin.editor.login.create')}</button>
      </div>`;
  }

  function render() {
    const chip = (val, label, on) => `<span class="chip chip-toggle ${on ? 'on' : ''}" data-v="${esc(val)}">${esc(label)}</span>`;
    const posSet = new Set(coach.positions), locSet = new Set(coach.locations);
    box.innerHTML = `
      <h2 style="font-size:1.5rem;margin-bottom:4px">${id ? t('admin.editor.title.manage', { name: esc(coach.name) }) : t('admin.editor.title.add')}</h2>
      ${overview ? `<p class="small muted" style="margin:0 0 12px">
        ${t('admin.editor.overview', {
          completed: overview.completed.all,
          upcoming: overview.upcoming,
          utilization: overview.utilization === null
            ? t('admin.editor.overview.noslots')
            : t('admin.editor.overview.booked', { pct: overview.utilization }),
          tier: overview.tier.number,
          payout: eur(overview.tier.payoutThisMonthCents),
        })}
        <button class="btn btn-ghost btn-sm" id="ce-cal" style="margin-left:6px">${t('admin.editor.editcalendar')}</button></p>` : ''}

      <label class="small muted">${t('admin.editor.photos.label')} <span style="opacity:.7">${t('admin.editor.photos.hint')}</span></label>
      <div id="ce-photos" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"></div>
      <input type="file" id="ce-file" accept="image/*" multiple style="margin-bottom:14px">

      <label class="small muted">${t('admin.editor.name')}</label>
      <input type="text" id="ce-name" value="${esc(coach.name)}" maxlength="60" style="margin:4px 0 12px">

      <label class="small muted">${t('admin.editor.bio.fi')}</label>
      <textarea id="ce-bio" rows="4" maxlength="1200" style="margin:4px 0 12px">${esc(coach.bio)}</textarea>

      <label class="small muted">${t('admin.editor.bio.en')}</label>
      <textarea id="ce-bio-en" rows="4" maxlength="1200" style="margin:4px 0 12px">${esc(coach.bio_en || '')}</textarea>

      <label class="small muted">${t('admin.editor.positions')}</label>
      <div id="ce-pos" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px">
        ${CONFIG.positions.map((p) => chip(p, posLabel(p), posSet.has(p))).join('')}</div>

      <label class="small muted">${t('admin.editor.cities')}</label>
      <div id="ce-loc" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px">
        ${CONFIG.locations.map((l) => chip(l, l, locSet.has(l))).join('')}</div>

      <label class="small muted">${t('admin.editor.spotlight')}</label>
      <input type="number" id="ce-spotlight" min="1" max="99" step="1" value="${coach.spotlightOrder || ''}"
        placeholder="${esc(t('admin.editor.spotlight.ph'))}" style="margin:6px 0 4px;max-width:220px">
      <p class="small muted" style="margin:0 0 14px">${t('admin.editor.spotlight.hint')}</p>

      ${!id ? `<div class="small muted" style="border-top:1px dashed var(--line);padding-top:12px;margin-bottom:6px">
          ${t('admin.editor.newlogin')}</div>
        <input type="email" id="ce-email" placeholder="${t('admin.editor.login.email.ph')}" autocomplete="off" style="margin-bottom:8px">
        <input type="password" id="ce-pass" placeholder="${t('admin.editor.login.pass.ph')}" autocomplete="new-password" style="margin-bottom:12px">` : ''}

      <div class="form-error" id="ce-msg"></div>
      <button class="btn btn-primary" id="ce-save" style="width:100%">${id ? t('admin.editor.save') : t('admin.editor.createcoach')}</button>
      ${id ? accountSection() : ''}`;

    renderPhotos();
    initPasswordToggles(box);
    box.querySelectorAll('.chip-toggle').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));

    box.querySelector('#ce-file').addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        if (photos.length >= COACH_MAX_PHOTOS) { toast(t('admin.editor.photos.max', { max: COACH_MAX_PHOTOS }), true); break; }
        try { photos.push(await fileToResizedDataURL(f)); } catch (err) { toast(err.message, true); }
      }
      renderPhotos();
    });

    const calBtn = box.querySelector('#ce-cal');
    if (calBtn) calBtn.addEventListener('click', () => {
      bd.classList.remove('open');
      openCoachCalendar(id).catch((err) => toast(I18N.server(err.message), true));
    });

    box.querySelector('#ce-save').addEventListener('click', async () => {
      const msg = box.querySelector('#ce-msg'); msg.textContent = '';
      const payload = {
        name: box.querySelector('#ce-name').value.trim(),
        bio: box.querySelector('#ce-bio').value.trim(),
        bio_en: box.querySelector('#ce-bio-en').value.trim(),
        positions: pickOn('#ce-pos'),
        locations: pickOn('#ce-loc'),
        spotlightOrder: box.querySelector('#ce-spotlight').value.trim() || null,
        photos,
      };
      if (!id) {
        const email = box.querySelector('#ce-email').value.trim();
        const pass = box.querySelector('#ce-pass').value;
        if (email || pass) { payload.email = email; payload.password = pass; }
      }
      const btn = box.querySelector('#ce-save'); btn.disabled = true;
      const orig = btn.textContent; btn.textContent = t('admin.saving');
      try {
        if (id) await API.put(`/admin/coaches/${id}`, payload);
        else await API.post('/admin/coaches', payload);
        toast(id ? t('admin.editor.updated') : t('admin.editor.added'));
        bd.classList.remove('open');
        await refresh();
      } catch (err) { msg.textContent = I18N.server(err.message); btn.disabled = false; btn.textContent = orig; }
    });

    if (id) box.querySelector('#ce-acc-save').addEventListener('click', async () => {
      const msg = box.querySelector('#ce-acc-msg'); msg.textContent = '';
      const email = box.querySelector('#ce-acc-email').value.trim();
      const pass = box.querySelector('#ce-acc-pass').value;
      const body = {}; if (email) body.email = email; if (pass) body.password = pass;
      const btn = box.querySelector('#ce-acc-save'); btn.disabled = true;
      try {
        const r = await API.put(`/admin/coaches/${id}/account`, body);
        toast(r.created ? t('admin.editor.login.created') : t('admin.editor.login.updated'));
        coach.account.hasLogin = true;
        if (email) coach.account.email = email;
        render();
      } catch (err) { msg.textContent = I18N.server(err.message); btn.disabled = false; }
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
  box.innerHTML = `<p class="muted">${t('admin.cal.loading')}</p>`;
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
          title="${b ? esc(`${b.customer} · ${posLabel(b.position)} · ${I18N.server(b.focus)}`) : ''}"></div>`;
      }
    }
    grid += '</div>';
    box.innerHTML = `
      <h2 style="font-size:1.7rem">${t('admin.cal.title', { name: esc(data.coach.name) })}</h2>
      <p class="muted small">${t('admin.cal.sub', {
        locations: data.coach.locations.map(esc).join(', '),
        positions: data.coach.positions.map((p) => esc(posLabel(p))).join(', '),
      })}</p>
      <div class="cal-scroll">${grid}</div>
      <div class="cal-legend">
        <span><i style="background:rgba(255,255,255,0.05);border:1px solid var(--line)"></i>${t('admin.cal.legend.notavailable')}</span>
        <span><i style="background:rgba(62,229,134,0.25)"></i>${t('admin.cal.legend.open')}</span>
        <span><i style="background:var(--lime)"></i>${t('admin.cal.legend.booked')}</span>
        <span><i style="background:rgba(62,229,134,0.5)"></i>${t('admin.cal.legend.unsaved')}</span>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary btn-sm" id="cal-save" ${pending.size ? '' : 'disabled'}>
          ${pending.size ? t('admin.cal.save.count', { count: pending.size }) : t('admin.cal.save')}</button>
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
      saveBtn.textContent = t('admin.saving');
      const adds = [], removes = [];
      for (const [k, op] of pending) {
        const [date, hour] = k.split('|');
        (op === 'add' ? adds : removes).push({ date, hour: Number(hour) });
      }
      try {
        const r = await API.put(`/admin/coaches/${id}/availability`, { adds, removes });
        let msg = t('admin.cal.saved', { added: r.added, removed: r.removed });
        if (r.conflicts.length) msg += ' ' + t('admin.cal.saved.conflicts', { count: r.conflicts.length });
        if (r.rejected.length) msg += ' ' + t('admin.cal.saved.rejected', { count: r.rejected.length });
        toast(msg, r.conflicts.length > 0);
        await refresh();
        if (document.getElementById('cal-backdrop').classList.contains('open')) {
          openCoachCalendar(id).catch((err) => toast(I18N.server(err.message), true)); // reload with saved state
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = t('admin.cal.save.count', { count: pending.size });
        toast(I18N.server(err.message), true);
      }
    });
  }
  paint();
}

// --- bookings table -----------------------------------------------------------
async function loadBookings(status) {
  const rows = await API.get('/admin/bookings' + (status ? `?status=${status}` : ''));
  const tbl = document.getElementById('bookings-table');
  const hourSep = I18N.lang === 'fi' ? '.' : ':'; // FI '14.00', EN '14:00'
  tbl.innerHTML = `
    <tr><th>${t('mybookings.table.ref')}</th><th>${t('mybookings.table.when')}</th><th>${t('mybookings.table.coach')}</th><th>${t('admin.table.customer')}</th><th>${t('mybookings.table.session')}</th>
      <th>${t('mybookings.table.total')}</th><th>${t('mybookings.table.status')}</th><th>${t('mybookings.table.invoice')}</th><th></th></tr>` +
    rows.map((b) => `
      <tr>
        <td class="muted">${esc(b.code)}</td>
        <td>${esc(fmtDate(b.date))} ${String(b.hour).padStart(2, '0')}${hourSep}00</td>
        <td>${esc(b.coach)}</td>
        <td title="${esc(b.customer_email)}">${esc(b.customer)}</td>
        <td>${esc(posLabel(b.position))} · ${esc(I18N.server(b.focus))}${b.is_online ? ' · ' + t('mybookings.table.online') : ' · ' + esc(b.location)}</td>
        <td>${eur(b.total_cents)}</td>
        <td><span class="status-tag status-${esc(b.status)}">${esc(t('common.status.' + b.status))}</span></td>
        <td>${b.invoice_number
          ? `<a href="/api/invoices/${encodeURIComponent(b.invoice_number)}" target="_blank">${esc(b.invoice_number)}</a>
             <span class="muted small">${esc(t('admin.invoicestatus.' + b.invoice_status))}</span>` : '—'}</td>
        <td style="white-space:nowrap">
          ${b.status === 'confirmed' ? `
            <button class="btn btn-ghost btn-sm" data-act="completed" data-id="${b.id}"
              ${b.date > A.today ? `disabled title="${t('admin.bookings.done.disabled')}"` : ''}>${t('admin.bookings.done')}</button>
            <button class="btn btn-danger btn-sm" data-act="cancelled" data-id="${b.id}">${t('admin.bookings.cancel')}</button>` : ''}
          ${b.invoice_status === 'sent' ? `<button class="btn btn-ghost btn-sm" data-paid="${esc(b.invoice_number)}">${t('admin.invoices.markpaid')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-del-booking="${b.id}" data-code="${esc(b.code)}"
            data-customer="${esc(b.customer)}" title="${esc(t('admin.bookings.delete.title'))}">🗑</button>
        </td>
      </tr>`).join('');

  // Hard removal: the booking, its invoice and the slot hold all disappear;
  // a consumed free-session credit returns to the customer.
  tbl.querySelectorAll('[data-del-booking]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(t('admin.bookings.delete.confirm', { code: btn.dataset.code, customer: btn.dataset.customer }))) return;
    btn.disabled = true;
    try {
      await API.del(`/admin/bookings/${btn.dataset.delBooking}`);
      toast(t('admin.bookings.delete.done', { code: btn.dataset.code }));
      await Promise.all([refresh(), loadBookings(status), loadCRM()]);
    } catch (err) {
      btn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  }));

  tbl.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.act === 'cancelled' && !confirm(t('admin.bookings.cancel.confirm'))) return;
    btn.disabled = true;
    try {
      await API.post(`/admin/bookings/${btn.dataset.id}/status`, { status: btn.dataset.act });
      toast(t('admin.bookings.updated'));
      await Promise.all([refresh(), loadBookings(status), loadCRM()]);
    } catch (err) {
      btn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  }));
  tbl.querySelectorAll('[data-paid]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await API.post(`/admin/invoices/${encodeURIComponent(btn.dataset.paid)}/paid`, {});
      toast(t('admin.invoices.paid.toast'));
      await Promise.all([refresh(), loadBookings(status), loadCRM()]);
    } catch (err) {
      btn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  }));
}

// --- CRM: customers + leads + reviews -------------------------------------------
let CRM = null;

async function loadCRM() {
  CRM = await API.get('/admin/crm');
  renderCRM();
  renderContactRequests();
}

function renderCRM() {
  if (!CRM) return;
  document.getElementById('crm-stats').innerHTML = [
    { label: t('admin.crm.stats.paid'), value: eur(CRM.totals.paidCents) },
    { label: t('admin.crm.stats.outstanding'), value: eur(CRM.totals.outstandingCents),
      sub: `<div class="sub">${t('admin.crm.stats.overdue', { count: CRM.totals.overdue })}</div>` },
    { label: t('admin.crm.stats.accounts'), value: CRM.customers.length },
  ].map((c) => `<div class="card stat-card"><div class="label">${c.label}</div>
    <div class="value" style="font-size:2rem">${c.value}</div>${c.sub || ''}</div>`).join('');

  const ct = document.getElementById('crm-customers');
  document.getElementById('crm-empty').hidden = CRM.customers.length > 0;
  ct.innerHTML = CRM.customers.length ? `
    <tr><th>${t('admin.table.customer')}</th><th>${t('admin.crm.table.email')}</th><th>${t('admin.crm.leads.phone')}</th><th>${t('admin.crm.table.signedup')}</th><th>${t('admin.crm.table.bookings')}</th>
      <th>${t('admin.crm.table.dnc')}</th><th>${t('admin.crm.table.paid')}</th><th>${t('admin.crm.table.outstanding')}</th>
      <th>${t('admin.crm.table.credits')}</th><th>${t('admin.crm.table.lastsession')}</th><th></th></tr>` +
    CRM.customers.map((c) => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
        <td>${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">${esc(c.phone)}</a>` : '<span class="muted">—</span>'}</td>
        <td>${esc(c.signed_up)}</td>
        <td><strong>${c.bookings}</strong></td>
        <td>${c.completed || 0} / ${c.upcoming || 0} / ${c.cancelled || 0}</td>
        <td>${eur(c.paid_cents)}</td>
        <td>${c.outstanding_cents ? `<strong style="color:#f7a13a">${eur(c.outstanding_cents)}</strong>` : eur(0)}</td>
        <td>${c.free_credits || ''}</td>
        <td class="muted">${c.last_session ? esc(fmtDate(c.last_session)) : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" data-del-customer="${c.id}"
          data-name="${esc(c.name)}" data-bookings="${c.bookings || 0}" data-upcoming="${c.upcoming || 0}"
          title="${esc(t('admin.crm.delete.title'))}">🗑</button></td>
      </tr>`).join('') : '';

  // Deleting an account is permanent: double confirm, the second listing exactly
  // what goes with it (bookings free their slots, invoices, chats, credits).
  ct.querySelectorAll('[data-del-customer]').forEach((btn) => btn.addEventListener('click', async () => {
    const name = btn.dataset.name;
    if (!confirm(t('admin.crm.delete.confirm1', { name }))) return;
    if (!confirm(t('admin.crm.delete.confirm2',
      { name, bookings: btn.dataset.bookings, upcoming: btn.dataset.upcoming }))) return;
    btn.disabled = true;
    try {
      await API.del(`/admin/customers/${btn.dataset.delCustomer}`);
      toast(t('admin.crm.delete.done', { name }));
      await Promise.all([refresh(), loadCRM()]);
    } catch (e) {
      btn.disabled = false;
      toast(I18N.server(e.message), true);
    }
  }));

  // Leads: every customer who left a phone number at signup. The status button
  // toggles called <-> open (stored server-side with the call date); the
  // bookings cell shows whether the lead already booked, and when.
  const leads = CRM.customers.filter((c) => c.phone);
  document.getElementById('crm-leads-empty').hidden = leads.length > 0;
  document.getElementById('crm-leads').innerHTML = leads.length ? `
    <tr><th>${t('admin.table.customer')}</th><th>${t('admin.crm.leads.phone')}</th><th>${t('admin.crm.leads.status')}</th>
      <th>${t('admin.crm.table.email')}</th><th>${t('admin.crm.table.signedup')}</th><th>${t('admin.crm.table.bookings')}</th></tr>` +
    leads.map((c) => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td><a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">${esc(c.phone)}</a></td>
        <td>
          <button class="btn btn-sm ${c.lead_called_at ? 'btn-primary' : 'btn-ghost'}" data-lead-called="${c.id}"
            title="${esc(t('admin.crm.leads.toggle_title'))}">
            ${c.lead_called_at ? '✓ ' + t('admin.crm.leads.called') : t('admin.crm.leads.open')}</button>
          ${c.lead_called_at ? `<span class="muted small">${esc(fmtDate(c.lead_called_at.slice(0, 10)))}</span>` : ''}
        </td>
        <td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
        <td class="muted">${esc(c.signed_up)}</td>
        <td>${c.bookings
          ? `<strong>${c.bookings}</strong> <span class="muted small">${t('admin.crm.leads.booked_on',
              { date: esc(fmtDate(c.last_booking_made)) })}</span>`
          : `<span class="muted">0</span>`}</td>
      </tr>`).join('') : '';

  document.querySelectorAll('[data-lead-called]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.leadCalled);
    const lead = CRM.customers.find((c) => c.id === id);
    btn.disabled = true;
    try {
      const r = await API.post(`/admin/customers/${id}/called`, { called: !lead.lead_called_at });
      lead.lead_called_at = r.calledAt;
      renderCRM();
    } catch (e) {
      btn.disabled = false;
      toast(I18N.server(e.message), true);
    }
  }));

  // (The invoice ledger table was removed: payment happens at booking, so the
  // ledger showed nothing actionable. Receipts stay linked on booking rows.)

  const reviews = CRM.reviews || [];
  document.getElementById('crm-reviews-empty').hidden = reviews.length > 0;
  document.getElementById('crm-reviews').innerHTML = reviews.length ? `
    <tr><th>${t('mybookings.table.coach')}</th><th>${t('mybookings.reviews.rating_label')}</th><th>${t('admin.crm.reviews.reviewer')}</th><th>${t('admin.crm.reviews.review')}</th><th>${t('admin.crm.reviews.date')}</th><th></th></tr>` +
    reviews.map((r) => `
      <tr>
        <td>${esc(r.coach)}</td>
        <td>${starsHTML(r.rating)} <span class="muted small">${r.rating}</span></td>
        <td>${esc(r.author_name)}${r.demo ? ` <span class="chip gray" style="font-size:.65rem">${t('admin.crm.reviews.demochip')}</span>` : ''}</td>
        <td class="muted">${r.body ? esc(r.body) : `<em>${t('admin.crm.reviews.nocomment')}</em>`}</td>
        <td class="muted">${esc(r.date)}</td>
        <td><button class="btn btn-ghost btn-sm" data-del-review="${r.id}">${t('admin.crm.reviews.delete')}</button></td>
      </tr>`).join('') : '';

  document.querySelectorAll('[data-del-review]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm(t('admin.crm.reviews.delete.confirm'))) return;
    btn.disabled = true;
    try {
      await API.post(`/admin/reviews/${btn.dataset.delReview}/delete`, {});
      toast(t('admin.crm.reviews.deleted'));
      await loadCRM();
    } catch (err) { btn.disabled = false; toast(I18N.server(err.message), true); }
  }));
}

// --- data & export ------------------------------------------------------------
function renderExports() {
  // Dataset names are the raw export identifiers (they name the CSV files),
  // so they stay in English in both languages.
  const names = ['Bookings', 'Invoices', 'Coaches', 'CoachPayouts', 'Availability', 'VisitsDaily', 'Funnel',
    'Customers', 'ContactLeads', 'GroupSessions', 'GroupSignups', 'Packages', 'FinanceMonthly', 'Reviews'];
  document.getElementById('csv-links').innerHTML = names.map((n) =>
    `<a class="btn btn-ghost btn-sm" href="/api/admin/export/${n}.csv">${n}.csv</a>`).join('');
  const st = A.sheets;
  document.getElementById('sheets-status').innerHTML = st.configured
    ? t('admin.sheets.connected', { time: st.lastSync
        ? new Date(st.lastSync).toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB')
        : t('admin.sheets.notyet') })
    : t('admin.sheets.notconnected');
}

async function syncSheets() {
  try {
    const res = await API.post('/admin/sheets/sync', {});
    if (res.synced) { toast(t('admin.sheets.synced', { count: res.tabs.length })); await refresh(); }
    else toast(t('admin.sheets.sync.notconnected'), true);
  } catch (err) {
    toast(I18N.server(err.message), true);
  }
}

async function removeDemo() {
  if (!confirm(t('admin.demo.remove.confirm'))) return;
  await API.post('/admin/demo-data/remove', {});
  toast(t('admin.demo.removed'));
  await refresh();
  await loadBookings('');
}
