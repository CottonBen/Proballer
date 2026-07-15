// Login / signup page. Redirects each role to its own home.
'use strict';

// Only honor a same-origin, path-relative next (blocks open-redirect phishing).
function safeNext(raw) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

(async function init() {
  const user = await initHeaderAuth();
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  if (user) { location.href = next || DASH_FOR_ROLE[user.role] || '/'; return; }

  let mode = 'login';
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => {
      x.classList.toggle('btn-primary', x === b);
      x.classList.toggle('btn-ghost', x !== b);
    });
    document.getElementById('f-name').hidden = mode === 'login';
    document.getElementById('f-phone').hidden = mode === 'login';
    document.getElementById('submit-btn').textContent = mode === 'login' ? t('login.action.login') : t('login.action.signup');
  }));

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const err = document.getElementById('auth-error');
    err.textContent = '';
    try {
      // lang: invoices + emails follow the language the customer uses the site in
      const payload = { email: fd.get('email'), password: fd.get('password'), lang: I18N.lang };
      if (mode === 'signup') {
        payload.name = fd.get('name');
        payload.phone = String(fd.get('phone') || '').trim();
      }
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      location.href = next || DASH_FOR_ROLE[res.user.role] || '/';
    } catch (ex) {
      err.textContent = I18N.server(ex.message);
    }
  });
})();
