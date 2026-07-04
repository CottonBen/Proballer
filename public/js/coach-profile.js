// Public coach profile page (/coaches/:slug): photo gallery, full bio,
// rating + reviews, and the booking call-to-action (opens the shared wizard).
'use strict';

let SITE = null; // /api/config payload — booking.js reads pricing from it

function profilePriceHTML() {
  const p = SITE.pricing;
  const full = p.sessionPrice * 100;
  if (!p.salePercent) return `<span class="price-new display" style="font-size:2rem">${eur(full)}</span>
    <span class="muted">/ session</span>`;
  const now = full * (100 - p.salePercent) / 100;
  return `<span class="price-old">${eur(full)}</span>
    <span class="price-new display" style="font-size:2rem">${eur(now)}</span>
    <span class="muted">/ session</span>
    <span class="chip">${esc(p.saleLabel)} −${p.salePercent}%</span>`;
}

// NOTE: named renderProfile (not "render") — booking.js, loaded on this page
// for the wizard, defines its own global render() and would clobber ours.
function renderProfile(coach, reviewsData) {
  const root = document.getElementById('profile-root');
  document.title = `${coach.name} — Proballers Coaching Finland`;

  const photos = coach.photos.length ? coach.photos : ['/assets/logo.svg'];
  root.innerHTML = `
    <div class="profile-hero">
      <div class="profile-gallery reveal in">
        <div class="main"><img id="gal-main" src="${esc(photos[0])}" alt="Coach ${esc(coach.name)}"></div>
        ${photos.length > 1 ? `<div class="profile-thumbs">${photos.map((p, i) =>
          `<img src="${esc(p)}" alt="" data-i="${i}" class="${i === 0 ? 'on' : ''}">`).join('')}</div>` : ''}
      </div>
      <div>
        <a href="/#coaches" class="small muted">← All coaches</a>
        <div class="kicker" style="color:var(--lime);font-weight:700;letter-spacing:.22em;
          text-transform:uppercase;font-size:.8rem;margin:14px 0 10px">Coach profile</div>
        <h1 style="font-size:clamp(2.2rem,6vw,4rem)">${esc(coach.name)}</h1>
        <div class="slide-tags">
          ${coach.positions.map((p) => `<span class="chip">${esc(cap(p))}</span>`).join('')}
          ${coach.locations.map((l) => `<span class="chip gray">${esc(l)}</span>`).join('')}
        </div>
        <div style="margin:2px 0 14px">${ratingLine(reviewsData.rating)}</div>
        <p class="bio" style="color:var(--muted);font-size:1.06rem;max-width:58ch">${esc(coach.bio)}</p>
        <div class="profile-price">${profilePriceHTML()}</div>
        <button class="btn btn-primary" id="book-cta" style="margin-top:8px">
          Book a session with ${esc(coach.name.split(' ')[0])}</button>
        <p class="small muted" style="margin-top:10px">Pick one of ${esc(coach.name.split(' ')[0])}'s
          free times in the next step — sessions run 8:00–20:00, every day.</p>
      </div>
    </div>

    <section class="section" style="padding:30px 0 60px">
      <h2 style="font-size:1.7rem">Reviews</h2>
      <div class="card" style="max-width:720px">
        ${reviewsData.reviews.length
          ? reviewsData.reviews.map(reviewHTML).join('')
          : '<p class="muted" style="margin:0">No reviews yet — be the first after your session.</p>'}
      </div>
    </section>`;

  // Gallery thumbs swap the main photo.
  root.querySelectorAll('.profile-thumbs img').forEach((t) => t.addEventListener('click', () => {
    document.getElementById('gal-main').src = photos[Number(t.dataset.i)];
    root.querySelectorAll('.profile-thumbs img').forEach((x) => x.classList.toggle('on', x === t));
  }));

  document.getElementById('book-cta').addEventListener('click', () => openWizard(coach, SITE));
}

function renderNotFound() {
  document.getElementById('profile-root').innerHTML = `
    <div style="padding:70px 0;text-align:center">
      <h1 style="font-size:2.4rem">Coach not found</h1>
      <p class="muted">That profile doesn't exist (any more).</p>
      <a class="btn btn-primary" href="/#coaches">See all coaches</a>
    </div>`;
}

(async function init() {
  initHeaderAuth();
  const slug = decodeURIComponent(location.pathname.split('/').pop() || '');
  let coaches;
  [SITE, coaches] = await Promise.all([API.get('/config'), API.get('/coaches')]);

  const banner = document.getElementById('sale-banner');
  if (SITE.pricing.salePercent > 0) {
    banner.hidden = false;
    banner.textContent = `⚡ ${SITE.pricing.saleLabel}: ${SITE.pricing.salePercent}% OFF every session — automatically applied at booking`;
  }

  const coach = coaches.find((c) => c.slug === slug);
  if (!coach) return renderNotFound();

  let reviewsData = { rating: coach.rating || { avg: null, count: 0 }, reviews: [] };
  try { reviewsData = await API.get(`/coaches/${coach.id}/reviews`); } catch { /* non-blocking */ }
  renderProfile(coach, reviewsData);
})().catch((e) => {
  console.error(e);
  toast('Could not load this coach — please refresh.', true);
});
