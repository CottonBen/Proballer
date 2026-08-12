// Privacy policy (/privacy, /en/privacy) and the account-deletion it promises.
//
// The text is generated from what the app ACTUALLY does — the retention
// periods, the named processors and the cookie names all come from config.js
// and the real code, so the policy cannot quietly drift away from the system it
// describes. If you switch a new integration on, add it to config.privacy and
// it appears here; if you change a retention period, the page changes with it.
//
// NOT legal advice. It is an accurate description of the system written in
// plain language, which is the part a lawyer cannot do for you. Have someone
// qualified read it before you rely on it — especially the children's-data and
// health-data sections, which are the ones with teeth.
'use strict';

const config = require('../config');
const { db, nowISO } = require('./db');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// True while the legal identity is still placeholder text. The page says so
// rather than presenting an incomplete policy as if it were finished.
const isDraft = () => ['legalName', 'address']
  .some((k) => String(config.privacy[k] || '').startsWith('TODO'));

const P = config.privacy;

// ---------------------------------------------------------------------------
// The text, both languages side by side so they cannot drift apart.
// ---------------------------------------------------------------------------
function sections(lang) {
  const fi = lang === 'fi';
  const s = (fiText, enText) => (fi ? fiText : enText);

  return [
    {
      h: s('Rekisterinpitäjä', 'Who is responsible'),
      body: `<p>${s(
        `${esc(P.legalName)}${P.businessId ? ` (Y-tunnus ${esc(P.businessId)})` : ''}, ${esc(P.address)}. `
        + `Tietosuoja-asioissa ota yhteyttä: <a href="mailto:${esc(P.contactEmail)}">${esc(P.contactEmail)}</a>.`,
        `${esc(P.legalName)}${P.businessId ? ` (business ID ${esc(P.businessId)})` : ''}, ${esc(P.address)}. `
        + `For anything about your data, contact <a href="mailto:${esc(P.contactEmail)}">${esc(P.contactEmail)}</a>.`)}</p>
      <p>${s(
        'Emme ole nimenneet tietosuojavastaavaa — toimintamme on pienimuotoista eikä laki sitä edellytä. '
        + 'Yhteydenotot menevät yllä olevaan osoitteeseen ja vastaamme kuukauden kuluessa.',
        'We have not appointed a data protection officer — we are small enough that the law does not '
        + 'require one. Requests go to the address above and we answer within a month.')}</p>`,
    },
    {
      h: s('Mitä tietoja keräämme', 'What we collect'),
      body: `<p>${s('Vain sen, mitä treenin varaaminen ja laskuttaminen vaatii:',
        'Only what booking and invoicing a session actually requires:')}</p>
      <ul>
        <li><strong>${s('Tili', 'Account')}</strong> — ${s(
          'nimi, sähköposti, salasana (tallennetaan vain suolattuna tiivisteenä, emme näe sitä), '
          + 'puhelinnumero ja kotialue.',
          'name, email, password (stored only as a salted hash — we never see it), phone number '
          + 'and home area.')}</li>
        <li><strong>${s('Varaukset ja laskutus', 'Bookings and billing')}</strong> — ${s(
          'varatut ajat, valmentaja, paikkakunta, laskutusnimi ja -osoite, laskut ja maksutiedot.',
          'the times you booked, the coach, the city, your billing name and address, invoices and '
          + 'payment records.')}</li>
        <li><strong>${s('Viestit', 'Messages')}</strong> — ${s(
          'valmentajan ja asiakkaan välinen keskustelu sekä varaukseen kirjoitetut toiveet.',
          'the coach–customer chat, and any wishes you write on a booking.')}</li>
        <li><strong>${s('Arviot', 'Reviews')}</strong> — ${s(
          'jättämäsi tähtiarvio ja teksti, jotka näkyvät julkisesti valmentajan sivulla.',
          'the star rating and text you leave, which appear publicly on the coach’s page.')}</li>
        <li><strong>${s('Käyttötiedot', 'Usage')}</strong> — ${s(
          'sivulataukset, mistä saavuit sivustolle, ja milloin tili on viimeksi ollut käytössä.',
          'page views, where you arrived from, and when the account was last active.')}</li>
      </ul>
      <p>${s(
        'Emme kerää sijaintitietoa, emme seuraa sinua muilla sivustoilla emmekä osta tai myy tietoja.',
        'We do not collect location data, do not track you across other sites, and do not buy or '
        + 'sell data.')}</p>`,
    },
    {
      h: s('Terveystiedot', 'Health information'),
      body: `<p>${s(
        'Varauksen “toiveet valmentajalle” -kenttään kirjoitetaan joskus loukkaantumisia tai '
        + 'terveyteen liittyviä asioita, jotta valmentaja osaa ottaa ne huomioon. Tällainen tieto on '
        + 'tietosuoja-asetuksen tarkoittamaa erityistä henkilötietoa.',
        'People sometimes write injuries or health conditions in the “wishes for the coach” field so '
        + 'the coach can take them into account. That counts as special-category data under the GDPR.')}</p>
      <p>${s(
        'Käsittelemme sitä vain nimenomaisella suostumuksellasi — suostumus annetaan sillä, että '
        + 'kirjoitat tiedon kenttään vapaaehtoisesti. Sen näkee vain kyseinen valmentaja ja ylläpito. '
        + 'Sitä ei viedä Google Sheets -vientiin eikä kerrota kenellekään muulle. Voit pyytää sen '
        + 'poistamista milloin tahansa, ja voit aivan hyvin jättää kentän tyhjäksi tai kertoa asian '
        + 'valmentajalle kasvotusten.',
        'We process it only with your explicit consent — which you give by choosing to type it into '
        + 'that field. Only the coach concerned and the site administrators can see it. It is not '
        + 'included in the Google Sheets export and is not shared with anyone else. You can ask us to '
        + 'delete it at any time, and you are equally welcome to leave the field empty and tell the '
        + 'coach in person.')}</p>`,
    },
    {
      h: s('Lapset ja nuoret', 'Children and young people'),
      body: `<p>${s(
        'Valmennamme nuoria pelaajia, joten tämä on meille tärkeä kohta. Suomessa 13 vuotta täyttänyt '
        + 'voi antaa suostumuksensa itse; sitä nuoremman puolesta suostumuksen antaa huoltaja.',
        'We coach young players, so this matters to us. In Finland someone aged 13 or over can consent '
        + 'for themselves; for anyone younger, a parent or guardian consents on their behalf.')}</p>
      <p>${s(
        'Tiliä luotaessa pyydämme vahvistamaan, että olet vähintään 13-vuotias tai että huoltajasi on '
        + 'hyväksynyt tilin. Jos alle 13-vuotias on luonut tilin ilman huoltajan hyväksyntää, kerro '
        + 'meille — poistamme tilin ja siihen liittyvät tiedot.',
        'When an account is created we ask you to confirm that you are 13 or older, or that your parent '
        + 'or guardian has agreed to the account. If a child under 13 has created an account without a '
        + 'guardian’s agreement, tell us and we will delete the account and its data.')}</p>
      <p>${s(
        'Huoltaja voi aina pyytää nähtäväkseen, oikaistavaksi tai poistettavaksi lapsensa tiedot '
        + 'samalla tavalla kuin omansa.',
        'A guardian can always ask to see, correct or delete their child’s data, exactly as they '
        + 'could their own.')}</p>`,
    },
    {
      h: s('Miksi käsittelemme tietoja', 'Why we process it'),
      body: `<ul>
        <li><strong>${s('Sopimuksen täyttäminen', 'Performing our agreement')}</strong> — ${s(
          'varauksen tekeminen, valmentajan tiedottaminen, laskutus ja kuitit.',
          'making the booking, telling the coach, invoicing and receipts.')}</li>
        <li><strong>${s('Lakisääteinen velvoite', 'Legal obligation')}</strong> — ${s(
          'kirjanpito ja laskut on säilytettävä kirjanpitolain mukaan.',
          'accounting law requires invoices and booking records to be kept.')}</li>
        <li><strong>${s('Oikeutettu etu', 'Legitimate interest')}</strong> — ${s(
          'palvelun toiminnan seuraaminen, väärinkäytösten estäminen ja kävijämäärien laskeminen.',
          'keeping the service working, preventing abuse, and counting visitors.')}</li>
        <li><strong>${s('Suostumus', 'Consent')}</strong> — ${s(
          'terveystiedot (yllä) ja julkiset arviot.',
          'health information (above) and public reviews.')}</li>
      </ul>`,
    },
    {
      h: s('Kenelle tietoja luovutetaan', 'Who else sees it'),
      body: `<p>${s(
        'Emme myy tietoja. Käytämme näitä palveluntarjoajia, jotka käsittelevät tietoja puolestamme:',
        'We do not sell data. We use these providers, who process data on our behalf:')}</p>
      <ul>
        <li><strong>Render</strong> — ${s('palvelinten ja tietokannan ylläpito.',
          'hosting for the server and database.')}</li>
        <li><strong>${esc(P.smtpProvider)}</strong> — ${s(
          'sähköpostien lähetys (laskut, kuitit, muistutukset).',
          'sending email (invoices, receipts, reminders).')}</li>
        <li><strong>Google Sheets</strong> — ${s(
          'varaus-, lasku- ja asiakaslistojen vienti omaan kirjanpitoomme. Vientiin menevät nimi, '
          + 'sähköposti, puhelinnumero ja varausten tiedot.',
          'exporting bookings, invoices and the customer list into our own bookkeeping. The export '
          + 'includes name, email, phone number and booking details.')}</li>
        <li><strong>Vipps MobilePay</strong> — ${s(
          'maksujen välitys, kun maksat MobilePaylla.',
          'processing your payment when you pay by MobilePay.')}</li>
      </ul>
      <p>${s(
        'Valmentaja näkee oman treeninsä asiakkaan nimen, varauksen tiedot ja siihen kirjoitetut '
        + 'toiveet — ei laskutus- tai maksutietoja.',
        'A coach sees the name, booking details and wishes for their own sessions — not billing or '
        + 'payment details.')}</p>
      <p>${s(
        'Tiedot säilytetään EU:n alueella. Google saattaa käsitellä tietoja myös EU:n ulkopuolella; '
        + 'siirto perustuu komission vakiolausekkeisiin.',
        'Data is stored within the EU. Google may also process data outside the EU; those transfers '
        + 'rely on the European Commission’s standard contractual clauses.')}</p>`,
    },
    {
      h: s('Kuinka kauan säilytämme', 'How long we keep it'),
      body: `<ul>
        <li>${s(
          `<strong>Laskut ja varaustiedot:</strong> ${P.invoiceYears} vuotta tilikauden päättymisestä, `
          + 'kuten kirjanpitolaki edellyttää. Näitä emme voi poistaa pyynnöstä aiemmin.',
          `<strong>Invoices and booking records:</strong> ${P.invoiceYears} years from the end of the `
          + 'financial year, as accounting law requires. We cannot delete these earlier on request.')}</li>
        <li>${s(
          `<strong>Tili, viestit ja muistiinpanot:</strong> poistetaan, kun tili on ollut käyttämättä `
          + `${P.inactiveMonths} kuukautta — tai heti kun pyydät.`,
          `<strong>Account, messages and notes:</strong> deleted after ${P.inactiveMonths} months of `
          + 'inactivity — or as soon as you ask.')}</li>
        <li>${s('<strong>Kävijätilastot:</strong> enintään 24 kuukautta, minkä jälkeen vain lukumäärät jäävät.',
          '<strong>Visitor statistics:</strong> at most 24 months, after which only counts remain.')}</li>
        <li>${s('<strong>Keskeneräiset rekisteröitymiset:</strong> poistetaan vuorokaudessa.',
          '<strong>Abandoned signups:</strong> deleted within a day.')}</li>
      </ul>`,
    },
    {
      h: s('Evästeet', 'Cookies'),
      body: `<p>${s('Käytämme kahta evästettä, molemmat omia — emme käytä mainos- tai seurantaevästeitä:',
        'We use two cookies, both our own. There are no advertising or tracking cookies:')}</p>
      <ul>
        <li><code>pbf_session</code> — ${s(
          'pitää sinut kirjautuneena. Poistuu, kun kirjaudut ulos.',
          'keeps you logged in. Removed when you log out.')}</li>
        <li><code>pbf_vid</code> — ${s(
          'satunnainen tunniste, jolla lasketaan kävijämäärät ja se, mistä saavuit sivustolle. '
          + 'Voimassa vuoden. Ei sisällä nimeäsi eikä sitä jaeta kenellekään.',
          'a random identifier used to count visitors and where they arrived from. Lasts a year. '
          + 'It contains nothing about who you are and is shared with nobody.')}</li>
      </ul>
      <p>${s(
        'Koska kumpikaan eväste ei seuraa sinua muilla sivustoilla eikä tietoja luovuteta eteenpäin, '
        + 'emme kysy niistä erillistä suostumusta. Voit estää evästeet selaimesi asetuksista; '
        + 'sisäänkirjautuminen ei tällöin toimi.',
        'Because neither cookie follows you to other sites and nothing is passed on, we do not ask for '
        + 'separate consent. You can block cookies in your browser settings; logging in will not work '
        + 'if you do.')}</p>`,
    },
    {
      h: s('Oikeutesi', 'Your rights'),
      body: `<p>${s(
        'Sinulla on oikeus nähdä, oikaista ja poistaa tietosi, rajoittaa tai vastustaa käsittelyä, '
        + 'saada tietosi siirrettävässä muodossa ja perua antamasi suostumus.',
        'You can see, correct and delete your data, restrict or object to processing, receive your data '
        + 'in a portable form, and withdraw any consent you gave.')}</p>
      <p>${s(
        'Voit poistaa tilisi itse <a href="/my-bookings">Omat varaukset</a> -sivulta. Poisto tyhjentää '
        + 'nimen, sähköpostin, puhelinnumeron, osoitteen, viestit ja muistiinpanot välittömästi. '
        + 'Laskut jäävät kirjanpitoon ilman henkilötietojasi, koska laki vaatii niiden säilyttämisen.',
        'You can delete your account yourself from <a href="/my-bookings">My bookings</a>. Deleting '
        + 'clears your name, email, phone, address, messages and notes straight away. Invoices remain '
        + 'in the accounts without your personal details, because the law requires us to keep them.')}</p>
      <p>${s(
        'Muissa pyynnöissä kirjoita osoitteeseen '
        + `<a href="mailto:${esc(P.contactEmail)}">${esc(P.contactEmail)}</a>. Jos et ole tyytyväinen, `
        + 'voit tehdä valituksen tietosuojavaltuutetun toimistolle (tietosuoja.fi).',
        'For anything else write to '
        + `<a href="mailto:${esc(P.contactEmail)}">${esc(P.contactEmail)}</a>. If you are unhappy with `
        + 'how we handled it, you can complain to the Finnish Data Protection Ombudsman (tietosuoja.fi).')}</p>`,
    },
    {
      h: s('Tietoturva', 'Security'),
      body: `<p>${s(
        'Yhteys sivustolle on salattu (HTTPS). Salasanat tallennetaan vain bcrypt-tiivisteenä. '
        + 'Asiakastietoihin pääsevät vain ylläpitäjät ja valmentajat omien treeniensä osalta. '
        + 'Jos tietoturvaloukkaus koskee sinua, ilmoitamme siitä sinulle ja viranomaiselle lain '
        + 'edellyttämässä ajassa.',
        'The site is served over HTTPS. Passwords are stored only as bcrypt hashes. Customer data is '
        + 'reachable only by administrators, and by coaches for their own sessions. If a breach affects '
        + 'you we will tell you and the authorities within the time the law allows.')}</p>`,
    },
    {
      h: s('Muutokset', 'Changes'),
      body: `<p>${s(
        `Tämä seloste on päivitetty ${esc(P.updated)}. Jos muutamme sitä olennaisesti, kerromme siitä `
        + 'sivustolla tai sähköpostitse.',
        `This policy was last updated on ${esc(P.updated)}. If we change it substantially we will say so `
        + 'on the site or by email.')}</p>`,
    },
  ];
}

// The policy body, as HTML for the page shell in server/seo.js.
function renderPrivacyBody(lang) {
  const fi = lang === 'fi';
  const draftNote = isDraft() ? `<div class="privacy-draft">
    <strong>${fi ? 'Keskeneräinen' : 'Draft'}</strong> — ${fi
      ? 'rekisterinpitäjän viralliset tiedot puuttuvat vielä. Täytä ne ennen julkaisua (config.js → privacy).'
      : 'the controller’s official details are still missing. Fill them in before publishing '
        + '(config.js → privacy).'}
  </div>` : '';

  return `<section class="wrap privacy">
    <h1>${fi ? 'Tietosuojaseloste' : 'Privacy policy'}</h1>
    <p class="muted">${fi ? 'Päivitetty' : 'Last updated'} ${esc(P.updated)}</p>
    ${draftNote}
    <p class="privacy-lede">${fi
      ? 'Valmennamme nuoria pelaajia, joten suhtaudumme heidän tietoihinsa vakavasti. Tässä kerrotaan '
        + 'suoraan mitä keräämme, miksi, kenelle sitä menee ja miten saat sen pois.'
      : 'We coach young players, so we take their data seriously. This says plainly what we collect, '
        + 'why, who else sees it, and how to get it removed.'}</p>
    ${sections(lang).map((sec) => `
      <h2>${esc(sec.h)}</h2>
      ${sec.body}`).join('')}
  </section>`;
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------
// Erases the person, keeps the accounting. Invoices and completed bookings must
// survive the statutory bookkeeping period, so the user row stays but is
// stripped of everything that identifies anybody; the login is destroyed and
// the email replaced with a non-routable placeholder so the address is free to
// sign up again later.
function anonymiseCustomer(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.anonymised_at) return false;
  const stamp = nowISO();
  const placeholder = `deleted-${userId}@removed.invalid`;

  // Free-text the customer wrote about themselves or their child.
  db.prepare("UPDATE bookings SET notes = '', billing_name = '', billing_email = '', "
    + "billing_phone = '', billing_address = '', billing_postcode = '', billing_city = '' "
    + 'WHERE customer_id = ?').run(userId);
  db.prepare('DELETE FROM chat_messages WHERE sender_id = ?').run(userId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  // A public review loses its author but keeps the rating, which belongs to the
  // coach's record rather than the reviewer.
  db.prepare("UPDATE reviews SET author_name = '', body = '', customer_id = NULL WHERE customer_id = ?")
    .run(userId);
  db.prepare('DELETE FROM email_log WHERE user_id = ?').run(userId);
  // Invoices keep their number and amount for the accounts; the email goes.
  db.prepare(`UPDATE invoices SET customer_email = ?
    WHERE booking_id IN (SELECT id FROM bookings WHERE customer_id = ?)`).run(placeholder, userId);

  db.prepare(`UPDATE users SET
      name = ?, email = ?, phone = '', area = '',
      billing_address = '', billing_postcode = '', billing_city = '',
      password_hash = '', verify_code = NULL, anonymised_at = ?
    WHERE id = ?`)
    .run('Poistettu asiakas', placeholder, stamp, userId);
  return true;
}

module.exports = { renderPrivacyBody, anonymiseCustomer, isDraft };
