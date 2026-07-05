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
    'email.invoiceSubject': '{siteName} — lasku {number}',
    'email.cancelledSubject': '{siteName} — treeni peruttu',
    'email.greeting': 'Hei {name},',
    'email.cancelledBody': '{actor} perui treenisi valmentajan {coach} kanssa {date} klo {hour}.00. Olemme pahoillamme! {creditMsg}',
    'email.actor.coach': 'Valmentajasi',
    'email.actor.team': 'Proballers-tiimi',
    'email.credit.returned': 'Ilmainen treenikertasi on taas käytettävissä — voit käyttää sen kenen tahansa valmentajan kanssa.',
    'email.credit.granted': 'Hyvitykseksi seuraava treenisi KENEN tahansa valmentajan kanssa on ilmainen — ilmainen treenikerta käytetään automaattisesti, kun varaat.',
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
    'email.invoiceSubject': '{siteName} — invoice {number}',
    'email.cancelledSubject': '{siteName} — session cancelled',
    'email.greeting': 'Hi {name},',
    'email.cancelledBody': "Your session with {coach} on {date} at {hour}:00 was cancelled by {actor}. We're sorry! {creditMsg}",
    'email.actor.coach': 'your coach',
    'email.actor.team': 'the Proballers team',
    'email.credit.returned': 'Your free-session credit is available again — use it on any coach.',
    'email.credit.granted': 'To make it right, your next session with ANY coach is free — the credit is applied automatically when you book.',
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
