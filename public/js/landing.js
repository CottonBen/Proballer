// Landing page: hero carousel (rotates every 5 s) + coaches grid.
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

  for (const c of COACHES.filter((c) => c.featured)) {
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
    if (manual) restart();
  }

  function restart() {
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), 5000); // design changes every 5 seconds
  }

  carousel.addEventListener('mouseenter', () => clearInterval(timer));
  carousel.addEventListener('mouseleave', restart);
  rotatePhotos(els[0]);
  restart();
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
      <div class="photo"><img src="${esc(c.photos[0] || '/assets/logo.svg')}" alt="${t('landing.coachalt', { name: esc(c.name) })}" loading="lazy"></div>
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

// --- init -------------------------------------------------------------------
(async function init() {
  initHeaderAuth();
  [SITE, COACHES] = await Promise.all([API.get('/config'), API.get('/coaches')]);

  const banner = document.getElementById('sale-banner');
  if (SITE.pricing.salePercent > 0) {
    banner.hidden = false;
    banner.textContent = t('landing.salebanner',
      { label: I18N.server(SITE.pricing.saleLabel), percent: SITE.pricing.salePercent });
  }
  document.getElementById('price-tag').innerHTML = slidePriceHTML();

  buildSlides();
  buildCoachGrid();
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
