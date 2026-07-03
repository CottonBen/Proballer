// Booking wizard: time → position → focus → location → confirm (+ inline login).
'use strict';

const W = {
  coach: null, site: null, slots: [],
  slot: null, position: null, focus: null, location: null,
  step: 0, user: null,
};

const backdrop = () => document.getElementById('wizard-backdrop');
const body = () => document.getElementById('wizard-body');

function track(type, meta) { API.post('/track', { type, meta }).catch(() => {}); }

async function openWizard(coach, site) {
  W.coach = coach; W.site = site;
  W.slot = W.position = W.focus = W.location = null;
  W.step = 0;
  backdrop().classList.add('open');
  document.body.style.overflow = 'hidden';
  track('booking_started', { coachId: coach.id });
  body().innerHTML = '<p class="muted">Loading calendar…</p>';
  try {
    const data = await API.get(`/coaches/${coach.id}/slots`);
    W.slots = data.slots;
  } catch (err) {
    body().innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    return;
  }
  render();
}

function closeWizard() {
  backdrop().classList.remove('open');
  document.body.style.overflow = '';
  if (W.step < 5 && W.step > 0) track('booking_abandoned', { step: W.step, coachId: W.coach?.id });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('wizard-close').addEventListener('click', closeWizard);
  backdrop().addEventListener('click', (e) => { if (e.target === backdrop()) closeWizard(); });
  // Escape closes the wizard when it's open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop().classList.contains('open')) closeWizard();
  });
});

const STEP_TITLES = ['Pick a time', 'Your position', 'Session focus', 'Where do you train?', 'Confirm your booking'];

function header(title, subtitle) {
  return `
    <div class="kicker" style="color:var(--lime);font-weight:700;letter-spacing:.18em;
      text-transform:uppercase;font-size:.75rem">Book ${esc(W.coach.name)}</div>
    <h2 style="font-size:1.9rem">${esc(title)}</h2>
    ${subtitle ? `<p class="muted small">${subtitle}</p>` : ''}
    <div class="steps">${STEP_TITLES.map((_, i) =>
      `<span class="step-pill ${i <= W.step ? 'done' : ''}"></span>`).join('')}</div>`;
}

function nav({ backOk = true, nextOk = false, nextLabel = 'Continue' } = {}) {
  return `<div class="wizard-nav">
    <button class="btn btn-ghost" data-nav="back" ${backOk ? '' : 'style="visibility:hidden"'}>Back</button>
    <button class="btn btn-primary" data-nav="next" ${nextOk ? '' : 'disabled'}>${nextLabel}</button>
  </div>`;
}

function render() {
  const steps = [renderSlot, renderPosition, renderFocus, renderLocation, renderReview];
  steps[W.step]();
  body().querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', onNav));
}

function onNav(e) {
  const dir = e.currentTarget.dataset.nav;
  if (dir === 'back') { W.step = Math.max(0, W.step - 1); return render(); }
  if (W.step === 3 || (W.step === 2 && skipLocation())) {
    // entering review
    W.step = 4;
  } else {
    W.step += 1;
    if (W.step === 3 && skipLocation()) W.step = 4;
  }
  track('booking_step', { step: W.step, coachId: W.coach.id });
  render();
}

// Online sessions and single-city coaches don't need the location step.
function skipLocation() {
  const focus = W.site.focusTypes.find((f) => f.id === W.focus);
  if (focus?.online) { W.location = 'Online'; return true; }
  if (W.coach.locations.length === 1) { W.location = W.coach.locations[0]; return true; }
  return false;
}

// --- step 0: slot picker ----------------------------------------------------
function renderSlot() {
  const byDate = new Map();
  for (const s of W.slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s.hour);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) {
    body().innerHTML = header(STEP_TITLES[0]) +
      `<p class="muted">${esc(W.coach.name)} has not opened any bookable times right now —
       check back soon or pick another coach.</p>` + nav({ backOk: false });
    return;
  }
  const selDate = W.slot?.date && byDate.has(W.slot.date) ? W.slot.date : dates[0];

  body().innerHTML = header(STEP_TITLES[0],
    'All times are one-hour sessions, Finnish time (8:00–20:00). Only times the coach has opened are shown.') +
    `<div class="date-strip">${dates.map((d) => `
      <div class="date-cell ${d === selDate ? 'sel' : ''}" data-date="${d}">
        <div class="dow">${fmtDate(d).split(' ')[0]}</div>
        <div class="num">${d.slice(8)}</div>
        <div class="small muted">${byDate.get(d).length} free</div>
      </div>`).join('')}</div>
    <div class="slot-grid" id="slot-grid"></div>` +
    nav({ backOk: false, nextOk: Boolean(W.slot) });

  function paintHours(date) {
    const grid = body().querySelector('#slot-grid');
    grid.innerHTML = byDate.get(date).sort((a, b) => a - b).map((h) => `
      <button class="slot-btn ${W.slot && W.slot.date === date && W.slot.hour === h ? 'sel' : ''}"
        data-hour="${h}">${String(h).padStart(2, '0')}:00</button>`).join('');
    grid.querySelectorAll('.slot-btn').forEach((btn) => btn.addEventListener('click', () => {
      W.slot = { date, hour: Number(btn.dataset.hour) };
      grid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
      body().querySelector('[data-nav="next"]').disabled = false;
    }));
  }
  body().querySelectorAll('.date-cell').forEach((cell) => cell.addEventListener('click', () => {
    body().querySelectorAll('.date-cell').forEach((c) => c.classList.remove('sel'));
    cell.classList.add('sel');
    paintHours(cell.dataset.date);
  }));
  paintHours(selDate);
}

// --- step 1: position (limited to what the coach trains) --------------------
function renderPosition() {
  body().innerHTML = header(STEP_TITLES[1],
    `${esc(W.coach.name.split(' ')[0])} trains: ${W.coach.positions.map(cap).join(', ')}.`) +
    `<div class="opt-grid">${W.coach.positions.map((p) => `
      <div class="opt-card ${W.position === p ? 'sel' : ''}" data-val="${p}">
        <div class="t">${esc(cap(p))}</div>
        <div class="d">Session built for ${esc(p)}</div>
      </div>`).join('')}</div>` + nav({ nextOk: Boolean(W.position) });
  bindOptCards('position');
}

// --- step 2: focus ----------------------------------------------------------
const FOCUS_HINTS = {
  conditioning: 'Engine building — repeat sprints, stamina', physicality: 'Strength, duels, holding your ground',
  agility: 'Feet, turns, first three steps', technical: 'Touch, control, both feet',
  defending: '1v1s, blocks, body shape', finishing: 'Shots, headers, composure in the box',
  passing: 'Short, long, breaking lines', 'game-iq': 'Video session — scanning, decisions, positioning',
};
function renderFocus() {
  body().innerHTML = header(STEP_TITLES[2], 'What should the hour concentrate on?') +
    `<div class="opt-grid">${W.site.focusTypes.map((f) => `
      <div class="opt-card ${W.focus === f.id ? 'sel' : ''}" data-val="${f.id}">
        <div class="t">${esc(f.label)} ${f.online ? '<span class="chip" style="font-size:.68rem">ONLINE</span>' : ''}</div>
        <div class="d">${esc(FOCUS_HINTS[f.id] || '')}</div>
      </div>`).join('')}</div>` + nav({ nextOk: Boolean(W.focus) });
  // Changing the focus can change whether a location is valid (online forces
  // 'Online'; on-pitch needs a real city), so drop any previously picked city.
  bindOptCards('focus', () => { W.location = null; });
}

// --- step 3: location -------------------------------------------------------
function renderLocation() {
  body().innerHTML = header(STEP_TITLES[3],
    `${esc(W.coach.name.split(' ')[0])} coaches in these cities — pick what suits you.`) +
    `<div class="opt-grid">${W.coach.locations.map((l) => `
      <div class="opt-card ${W.location === l ? 'sel' : ''}" data-val="${l}">
        <div class="t">${esc(l)}</div><div class="d">Exact pitch confirmed with your coach</div>
      </div>`).join('')}</div>` + nav({ nextOk: Boolean(W.location) });
  bindOptCards('location');
}

function bindOptCards(field, onChange) {
  body().querySelectorAll('.opt-card').forEach((card) => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    const choose = () => {
      W[field] = card.dataset.val;
      body().querySelectorAll('.opt-card').forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      body().querySelector('[data-nav="next"]').disabled = false;
      if (onChange) onChange(card.dataset.val);
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
    });
  });
}

// --- step 4: review + login + confirm ---------------------------------------
async function renderReview() {
  const focus = W.site.focusTypes.find((f) => f.id === W.focus);
  const p = W.site.pricing;
  const price = (focus.online ? p.onlineSessionPrice : p.sessionPrice) * 100;

  let me = { user: null };
  try { me = await API.get('/me'); } catch { /* anonymous */ }
  W.user = me.user;
  const needsAuth = !W.user || (W.user.role !== 'customer' && W.user.role !== 'admin');

  // A free-session credit (from a cancelled booking) makes this booking free;
  // otherwise the launch sale applies. The server enforces the same rule.
  const hasCredit = !needsAuth && (me.freeCredits || 0) > 0;
  const discount = hasCredit ? price : Math.round(price * p.salePercent / 100);
  const priceChip = hasCredit
    ? '<span class="chip" style="font-size:.68rem">FREE — credit from a cancelled session</span>'
    : (discount ? `<span class="chip" style="font-size:.68rem">${p.saleLabel} −${p.salePercent}%</span>` : '');

  body().innerHTML = header(STEP_TITLES[4]) + `
    <div class="review-row"><span class="muted">Coach</span><strong>${esc(W.coach.name)}</strong></div>
    <div class="review-row"><span class="muted">Time</span>
      <strong>${esc(fmtDate(W.slot.date))} ${String(W.slot.hour).padStart(2, '0')}:00–${String(W.slot.hour + 1).padStart(2, '0')}:00</strong></div>
    <div class="review-row"><span class="muted">Built for</span><strong>${esc(cap(W.position))}</strong></div>
    <div class="review-row"><span class="muted">Focus</span><strong>${esc(focus.label)}</strong></div>
    <div class="review-row"><span class="muted">Where</span><strong>${esc(W.location)}</strong></div>
    <div class="review-row"><span class="muted">Price</span>
      <strong>${discount ? `<span class="price-old">${eur(price)}</span> ` : ''}
        <span class="price-new">${eur(price - discount)}</span>
        ${priceChip}</strong></div>
    <p class="small muted" style="margin-top:12px">${hasCredit
      ? 'This session is free — your credit is applied automatically and the 0,00 € invoice is just for your records.'
      : `Confirming issues the invoice (${eur(price - discount)}, due in 7 days)${W.site.emailDelivery ? ' to your email' : ', viewable in My bookings'}. Pay by the due date — details are on the invoice.`}</p>
    <div id="auth-panel"></div>
    <div class="form-error" id="confirm-error"></div>
    <div class="wizard-nav">
      <button class="btn btn-ghost" data-nav="back">Back</button>
      <button class="btn btn-primary" id="confirm-btn" ${needsAuth ? 'disabled' : ''}>
        Confirm booking</button>
    </div>`;

  body().querySelector('[data-nav="back"]').addEventListener('click', () => {
    W.step = skipLocation() ? 2 : 3;
    render();
  });

  if (needsAuth) renderAuthPanel();

  body().querySelector('#confirm-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Booking…';
    try {
      const result = await API.post('/bookings', {
        coachId: W.coach.id, date: W.slot.date, hour: W.slot.hour,
        position: W.position, focus: W.focus, location: W.location,
      });
      W.step = 5;
      renderSuccess(result);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Confirm booking';
      body().querySelector('#confirm-error').textContent = err.message;
      if (err.status === 409) { // slot taken — refresh slots and go back to the picker
        const data = await API.get(`/coaches/${W.coach.id}/slots`).catch(() => null);
        if (data) { W.slots = data.slots; }
        W.slot = null;
        W.step = 0;
        toast('That time was just taken — please pick another.', true);
        render();
      }
    }
  });
}

// Inline login / signup so the customer never leaves the wizard.
function renderAuthPanel() {
  const panel = body().querySelector('#auth-panel');
  const isCoachOrAdmin = W.user && W.user.role === 'coach';
  panel.innerHTML = isCoachOrAdmin
    ? `<p class="form-error">You are logged in as a coach — bookings need a customer account.
       Log out first, then book as a customer.</p>`
    : `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn btn-sm btn-primary" data-tab="login">I have an account</button>
        <button class="btn btn-sm btn-ghost" data-tab="signup">I'm new here</button>
      </div>
      <form id="auth-form">
        <label class="f" id="f-name" hidden><span>Player / parent name</span>
          <input type="text" name="name" autocomplete="name"></label>
        <label class="f"><span>Email</span>
          <input type="email" name="email" required autocomplete="email"></label>
        <label class="f"><span>Password</span>
          <input type="password" name="password" required autocomplete="current-password"></label>
        <div class="form-error" id="auth-error"></div>
        <button class="btn btn-primary" type="submit" style="width:100%">Log in &amp; continue</button>
      </form>
    </div>`;
  if (isCoachOrAdmin) return;

  let mode = 'login';
  panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    panel.querySelectorAll('[data-tab]').forEach((x) => {
      x.classList.toggle('btn-primary', x === b);
      x.classList.toggle('btn-ghost', x !== b);
    });
    panel.querySelector('#f-name').hidden = mode === 'login';
    panel.querySelector('button[type="submit"]').innerHTML =
      mode === 'login' ? 'Log in &amp; continue' : 'Create account &amp; continue';
  }));

  panel.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = panel.querySelector('#auth-error');
    err.textContent = '';
    try {
      const payload = { email: fd.get('email'), password: fd.get('password') };
      if (mode === 'signup') payload.name = fd.get('name');
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      if (res.user.role !== 'customer' && res.user.role !== 'admin') {
        err.textContent = 'This account is a staff account — please use a customer account to book.';
        return;
      }
      initHeaderAuth();
      renderReview(); // re-render with the confirm button enabled
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

// --- success ----------------------------------------------------------------
function renderSuccess({ booking, invoice }) {
  body().innerHTML = `
    <div style="text-align:center;padding:12px 0">
      <div style="font-size:3.2rem">⚽</div>
      <h2>You're booked!</h2>
      <p class="muted">${esc(booking.coach)} · ${esc(fmtDate(booking.date))}
        ${String(booking.hour).padStart(2, '0')}:00–${String(booking.hour + 1).padStart(2, '0')}:00 ·
        ${esc(booking.location)}</p>
      <p>Booking reference <strong>${esc(booking.code)}</strong></p>
      <div class="card" style="text-align:left;margin:18px 0">
        <div class="review-row"><span class="muted">Invoice</span><strong>${esc(invoice.number)}</strong></div>
        <div class="review-row"><span class="muted">Amount</span><strong>${eur(invoice.amountCents)}
          ${booking.creditApplied ? '<span class="chip" style="font-size:.68rem">FREE — credit used</span>' : ''}</strong></div>
        <div class="review-row" style="border:none"><span class="muted">Due</span><strong>${esc(invoice.dueDate)}</strong></div>
      </div>
      <p class="small muted">${W.site.emailDelivery
        ? 'The invoice has been sent to your email.'
        : 'Your invoice is ready to view below.'} You can open it any time
        from <a href="/my-bookings">My bookings</a>.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:8px">
        <a class="btn btn-ghost" href="/api/invoices/${encodeURIComponent(invoice.number)}" target="_blank">View invoice</a>
        <a class="btn btn-primary" href="/my-bookings">My bookings</a>
      </div>
    </div>`;
}
