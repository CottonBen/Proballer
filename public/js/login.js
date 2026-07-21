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
    document.getElementById('f-area').hidden = mode === 'login';
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
        payload.area = String(fd.get('area') || '');
      }
      const res = await API.post(mode === 'signup' ? '/auth/signup' : '/auth/login', payload);
      // A signup is NOT an account yet — the emailed code creates it.
      if (res.pendingSignup) { showVerifyStep(res.email, next); return; }
      location.href = next || DASH_FOR_ROLE[res.user.role] || '/';
    } catch (ex) {
      err.textContent = I18N.server(ex.message);
    }
  });
})();

// Replaces the signup form with the 6-digit code step; the account is
// created (and the browser signed in) when the code checks out.
function showVerifyStep(email, next) {
  const form = document.getElementById('auth-form');
  form.parentElement.innerHTML = `
    <h3 style="margin:0 0 8px">${t('verify.title')}</h3>
    <p class="muted small">${t('verify.body', { email: esc(email) })}</p>
    <form id="verify-form" style="margin-top:10px">
      <input class="input" id="verify-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
        placeholder="${esc(t('verify.placeholder'))}" required
        style="width:100%;text-align:center;font-size:1.5rem;letter-spacing:.4em;margin-bottom:10px">
      <div class="form-error" id="verify-error"></div>
      <button class="btn btn-primary" type="submit" style="width:100%">${t('verify.submit')}</button>
    </form>
    <div style="text-align:center;margin-top:12px">
      <button class="link-btn" id="verify-resend" type="button">${t('verify.resend')}</button>
    </div>`;
  document.getElementById('verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('verify-error');
    err.textContent = '';
    try {
      const res = await API.post('/auth/verify-signup', {
        email, code: document.getElementById('verify-code').value.trim(),
      });
      toast(t('verify.done'));
      location.href = next || DASH_FOR_ROLE[res.user.role] || '/';
    } catch (ex) { err.textContent = I18N.server(ex.message); }
  });
  document.getElementById('verify-resend').addEventListener('click', async () => {
    try { await API.post('/auth/resend-code', { email }); toast(t('verify.sent')); }
    catch (ex) { toast(I18N.server(ex.message), true); }
  });
}
