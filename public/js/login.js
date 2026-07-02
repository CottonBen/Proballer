// Login / signup page. Redirects each role to its own home.
'use strict';

(async function init() {
  const user = await initHeaderAuth();
  const next = new URLSearchParams(location.search).get('next');
  if (user) { location.href = next || DASH_FOR_ROLE[user.role] || '/'; return; }

  let mode = 'login';
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => {
      x.classList.toggle('btn-primary', x === b);
      x.classList.toggle('btn-ghost', x !== b);
    });
    document.getElementById('f-name').hidden = mode === 'login';
    document.getElementById('submit-btn').textContent = mode === 'login' ? 'Log in' : 'Create account';
  }));

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = document.getElementById('auth-error');
    err.textContent = '';
    try {
      const payload = { email: fd.get('email'), password: fd.get('password') };
      if (mode === 'signup') payload.name = fd.get('name');
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      location.href = next || DASH_FOR_ROLE[res.user.role] || '/';
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
})();
