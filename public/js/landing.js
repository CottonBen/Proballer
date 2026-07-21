// Landing page: entry gate (sign in / create account first), hero carousel
// (rotates every 10 s; a clicked spotlight stays pinned) + coaches grid.
'use strict';

let SITE = null;      // /api/config payload
let COACHES = [];     // /api/coaches payload

function slidePriceHTML() {
  const p = SITE.pricing;
  if (!p.salePercent) return `<span class="price-new">${eur(p.sessionPrice * 100)}</span> ${t('landing.persession')}`;
  const now = p.sessionPrice * 100 * (100 - p.salePercent) / 100;
  return `<span class="price-old">${eur(p.sessionPrice * 100)}</span>
    <span class="price-new">${eur(now)}</span> ${t('landing.persession')}`;
}

// --- hero carousel ----------------------------------------------------------
function buildSlides() {
  const carousel = document.getElementById('carousel');
  const dots = document.getElementById('dots');
  const slides = [];

  // Spotlight order: the admin's explicit numbers (1, 2, 3, …) come first;
  // featured coaches without a number follow in their normal site order.
  const featured = COACHES.filter((c) => c.featured)
    .sort((a, b) => (a.spotlightOrder || 999) - (b.spotlightOrder || 999));
  for (const c of featured) {
    slides.push({
      photos: c.photos,
      html: `
        <div>
          <div class="kicker">${t('landing.spotlight')}</div>
          <h1><a href="/coaches/${encodeURIComponent(c.slug)}" style="color:inherit">${esc(c.name)}</a></h1>
          <div class="slide-tags">
            ${c.positions.map((p) => `<span class="chip">${esc(posLabel(p))}</span>`).join('')}
            ${c.locations.map((l) => `<span class="chip gray">${esc(l)}</span>`).join('')}
          </div>
          <p class="bio">${esc(coachBio(c))}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" data-book="${c.id}">${t('landing.bookwith', { name: esc(c.name.split(' ')[0]) })}</button>
            <a class="btn btn-ghost" href="/coaches/${encodeURIComponent(c.slug)}">${t('landing.fullprofile')}</a>
          </div>
        </div>`,
    });
  }

  // Final slide — about us.
  slides.push({
    photos: ['/assets/ben-2.jpg'],
    html: `
      <div>
        <div class="kicker">${t('landing.about.kicker')}</div>
        <h1>${t('landing.about.title')}</h1>
        <p class="bio">${t('landing.about.body1')}</p>
        <p class="bio">${t('landing.about.body2')}</p>
        <a class="btn btn-primary" href="#coaches">${t('landing.about.cta')}</a>
      </div>`,
  });

  slides.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slide' + (i === 0 ? ' active' : '');
    el.innerHTML = `${s.html}
      <div class="slide-photo">${s.photos.map((p, j) =>
        `<img src="${esc(p)}" alt="" class="${j === 0 ? 'show' : ''}" loading="${i === 0 ? 'eager' : 'lazy'}">`).join('')}
      </div>`;
    carousel.appendChild(el);

    const dot = document.createElement('button');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', t('landing.slide.aria', { n: i + 1 }));
    dot.innerHTML = '<span class="fill"></span>';
    dot.addEventListener('click', () => show(i, true));
    dots.appendChild(dot);
  });

  const els = [...carousel.children];
  const dotEls = [...dots.children];
  let current = 0;
  let timer = null;
  let photoTimer = null;
  let pinned = false; // a hand-picked spotlight stays until another dot is clicked

  function rotatePhotos(slideEl) {
    clearInterval(photoTimer);
    const imgs = slideEl.querySelectorAll('.slide-photo img');
    if (imgs.length < 2) return;
    let k = 0;
    photoTimer = setInterval(() => {
      imgs[k].classList.remove('show');
      k = (k + 1) % imgs.length;
      imgs[k].classList.add('show');
    }, 2400);
  }

  function show(i, manual = false) {
    els[current].classList.remove('active');
    dotEls[current].classList.remove('active');
    current = i % els.length;
    els[current].classList.add('active');
    // restart the dot progress animation
    const dot = dotEls[current];
    dot.classList.remove('active');
    void dot.offsetWidth;
    dot.classList.add('active');
    rotatePhotos(els[current]);
    // Clicking a dot pins that spotlight: rotation stops for good, and the
    // dots stop showing the countdown fill (CSS .dots.pinned).
    if (manual) {
      pinned = true;
      dots.classList.add('pinned');
      clearInterval(timer);
    }
  }

  function restart() {
    if (pinned) return;
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), 10000); // spotlight rotates every 10 seconds
  }

  carousel.addEventListener('mouseenter', () => clearInterval(timer));
  carousel.addEventListener('mouseleave', restart);
  rotatePhotos(els[0]);
  restart();
}

// --- group training ---------------------------------------------------------
let GROUPS = { sessions: [], startable: [] };
let LANDING_USER = null;

const hourFmt = (h) => `${String(h).padStart(2, '0')}${I18N.lang === 'fi' ? '.' : ':'}00`;
const ageLabel = (a) => t('landing.groups.age_of', { age: a });

// Two halves under the spotlight: joinable sessions (with live spot counts
// and their age group) and free coach hours ≥5 days out where a player can
// START a brand-new group for their own age group.
async function buildGroups() {
  const section = document.getElementById('groups');
  if (!section) return;
  try { GROUPS = await API.get('/groups'); } catch { GROUPS = { sessions: [], startable: [] }; }
  const any = GROUPS.sessions.length || GROUPS.startable.length;
  section.hidden = !any;
  if (!any) return;
  const gt = SITE.groupTraining || { pricePerPlayer: 25, capacity: 4, ageGroups: [] };
  document.getElementById('groups-sub').textContent = t('landing.groups.sub', { cap: gt.capacity });
  document.getElementById('group-price-tag').innerHTML =
    `<span class="price-new">${eur(gt.pricePerPlayer * 100)}</span>
     <span class="muted" style="font-size:1rem">${t('landing.groups.perplayer')}</span>`;

  const sessionCards = GROUPS.sessions.map((g) => {
    const full = g.spotsLeft < 1;
    return `
    <article class="card reveal" style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:12px">
        ${g.coachPhoto ? `<img src="${esc(g.coachPhoto)}" alt="" style="width:52px;height:52px;border-radius:50%;object-fit:cover">` : ''}
        <div>
          <strong style="display:block">${esc(fmtDate(g.date))} ${hourFmt(g.hour)}</strong>
          <span class="muted small">${esc(g.coach)} · ${esc(I18N.server(g.location))}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${g.ageGroup ? `<span class="chip">${esc(ageLabel(g.ageGroup))}</span>`
          : `<select class="input" data-agepick style="padding:4px 8px;font-size:.8rem">
              ${gt.ageGroups.map((a) => `<option value="${a}">${esc(ageLabel(a))}</option>`).join('')}</select>`}
        <span class="chip ${full ? 'gray' : ''}">${full
          ? t('landing.groups.full')
          : t('landing.groups.spots', { left: g.spotsLeft, cap: g.capacity })}</span>
      </div>
      <div style="margin-top:auto">
        <button class="btn btn-primary btn-sm" data-join="${esc(g.code)}" data-age="${esc(g.ageGroup)}"
          ${full ? 'disabled' : ''} style="width:100%">${t('landing.groups.join')}</button>
      </div>
    </article>`;
  }).join('');

  // The "start a new group" card: coach → time → city → age group.
  let startCard = '';
  if (GROUPS.startable.length) {
    startCard = `
    <article class="card reveal" style="display:flex;flex-direction:column;gap:8px;border-style:dashed">
      <strong>${t('landing.groups.start_title')}</strong>
      <span class="muted small">${t('landing.groups.start_sub')}</span>
      <select class="input" id="gs-coach">
        ${GROUPS.startable.map((c, i) => `<option value="${i}">${esc(c.coach)}</option>`).join('')}
      </select>
      <select class="input" id="gs-slot"></select>
      <select class="input" id="gs-city"></select>
      <select class="input" id="gs-age">
        <option value="" disabled selected>${esc(t('landing.groups.pick_age'))}</option>
        ${gt.ageGroups.map((a) => `<option value="${a}">${esc(ageLabel(a))}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" id="gs-start" style="margin-top:auto">
        ${t('landing.groups.start_cta', { price: eur(gt.pricePerPlayer * 100) })}</button>
    </article>`;
  }

  document.getElementById('group-grid').innerHTML = sessionCards + startCard;

  document.getElementById('group-grid').querySelectorAll('[data-join]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const card = btn.closest('article');
      const age = btn.dataset.age || card.querySelector('[data-agepick]')?.value || '';
      requireAccount(() => joinGroup(btn, age));
    }));

  const coachSel = document.getElementById('gs-coach');
  if (coachSel) {
    const paintStart = () => {
      const c = GROUPS.startable[Number(coachSel.value)];
      document.getElementById('gs-slot').innerHTML = c.slots.map((s, i) =>
        `<option value="${i}">${esc(fmtDate(s.date))} ${hourFmt(s.hour)}</option>`).join('');
      document.getElementById('gs-city').innerHTML = c.locations.map((l) =>
        `<option>${esc(l)}</option>`).join('');
    };
    coachSel.addEventListener('change', paintStart);
    paintStart();
    document.getElementById('gs-start').addEventListener('click', () => {
      const c = GROUPS.startable[Number(coachSel.value)];
      const slot = c.slots[Number(document.getElementById('gs-slot').value)];
      const body = {
        coachId: c.coachId, date: slot.date, hour: slot.hour,
        location: document.getElementById('gs-city').value,
        ageGroup: document.getElementById('gs-age').value,
      };
      if (!body.ageGroup) { toast(I18N.server('Please pick an age group.'), true); return; }
      requireAccount(async () => {
        const btn = document.getElementById('gs-start');
        btn.disabled = true;
        try {
          const r = await API.post('/groups/start', body);
          if (r.payUrl) { location.href = r.payUrl; return; }
          if (r.signup && r.signup.status === 'confirmed') { toast(t('pay.success.group_title')); buildGroups(); return; }
          toast(t('landing.groups.pay_failed'), true);
        } catch (err) {
          btn.disabled = false;
          toast(I18N.server(err.message), true);
          buildGroups();
        }
      });
    });
  }
}

async function joinGroup(btn, ageGroup) {
  btn.disabled = true;
  try {
    const r = await API.post(`/groups/${encodeURIComponent(btn.dataset.join)}/join`,
      { ageGroup, lang: I18N.lang });
    if (r.payUrl) { location.href = r.payUrl; return; }
    if (r.signup && r.signup.status === 'confirmed') { toast(t('pay.success.group_title')); buildGroups(); return; }
    toast(t('landing.groups.pay_failed'), true);
  } catch (err) {
    btn.disabled = false;
    toast(I18N.server(err.message), true);
    buildGroups(); // spot counts may have moved under us
  }
}

// --- training packages section ------------------------------------------------
// The 3/5/8 bundles with their pitch: good start / favourite / elite.
function buildPackages() {
  const grid = document.getElementById('package-grid');
  if (!grid) return;
  const options = (SITE.packages || []).filter((o) => o.sessions > 1);
  const single = (SITE.packages || []).find((o) => o.sessions === 1);
  if (!options.length) { document.getElementById('packages').hidden = true; return; }
  grid.innerHTML = options.map((o) => {
    const per = Math.round(o.price * 100 / o.sessions);
    const save = single ? single.price * 100 * o.sessions - o.price * 100 : 0;
    const cls = o.id === 'pack5' ? 'popular' : (o.id === 'pack8' ? 'elite' : '');
    return `
    <article class="card pkg-card reveal ${cls}">
      <span class="pkg-tag">${t('landing.pkg.tag.' + o.id)}</span>
      <h3 style="margin:0">${t('landing.pkg.name.' + o.id)}</h3>
      <div class="pkg-price">${eur(o.price * 100)}
        <span class="muted" style="font-size:.9rem;font-weight:400">· ${t('landing.pkg.sessions', { n: o.sessions })}</span></div>
      <div class="muted small">${t('booking.pkg.per', { per: eur(per) })}${save > 0
        ? ` · <strong style="color:var(--lime)">${t('landing.pkg.save', { save: eur(save) })}</strong>` : ''}</div>
      <p class="muted small" style="margin:0">${t('landing.pkg.bio.' + o.id)}</p>
      <button class="btn btn-primary btn-sm" data-buylanding="${o.id}" style="margin-top:auto">
        ${t('landing.pkg.cta')}</button>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-buylanding]').forEach((btn) =>
    btn.addEventListener('click', () => requireAccount(async () => {
      btn.disabled = true;
      try {
        const r = await API.post('/packages/buy', { package: btn.dataset.buylanding });
        if (r.payUrl) { location.href = r.payUrl; return; }
        toast(t('landing.groups.pay_failed'), true);
      } catch (err) {
        btn.disabled = false;
        toast(I18N.server(err.message), true);
      }
    })));
}

// --- header menu + get-in-touch modal -----------------------------------------
function updateMenuLabels() {
  const loginItem = document.querySelector('#site-menu [data-menu="login"]');
  if (loginItem) loginItem.textContent = LANDING_USER ? t('common.mybookings') : t('common.login');
  // The app link only makes sense with an account (players, coaches, admin).
  const appItem = document.querySelector('#site-menu [data-menu="app"]');
  if (appItem) appItem.hidden = !LANDING_USER;
}

function initMenu() {
  const btn = document.getElementById('menu-btn');
  const menu = document.getElementById('site-menu');
  if (!btn || !menu) return;
  const closeMenu = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  updateMenuLabels();

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-menu]');
    if (!item) return;
    closeMenu();
    switch (item.dataset.menu) {
      case 'login':
        if (LANDING_USER) location.href = '/my-bookings';
        else showGate();
        break;
      case 'app': location.href = '/app'; break;
      case 'book': startQuickBook(); break;
      case 'coaches': scrollTo('coaches'); break;
      case 'groups': scrollTo('groups'); break;
      case 'packages': scrollTo('packages'); break;
      case 'contact': openContactModal(); break;
    }
  });
}

function openContactModal() {
  const back = document.getElementById('contact-backdrop');
  back.classList.add('open');
  const form = document.getElementById('contact-form');
  const close = () => back.classList.remove('open');
  document.getElementById('contact-close').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('contact-error');
    err.textContent = '';
    try {
      await API.post('/contact', { contact: document.getElementById('contact-input').value.trim() });
      close();
      form.reset();
      toast(t('landing.contactmodal.done'));
    } catch (ex) { err.textContent = I18N.server(ex.message); }
  };
}

// Menu "Book a session": place → notes → coach, then the wizard picks the
// time and confirms (location + notes ride along preset).
function startQuickBook() {
  const backdrop = document.getElementById('wizard-backdrop');
  const body = document.getElementById('wizard-body');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  const state = { city: null, notes: '' };

  const stepCity = () => {
    body.innerHTML = `
      <h2 style="font-size:1.8rem">${t('booking.step.location.title')}</h2>
      <div class="opt-grid">${SITE.locations.map((l) => `
        <div class="opt-card" data-val="${esc(l)}"><div class="t">${esc(I18N.server(l))}</div></div>`).join('')}
      </div>`;
    body.querySelectorAll('.opt-card').forEach((c) => c.addEventListener('click', () => {
      state.city = c.dataset.val;
      stepNotes();
    }));
  };
  const stepNotes = () => {
    body.innerHTML = `
      <h2 style="font-size:1.8rem">${t('booking.step.notes.title')}</h2>
      <p class="muted small">${t('booking.step.notes.subtitle')}</p>
      <textarea id="qb-notes" rows="4" maxlength="500" class="input" style="width:100%">${esc(state.notes)}</textarea>
      <div class="wizard-nav">
        <button class="btn btn-ghost" id="qb-back">${t('booking.nav.back')}</button>
        <button class="btn btn-primary" id="qb-next">${t('booking.nav.continue')}</button>
      </div>`;
    body.querySelector('#qb-back').addEventListener('click', stepCity);
    body.querySelector('#qb-next').addEventListener('click', () => {
      state.notes = body.querySelector('#qb-notes').value.slice(0, 500);
      stepCoach();
    });
  };
  const stepCoach = () => {
    const inCity = COACHES.filter((c) => c.locations.includes(state.city));
    body.innerHTML = `
      <h2 style="font-size:1.8rem">${t('landing.menu.coaches')}</h2>
      <div class="opt-grid">${inCity.map((c) => `
        <div class="opt-card" data-val="${c.id}">
          ${c.photos[0] ? `<img src="${esc(c.photos[0])}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;margin-bottom:8px">` : ''}
          <div class="t">${esc(c.name)}</div>
        </div>`).join('') || `<p class="muted">${t('booking.slots.empty', { coach: esc(state.city) })}</p>`}
      </div>
      <div class="wizard-nav">
        <button class="btn btn-ghost" id="qb-back2">${t('booking.nav.back')}</button><span></span>
      </div>`;
    body.querySelector('#qb-back2').addEventListener('click', stepNotes);
    body.querySelectorAll('.opt-card').forEach((card) => card.addEventListener('click', () => {
      const coach = COACHES.find((c) => c.id === Number(card.dataset.val));
      if (coach) openWizard(coach, SITE, { location: state.city, notes: state.notes });
    }));
  };
  stepCity();
}

// --- coaches grid -----------------------------------------------------------
function buildCoachGrid() {
  const grid = document.getElementById('coach-grid');
  grid.innerHTML = '';
  for (const c of COACHES) {
    const card = document.createElement('article');
    card.className = 'card coach-card reveal';
    const reviewsToggle = c.rating && c.rating.count
      ? `<button class="reviews-toggle small" data-reviews="${c.id}">${t('landing.readreviews')}</button>` : '';
    card.innerHTML = `
      <div class="photo"><img src="${esc(c.photos[0] || '/assets/logo.svg?v=2')}" alt="${t('landing.coachalt', { name: esc(c.name) })}" loading="lazy"></div>
      <div class="body">
        <h3>${esc(c.name)}</h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${ratingLine(c.rating)} ${reviewsToggle}
        </div>
        <div>
          ${c.positions.map((p) => `<span class="chip">${esc(posLabel(p))}</span>`).join(' ')}
          ${c.locations.map((l) => `<span class="chip gray">${esc(l)}</span>`).join(' ')}
        </div>
        <p class="bio">${esc(coachBio(c))}</p>
        <a class="small" href="/coaches/${encodeURIComponent(c.slug)}">${t('landing.fullprofile.arrow')}</a>
        <div class="reviews-panel" id="reviews-${c.id}" hidden></div>
        <div class="foot">
          <span>${slidePriceHTML()}</span>
          <button class="btn btn-primary btn-sm" data-book="${c.id}">${t('common.cta.book')}</button>
        </div>
      </div>`;
    // The whole card opens the coach's profile — except the interactive bits
    // (Book, Read reviews, links), which keep their own behavior.
    card.addEventListener('click', (e) => {
      if (e.target.closest('a,button,.reviews-panel')) return;
      location.href = '/coaches/' + encodeURIComponent(c.slug);
    });
    grid.appendChild(card);
  }
}

// Lazily fetch + toggle a coach's reviews panel on the landing grid.
async function toggleReviews(coachId, btn) {
  const panel = document.getElementById('reviews-' + coachId);
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; btn.textContent = t('landing.readreviews'); return; }
  if (!panel.dataset.loaded) {
    panel.innerHTML = `<p class="small muted">${t('landing.loadingreviews')}</p>`;
    panel.hidden = false;
    try {
      const { reviews } = await API.get(`/coaches/${coachId}/reviews`);
      panel.innerHTML = reviews.length
        ? reviews.map(reviewHTML).join('')
        : `<p class="small muted">${t('landing.noreviews.dot')}</p>`;
      panel.dataset.loaded = '1';
    } catch (err) {
      panel.innerHTML = `<p class="small muted">${esc(err.message)}</p>`;
      btn.textContent = t('landing.readreviews');
      return;
    }
  } else {
    panel.hidden = false;
  }
  btn.textContent = t('landing.hidereviews');
}

// --- account gate (opens only when an ACTION needs an account) ----------------
// Browsing the site is always open. The gate appears when the visitor tries
// to book, join or buy — and after a signup it walks through the email
// verification code before handing control back to the action.
let LANDING_VERIFIED = false;
let gateDone = null; // callback to resume the interrupted action

function closeGate() {
  const gate = document.getElementById('gate');
  gate.hidden = true;
  document.body.classList.remove('gated');
}

function showGate(cb) {
  const gate = document.getElementById('gate');
  if (!gate) return;
  gateDone = cb || null;
  gate.hidden = false;
  document.body.classList.add('gated');
  const langBox = document.getElementById('gate-lang');
  langBox.innerHTML = '';
  langBox.appendChild(langToggleEl());

  const bodyEl = document.getElementById('gate-body');
  let mode = 'signup'; // most first-time visitors need an account

  function render() {
    bodyEl.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:14px;justify-content:center">
        <button class="btn btn-sm ${mode === 'signup' ? 'btn-primary' : 'btn-ghost'}" data-gate-tab="signup">${t('login.action.signup')}</button>
        <button class="btn btn-sm ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}" data-gate-tab="login">${t('login.action.login')}</button>
      </div>
      <form id="gate-form">
        ${mode === 'signup' ? `
        <label class="f"><span>${t('login.form.name')}</span>
          <input type="text" name="name" required autocomplete="name"></label>` : ''}
        <label class="f"><span>${t('common.form.email')}</span>
          <input type="email" name="email" required autocomplete="email"></label>
        ${mode === 'signup' ? `
        <label class="f"><span>${t('login.form.area')}</span>
          <select name="area" required class="input" style="width:100%">
            ${(SITE ? SITE.locations : ['Helsinki', 'Espoo', 'Vantaa']).map((c) => `<option>${esc(c)}</option>`).join('')}
          </select></label>
        <label class="f"><span>${t('login.form.phone')}</span>
          <input type="tel" name="phone" autocomplete="tel" placeholder="+358 40 123 4567"></label>` : ''}
        <label class="f"><span>${t('common.form.password')}</span>
          <input type="password" name="password" required minlength="8"
            autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
        <div class="form-error" id="gate-error"></div>
        <button class="btn btn-primary" type="submit" style="width:100%">
          ${mode === 'signup' ? t('login.action.signup') : t('login.action.login')}</button>
      </form>
      <div style="text-align:center;margin-top:14px">
        <button class="gate-skip" id="gate-skip" type="button">${t('gate.skip')}</button>
      </div>`;
    bodyEl.querySelectorAll('[data-gate-tab]').forEach((b) =>
      b.addEventListener('click', () => { mode = b.dataset.gateTab; render(); }));
    bodyEl.querySelector('#gate-form').addEventListener('submit', onSubmit);
    bodyEl.querySelector('#gate-skip').addEventListener('click', () => { gateDone = null; closeGate(); });
    initPasswordToggles(bodyEl);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = bodyEl.querySelector('#gate-error');
    err.textContent = '';
    try {
      const payload = { email: fd.get('email'), password: fd.get('password'), lang: I18N.lang };
      if (mode === 'signup') {
        payload.name = fd.get('name');
        payload.phone = String(fd.get('phone') || '').trim();
        payload.area = String(fd.get('area') || '');
      }
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      // A signup is NOT an account yet — the emailed code creates it.
      if (res.pendingSignup) {
        renderVerifyPanel(bodyEl, res.email, (vres) => {
          LANDING_USER = vres.user;
          LANDING_VERIFIED = true;
          initHeaderAuth();
          updateMenuLabels();
          closeGate();
          const cb = gateDone; gateDone = null;
          if (cb) cb();
        }, true);
        return;
      }
      // Coaches have their own app; customers and admins stay to browse/book.
      if (res.user.role === 'coach') { location.href = DASH_FOR_ROLE.coach; return; }
      LANDING_USER = res.user;
      initHeaderAuth();
      updateMenuLabels();
      // Legacy: an account from the brief window when unverified accounts
      // could exist confirms its code before the action continues.
      const me = await API.get('/me').catch(() => null);
      LANDING_VERIFIED = Boolean(me && me.verified);
      if (!LANDING_VERIFIED) {
        renderVerifyPanel(bodyEl, res.user.email, () => {
          LANDING_VERIFIED = true;
          closeGate();
          const cb = gateDone; gateDone = null;
          if (cb) cb();
        });
        return;
      }
      closeGate();
      const cb = gateDone; gateDone = null;
      if (cb) cb();
    } catch (ex) {
      err.textContent = ex.message;
    }
  }

  render();
}

// The 6-digit email code form, reusable inside the gate. With
// `pending` = true the code CREATES the account (/auth/verify-signup);
// otherwise it verifies a legacy logged-in account (/auth/verify).
function renderVerifyPanel(container, email, onDone, pending = false) {
  container.innerHTML = `
    <h3 style="margin:0 0 8px">${t('verify.title')}</h3>
    <p class="muted small">${t('verify.body', { email: esc(email) })}</p>
    <form id="verify-form" style="margin-top:10px">
      <input class="input" id="verify-code" inputmode="numeric" autocomplete="one-time-code"
        maxlength="6" placeholder="${esc(t('verify.placeholder'))}" required
        style="width:100%;text-align:center;font-size:1.5rem;letter-spacing:.4em;margin-bottom:10px">
      <div class="form-error" id="verify-error"></div>
      <button class="btn btn-primary" type="submit" style="width:100%">${t('verify.submit')}</button>
    </form>
    <div style="text-align:center;margin-top:12px">
      <button class="link-btn" id="verify-resend" type="button">${t('verify.resend')}</button>
    </div>`;
  container.querySelector('#verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = container.querySelector('#verify-error');
    err.textContent = '';
    const code = container.querySelector('#verify-code').value.trim();
    try {
      const vres = pending
        ? await API.post('/auth/verify-signup', { email, code })
        : await API.post('/auth/verify', { code });
      toast(t('verify.done'));
      onDone(vres);
    } catch (ex) { err.textContent = I18N.server(ex.message); }
  });
  container.querySelector('#verify-resend').addEventListener('click', async () => {
    try { await API.post('/auth/resend-code', { email }); toast(t('verify.sent')); }
    catch (ex) { toast(I18N.server(ex.message), true); }
  });
}

// Run `cb` once the visitor has a verified customer account.
function requireAccount(cb) {
  if (LANDING_USER && LANDING_VERIFIED) { cb(); return; }
  if (LANDING_USER && !LANDING_VERIFIED) {
    // Logged in but never verified: straight to the code form.
    const gate = document.getElementById('gate');
    gate.hidden = false;
    document.body.classList.add('gated');
    renderVerifyPanel(document.getElementById('gate-body'), LANDING_USER.email || '', () => {
      LANDING_VERIFIED = true;
      closeGate();
      cb();
    });
    return;
  }
  showGate(cb);
}

// --- init -------------------------------------------------------------------
(async function init() {
  const userPromise = initHeaderAuth();
  [SITE, COACHES] = await Promise.all([API.get('/config'), API.get('/coaches')]);
  LANDING_USER = await userPromise;
  if (LANDING_USER) {
    const me = await API.get('/me').catch(() => null);
    LANDING_VERIFIED = Boolean(me && me.verified);
  }
  initMenu();

  const banner = document.getElementById('sale-banner');
  if (SITE.pricing.salePercent > 0) {
    banner.hidden = false;
    banner.textContent = t('landing.salebanner',
      { label: I18N.server(SITE.pricing.saleLabel), percent: SITE.pricing.salePercent });
  }
  document.getElementById('price-tag').innerHTML = slidePriceHTML();

  buildSlides();
  await buildGroups();
  buildCoachGrid();
  buildPackages();
  initReveal();

  // One handler for every "Book" button (hero + grid) and the review toggles.
  document.body.addEventListener('click', (e) => {
    const book = e.target.closest('[data-book]');
    if (book) {
      const coach = COACHES.find((c) => c.id === Number(book.dataset.book));
      if (coach) openWizard(coach, SITE);
      return;
    }
    const rev = e.target.closest('[data-reviews]');
    if (rev) toggleReviews(Number(rev.dataset.reviews), rev);
  });
})().catch((err) => {
  console.error(err);
  toast(t('common.loadfailed'), true);
});
