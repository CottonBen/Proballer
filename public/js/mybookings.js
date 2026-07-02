// Customer's own bookings + invoices.
'use strict';

(async function init() {
  const user = await initHeaderAuth();
  if (!user) return requireLoginRedirect();
  if (user.role === 'coach') { location.href = '/coach'; return; }

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
