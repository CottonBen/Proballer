// Server-side i18n for customer-facing documents (invoices) and emails.
// The frontend has its own dictionary (public/js/i18n.js); this one covers
// only what the SERVER renders. Language comes from users.lang ('fi'|'en'),
// which the client sets at signup/login/booking. Finnish is the default.
'use strict';

const STRINGS = {
  fi: {
    'invoice.title': 'Lasku {number}',
    'invoice.billedTo': 'Laskutettava',
    'invoice.issued': 'Päivätty',
    'invoice.due': 'Eräpäivä',
    'invoice.bookingRef': 'Varaustunnus',
    'invoice.item': 'Tuote',
    'invoice.amount': 'Summa',
    'invoice.lineItem': 'Henkilökohtainen valmennustreeni — {focus} ({position})',
    'invoice.freeSession': 'ILMAINEN TREENI — hyvitys perutusta varauksesta',
    'invoice.totalDue': 'Maksettava yhteensä',
    'invoice.howToPay': 'Näin maksat',
    'invoice.paymentMethod': 'Maksutapa',
    'invoice.orMobilePay': ' tai MobilePay',
    'invoice.onlyMethod': ' (ainoa maksutapa)',
    'invoice.payee': 'Maksunsaaja',
    'invoice.ibanRow': 'Tilisiirto — IBAN',
    'invoice.mobilepayRow': 'MobilePay — numero',
    'invoice.reference': 'Viesti / viitenumero',
    'invoice.dueDate': 'Eräpäivä',
    'invoice.matchNote': '{hint}, jotta osaamme kohdistaa maksusi. Kysyttävää? Vastaa osoitteeseen {email}.',
    'invoice.thanks': 'Kiitos, että treenaat kanssamme — nähdään kentällä!',
    'receipt.title': 'Kuitti {number}',
    'receipt.badge': 'MAKSETTU',
    'receipt.totalPaid': 'Maksettu yhteensä',
    'receipt.paidRow': 'Maksupäivä',
    'receipt.keepNote': 'Tämä kuitti on tosite maksustasi — säilytä se.',
    'method.card': 'Korttimaksu',
    'method.credit': 'Ilmainen treenikerta',
    'method.bank': 'Tilisiirto',
    'email.receiptSubject': '{siteName} — kuitti {number}',
    'email.invoiceSubject': '{siteName} — lasku {number}',
    'email.cancelledSubject': '{siteName} — treeni peruttu',
    'email.greeting': 'Hei {name},',
    'email.cancelledBody': '{actor} perui treenisi valmentajan {coach} kanssa {date} klo {hour}.00. Olemme pahoillamme! {creditMsg}',
    'email.actor.coach': 'Valmentajasi',
    'email.actor.team': 'Proballers-tiimi',
    'email.credit.returned': 'Ilmainen treenikertasi on taas käytettävissä — voit käyttää sen kenen tahansa valmentajan kanssa.',
    'email.credit.granted': 'Hyvitykseksi seuraava treenisi KENEN tahansa valmentajan kanssa on ilmainen — ilmainen treenikerta käytetään automaattisesti, kun varaat.',
    'email.signoff': 'Terveisin Proballers Coaching -tiimi',
    'email.welcome.subject': 'Tervetuloa — {siteName}',
    'email.welcome.title': 'Tervetuloa mukaan!',
    'email.welcome.body': 'Tilisi on valmis. Voit nyt selata valmentajia, varata henkilökohtaisia treenejä Helsingissä, Espoossa ja Vantaalla (tai etänä) ja seurata varauksiasi Omat varaukset -sivulla. Kaikki vahvistukset ja kuitit tulevat tähän sähköpostiosoitteeseen.',
    'email.welcome.cta': 'Varaa ensimmäinen treenisi',
    'email.booking.subject': '{siteName} — varaus vahvistettu {date}',
    'email.booking.title': 'Varauksesi on vahvistettu',
    'email.booking.body': 'Treenisi on lyöty lukkoon — tässä vielä tiedot:',
    'email.booking.line': '{coach} · {date} · {hours} · {focus} · {location}',
    'email.booking.ref': 'Varaustunnus: {code}',
    'email.booking.pitchNote': 'Valmentaja valitsee treenille kentän — saat siitä erillisen sähköpostivahvistuksen ennen treeniä.',
    'email.booking.cta': 'Katso varauksesi',
    'email.coachbooking.subject': '{siteName} — uusi varaus {date}',
    'email.coachbooking.title': 'Sinulle on uusi varaus',
    'email.coachbooking.body': '{customer} varasi ja maksoi treenin:',
    'email.coachbooking.ref': 'Varaustunnus: {code}',
    'email.coachbooking.notes': 'Pelaajan toiveet: {notes}',
    'email.coachbooking.steps': 'Avaa valmennussovellus ja tee kaksi asiaa: valitse treenille kenttä Kentät-välilehdeltä ja laita pelaajalle viesti Viestit-välilehdellä.',
    'email.coachbooking.own_pitch': 'Voit halutessasi valita oman kentän, jos olet varma, että kentälle mahtuu.',
    'email.coachbooking.steps_online': 'Avaa valmennussovellus ja laita pelaajalle viesti Viestit-välilehdellä — sopikaa etätapaamisen yksityiskohdat.',
    'email.coachbooking.cta': 'Avaa valmennussovellus',
    'email.pitch.subject': '{siteName} — kenttä vahvistettu: {pitch}',
    'email.pitch.title': 'Treenipaikka on valittu',
    'email.pitch.body': 'Valmentajasi {coach} valitsi kentän treenillenne {date} {hours}:',
    'email.pitch.cta': 'Katso varauksesi',
    'email.review.subject': '{siteName} — miten treeni meni?',
    'email.review.title': 'Miten treeni meni?',
    'email.review.body': 'Kiitos, että treenasit valmentajan {coach} kanssa {date}. Palautteesi auttaa muita pelaajia löytämään oikean valmentajan — jättäisitkö lyhyen arvostelun Omat varaukset -sivulla?',
    'email.review.cta': 'Jätä arvostelu',
    'email.release.subject': '{siteName} — varaustasi ei voitu vahvistaa',
    'email.release.title': 'Varaus ei mennyt läpi',
    'email.release.body': 'Varauksesi {code} ({date} {hours}, valmentaja {coach}) peruuntui automaattisesti, koska maksua ei suoritettu loppuun, ja aika vapautui muiden varattavaksi.',
    'email.release.note': 'Jos haluat treenin edelleen, varaa uusi aika — maksu tapahtuu heti varauksen yhteydessä. Jos maksusi ehti kuitenkin lähteä, vahvistamme varauksen tai palautamme rahat, ja saat siitä erillisen viestin.',
    'email.release.cta': 'Varaa uusi aika',
    'email.rebook.subject': '{siteName} — aika varata seuraava treeni?',
    'email.rebook.title': 'Jatketaanko kehittymistä?',
    'email.rebook.body': 'Edellisestä treenistäsi valmentajan {coach} kanssa ({date}) on muutama päivä. Parhaat tulokset syntyvät säännöllisellä harjoittelulla — seuraava vapaa aika odottaa jo.',
    'email.rebook.cta': 'Varaa uusi treeni',
    // config-value translations (the config stays English; displayed per language)
    'cfg.Bank transfer': 'Tilisiirto',
    'cfg.LAUNCH OFFER': 'AVAJAISTARJOUS',
    'cfg.VAT 0% — small business, AVL 3 §': 'ALV 0 % — pienyritys, AVL 3 §',
    'cfg.Use the invoice number as the message/reference': 'Käytä laskun numeroa viestinä/viitteenä',
    'cfg.Online': 'Etänä',
    'position.goalkeepers': 'Maalivahdit',
    'position.defenders': 'Puolustajat',
    'position.midfielders': 'Keskikenttäpelaajat',
    'position.attackers': 'Hyökkääjät',
    'focus.conditioning': 'Kunto',
    'focus.physicality': 'Fyysisyys',
    'focus.agility': 'Ketteryys',
    'focus.technical': 'Tekniikka',
    'focus.defending': 'Puolustaminen',
    'focus.finishing': 'Viimeistely',
    'focus.passing': 'Syöttäminen',
    'focus.game-iq': 'Game IQ (etätapaaminen)',
  },
  en: {
    'invoice.title': 'Invoice {number}',
    'invoice.billedTo': 'Billed to',
    'invoice.issued': 'Issued',
    'invoice.due': 'Due',
    'invoice.bookingRef': 'Booking reference',
    'invoice.item': 'Item',
    'invoice.amount': 'Amount',
    'invoice.lineItem': '1-on-1 coaching session — {focus} ({position})',
    'invoice.freeSession': 'FREE SESSION — credit from a cancelled booking',
    'invoice.totalDue': 'Total due',
    'invoice.howToPay': 'How to pay',
    'invoice.paymentMethod': 'Payment method',
    'invoice.orMobilePay': ' or MobilePay',
    'invoice.onlyMethod': ' (only payment method)',
    'invoice.payee': 'Payee',
    'invoice.ibanRow': 'Bank transfer — IBAN',
    'invoice.mobilepayRow': 'MobilePay — number',
    'invoice.reference': 'Reference / message',
    'invoice.dueDate': 'Due date',
    'invoice.matchNote': '{hint} so we can match your payment. Questions? Reply to {email}.',
    'invoice.thanks': 'Thank you for training with us — see you on the pitch!',
    'receipt.title': 'Receipt {number}',
    'receipt.badge': 'PAID',
    'receipt.totalPaid': 'Total paid',
    'receipt.paidRow': 'Payment date',
    'receipt.keepNote': 'This receipt is proof of your payment — please keep it.',
    'method.card': 'Card payment',
    'method.credit': 'Free session credit',
    'method.bank': 'Bank transfer',
    'email.receiptSubject': '{siteName} — receipt {number}',
    'email.invoiceSubject': '{siteName} — invoice {number}',
    'email.cancelledSubject': '{siteName} — session cancelled',
    'email.greeting': 'Hi {name},',
    'email.cancelledBody': "Your session with {coach} on {date} at {hour}:00 was cancelled by {actor}. We're sorry! {creditMsg}",
    'email.actor.coach': 'your coach',
    'email.actor.team': 'the Proballers team',
    'email.credit.returned': 'Your free-session credit is available again — use it on any coach.',
    'email.credit.granted': 'To make it right, your next session with ANY coach is free — the credit is applied automatically when you book.',
    'email.signoff': 'Best regards, the Proballers Coaching team',
    'email.welcome.subject': 'Welcome — {siteName}',
    'email.welcome.title': 'Welcome aboard!',
    'email.welcome.body': 'Your account is ready. You can now browse the coaches, book 1-on-1 sessions in Helsinki, Espoo and Vantaa (or online), and follow your bookings on the My bookings page. All confirmations and receipts arrive at this email address.',
    'email.welcome.cta': 'Book your first session',
    'email.booking.subject': '{siteName} — booking confirmed {date}',
    'email.booking.title': 'Your booking is confirmed',
    'email.booking.body': 'Your session is locked in — here are the details:',
    'email.booking.line': '{coach} · {date} · {hours} · {focus} · {location}',
    'email.booking.ref': 'Booking reference: {code}',
    'email.booking.pitchNote': 'Your coach will pick the pitch for the session — you will get a separate confirmation email before the session.',
    'email.booking.cta': 'View your booking',
    'email.coachbooking.subject': '{siteName} — new booking {date}',
    'email.coachbooking.title': 'You have a new booking',
    'email.coachbooking.body': '{customer} booked and paid for a session:',
    'email.coachbooking.ref': 'Booking reference: {code}',
    'email.coachbooking.notes': "Player's wishes: {notes}",
    'email.coachbooking.steps': 'Open the coach app and do two things: pick the pitch for the session on the Pitches tab, and message the player on the Chats tab.',
    'email.coachbooking.own_pitch': 'If you prefer, you can pick your own pitch, as long as you are sure there is room for your session.',
    'email.coachbooking.steps_online': 'Open the coach app and message the player on the Chats tab — agree on the details of the online session.',
    'email.coachbooking.cta': 'Open the coach app',
    'email.pitch.subject': '{siteName} — pitch confirmed: {pitch}',
    'email.pitch.title': 'Your session has a pitch',
    'email.pitch.body': 'Your coach {coach} picked the pitch for your session on {date} {hours}:',
    'email.pitch.cta': 'View your booking',
    'email.review.subject': '{siteName} — how was your session?',
    'email.review.title': 'How was your session?',
    'email.review.body': 'Thanks for training with {coach} on {date}. Your feedback helps other players find the right coach — would you leave a short review on the My bookings page?',
    'email.review.cta': 'Leave a review',
    'email.release.subject': '{siteName} — your booking could not be confirmed',
    'email.release.title': 'Your booking did not go through',
    'email.release.body': 'Your booking {code} ({date} {hours} with {coach}) was cancelled automatically because the payment was not completed, and the slot has been released for others to book.',
    'email.release.note': 'If you still want the session, simply book a new time — payment happens right at booking. If your payment did go through after all, we will either confirm the booking or refund you — you will get a separate message about it.',
    'email.release.cta': 'Book a new time',
    'email.rebook.subject': '{siteName} — time to book your next session?',
    'email.rebook.title': 'Keep the progress going?',
    'email.rebook.body': 'It has been a few days since your last session with {coach} ({date}). Steady training brings the best results — the next open slot is waiting.',
    'email.rebook.cta': 'Book a new session',
  },
};

// 'fi' | 'en' only — anything else falls back to Finnish (site default).
const pickLang = (l) => (l === 'en' ? 'en' : 'fi');

function tr(lang, key, params) {
  const L = pickLang(lang);
  let s = STRINGS[L][key] ?? STRINGS.en[key] ?? STRINGS.fi[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, p) => (params[p] ?? m));
  return s;
}

// Translate an English config value (payment method, sale label, VAT note, …).
// Unknown values and EN mode pass through unchanged.
function trCfg(lang, value) {
  if (pickLang(lang) !== 'fi' || !value) return value;
  return STRINGS.fi['cfg.' + value] ?? value;
}

// Position group / focus labels by id ('defenders', 'finishing', …).
function positionLabel(lang, id) {
  if (pickLang(lang) === 'fi') return STRINGS.fi['position.' + id] ?? id;
  return String(id).charAt(0).toUpperCase() + String(id).slice(1);
}
function focusLabel(lang, focus) {
  // `focus` is a config focusType ({id, label}) or a bare id string.
  const id = typeof focus === 'string' ? focus : focus.id;
  if (pickLang(lang) === 'fi') return STRINGS.fi['focus.' + id] ?? id;
  return typeof focus === 'string' ? focus : focus.label;
}

// '2026-07-11' -> '11.7.2026' (fi) or unchanged ISO (en).
function localDate(lang, iso) {
  if (pickLang(lang) !== 'fi' || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  const [y, m, d] = String(iso).split('-');
  return `${+d}.${+m}.${y}`;
}

// Hour range: 9 -> 'klo 9.00–10.00' (fi) / '9:00–10:00' (en).
function hourRange(lang, hour) {
  const h = Number(hour);
  return pickLang(lang) === 'fi' ? `klo ${h}.00–${h + 1}.00` : `${h}:00–${h + 1}:00`;
}

module.exports = { tr, trCfg, positionLabel, focusLabel, localDate, hourRange, pickLang };
