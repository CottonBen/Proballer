// Landing page: hero carousel (rotates every 5 s) + coaches grid.
'use strict';

let SITE = null;      // /api/config payload
let COACHES = [];     // /api/coaches payload

function slidePriceHTML() {
  const p = SITE.pricing;
  if (!p.salePercent) return `<span class="price-new">${eur(p.sessionPrice * 100)}</span> / session`;
  const now = p.sessionPrice * 100 * (100 - p.salePercent) / 100;
  return `<span class="price-old">${eur(p.sessionPrice * 100)}</span>
    <span class="price-new">${eur(now)}</span> / session`;
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
          <div class="kicker">Coach spotlight</div>
          <h1><a href="/coaches/${encodeURIComponent(c.slug)}" style="color:inherit">${esc(c.name)}</a></h1>
          <div class="slide-tags">
            ${c.positions.map((p) => `<span class="chip">${esc(cap(p))}</span>`).join('')}
            ${c.locations.map((l) => `<span class="chip gray">${esc(l)}</span>`).join('')}
          </div>
          <p class="bio">${esc(c.bio)}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" data-book="${c.id}">Book a session with ${esc(c.name.split(' ')[0])}</button>
            <a class="btn btn-ghost" href="/coaches/${encodeURIComponent(c.slug)}">Full profile</a>
          </div>
        </div>`,
    });
  }

  // Final slide — about us.
  slides.push({
    photos: ['/assets/ben-2.jpg'],
    html: `
      <div>
        <div class="kicker">About us</div>
        <h1>Built by players,<br>for the next generation</h1>
        <p class="bio">We are a Finnish coaching collective for young footballers who want more than
          two team trainings a week. Our coaches have come up through Finnish academies and play or
          have played competitively — they remember exactly what it takes, because they are living it.
          Every session is 1-on-1, planned around your position, your goals and your pace, on pitches
          in Helsinki, Espoo and Vantaa.</p>
        <p class="bio">One hour with full attention on you beats ten where you wait in line.
          That is the whole idea.</p>
        <a class="btn btn-primary" href="#coaches">Find your coach</a>
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
    dot.setAttribute('aria-label', `Slide ${i + 1}`);
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
      ? `<button class="reviews-toggle small" data-reviews="${c.id}">Read reviews</button>` : '';
    card.innerHTML = `
      <div class="photo"><img src="${esc(c.photos[0] || '/assets/logo.svg')}" alt="Coach ${esc(c.name)}" loading="lazy"></div>
      <div class="body">
        <h3>${esc(c.name)}</h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${ratingLine(c.rating)} ${reviewsToggle}
        </div>
        <div>
          ${c.positions.map((p) => `<span class="chip">${esc(cap(p))}</span>`).join(' ')}
          ${c.locations.map((l) => `<span class="chip gray">${esc(l)}</span>`).join(' ')}
        </div>
        <p class="bio">${esc(c.bio)}</p>
        <a class="small" href="/coaches/${encodeURIComponent(c.slug)}">Full profile →</a>
        <div class="reviews-panel" id="reviews-${c.id}" hidden></div>
        <div class="foot">
          <span>${slidePriceHTML()}</span>
          <button class="btn btn-primary btn-sm" data-book="${c.id}">Book a session</button>
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
  if (!panel.hidden) { panel.hidden = true; btn.textContent = 'Read reviews'; return; }
  if (!panel.dataset.loaded) {
    panel.innerHTML = '<p class="small muted">Loading reviews…</p>';
    panel.hidden = false;
    try {
      const { reviews } = await API.get(`/coaches/${coachId}/reviews`);
      panel.innerHTML = reviews.length
        ? reviews.map(reviewHTML).join('')
        : '<p class="small muted">No reviews yet.</p>';
      panel.dataset.loaded = '1';
    } catch (err) {
      panel.innerHTML = `<p class="small muted">${esc(err.message)}</p>`;
      btn.textContent = 'Read reviews';
      return;
    }
  } else {
    panel.hidden = false;
  }
  btn.textContent = 'Hide reviews';
}

// --- init -------------------------------------------------------------------
(async function init() {
  initHeaderAuth();
  [SITE, COACHES] = await Promise.all([API.get('/config'), API.get('/coaches')]);

  const banner = document.getElementById('sale-banner');
  if (SITE.pricing.salePercent > 0) {
    banner.hidden = false;
    banner.textContent = `⚡ ${SITE.pricing.saleLabel}: ${SITE.pricing.salePercent}% OFF every session — automatically applied at booking`;
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
  toast('Could not load the site data — please refresh.', true);
});
