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
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get: (p) => API.req(p),
  post: (p, body) => API.req(p, { method: 'POST', body }),
  put: (p, body) => API.req(p, { method: 'PUT', body }),
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

// Fills the header auth area: "Log in" CTA when anonymous, dashboard + logout when known.
async function initHeaderAuth() {
  const box = document.getElementById('auth-box');
  if (!box) return null;
  let me = { user: null };
  try { me = await API.get('/me'); } catch { /* treat as anonymous */ }
  box.innerHTML = '';
  if (!me.user) {
    const a = document.createElement('a');
    a.href = '/login';
    a.className = 'btn btn-primary btn-sm';
    a.textContent = 'Log in';
    box.appendChild(a);
  } else {
    // Dual-role users (admin + coach profile) get a button for each hat.
    const links = [];
    if (me.user.role === 'admin') links.push(['/admin', 'Admin']);
    if (me.coachProfile) links.push(['/coach', 'My calendar']);
    if (me.user.role === 'customer') links.push(['/my-bookings', 'My bookings']);
    for (const [href, label] of links) {
      const a = document.createElement('a');
      a.href = href;
      a.className = 'btn btn-ghost btn-sm';
      a.textContent = label;
      box.appendChild(a);
    }
    const out = document.createElement('button');
    out.className = 'btn btn-ghost btn-sm';
    out.textContent = 'Log out';
    out.addEventListener('click', async () => {
      await API.post('/auth/logout', {});
      location.href = '/';
    });
    box.appendChild(out);
  }
  return me.user;
}

// Reveal-on-scroll animation for elements with .reveal
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// Redirects to /login (with return path) — used by pages that need a role.
function requireLoginRedirect() {
  location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtDate(iso) {
  // UTC-anchored so a calendar date renders the same weekday in every timezone.
  const d = new Date(iso + 'T12:00:00Z');
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}
