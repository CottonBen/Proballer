// Booking wizard: time → position → focus → location → confirm (+ inline login).
'use strict';

const W = {
  coach: null, site: null, slots: [],
  slot: null, position: null, focus: null, location: null,
  step: 0, user: null,
};

const backdrop = () => document.getElementById('wizard-backdrop');
const body = () => document.getElementById('wizard-body');

// Hour labels per the copy rulings: FI '9.00', EN '9:00'; en dash in ranges.
const fmtHour = (h) => `${h}${I18N.lang === 'fi' ? '.' : ':'}00`;
const fmtHourRange = (h) => `${fmtHour(h)}–${fmtHour(h + 1)}`;

function track(type, meta) { API.post('/track', { type, meta }).catch(() => {}); }

async function openWizard(coach, site) {
  W.coach = coach; W.site = site;
  W.slot = W.position = W.focus = W.location = null;
  W.step = 0;
  backdrop().classList.add('open');
  document.body.style.overflow = 'hidden';
  track('booking_started', { coachId: coach.id });
  body().innerHTML = `<p class="muted">${t('booking.wizard.loading_calendar')}</p>`;
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

const STEP_TITLE_KEYS = ['booking.step.time.title', 'booking.step.position.title',
  'booking.step.focus.title', 'booking.step.location.title', 'booking.step.confirm.title'];

function header(title, subtitle) {
  return `
    <div class="kicker" style="color:var(--lime);font-weight:700;letter-spacing:.18em;
      text-transform:uppercase;font-size:.75rem">${t('booking.wizard.kicker', { coach: esc(W.coach.name) })}</div>
    <h2 style="font-size:1.9rem">${esc(title)}</h2>
    ${subtitle ? `<p class="muted small">${subtitle}</p>` : ''}
    <div class="steps">${STEP_TITLE_KEYS.map((_, i) =>
      `<span class="step-pill ${i <= W.step ? 'done' : ''}"></span>`).join('')}</div>`;
}

function nav({ backOk = true, nextOk = false, nextLabel = t('booking.nav.continue') } = {}) {
  return `<div class="wizard-nav">
    <button class="btn btn-ghost" data-nav="back" ${backOk ? '' : 'style="visibility:hidden"'}>${t('booking.nav.back')}</button>
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
    body().innerHTML = header(t(STEP_TITLE_KEYS[0])) +
      `<p class="muted">${t('booking.slots.empty', { coach: esc(W.coach.name) })}</p>` +
      nav({ backOk: false });
    return;
  }
  const selDate = W.slot?.date && byDate.has(W.slot.date) ? W.slot.date : dates[0];

  body().innerHTML = header(t(STEP_TITLE_KEYS[0]), t('booking.step.time.subtitle')) +
    `<div class="date-strip">${dates.map((d) => `
      <div class="date-cell ${d === selDate ? 'sel' : ''}" data-date="${d}">
        <div class="dow">${fmtDate(d).split(' ')[0]}</div>
        <div class="num">${d.slice(8)}</div>
        <div class="small muted">${t('booking.slots.free_count', { count: byDate.get(d).length })}</div>
      </div>`).join('')}</div>
    <div class="slot-grid" id="slot-grid"></div>` +
    nav({ backOk: false, nextOk: Boolean(W.slot) });

  function paintHours(date) {
    const grid = body().querySelector('#slot-grid');
    grid.innerHTML = byDate.get(date).sort((a, b) => a - b).map((h) => `
      <button class="slot-btn ${W.slot && W.slot.date === date && W.slot.hour === h ? 'sel' : ''}"
        data-hour="${h}">${fmtHourRange(h)}</button>`).join('');
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
  body().innerHTML = header(t(STEP_TITLE_KEYS[1]),
    t('booking.step.position.subtitle', {
      coach: esc(W.coach.name.split(' ')[0]),
      positions: W.coach.positions.map((p) => esc(posLabel(p))).join(', '),
    })) +
    `<div class="opt-grid">${W.coach.positions.map((p) => `
      <div class="opt-card ${W.position === p ? 'sel' : ''}" data-val="${p}">
        <div class="t">${esc(posLabel(p))}</div>
        <div class="d">${t('booking.step.position.card_desc', { position: esc(posLabel(p).toLowerCase()) })}</div>
      </div>`).join('')}</div>` + nav({ nextOk: Boolean(W.position) });
  bindOptCards('position');
}

// --- step 2: focus ----------------------------------------------------------
function renderFocus() {
  body().innerHTML = header(t(STEP_TITLE_KEYS[2]), t('booking.step.focus.subtitle')) +
    `<div class="opt-grid">${W.site.focusTypes.map((f) => {
      // Hint keys use underscores ('game-iq' -> booking.focus.hint.game_iq);
      // unknown focus ids just render without a hint.
      const hintKey = 'booking.focus.hint.' + f.id.replace(/-/g, '_');
      return `
      <div class="opt-card ${W.focus === f.id ? 'sel' : ''}" data-val="${f.id}">
        <div class="t">${esc(I18N.server(f.label))} ${f.online ? `<span class="chip" style="font-size:.68rem">${t('booking.focus.online_chip')}</span>` : ''}</div>
        <div class="d">${I18N_DICT[hintKey] ? t(hintKey) : ''}</div>
      </div>`;
    }).join('')}</div>` + nav({ nextOk: Boolean(W.focus) });
  // Changing the focus can change whether a location is valid (online forces
  // 'Online'; on-pitch needs a real city), so drop any previously picked city.
  bindOptCards('focus', () => { W.location = null; });
}

// --- step 3: location -------------------------------------------------------
function renderLocation() {
  body().innerHTML = header(t(STEP_TITLE_KEYS[3]),
    t('booking.step.location.subtitle', { coach: esc(W.coach.name.split(' ')[0]) })) +
    `<div class="opt-grid">${W.coach.locations.map((l) => `
      <div class="opt-card ${W.location === l ? 'sel' : ''}" data-val="${l}">
        <div class="t">${esc(I18N.server(l))}</div><div class="d">${t('booking.step.location.card_desc')}</div>
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
    ? `<span class="chip" style="font-size:.68rem">${t('booking.review.credit_chip')}</span>`
    : (discount ? `<span class="chip" style="font-size:.68rem">${t('booking.review.sale_chip',
        { saleLabel: esc(I18N.server(p.saleLabel)), salePercent: p.salePercent })}</span>` : '');

  // Raw method stays English server-side; translate for display only.
  const payMethod = W.site.payment && W.site.payment.method
    ? I18N.server(W.site.payment.method).toLowerCase()
    : t('booking.review.payment_method_fallback');

  body().innerHTML = header(t(STEP_TITLE_KEYS[4])) + `
    <div class="review-row"><span class="muted">${t('booking.review.coach_label')}</span><strong>${esc(W.coach.name)}</strong></div>
    <div class="review-row"><span class="muted">${t('booking.review.time_label')}</span>
      <strong>${esc(fmtDate(W.slot.date))} ${fmtHourRange(W.slot.hour)}</strong></div>
    <div class="review-row"><span class="muted">${t('booking.review.position_label')}</span><strong>${esc(posLabel(W.position))}</strong></div>
    <div class="review-row"><span class="muted">${t('booking.review.focus_label')}</span><strong>${esc(I18N.server(focus.label))}</strong></div>
    <div class="review-row"><span class="muted">${t('booking.review.location_label')}</span><strong>${esc(I18N.server(W.location))}</strong></div>
    <div class="review-row"><span class="muted">${t('booking.review.price_label')}</span>
      <strong>${discount ? `<span class="price-old">${eur(price)}</span> ` : ''}
        <span class="price-new">${eur(price - discount)}</span>
        ${priceChip}</strong></div>
    <p class="small muted" style="margin-top:12px">${hasCredit
      ? t('booking.review.free_note')
      : t('booking.review.invoice_note', {
          price: eur(price - discount),
          delivery: W.site.emailDelivery
            ? t('booking.review.invoice_note_delivery_email')
            : t('booking.review.invoice_note_delivery_mybookings'),
          method: esc(payMethod),
        })}</p>
    <div id="auth-panel"></div>
    <div class="form-error" id="confirm-error"></div>
    <div class="wizard-nav">
      <button class="btn btn-ghost" data-nav="back">${t('booking.nav.back')}</button>
      <button class="btn btn-primary" id="confirm-btn" ${needsAuth ? 'disabled' : ''}>
        ${t('booking.review.confirm_button')}</button>
    </div>`;

  body().querySelector('[data-nav="back"]').addEventListener('click', () => {
    W.step = skipLocation() ? 2 : 3;
    render();
  });

  if (needsAuth) renderAuthPanel();

  body().querySelector('#confirm-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = t('booking.review.confirm_button_busy');
    try {
      const result = await API.post('/bookings', {
        coachId: W.coach.id, date: W.slot.date, hour: W.slot.hour,
        position: W.position, focus: W.focus, location: W.location,
        lang: I18N.lang, // the invoice is generated in this language
      });
      W.step = 5;
      renderSuccess(result);
    } catch (err) {
      btn.disabled = false; btn.textContent = t('booking.review.confirm_button');
      body().querySelector('#confirm-error').textContent = err.message;
      if (err.status === 409) { // slot taken — refresh slots and go back to the picker
        const data = await API.get(`/coaches/${W.coach.id}/slots`).catch(() => null);
        if (data) { W.slots = data.slots; }
        W.slot = null;
        W.step = 0;
        toast(t('booking.toast.slot_taken'), true);
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
    ? `<p class="form-error">${t('booking.auth.coach_blocked')}</p>`
    : `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn btn-sm btn-primary" data-tab="login">${t('booking.auth.tab_login')}</button>
        <button class="btn btn-sm btn-ghost" data-tab="signup">${t('booking.auth.tab_signup')}</button>
      </div>
      <form id="auth-form">
        <label class="f" id="f-name" hidden><span>${t('booking.auth.name_label')}</span>
          <input type="text" name="name" autocomplete="name"></label>
        <label class="f"><span>${t('common.form.email')}</span>
          <input type="email" name="email" required autocomplete="email"></label>
        <label class="f"><span>${t('common.form.password')}</span>
          <input type="password" name="password" required autocomplete="current-password"></label>
        <div class="form-error" id="auth-error"></div>
        <button class="btn btn-primary" type="submit" style="width:100%">${esc(t('booking.auth.submit_login'))}</button>
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
    panel.querySelector('button[type="submit"]').textContent =
      mode === 'login' ? t('booking.auth.submit_login') : t('booking.auth.submit_signup');
  }));

  panel.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = panel.querySelector('#auth-error');
    err.textContent = '';
    try {
      // lang: invoices + emails follow the language the customer uses the site in
      const payload = { email: fd.get('email'), password: fd.get('password'), lang: I18N.lang };
      if (mode === 'signup') payload.name = fd.get('name');
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      if (res.user.role !== 'customer' && res.user.role !== 'admin') {
        err.textContent = t('booking.auth.staff_error');
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
      <h2>${t('booking.success.title')}</h2>
      <p class="muted">${esc(booking.coach)} · ${esc(fmtDate(booking.date))}
        ${fmtHourRange(booking.hour)} ·
        ${esc(I18N.server(booking.location))}</p>
      <p>${t('booking.success.reference', { code: `<strong>${esc(booking.code)}</strong>` })}</p>
      <div class="card" style="text-align:left;margin:18px 0">
        <div class="review-row"><span class="muted">${t('booking.success.invoice_label')}</span><strong>${esc(invoice.number)}</strong></div>
        <div class="review-row"><span class="muted">${t('booking.success.amount_label')}</span><strong>${eur(invoice.amountCents)}
          ${booking.creditApplied ? `<span class="chip" style="font-size:.68rem">${t('booking.success.credit_chip')}</span>` : ''}</strong></div>
        <div class="review-row" style="border:none"><span class="muted">${t('booking.success.due_label')}</span><strong>${esc(I18N.lang === 'fi' ? fiDate(invoice.dueDate) : invoice.dueDate)}</strong></div>
      </div>
      <p class="small muted">${W.site.emailDelivery
        ? t('booking.success.invoice_emailed')
        : t('booking.success.invoice_ready')} ${t('booking.success.payment_note',
          { myBookingsLink: `<a href="/my-bookings">${t('common.nav.my_bookings')}</a>` })}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:8px">
        <a class="btn btn-ghost" href="/api/invoices/${encodeURIComponent(invoice.number)}" target="_blank">${t('booking.success.view_invoice')}</a>
        <a class="btn btn-primary" href="/my-bookings">${t('common.nav.my_bookings')}</a>
      </div>
    </div>`;
}
