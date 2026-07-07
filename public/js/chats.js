// Chats page (/chats): coach <-> customer conversations, admin sees all.
// List left, thread right (stacked on mobile). New messages poll every 8 s.
'use strict';

const C = { chats: [], open: null, me: null, pollTimer: null };

const listEl = () => document.getElementById('chat-list');
const threadEl = () => document.getElementById('chat-thread');

function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(I18N.lang === 'fi' ? 'fi-FI' : 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Whose face/name identifies a chat depends on who is looking at it.
function chatTitle(c) {
  const iAmCustomer = C.me.user.id === c.customerId;
  if (C.me.user.role === 'admin' && !iAmCustomer) {
    return `${c.customerName} ↔ ${c.coachName}`;
  }
  return iAmCustomer ? t('chat.with_coach', { name: esc(c.coachName) }) : c.customerName;
}

async function loadChats(keepOpen = true) {
  C.chats = await API.get('/chats');
  const list = listEl();
  if (!C.chats.length) {
    list.innerHTML = `<p class="muted small" style="margin:0">${t('chat.empty')}</p>`;
    return;
  }
  list.innerHTML = C.chats.map((c) => `
    <button class="chat-item ${C.open === c.id ? 'on' : ''}" data-chat="${c.id}">
      <span class="chat-ava">${c.coachPhoto ? `<img src="${esc(c.coachPhoto)}" alt="">` : '💬'}</span>
      <span class="chat-item-main">
        <span class="chat-item-title">${chatTitle(c)}</span>
        <span class="chat-item-last muted">${esc((c.lastMessage || '').slice(0, 48))}</span>
      </span>
      ${c.unread ? `<span class="hdr-badge">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
    </button>`).join('');
  list.querySelectorAll('[data-chat]').forEach((b) =>
    b.addEventListener('click', () => openThread(Number(b.dataset.chat))));
  if (keepOpen && C.open && !C.chats.some((c) => c.id === C.open)) C.open = null;
}

async function openThread(id) {
  C.open = id;
  listEl().querySelectorAll('.chat-item').forEach((b) =>
    b.classList.toggle('on', Number(b.dataset.chat) === id));
  const data = await API.get(`/chats/${id}/messages`);
  const th = threadEl();
  th.hidden = false;
  document.getElementById('chat-layout').classList.add('thread-open');

  const c = data.chat;
  const iAmCustomer = C.me.user.id === c.customerId;
  document.getElementById('thread-head').innerHTML = `
    <button class="btn btn-ghost btn-sm chat-back" id="chat-back">${t('chat.back')}</button>
    <strong>${iAmCustomer ? t('chat.with_coach', { name: esc(c.coachName) })
      : `${esc(c.customerName)} ↔ ${esc(c.coachName)}`}</strong>`;
  document.getElementById('chat-back').addEventListener('click', () => {
    document.getElementById('chat-layout').classList.remove('thread-open');
    th.hidden = true; C.open = null;
    loadChats();
  });

  renderMessages(data.messages);
  // Opening marks it read — refresh list + header badge quietly.
  loadChats();
}

function renderMessages(messages) {
  const box = document.getElementById('chat-msgs');
  box.innerHTML = messages.map((m) => {
    if (m.system) {
      // 📅 = booking created, 📍 = coach picked the pitch; body carries the values.
      if (m.body.startsWith('📍')) {
        return `<div class="msg-system">📍 ${t('chat.system_pitch')} · ${esc(m.body.replace(/^📍\s*/, ''))}</div>`;
      }
      return `<div class="msg-system">📅 ${t('chat.system_booking')} · ${esc(m.body.replace(/^📅\s*/, ''))}</div>`;
    }
    const roleBadge = m.senderRole === 'admin' && !m.mine
      ? ` <span class="chip" style="font-size:.6rem">${t('chat.admin_badge')}</span>`
      : (m.senderRole === 'coach' && !m.mine ? ` <span class="chip" style="font-size:.6rem">${t('chat.coach_badge')}</span>` : '');
    return `<div class="msg ${m.mine ? 'mine' : ''}">
      ${m.mine ? '' : `<div class="msg-sender small muted">${esc(m.senderName || '?')}${roleBadge}</div>`}
      <div class="msg-bubble">${esc(m.body)}</div>
      <div class="msg-time small muted">${esc(fmtStamp(m.at))}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function refreshOpenThread() {
  if (!C.open) return;
  try {
    const data = await API.get(`/chats/${C.open}/messages`);
    renderMessages(data.messages);
  } catch { /* transient */ }
}

document.getElementById('chat-compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !C.open) return;
  input.value = '';
  try {
    await API.post(`/chats/${C.open}/messages`, { message: text });
    await refreshOpenThread();
  } catch (err) {
    input.value = text;
    toast(I18N.server(err.message), true);
  }
});

(async function init() {
  const user = await initHeaderAuth();
  try { C.me = await API.get('/me'); } catch { C.me = { user: null }; }
  if (!C.me.user) { location.href = '/login?next=' + encodeURIComponent('/chats'); return; }
  if (C.me.user.role === 'admin') {
    document.getElementById('chat-sub').textContent = t('chat.admin_view');
  }
  await loadChats();
  // Poll: refresh the open thread + list badges every 8 s.
  C.pollTimer = setInterval(async () => {
    await refreshOpenThread();
    if (!C.open) loadChats();
  }, 8000);
})();
