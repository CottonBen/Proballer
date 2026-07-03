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
