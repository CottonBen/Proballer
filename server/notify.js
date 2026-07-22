// Coach-facing announcement of a booking + the chat plumbing it needs.
//
// A card-paid booking is announced to its coach only when the payment
// CONFIRMS — not at booking time. Until then the coach sees nothing: no
// alert, no chat thread, and the coach endpoints hide the row
// (bookings.coach_notified = 0). Free-credit and legacy bank-transfer
// bookings are announced immediately (nothing is pending on them).
'use strict';

const { db, nowISO } = require('./db');

function ensureChat(coachId, customerId) {
  db.prepare('INSERT OR IGNORE INTO chats (coach_id, customer_id, created_at) VALUES (?,?,?)')
    .run(coachId, customerId, nowISO());
  return db.prepare('SELECT * FROM chats WHERE coach_id = ? AND customer_id = ?').get(coachId, customerId);
}

function postChatMessage(chatId, senderId, text) {
  const info = db.prepare('INSERT INTO chat_messages (chat_id, sender_id, body, created_at) VALUES (?,?,?,?)')
    .run(chatId, senderId, text, nowISO());
  // The sender has trivially read their own message.
  if (senderId) markChatRead(chatId, senderId, Number(info.lastInsertRowid));
  return Number(info.lastInsertRowid);
}

function markChatRead(chatId, userId, messageId) {
  db.prepare(`INSERT INTO chat_reads (chat_id, user_id, last_read_id) VALUES (?,?,?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)`)
    .run(chatId, userId, messageId);
}

// The moment the coach learns about a booking: in-app alert + the chat thread
// (language-neutral system line, then the customer's wizard notes as their
// first message). Idempotent via bookings.coach_notified, so every payment
// path can call it safely. Returns true when this call did the announcing.
function announceBookingToCoach(bookingId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b || b.coach_notified) return false;
  db.prepare('UPDATE bookings SET coach_notified = 1 WHERE id = ?').run(b.id);

  const coach = db.prepare('SELECT user_id, name FROM coaches WHERE id = ?').get(b.coach_id);
  const customer = db.prepare('SELECT id, name FROM users WHERE id = ?').get(b.customer_id);
  // English-canonical; the frontend translates at display time.
  if (coach.user_id && coach.user_id !== b.customer_id) {
    db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)')
      .run(coach.user_id, `New booking: ${customer.name} on ${b.date} at `
        + `${String(b.hour).padStart(2, '0')}:00 — ${b.focus ? b.focus + ' ' : ''}(${b.location}).`, nowISO());
  }
  const chat = ensureChat(b.coach_id, b.customer_id);
  const sysId = postChatMessage(chat.id, null, `📅 ${b.code} · ${b.date} · ${String(b.hour).padStart(2, '0')}:00`);
  // The customer has obviously "seen" their own booking's system line.
  markChatRead(chat.id, b.customer_id, sysId);
  if (b.notes) postChatMessage(chat.id, b.customer_id, b.notes);
  // The same moment the coach hears, everyone gets email: the customer's
  // confirmation, the coach's copy with a link to the coach app (pick the
  // pitch, message the player), and the admins' copy for the business inbox.
  // For card bookings that is when the payment confirms, so no email can
  // promise a session that might evaporate unpaid.
  require('./emails').sendBookingConfirmedEmail(b.id);
  require('./emails').sendCoachBookingEmail(b.id);
  require('./emails').sendAdminBookingEmail(b.id);
  // Mirror the booking into the CRM (no-op unless ATTIO_API_KEY is set).
  require('./attio').syncBooking(b.id);
  return true;
}

module.exports = { ensureChat, postChatMessage, markChatRead, announceBookingToCoach };
