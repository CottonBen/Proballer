// Shared helpers: API calls, header auth button, toasts, formatting.
'use strict';

const API = {
  async req(path, opts = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON (e.g. invoice HTML) */ }
    if (!res.ok) {
      // Server error strings are English; I18N.server maps known ones to Finnish.
      const err = new Error(data && data.error
        ? I18N.server(data.error)
        : t('common.requestfailed', { status: res.status }));
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get: (p) => API.req(p),
  post: (p, body) => API.req(p, { method: 'POST', body }),
  put: (p, body) => API.req(p, { method: 'PUT', body }),
  del: (p) => API.req(p, { method: 'DELETE' }),
};

function toast(msg, isError = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3800);
}

const eur = (cents) => (cents / 100).toLocaleString('fi-FI', { minimumFractionDigits: 2 }) + ' €';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

const DASH_FOR_ROLE = { admin: '/admin', coach: '/coach', customer: '/my-bookings' };

// Fills the header auth area. Anonymous: booking CTA + "Log in" + language
// toggle. Known: role buttons + logout + toggle (customers keep the CTA too).
async function initHeaderAuth() {
  const box = document.getElementById('auth-box');
  if (!box) return null;
  let me = { user: null };
  try { me = await API.get('/me'); } catch { /* treat as anonymous */ }
  box.innerHTML = '';
  const bookCta = () => {
    const a = document.createElement('a');
    a.href = '/#coaches';
    a.className = 'btn btn-primary btn-sm';
    a.textContent = t('common.cta.book');
    return a;
  };
  if (!me.user) {
    box.appendChild(bookCta());
    const a = document.createElement('a');
    a.href = '/login';
    a.className = 'btn btn-ghost btn-sm';
    a.textContent = t('common.login');
    box.appendChild(a);
  } else {
    // Chats: prominent for every logged-in role, with an unread badge.
    const chats = document.createElement('a');
    chats.href = '/chats';
    chats.className = 'btn btn-primary btn-sm chats-btn';
    chats.innerHTML = `💬 ${esc(t('chat.nav'))}` +
      (me.unreadChats ? ` <span class="hdr-badge">${me.unreadChats > 9 ? '9+' : me.unreadChats}</span>` : '');
    box.appendChild(chats);
    // Dual-role users (admin + coach profile) get a button for each hat.
    if (me.user.role === 'customer') box.appendChild(bookCta());
    const links = [];
    if (me.user.role === 'admin') links.push(['/admin', t('common.admin')]);
    if (me.coachProfile) links.push(['/coach', t('common.mycalendar')]);
    if (me.user.role === 'customer') links.push(['/my-bookings', t('common.mybookings')]);
    for (const [href, label] of links) {
      const a = document.createElement('a');
      a.href = href;
      a.className = 'btn btn-ghost btn-sm';
      a.textContent = label;
      box.appendChild(a);
    }
    const out = document.createElement('button');
    out.className = 'btn btn-ghost btn-sm';
    out.textContent = t('common.logout');
    out.addEventListener('click', async () => {
      await API.post('/auth/logout', {});
      location.href = '/';
    });
    box.appendChild(out);
  }
  box.appendChild(langToggleEl());
  return me.user;
}

// Adds a show/hide toggle (👁) to every password input under `root`, so
// people can check what they typed. Safe to call repeatedly after re-renders.
function initPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.hasToggle) return;
    input.dataset.hasToggle = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', t('common.password.show'));
    btn.textContent = t('common.password.reveal');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = t(show ? 'common.password.conceal' : 'common.password.reveal');
      btn.setAttribute('aria-label', t(show ? 'common.password.hide' : 'common.password.show'));
      input.focus();
    });
    wrap.appendChild(btn);
  });
}

// Static pages (e.g. /login) get their toggles automatically; dynamically
// rendered forms call initPasswordToggles(container) after each render.
document.addEventListener('DOMContentLoaded', () => initPasswordToggles());

// Reveal-on-scroll animation for elements with .reveal. Elements that enter
// together get a slight stagger (60 ms steps); the delay is cleared once the
// reveal finishes so it never slows down hover transitions afterwards.
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => {
      const el = e.target;
      el.style.transitionDelay = `${Math.min(i, 5) * 60}ms`;
      el.classList.add('in');
      el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
      io.unobserve(el);
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// The sticky header lifts off the page (darker, shadowed) once you scroll.
document.addEventListener('DOMContentLoaded', () => {
  const hdr = document.querySelector('.site-header');
  if (!hdr) return;
  const onScroll = () => hdr.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});

// Redirects to /login (with return path) — used by pages that need a role.
function requireLoginRedirect() {
  location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
}

// Star rating display. `avg` is a number (e.g. 4.5) or null. Renders five stars
// with a gold overlay clipped to the fractional value, so 4.5 shows as 4½ stars.
function starsHTML(avg) {
  const val = Math.max(0, Math.min(5, Number(avg) || 0));
  const pct = (val / 5 * 100).toFixed(1);
  const label = val ? t('common.stars.aria', { val: val.toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB') }) : t('common.stars.none');
  return `<span class="stars" role="img" aria-label="${label}">`
    + `<span class="stars-fill" style="width:${pct}%">★★★★★</span>★★★★★</span>`;
}

// Stars + "4.5 (12)" line. Falls back to a muted "No reviews yet" when count = 0.
function ratingLine(rating) {
  if (!rating || !rating.count) {
    return `<span class="rating-line muted">${starsHTML(0)}<span class="small">${t('common.noreviews')}</span></span>`;
  }
  return `<span class="rating-line">${starsHTML(rating.avg)}`
    + `<span class="small"><strong>${rating.avg.toLocaleString('fi-FI')}</strong> `
    + `<span class="muted">(${rating.count})</span></span></span>`;
}

// One review block: N gold stars, the body, and "— Author · date".
function reviewHTML(r) {
  return `<div class="review">
      <div>${starsHTML(r.rating)}</div>
      ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
      <div class="small muted">— ${esc(r.author_name || r.author || t('common.anonymous'))}${r.date ? ' · ' + esc(r.date) : ''}</div>
    </div>`;
}

function fmtDate(iso) {
  // UTC-anchored so a calendar date renders the same weekday in every timezone.
  const d = new Date(iso + 'T12:00:00Z');
  return `${t('common.weekdays').split(',')[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}
