// Admin-only financial model UI (/admin/financial-model). All math lives in
// fm-model.js (pure, unit-tested); this file only renders and wires inputs.
// ACTUAL data is read-only; assumptions live in memory until the admin
// explicitly saves defaults or a scenario (fm_* tables only).
'use strict';

let S = {
  actual: null,
  costs: [],
  scenarios: [],
  assumptions: {
    price: 40, customers: 20, sessionsPerCustomer: 2, newCustomersPerMonth: 5,
    arpc: 0, coachMode: 'per_session', coachCost: 20, coachPct: 50,
    extraFixed: 0, taxRate: 20, taxBasis: 'profit',
  },
  compareWith: null, // scenario id currently in the comparison table
};

const eurF = (v) => eur(Math.round((Number.isFinite(v) ? v : 0) * 100));
const pctF = (v) => (v === null || !Number.isFinite(v) ? '—' : `${(Math.round(v * 10) / 10).toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB')} %`);
const intF = (v) => (v === null || !Number.isFinite(v) ? '—' : String(v));
const model = () => ({ ...S.assumptions, costs: S.costs });
const deriveNow = () => FM.derive(model());

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  if (user.role !== 'admin') { location.href = DASH_FOR_ROLE[user.role] || '/'; return; }

  document.getElementById('fm-load-actuals').addEventListener('click', loadActualsIntoModel);
  document.getElementById('fm-save-defaults').addEventListener('click', saveDefaults);
  document.getElementById('fm-scen-save').addEventListener('click', saveScenario);
  document.getElementById('fm-scen-name').placeholder = t('fm.scen.name.ph');

  const data = await API.get('/admin/financial-model/data');
  S.actual = data.actual;
  S.costs = data.costs;
  S.scenarios = data.scenarios;
  if (data.defaults) S.assumptions = { ...S.assumptions, ...data.defaults };
  else seedFromActuals(false);

  renderActuals();
  renderSliders();
  renderSolveForm();
  renderCostAdd();
  renderScenarios();
  recalc();
})().catch((e) => toast(I18N.server(e.message), true));

// --- ACTUAL business data (read-only band) -----------------------------------
function renderActuals() {
  const a = S.actual;
  const card = (label, value, sub = '') => `
    <div class="card stat-card">
      <div class="label">${label}</div>
      <div class="value" style="font-size:1.7rem">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;
  const sessions30 = a.sessions1on1Completed30 + a.groupSessions30;
  document.getElementById('fm-actual-cards').innerHTML =
    card(t('fm.actual.revmonth'), eur(a.revenueThisMonthCents), a.month)
    + card(t('fm.actual.rev30'), eur(a.revenue30Cents))
    + card(t('fm.actual.customers'), `${a.customersActive30}`, t('fm.actual.customers.sub', { total: a.customersTotal }))
    + card(t('fm.actual.sessions'), `${sessions30}`, t('fm.actual.sessions.sub', {
        solo: a.sessions1on1Completed30, group: a.groupSessions30 }))
    + card(t('fm.actual.avgprice'), a.avgPaid1on1Cents === null ? '—' : eur(a.avgPaid1on1Cents))
    + card(t('fm.actual.coachcost'), a.avgCoachCostCents === null ? '—' : eur(a.avgCoachCostCents), t('fm.actual.coachcost.sub'))
    + card(t('fm.actual.payouts'), eur(a.payouts30Cents))
    + card(t('fm.actual.profit'), eur(a.profitBeforeFixed30Cents), t('fm.actual.profit.sub'));
}

function seedFromActuals(announce) {
  const a = S.actual;
  if (!a) return;
  const upd = {};
  if (a.avgPaid1on1Cents) upd.price = Math.round(a.avgPaid1on1Cents / 100);
  if (a.avgCoachCostCents) upd.coachCost = Math.round(a.avgCoachCostCents / 100);
  if (a.customersActive30 > 0) {
    upd.customers = a.customersActive30;
    const sessions30 = a.sessions1on1Completed30 + a.groupSessions30;
    if (sessions30 > 0) upd.sessionsPerCustomer = Math.max(0.5, Math.round(sessions30 / a.customersActive30 * 2) / 2);
  }
  S.assumptions = { ...S.assumptions, ...upd };
  if (announce) toast(t('fm.actual.loaded'));
}

function loadActualsIntoModel() {
  seedFromActuals(true);
  renderSliders();
  recalc();
}

// --- sliders + advanced inputs ------------------------------------------------
const SLIDERS = [
  { key: 'price', min: 0, max: 200, step: 1, tip: 'fm.tip.price' },
  { key: 'customers', min: 0, max: 500, step: 1, tip: 'fm.tip.customers' },
  { key: 'sessionsPerCustomer', min: 0, max: 10, step: 0.5, tip: 'fm.tip.spc' },
  { key: 'coachCost', min: 0, max: 100, step: 1, tip: 'fm.tip.coach' },
  { key: 'extraFixed', min: 0, max: 5000, step: 50, tip: 'fm.tip.fixed' },
  { key: 'taxRate', min: 0, max: 100, step: 1, tip: 'fm.tip.tax' },
];

function renderSliders() {
  const box = document.getElementById('fm-sliders');
  const a = S.assumptions;
  box.innerHTML = `
    <h3 style="margin:0 0 10px">${t('fm.inputs.heading')}</h3>
    ${SLIDERS.map((s) => `
      <div style="margin-bottom:14px">
        <label class="small muted" title="${esc(t(s.tip))}">${t('fm.in.' + s.key)}
          <span style="opacity:.55;cursor:help"> ?</span></label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
          <input type="range" id="fm-r-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}"
            value="${a[s.key]}" style="flex:1">
          <input type="number" id="fm-n-${s.key}" min="0" step="${s.step}" value="${a[s.key]}"
            style="width:92px" inputmode="decimal">
        </div>
      </div>`).join('')}
    <div style="border-top:1px dashed var(--line);padding-top:12px;margin-top:4px">
      <label class="small muted">${t('fm.in.newCustomersPerMonth')}
        <input type="number" id="fm-n-newCustomersPerMonth" min="0" step="1"
          value="${a.newCustomersPerMonth}" style="width:92px;margin-left:8px"></label>
      <label class="small muted" style="display:block;margin-top:10px" title="${esc(t('fm.tip.arpc'))}">${t('fm.in.arpc')}
        <span style="opacity:.55;cursor:help"> ?</span>
        <input type="number" id="fm-n-arpc" min="0" step="1" value="${a.arpc}" style="width:92px;margin-left:8px"></label>
      <label class="small muted" style="display:block;margin-top:10px">${t('fm.in.coachMode')}
        <select class="input" id="fm-coachmode" style="margin-left:8px;width:auto">
          <option value="per_session" ${a.coachMode === 'per_session' ? 'selected' : ''}>${t('fm.in.coachMode.per')}</option>
          <option value="pct" ${a.coachMode === 'pct' ? 'selected' : ''}>${t('fm.in.coachMode.pct')}</option>
        </select>
        <input type="number" id="fm-n-coachPct" min="0" max="100" step="1" value="${a.coachPct}"
          style="width:70px;margin-left:8px;${a.coachMode === 'pct' ? '' : 'display:none'}"> ${a.coachMode === 'pct' ? '%' : ''}</label>
      <label class="small muted" style="display:block;margin-top:10px" title="${esc(t('fm.tip.taxbasis'))}">${t('fm.in.taxBasis')}
        <span style="opacity:.55;cursor:help"> ?</span>
        <select class="input" id="fm-taxbasis" style="margin-left:8px;width:auto">
          <option value="profit" ${a.taxBasis === 'profit' ? 'selected' : ''}>${t('fm.in.taxBasis.profit')}</option>
          <option value="revenue" ${a.taxBasis === 'revenue' ? 'selected' : ''}>${t('fm.in.taxBasis.revenue')}</option>
        </select></label>
      <p class="small muted" style="margin:10px 0 0">${t('fm.tax.disclaimer')}</p>
    </div>`;

  for (const s of SLIDERS) {
    const range = box.querySelector(`#fm-r-${s.key}`);
    const numIn = box.querySelector(`#fm-n-${s.key}`);
    range.addEventListener('input', () => {
      S.assumptions[s.key] = Number(range.value);
      numIn.value = range.value;
      recalc();
    });
    numIn.addEventListener('input', () => {
      const v = Number(numIn.value);
      if (!Number.isFinite(v) || v < 0) return;
      S.assumptions[s.key] = v;
      range.value = Math.min(v, s.max);
      recalc();
    });
  }
  const bind = (id, key, extra) => box.querySelector(id).addEventListener('input', (e) => {
    const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    if (e.target.type === 'number' && (!Number.isFinite(v) || v < 0)) return;
    S.assumptions[key] = v;
    if (extra) extra();
    recalc();
  });
  bind('#fm-n-newCustomersPerMonth', 'newCustomersPerMonth');
  bind('#fm-n-arpc', 'arpc');
  bind('#fm-n-coachPct', 'coachPct');
  bind('#fm-coachmode', 'coachMode', () => renderSliders());
  bind('#fm-taxbasis', 'taxBasis');
}

// --- KPI cards + waterfall table ----------------------------------------------
function recalc() {
  const d = deriveNow();
  renderKpis(d);
  renderWaterfall(d);
  renderBE(d);
  renderNeed();
  renderCharts(d);
  if (S.compareWith != null) renderCompare(S.compareWith);
}

function renderKpis(d) {
  const card = (label, value, sub, tipKey) => `
    <div class="card stat-card" ${tipKey ? `title="${esc(t(tipKey))}"` : ''}>
      <div class="label">${label}</div>
      <div class="value" style="font-size:1.6rem">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;
  const neg = (v, str) => (v < 0 ? `<span style="color:#ff6b6b">${str}</span>` : str);
  document.getElementById('fm-kpis').innerHTML =
    card(t('fm.kpi.revenue'), eurF(d.revenue), t('fm.kpi.revenue.sub', { annual: eurF(d.revenueAnnual), sessions: Math.round(d.sessions) }), 'fm.tip.revenue')
    + card(t('fm.kpi.costs'), eurF(d.totalCosts), t('fm.kpi.costs.sub', { vc: eurF(d.variableCosts), fc: eurF(d.fixedCosts) }))
    + card(t('fm.kpi.gross'), neg(d.grossProfit, eurF(d.grossProfit)), '', 'fm.tip.gross')
    + card(t('fm.kpi.grossmargin'), pctF(d.grossMarginPct), '', 'fm.tip.grossmargin')
    + card(t('fm.kpi.net'), neg(d.netProfit, eurF(d.netProfit)), t('fm.kpi.net.sub', { annual: eurF(d.netProfitAnnual) }), 'fm.tip.net')
    + card(t('fm.kpi.netmargin'), pctF(d.netMarginPct), '', 'fm.tip.netmargin')
    + card(t('fm.kpi.berevenue'), d.breakEven.reachable ? eurF(d.breakEven.revenue) : t('fm.be.never'), '', 'fm.tip.be')
    + card(t('fm.kpi.becustomers'), d.breakEven.reachable ? intF(d.breakEven.customers) : '—', '', 'fm.tip.becustomers');
}

function renderWaterfall(d) {
  const row = (label, val, tipKey, strong) => `
    <tr ${tipKey ? `title="${esc(t(tipKey))}"` : ''}>
      <td class="${strong ? '' : 'muted'}">${label}${tipKey ? ' <span style="opacity:.5;cursor:help">?</span>' : ''}</td>
      <td style="text-align:right">${strong ? '<strong>' : ''}${val}${strong ? '</strong>' : ''}</td>
    </tr>`;
  document.getElementById('fm-waterfall').innerHTML =
    row(t('fm.wf.revenue'), eurF(d.revenue), 'fm.tip.revenue', true)
    + row(t('fm.wf.variable'), '−' + eurF(d.variableCosts), 'fm.tip.variable')
    + row(t('fm.wf.gross'), eurF(d.grossProfit), 'fm.tip.gross', true)
    + row(t('fm.wf.fixed'), '−' + eurF(d.fixedCosts), 'fm.tip.fixed2')
    + row(t('fm.wf.pretax'), eurF(d.preTaxProfit), null, true)
    + row(t('fm.wf.tax'), '−' + eurF(d.tax), 'fm.tip.taxrow')
    + row(t('fm.wf.net'), eurF(d.netProfit), 'fm.tip.net', true)
    + row(t('fm.wf.contribution'), eurF(d.contribution) + ' / ' + t('fm.unit.session'), 'fm.tip.contribution');
}

function renderBE(d) {
  const be = d.breakEven;
  document.getElementById('fm-be').innerHTML = be.reachable
    ? `<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;text-align:center">
        <div><div class="small muted">${t('fm.be.revenue')}</div><strong>${eurF(be.revenue)}</strong></div>
        <div><div class="small muted">${t('fm.be.sessions')}</div><strong>${intF(be.sessions)}</strong></div>
        <div><div class="small muted">${t('fm.be.customers')}</div><strong>${intF(be.customers)}</strong></div>
      </div>
      <p class="small muted" style="margin:10px 0 0">${t('fm.be.note', { contribution: eurF(d.contribution) })}</p>`
    : `<p class="small" style="color:#ff6b6b;margin:0">${t('fm.be.unreachable')}</p>`;
}

// --- "how many customers do I need" -------------------------------------------
const NEED = { revenue: 10000, profit: 5000, margin: 20 };

function renderNeed() {
  const solveCustomers = (target) => FM.solve(model(), target, 'customers');
  const solveSessions = (target) => FM.solve(model(), target, 'sessions');
  const d = deriveNow();
  const rows = [
    { label: t('fm.need.be'), customers: d.breakEven.reachable ? d.breakEven.customers : null,
      sessions: d.breakEven.reachable ? d.breakEven.sessions : null, input: null },
    { label: t('fm.need.revenue'), key: 'revenue', type: { type: 'revenue', value: NEED.revenue } },
    { label: t('fm.need.profit'), key: 'profit', type: { type: 'profit', value: NEED.profit } },
    { label: t('fm.need.margin'), key: 'margin', type: { type: 'netMargin', value: NEED.margin } },
  ];
  document.getElementById('fm-need').innerHTML = `
    <tr><th>${t('fm.need.th.goal')}</th><th></th><th>${t('fm.need.th.customers')}</th><th>${t('fm.need.th.sessions')}</th></tr>`
    + rows.map((r) => {
      let customers = r.customers, sessions = r.sessions;
      if (r.type) {
        const c = solveCustomers(r.type);
        const s = solveSessions(r.type);
        customers = c.ok ? c.value : null;
        sessions = s.ok ? s.value : null;
      }
      const input = r.key ? `<input type="number" data-need="${r.key}" value="${NEED[r.key]}" min="0"
        step="${r.key === 'margin' ? 1 : 100}" style="width:90px">${r.key === 'margin' ? ' %' : ' €'}` : '';
      return `<tr>
        <td class="muted">${r.label}</td><td>${input}</td>
        <td><strong>${customers === null ? t('fm.solve.noresult') : customers}</strong></td>
        <td>${sessions === null ? '—' : sessions}</td>
      </tr>`;
    }).join('');
  document.querySelectorAll('#fm-need [data-need]').forEach((el) => el.addEventListener('change', () => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v >= 0) NEED[el.dataset.need] = v;
    renderNeed();
  }));
}

// --- solve-for panel ----------------------------------------------------------
function renderSolveForm() {
  const box = document.getElementById('fm-solve-form');
  const opt = (v, label, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${label}</option>`;
  box.innerHTML = `
    <label class="small muted">${t('fm.solve.target')}<br>
      <select class="input" id="fm-t-type" style="width:auto;margin-top:4px">
        ${opt('revenue', t('fm.solve.t.revenue'), true)}${opt('revenueAnnual', t('fm.solve.t.revenueAnnual'))}
        ${opt('profit', t('fm.solve.t.profit'))}${opt('profitAnnual', t('fm.solve.t.profitAnnual'))}
        ${opt('netMargin', t('fm.solve.t.netMargin'))}
      </select></label>
    <label class="small muted">${t('fm.solve.value')}<br>
      <input type="number" id="fm-t-value" value="10000" min="0" step="100" style="width:120px;margin-top:4px"></label>
    <label class="small muted">${t('fm.solve.for')}<br>
      <select class="input" id="fm-t-solvefor" style="width:auto;margin-top:4px">
        ${opt('price', t('fm.in.price'), true)}${opt('customers', t('fm.in.customers'))}
        ${opt('sessionsPerCustomer', t('fm.in.sessionsPerCustomer'))}${opt('sessions', t('fm.solve.sessionsTotal'))}
      </select></label>
    <button class="btn btn-primary btn-sm" id="fm-t-run">${t('fm.solve.run')}</button>`;
  box.querySelector('#fm-t-run').addEventListener('click', runSolve);
}

function runSolve() {
  const type = document.getElementById('fm-t-type').value;
  const value = Number(document.getElementById('fm-t-value').value);
  const solveFor = document.getElementById('fm-t-solvefor').value;
  const out = document.getElementById('fm-solve-result');
  const r = FM.solve(model(), { type, value }, solveFor);
  if (!r.ok) {
    out.innerHTML = `<p class="small" style="color:#ff6b6b;margin:0">${t('fm.solve.err.' + r.reason)}</p>`;
    return;
  }
  const cur = deriveNow();
  const tgt = r.derived;
  const row = (label, a, b, strong) => `<tr><td class="muted">${label}</td>
    <td>${strong ? '<strong>' : ''}${a}${strong ? '</strong>' : ''}</td>
    <td>${strong ? '<strong>' : ''}${b}${strong ? '</strong>' : ''}</td></tr>`;
  const solvedLabel = { price: t('fm.in.price'), customers: t('fm.in.customers'),
    sessionsPerCustomer: t('fm.in.sessionsPerCustomer'), sessions: t('fm.solve.sessionsTotal') }[solveFor];
  const solvedValue = solveFor === 'price' ? eurF(r.value)
    : solveFor === 'sessionsPerCustomer' ? String(r.value) : String(r.value);
  out.innerHTML = `
    <p class="small" style="margin:0 0 8px"><span class="chip" style="font-size:.65rem">${t('fm.badge.scenario')}</span>
      <strong style="margin-left:6px">${t('fm.solve.answer', { label: solvedLabel, value: solvedValue })}</strong></p>
    <div style="overflow-x:auto"><table class="data">
      <tr><th></th><th>${t('fm.solve.col.current')}</th><th>${t('fm.solve.col.target')}</th></tr>
      ${row(solvedLabel, solveFor === 'price' ? eurF(cur.assumptions.price)
          : solveFor === 'sessions' ? String(Math.round(cur.sessions))
          : String(cur.assumptions[solveFor]), solvedValue, true)}
      ${row(t('fm.kpi.revenue'), eurF(cur.revenue), eurF(tgt.revenue))}
      ${row(t('fm.wf.sessions'), String(Math.round(cur.sessions)), String(r.requiredSessions))}
      ${row(t('fm.in.customers'), String(Math.round(cur.assumptions.customers)), String(r.requiredCustomers))}
      ${row(t('fm.kpi.net'), eurF(cur.netProfit), eurF(tgt.netProfit))}
      ${row(t('fm.kpi.netmargin'), pctF(cur.netMarginPct), pctF(tgt.netMarginPct))}
    </table></div>
    <p class="small muted" style="margin:8px 0 0">${t('fm.solve.note')}</p>`;
}

// --- monthly cost management ---------------------------------------------------
function kindLabel(kind) { return t('fm.cost.kind.' + kind); }

function renderCosts() {
  const tbl = document.getElementById('fm-costs-table');
  const active = S.costs.filter((c) => c.active);
  const totFixed = active.filter((c) => c.kind === 'fixed').reduce((s, c) => s + c.amountEur, 0);
  const totPerSession = active.filter((c) => c.kind === 'per_session').reduce((s, c) => s + c.amountEur, 0);
  const totPct = active.filter((c) => c.kind === 'pct_revenue').reduce((s, c) => s + c.percent, 0);
  tbl.innerHTML = `
    <tr><th>${t('fm.cost.th.name')}</th><th>${t('fm.cost.th.kind')}</th><th>${t('fm.cost.th.amount')}</th><th></th><th></th></tr>`
    + S.costs.map((c) => `
      <tr style="${c.active ? '' : 'opacity:.45'}" ${c.notes ? `title="${esc(c.notes)}"` : ''}>
        <td>${esc(c.name)}</td>
        <td class="muted">${kindLabel(c.kind)}</td>
        <td><input type="number" data-camount="${c.id}" min="0"
          value="${c.kind === 'pct_revenue' ? c.percent : c.amountEur}"
          step="${c.kind === 'pct_revenue' ? 0.1 : 1}" style="width:90px">
          ${c.kind === 'pct_revenue' ? '%' : '€' + (c.kind === 'per_session' ? '/' + t('fm.unit.session') : t('fm.unit.month'))}</td>
        <td><button class="btn btn-ghost btn-sm" data-ctoggle="${c.id}">${c.active ? t('fm.cost.deactivate') : t('fm.cost.activate')}</button></td>
        <td><button class="btn btn-ghost btn-sm" data-cdel="${c.id}" title="${t('fm.cost.delete')}">🗑</button></td>
      </tr>`).join('')
    + `<tr style="border-top:2px solid var(--line)"><td class="muted">Σ ${t('fm.cost.totals')}</td><td></td>
        <td class="small">${eurF(totFixed)}${t('fm.unit.month')} · ${eurF(totPerSession)}/${t('fm.unit.session')} · ${totPct.toLocaleString()} %</td><td></td><td></td></tr>`;

  tbl.querySelectorAll('[data-camount]').forEach((el) => el.addEventListener('change', async () => {
    const c = S.costs.find((x) => x.id === Number(el.dataset.camount));
    const v = Number(el.value);
    if (!c || !Number.isFinite(v) || v < 0) return;
    try {
      await API.put(`/admin/financial-model/costs/${c.id}`,
        c.kind === 'pct_revenue' ? { percent: v } : { amountEur: v });
      if (c.kind === 'pct_revenue') c.percent = v; else c.amountEur = v;
      recalc();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
  tbl.querySelectorAll('[data-ctoggle]').forEach((el) => el.addEventListener('click', async () => {
    const c = S.costs.find((x) => x.id === Number(el.dataset.ctoggle));
    try {
      await API.put(`/admin/financial-model/costs/${c.id}`, { active: !c.active });
      c.active = !c.active;
      renderCosts();
      recalc();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
  tbl.querySelectorAll('[data-cdel]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm(t('fm.cost.delete.confirm'))) return;
    try {
      await API.del(`/admin/financial-model/costs/${el.dataset.cdel}`);
      S.costs = S.costs.filter((x) => x.id !== Number(el.dataset.cdel));
      renderCosts();
      recalc();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
}

function renderCostAdd() {
  const box = document.getElementById('fm-cost-add');
  box.innerHTML = `
    <label class="small muted">${t('fm.cost.th.name')}<br>
      <input type="text" id="fm-c-name" maxlength="60" placeholder="Render / ${t('fm.cost.example')}" style="margin-top:4px;max-width:180px"></label>
    <label class="small muted">${t('fm.cost.th.kind')}<br>
      <select class="input" id="fm-c-kind" style="width:auto;margin-top:4px">
        <option value="fixed">${kindLabel('fixed')}</option>
        <option value="per_session">${kindLabel('per_session')}</option>
        <option value="pct_revenue">${kindLabel('pct_revenue')}</option>
      </select></label>
    <label class="small muted">${t('fm.cost.th.amount')}<br>
      <input type="number" id="fm-c-amount" min="0" step="1" value="0" style="width:100px;margin-top:4px"></label>
    <label class="small muted">${t('fm.cost.notes')}<br>
      <input type="text" id="fm-c-notes" maxlength="300" style="margin-top:4px;max-width:200px"></label>
    <button class="btn btn-primary btn-sm" id="fm-c-add">${t('fm.cost.add')}</button>`;
  box.querySelector('#fm-c-add').addEventListener('click', async () => {
    const kind = box.querySelector('#fm-c-kind').value;
    const amount = Number(box.querySelector('#fm-c-amount').value) || 0;
    const body = {
      name: box.querySelector('#fm-c-name').value.trim(),
      kind,
      notes: box.querySelector('#fm-c-notes').value.trim(),
      amountEur: kind === 'pct_revenue' ? 0 : amount,
      percent: kind === 'pct_revenue' ? amount : 0,
    };
    try {
      const r = await API.post('/admin/financial-model/costs', body);
      S.costs.push({ id: r.id, name: body.name, kind, amountEur: body.amountEur,
        percent: body.percent, active: true, notes: body.notes });
      box.querySelector('#fm-c-name').value = '';
      box.querySelector('#fm-c-amount').value = '0';
      box.querySelector('#fm-c-notes').value = '';
      renderCosts();
      recalc();
    } catch (e) { toast(I18N.server(e.message), true); }
  });
  renderCosts();
}

// --- scenarios -----------------------------------------------------------------
async function saveScenario() {
  const name = document.getElementById('fm-scen-name').value.trim();
  if (!name) { toast(t('fm.scen.name.missing'), true); return; }
  try {
    const r = await API.post('/admin/financial-model/scenarios', { name, data: model() });
    S.scenarios.unshift({ id: r.id, name, data: model(), createdAt: new Date().toISOString().slice(0, 10) });
    document.getElementById('fm-scen-name').value = '';
    toast(t('fm.scen.saved'));
    renderScenarios();
  } catch (e) { toast(I18N.server(e.message), true); }
}

async function saveDefaults() {
  try {
    const { costs, ...assumptions } = model();
    await API.put('/admin/financial-model/defaults', { data: assumptions });
    toast(t('fm.defaults.saved'));
  } catch (e) { toast(I18N.server(e.message), true); }
}

function renderScenarios() {
  const box = document.getElementById('fm-scen-list');
  box.innerHTML = S.scenarios.length ? S.scenarios.map((s) => `
    <span class="chip" style="display:inline-flex;gap:6px;align-items:center">
      <strong>${esc(s.name)}</strong><span class="muted small">${esc(s.createdAt)}</span>
      <button class="link-btn" data-sload="${s.id}" title="${t('fm.scen.load')}">↺</button>
      <button class="link-btn" data-scompare="${s.id}" title="${t('fm.scen.compare')}">⇄</button>
      <button class="link-btn" data-sdel="${s.id}" title="${t('fm.scen.delete')}">×</button>
    </span>`).join('') : `<span class="small muted">${t('fm.scen.none')}</span>`;
  box.querySelectorAll('[data-sload]').forEach((el) => el.addEventListener('click', () => {
    const s = S.scenarios.find((x) => x.id === Number(el.dataset.sload));
    if (!s) return;
    if (!confirm(t('fm.scen.load.confirm', { name: s.name }))) return;
    const { costs, ...assumptions } = s.data;
    S.assumptions = { ...S.assumptions, ...assumptions };
    renderSliders();
    recalc();
  }));
  box.querySelectorAll('[data-scompare]').forEach((el) => el.addEventListener('click', () => {
    S.compareWith = Number(el.dataset.scompare);
    renderCompare(S.compareWith);
  }));
  box.querySelectorAll('[data-sdel]').forEach((el) => el.addEventListener('click', async () => {
    try {
      await API.del(`/admin/financial-model/scenarios/${el.dataset.sdel}`);
      S.scenarios = S.scenarios.filter((x) => x.id !== Number(el.dataset.sdel));
      if (S.compareWith === Number(el.dataset.sdel)) {
        S.compareWith = null;
        document.getElementById('fm-scen-compare').innerHTML = '';
      }
      renderScenarios();
    } catch (e) { toast(I18N.server(e.message), true); }
  }));
}

function renderCompare(id) {
  const s = S.scenarios.find((x) => x.id === id);
  const out = document.getElementById('fm-scen-compare');
  if (!s) { out.innerHTML = ''; return; }
  const a = deriveNow();
  const b = FM.derive(s.data);
  const money = (v) => eurF(v);
  const rows = [
    [t('fm.in.price'), money(a.assumptions.price), money(b.assumptions.price), null],
    [t('fm.in.customers'), Math.round(a.assumptions.customers), Math.round(b.assumptions.customers), null],
    [t('fm.wf.sessions'), Math.round(a.sessions), Math.round(b.sessions), null],
    [t('fm.kpi.revenue'), money(a.revenue), money(b.revenue), b.revenue - a.revenue],
    [t('fm.kpi.costs'), money(a.totalCosts), money(b.totalCosts), b.totalCosts - a.totalCosts],
    [t('fm.kpi.gross'), money(a.grossProfit), money(b.grossProfit), b.grossProfit - a.grossProfit],
    [t('fm.kpi.grossmargin'), pctF(a.grossMarginPct), pctF(b.grossMarginPct), null],
    [t('fm.wf.tax'), money(a.tax), money(b.tax), b.tax - a.tax],
    [t('fm.kpi.net'), money(a.netProfit), money(b.netProfit), b.netProfit - a.netProfit],
    [t('fm.kpi.netmargin'), pctF(a.netMarginPct), pctF(b.netMarginPct), null],
    [t('fm.kpi.becustomers'), intF(a.breakEven.customers), intF(b.breakEven.customers), null],
  ];
  out.innerHTML = `<table class="data">
    <tr><th></th><th>${t('fm.scen.col.current')}</th><th>${esc(s.name)}</th><th>Δ</th></tr>
    ${rows.map(([label, av, bv, delta]) => `<tr>
      <td class="muted">${label}</td><td>${av}</td><td>${bv}</td>
      <td>${delta === null ? '' : `<span style="color:${delta >= 0 ? 'var(--lime)' : '#ff6b6b'}">${delta >= 0 ? '+' : '−'}${eurF(Math.abs(delta))}</span>`}</td>
    </tr>`).join('')}
  </table>`;
}

// --- charts (hand-rolled SVG, same idiom as the admin dashboard) --------------
function chartSVG(seriesList, { xLabels, marker = null }) {
  const W = 560, H = 200, pad = 10;
  let min = 0, max = 1;
  for (const s of seriesList) for (const v of s.values) { min = Math.min(min, v); max = Math.max(max, v); }
  if (max === min) max = min + 1;
  const n = seriesList[0].values.length;
  const X = (i) => pad + i * (W - 2 * pad) / (n - 1);
  const Y = (v) => H - pad - (v - min) * (H - 2 * pad) / (max - min);
  const pts = (vals) => vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H + 30}" preserveAspectRatio="none" role="img" style="width:100%">
    ${min < 0 ? `<line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/>` : ''}
    ${marker !== null && marker >= 0 && marker < n
      ? `<line x1="${X(marker)}" x2="${X(marker)}" y1="${pad}" y2="${H - pad}" stroke="rgba(247,161,58,.7)" stroke-dasharray="4 3"/>` : ''}
    ${seriesList.map((s) => `<polyline points="${pts(s.values)}" fill="none" stroke="${s.color}"
      stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <text x="${pad}" y="${H + 20}" fill="#a6a6ab" font-size="12">${xLabels[0]}</text>
    <text x="${W - pad}" y="${H + 20}" fill="#a6a6ab" font-size="12" text-anchor="end">${xLabels[1]}</text>
  </svg>
  <div class="small muted" style="display:flex;gap:14px;flex-wrap:wrap">
    ${seriesList.map((s) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:5px"></i>${s.label}</span>`).join('')}
    ${marker !== null ? `<span><i style="display:inline-block;width:10px;height:2px;background:rgba(247,161,58,.9);margin-right:5px;vertical-align:middle"></i>${t('fm.chart.bemark')}</span>` : ''}
  </div>`;
}

function renderCharts(d) {
  const a = model();
  const N = 41;

  // 1+2: revenue vs total costs as customer count grows (break-even visible).
  const maxC = Math.max(10, Math.ceil(Math.max(a.customers * 2,
    (d.breakEven.customers || 0) * 1.4)));
  const rev = [], cost = [];
  for (let i = 0; i < N; i++) {
    const di = FM.derive({ ...a, customers: maxC * i / (N - 1) });
    rev.push(di.revenue);
    cost.push(di.totalCosts);
  }
  const beMarker = d.breakEven.reachable && d.breakEven.customers !== null && d.breakEven.customers <= maxC
    ? Math.round(d.breakEven.customers / maxC * (N - 1)) : null;
  document.getElementById('fm-chart-customers').innerHTML = chartSVG(
    [{ values: rev, color: 'var(--lime)', label: t('fm.kpi.revenue') },
     { values: cost, color: '#ff6b6b', label: t('fm.kpi.costs') }],
    { xLabels: [`0 ${t('fm.unit.customers')}`, `${maxC} ${t('fm.unit.customers')}`], marker: beMarker });

  // 3: net profit as price changes.
  const maxP = Math.max(20, Math.ceil(a.price * 2));
  const profit = [];
  for (let i = 0; i < N; i++) profit.push(FM.derive({ ...a, arpc: 0, price: maxP * i / (N - 1) }).netProfit);
  document.getElementById('fm-chart-price').innerHTML = chartSVG(
    [{ values: profit, color: 'var(--lime)', label: t('fm.kpi.net') }],
    { xLabels: ['0 €', `${maxP} €`], marker: null });

  // 4: 12-month projection with newCustomersPerMonth growth.
  const proj = FM.projection(a, 12);
  document.getElementById('fm-chart-projection').innerHTML = chartSVG(
    [{ values: proj.map((m) => m.revenue), color: 'var(--lime)', label: t('fm.kpi.revenue') },
     { values: proj.map((m) => m.netProfit), color: '#7ab8ff', label: t('fm.kpi.net') }],
    { xLabels: [t('fm.chart.month1'), t('fm.chart.month12')], marker: null });
}
