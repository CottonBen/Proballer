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
        🎁 <strong style="color:var(--lime)">You have ${freeCredits} free session${freeCredits > 1 ? 's' : ''}!</strong>
        <span class="muted small">Book any coach — the price will be 0,00 € automatically.</span>
        <a class="btn btn-primary btn-sm" href="/#coaches" style="margin-left:8px">Use it now</a>
      </div>`;
    }
    const unread = notifications.filter((n) => !n.read);
    if (unread.length) {
      html += `<div class="card" style="margin-bottom:14px">
        <h3 style="font-size:1.05rem">What's new</h3>
        ${unread.map((n) => `<div class="review-row"><span class="small">${esc(n.message)}</span>
          <span class="small muted" style="white-space:nowrap">${esc(n.created_at.slice(0, 10))}</span></div>`).join('')}
      </div>`;
      API.post('/my-notifications/read', {}).catch(() => {});
    }
    box.innerHTML = html;
  } catch { /* non-blocking */ }

  await loadReviewsSection();   // independent of the bookings table below

  const rows = await API.get('/my-bookings');
  const t = document.getElementById('bookings-table');
  document.getElementById('empty-note').hidden = rows.length > 0;
  if (!rows.length) return;

  t.innerHTML = `
    <tr><th>Ref</th><th>When</th><th>Coach</th><th>Session</th><th>Where</th>
      <th>Total</th><th>Status</th><th>Invoice</th></tr>` +
    rows.map((b) => `
      <tr>
        <td class="muted">${esc(b.code)}</td>
        <td>${esc(fmtDate(b.date))} ${String(b.hour).padStart(2, '0')}:00</td>
        <td>${esc(b.coach)}</td>
        <td>${esc(cap(b.position))} · ${esc(b.focus)}</td>
        <td>${b.is_online ? 'Online' : esc(b.location)}</td>
        <td>${eur(b.total_cents)}</td>
        <td><span class="status-tag status-${esc(b.status)}">${esc(b.status)}</span></td>
        <td>${b.invoice_number
          ? `<a href="/api/invoices/${encodeURIComponent(b.invoice_number)}" target="_blank">${esc(b.invoice_number)}</a>` : '—'}</td>
      </tr>`).join('');
})().catch((e) => toast(e.message, true));

// --- reviews: leave one per coach you've completed a session with -------------
async function loadReviewsSection() {
  const box = document.getElementById('reviews-section');
  if (!box) return;
  let data;
  try { data = await API.get('/my-reviews'); }
  catch { box.innerHTML = ''; return; }

  const starPicker = (coachId) => `
    <div class="star-pick" role="radiogroup" aria-label="Rating">
      ${[5, 4, 3, 2, 1].map((n) => `
        <input type="radio" name="rate-${coachId}" id="r${coachId}-${n}" value="${n}">
        <label for="r${coachId}-${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
    </div>`;

  const forms = data.reviewable.map((c) => `
    <div class="review-form" data-coach="${c.id}" style="border-top:1px dashed var(--line);padding-top:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <strong>${esc(c.name)}</strong>
        ${starPicker(c.id)}
      </div>
      <textarea class="input" rows="2" maxlength="600" placeholder="How were the sessions? (optional)"
        style="width:100%;margin-top:8px"></textarea>
      <button class="btn btn-primary btn-sm" data-submit="${c.id}" style="margin-top:8px">Post review</button>
    </div>`).join('');

  const mine = data.mine.length ? `
    <div style="margin-top:16px">
      <div class="small muted" style="text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Your reviews</div>
      ${data.mine.map((r) => `<div class="review"><div>${starsHTML(r.rating)} <span class="small muted">${esc(r.coach)}</span></div>
        ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
        <div class="small muted">${esc(r.date)}</div></div>`).join('')}
    </div>` : '';

  if (!forms && !mine) { box.innerHTML = ''; return; }

  box.innerHTML = `<div class="card">
    <h3 style="font-size:1.15rem">Reviews</h3>
    ${data.reviewable.length
      ? '<p class="small muted">Rate the coaches you’ve trained with — it helps other players choose.</p>' + forms
      : (mine ? '' : '<p class="small muted">Once you’ve completed a session you can review your coach here.</p>')}
    ${mine}
  </div>`;

  box.querySelectorAll('[data-submit]').forEach((btn) => btn.addEventListener('click', async () => {
    const coachId = btn.dataset.submit;
    const form = btn.closest('.review-form');
    const rating = form.querySelector(`input[name="rate-${coachId}"]:checked`);
    if (!rating) { toast('Please pick a star rating first.', true); return; }
    btn.disabled = true;
    try {
      await API.post(`/coaches/${coachId}/reviews`, {
        rating: Number(rating.value),
        body: form.querySelector('textarea').value,
      });
      toast('Thanks — your review is posted!');
      await loadReviewsSection();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  }));
}
