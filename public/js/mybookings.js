// Customer's own bookings + invoices.
'use strict';

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  if (user.role === 'coach') { location.href = '/coach'; return; }

  // Notifications (e.g. coach cancellations) + free-session credit banner.
  try {
    const { notifications, freeCredits } = await API.get('/my-notifications');
    const box = document.getElementById('notices');
    let html = '';
    if (freeCredits > 0) {
      html += `<div class="card" style="border-color:var(--lime);margin-bottom:14px">
        🎁 <strong style="color:var(--lime)">${t('mybookings.credit.banner', { count: esc(freeCredits) })}</strong>
        <span class="muted small">${t('mybookings.credit.hint')}</span>
        <a class="btn btn-primary btn-sm" href="${lurl('/#coaches')}" style="margin-left:8px">${t('mybookings.credit.use_now')}</a>
      </div>`;
    }
    const unread = notifications.filter((n) => !n.read);
    if (unread.length) {
      html += `<div class="card" style="margin-bottom:14px">
        <h3 style="font-size:1.05rem">${t('mybookings.notifications.title')}</h3>
        ${unread.map((n) => `<div class="review-row"><span class="small">${esc(I18N.server(n.message))}</span>
          <span class="small muted" style="white-space:nowrap">${esc(n.created_at.slice(0, 10))}</span></div>`).join('')}
      </div>`;
      API.post('/my-notifications/read', {}).catch(() => {});
    }
    box.innerHTML = html;
  } catch { /* non-blocking */ }

  await loadReviewsSection();   // independent of the bookings table below

  await loadPackageSection();
  await loadGroupsSection();

  // The MobilePay number is only in /config for signed-in callers, which is
  // exactly who this page serves.
  let pay = {};
  try { pay = (await API.get('/config')).payment || {}; } catch { /* fall back to no panel */ }

  const rows = await API.get('/my-bookings');
  const tbl = document.getElementById('bookings-table');
  document.getElementById('empty-note').hidden = rows.length > 0;
  if (!rows.length) return;

  const hourSep = I18N.lang === 'fi' ? '.' : ':'; // FI '08.00', EN '08:00'
  tbl.innerHTML = `
    <tr><th>${t('mybookings.table.ref')}</th><th>${t('mybookings.table.when')}</th><th>${t('mybookings.table.coach')}</th><th>${t('mybookings.table.session')}</th><th>${t('mybookings.table.where')}</th>
      <th>${t('mybookings.table.total')}</th><th>${t('mybookings.table.status')}</th><th>${t('mybookings.table.invoice')}</th></tr>` +
    rows.map((b) => `
      <tr>
        <td class="muted">${esc(b.code)}</td>
        <td>${esc(fmtDate(b.date))} ${String(b.hour).padStart(2, '0')}${hourSep}00</td>
        <td>${esc(b.coach)}</td>
        <td>${b.position || b.focus
          ? [b.position ? esc(posLabel(b.position)) : '', b.focus ? esc(I18N.server(b.focus)) : '']
              .filter(Boolean).join(' · ')
          : t('mybookings.table.plain')}</td>
        <td>${b.is_online ? t('mybookings.table.online') : esc(b.location)}${
          b.pitch_name ? `<br><span class="small muted">📍 ${esc(b.pitch_name)}</span>` : ''}</td>
        <td>${eur(b.total_cents)}</td>
        <td>${(() => { const k = bookingStatusKey(b);
          return `<span class="status-tag status-${esc(k)}">${esc(t('common.status.' + k))}</span>`; })()}</td>
        <td>${b.invoice_number
          ? `<a href="/api/invoices/${encodeURIComponent(b.invoice_number)}" target="_blank">${esc(b.invoice_number)}</a>${
              b.invoice_status === 'sent' && b.total_cents > 0
                ? mobilePayNote(pay, b.invoice_number, b.total_cents, b.pay_by) : ''
            }` : '—'}</td>
      </tr>`).join('');
})().catch((e) => toast(I18N.server(e.message), true));

// The "how to pay" note under anything awaiting payment: nothing to click —
// the customer pays from their own MobilePay app, and the reference is what
// lets us match the money back to this purchase.
function mobilePayNote(pay, reference, amountCents, payBy) {
  if (!pay.mobilepay) return '';
  return `<div class="paynote">
    <div class="paynote-title">${t('pay.mp.how')}</div>
    <div><span class="muted">${t('pay.mp.number')}:</span> <strong>${esc(pay.mobilepay)}</strong></div>
    <div><span class="muted">${t('pay.mp.reference')}:</span> <strong>${esc(reference)}</strong></div>
    <div><span class="muted">${t('pay.mp.amount')}:</span> <strong>${eur(amountCents)}</strong></div>
    ${payBy ? `<div class="small muted" style="margin-top:4px">⏳ ${t('pay.deadline', { deadline: esc(payDeadline(payBy)) })}</div>` : ''}
  </div>`;
}

// Payment deadline (config.payment.holdHours from booking) in local time.
function payDeadline(iso) {
  return new Date(iso).toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB',
    { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// --- prepaid session package: balance, history, buy buttons -------------------
async function loadPackageSection() {
  const box = document.getElementById('package-section');
  if (!box) return;
  let data, cfg;
  try {
    [data, cfg] = await Promise.all([API.get('/my-package'), API.get('/config')]);
  } catch { box.innerHTML = ''; return; }
  const options = (cfg.packages || []).filter((o) => o.sessions > 1);
  const pay = cfg.payment || {};

  const buyButtons = options.length ? `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${options.map((o) => `<button class="btn btn-ghost btn-sm" data-buypkg="${o.id}">
        ${t('mybookings.pkg.buy_pack', { n: o.sessions, price: eur(o.price * 100) })}</button>`).join('')}
    </div>` : '';

  const history = data.packages.length ? `
    <div style="margin-top:14px">
      <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">${t('mybookings.pkg.history')}</div>
      ${data.packages.map((pk) => `
        <div class="review-row">
          <span class="small">${t('mybookings.pkg.row', { n: pk.sessions })} · ${eur(pk.priceCents)}
            <span class="muted">· ${esc(pk.purchasedAt)}</span></span>
          <span class="small" style="white-space:nowrap">${pk.pending
            ? `<span class="status-tag status-pending">${t('pay.mp.awaiting')}</span>`
            : `${t('mybookings.pkg.used', { used: pk.used, total: pk.sessions + pk.adjusted })}
               · <strong>${pk.remaining}</strong> ⚽</span>`}
        </div>
        ${pk.pending ? mobilePayNote(pay, pk.code, pk.priceCents, null, null) : ''}`).join('')}
    </div>` : '';

  box.innerHTML = `<div class="card" ${data.remaining > 0 ? 'style="border-color:var(--lime)"' : ''}>
    <h3 style="font-size:1.15rem">📦 ${t('mybookings.pkg.title')}</h3>
    ${data.remaining > 0
      ? `<p style="margin:6px 0 2px"><strong style="color:var(--lime);font-size:1.3rem">${t('mybookings.pkg.remaining', { n: data.remaining })}</strong></p>
         <p class="small muted" style="margin:0">${t('mybookings.pkg.autouse')}</p>
         ${buyButtons ? `<p class="small muted" style="margin:10px 0 0">${t('mybookings.pkg.more')}</p>` : ''}`
      : `<p class="small muted" style="margin:6px 0 0">${t('mybookings.pkg.none')}</p>`}
    ${buyButtons}
    ${history}
  </div>`;

  // Buying a package invoices it — the panel that appears carries the
  // MobilePay number and the package code to use as the reference.
  box.querySelectorAll('[data-buypkg]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await API.post('/packages/buy', { package: btn.dataset.buypkg });
      await loadPackageSection();
    } catch (e) { btn.disabled = false; toast(I18N.server(e.message), true); }
  }));
}

// --- group training spots -----------------------------------------------------
async function loadGroupsSection() {
  const box = document.getElementById('groups-section');
  if (!box) return;
  let rows, pay = {};
  try {
    rows = await API.get('/my-groups');
    pay = (await API.get('/config')).payment || {};
  } catch { box.innerHTML = ''; return; }
  if (!rows.length) { box.innerHTML = ''; return; }
  const hourSep = I18N.lang === 'fi' ? '.' : ':';
  box.innerHTML = `<div class="card">
    <h3 style="font-size:1.15rem">👥 ${t('mybookings.groups.title')}</h3>
    ${rows.map((g) => `
      <div class="review-row">
        <span class="small">
          <strong>${esc(fmtDate(g.date))} ${String(g.hour).padStart(2, '0')}${hourSep}00</strong>
          · ${esc(g.coach)} · ${esc(I18N.server(g.location))}
          ${g.pitchName ? `· 📍 ${esc(g.pitchName)}` : ''}
          <span class="muted">· ${t('mybookings.groups.spots', { taken: g.taken, cap: g.capacity })}</span>
          ${g.sessionStatus === 'cancelled' ? `<br><span class="muted">${t('mybookings.groups.cancelled_note')}</span>` : ''}
        </span>
        <span class="small" style="white-space:nowrap">${g.sessionStatus === 'cancelled'
          ? `<span class="status-tag status-cancelled">${t('common.status.cancelled')}</span>`
          : g.status === 'pending'
            ? `<span class="status-tag status-pending">${t('pay.mp.awaiting')}</span>`
            : `<span class="status-tag status-${esc(g.sessionStatus === 'completed' ? 'completed' : 'confirmed')}">${t('common.status.' + (g.sessionStatus === 'completed' ? 'completed' : 'confirmed'))}</span>`}
        </span>
      </div>
      ${g.status === 'pending' && g.sessionStatus !== 'cancelled'
        ? mobilePayNote(pay, g.code, g.priceCents, g.payBy, payDeadlineLocal) : ''}`).join('')}
  </div>`;
}

// Shared deadline formatter for the payment panels outside the bookings table.
const payDeadlineLocal = (iso) => new Date(iso).toLocaleString(
  I18N.lang === 'fi' ? 'fi-FI' : 'en-GB',
  { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

// --- reviews: leave one per coach you've completed a session with -------------
async function loadReviewsSection() {
  const box = document.getElementById('reviews-section');
  if (!box) return;
  let data;
  try { data = await API.get('/my-reviews'); }
  catch { box.innerHTML = ''; return; }

  const starPicker = (coachId) => `
    <div class="star-pick" role="radiogroup" aria-label="${t('mybookings.reviews.rating_label')}">
      ${[5, 4, 3, 2, 1].map((n) => `
        <input type="radio" name="rate-${coachId}" id="r${coachId}-${n}" value="${n}">
        <label for="r${coachId}-${n}" title="${t('mybookings.reviews.stars_title', { n })}">★</label>`).join('')}
    </div>`;

  const forms = data.reviewable.map((c) => `
    <div class="review-form" data-coach="${c.id}" style="border-top:1px dashed var(--line);padding-top:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <strong>${esc(c.name)}</strong>
        ${starPicker(c.id)}
      </div>
      <textarea class="input" rows="2" maxlength="600" placeholder="${t('mybookings.reviews.placeholder')}"
        style="width:100%;margin-top:8px"></textarea>
      <button class="btn btn-primary btn-sm" data-submit="${c.id}" style="margin-top:8px">${t('mybookings.reviews.submit')}</button>
    </div>`).join('');

  const mine = data.mine.length ? `
    <div style="margin-top:16px">
      <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">${t('mybookings.reviews.mine_title')}</div>
      ${data.mine.map((r) => `<div class="review"><div>${starsHTML(r.rating)} <span class="small muted">${esc(r.coach)}</span></div>
        ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
        <div class="small muted">${esc(r.date)}</div></div>`).join('')}
    </div>` : '';

  if (!forms && !mine) { box.innerHTML = ''; return; }

  box.innerHTML = `<div class="card">
    <h3 style="font-size:1.15rem">${t('mybookings.reviews.title')}</h3>
    ${data.reviewable.length
      ? `<p class="small muted">${t('mybookings.reviews.prompt')}</p>` + forms
      : (mine ? '' : `<p class="small muted">${t('mybookings.reviews.empty_hint')}</p>`)}
    ${mine}
  </div>`;

  box.querySelectorAll('[data-submit]').forEach((btn) => btn.addEventListener('click', async () => {
    const coachId = btn.dataset.submit;
    const form = btn.closest('.review-form');
    const rating = form.querySelector(`input[name="rate-${coachId}"]:checked`);
    if (!rating) { toast(t('mybookings.reviews.pick_rating'), true); return; }
    btn.disabled = true;
    try {
      await API.post(`/coaches/${coachId}/reviews`, {
        rating: Number(rating.value),
        body: form.querySelector('textarea').value,
      });
      toast(t('mybookings.reviews.posted'));
      await loadReviewsSection();
    } catch (err) {
      btn.disabled = false;
      toast(I18N.server(err.message), true);
    }
  }));
}

