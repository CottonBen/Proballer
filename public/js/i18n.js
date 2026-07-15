// Tiny client-side i18n (no dependencies). Finnish is the site's default
// language; English is available from the header toggle. Everything
// user-visible lives in this dictionary — the code itself stays in English.
//
// Usage:
//   t('landing.how.title')              -> string in the current language
//   t('common.requestfailed', {status}) -> '{param}' placeholders filled in
//   I18N.server(msg)                    -> translate a server-sent string
//                                          (error messages, notifications,
//                                          config labels); returns the input
//                                          unchanged when no match / EN mode.
//   HTML:  <h2 data-i18n="landing.how.title">Näin se toimii</h2>
//          Inline text is the Finnish default; applyStatic() swaps it in EN.
//          Attribute variants: data-i18n-placeholder / -aria / -title-attr /
//          -alt / -content (for <meta>).
//
// NOTE: t() does NOT escape params — when the result goes into innerHTML,
// esc() the params at the call site (dictionary text itself is trusted).
'use strict';

const I18N_DICT = {
  // --- shared (header, helpers, toasts) -------------------------------------
  'common.login':          { fi: 'Kirjaudu sisään', en: 'Log in' },
  'common.logout':         { fi: 'Kirjaudu ulos', en: 'Log out' },
  'common.admin':          { fi: 'Ylläpito', en: 'Admin' },
  'common.mycalendar':     { fi: 'Oma kalenteri', en: 'My calendar' },
  'common.mybookings':     { fi: 'Omat varaukset', en: 'My bookings' },
  'common.cta.book':       { fi: 'Varaa treeni', en: 'Book a session' },
  'common.requestfailed':  { fi: 'Pyyntö epäonnistui ({status})', en: 'Request failed ({status})' },
  'common.loadfailed':     { fi: 'Sivun tietojen lataus epäonnistui — päivitä sivu.', en: 'Could not load the site data — please refresh.' },
  'common.noreviews':      { fi: 'Ei vielä arvosteluja', en: 'No reviews yet' },
  'common.stars.aria':     { fi: '{val} / 5 tähteä', en: '{val} out of 5 stars' },
  'common.stars.none':     { fi: 'ei vielä arvosanaa', en: 'no rating yet' },
  'common.anonymous':      { fi: 'Nimetön', en: 'Anonymous' },
  'common.weekdays':       { fi: 'su,ma,ti,ke,to,pe,la', en: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat' },
  'common.close':          { fi: 'Sulje', en: 'Close' },
  'common.password.show':  { fi: 'Näytä salasana', en: 'Show password' },
  'common.password.hide':  { fi: 'Piilota salasana', en: 'Hide password' },
  'common.password.reveal':  { fi: 'Näytä', en: 'Show' },
  'common.password.conceal': { fi: 'Piilota', en: 'Hide' },

  // --- config labels (position groups; matched by id) ------------------------
  'cfg.position.goalkeepers':  { fi: 'Maalivahdit', en: 'Goalkeepers' },
  'cfg.position.defenders':    { fi: 'Puolustajat', en: 'Defenders' },
  'cfg.position.midfielders':  { fi: 'Keskikenttäpelaajat', en: 'Midfielders' },
  'cfg.position.attackers':    { fi: 'Hyökkääjät', en: 'Attackers' },

  // --- landing page -----------------------------------------------------------
  'landing.title': {
    fi: 'Proballers Coaching — henkilökohtaista jalkapallovalmennusta nuorille pelaajille',
    en: 'Proballers Coaching — 1-on-1 football coaching for young players' },
  'landing.meta.description': {
    fi: 'Henkilökohtaista jalkapallovalmennusta nuorille pelaajille Helsingissä, Espoossa ja Vantaalla. Varaa henkilökohtainen treeni valmentajan kanssa, joka on itse pelannut.',
    en: 'Personal football coaching for young players in Helsinki, Espoo and Vantaa. Book a 1-on-1 session with a coach who has played the game.' },
  'landing.coaches.title':   { fi: 'Tutustu valmentajiin', en: 'Meet the coaches' },
  'landing.coaches.lead': {
    fi: 'Jokainen valmentaja ylläpitää omaa kalenteriaan. Valitse valmentaja, valitse vapaa aika ja rakenna treeni pelipaikkasi ja kehitystavoitteidesi ympärille.',
    en: 'Every coach sets their own calendar. Pick a coach, pick a free time, and build the session around your position and what you want to improve.' },
  'landing.how.title':       { fi: 'Näin se toimii', en: 'How it works' },
  'landing.how.step1.title': { fi: '1 · Valitse aika', en: '1 · Pick a time' },
  'landing.how.step1.body': {
    fi: 'Valitse valmentaja ja jokin hänen kalenteriinsa avaamistaan ajoista. Treenejä on joka päivä klo 8.00–20.00.',
    en: 'Choose a coach and one of the times they have opened in their calendar. Sessions run 8:00–20:00, every day.' },
  'landing.how.step2.title': { fi: '2 · Räätälöi treeni', en: '2 · Shape the session' },
  'landing.how.step2.body': {
    fi: 'Kerro pelipaikkasi — maalivahti, puolustaja, keskikenttäpelaaja tai hyökkääjä — ja valitse treenin painopiste viimeistelystä syöttöpeliin.',
    en: 'Tell us your position — goalkeeper, defender, midfielder or attacker — and pick a focus, from finishing to passing.' },
  'landing.how.step3.title': { fi: '3 · Vahvista ja treenaa', en: '3 · Confirm & train' },
  'landing.how.step3.body': {
    fi: 'Maksa varaus turvallisesti kortilla — vahvistus ja kuitti tulevat sähköpostiisi. Sitten jäljellä olette vain sinä, valmentaja ja kenttä.',
    en: 'Pay for the booking securely by card — the confirmation and receipt land in your email. Then it\'s just you, the coach and the pitch.' },
  'gate.title':              { fi: 'Tervetuloa Proballers Coachingiin', en: 'Welcome to Proballers Coaching' },
  'gate.intro':              { fi: 'Kirjaudu sisään tai luo ilmainen tili, niin pääset tutustumaan valmentajiin ja varaamaan treenejä.',
                               en: 'Sign in or create a free account to meet the coaches and book sessions.' },
  'gate.skip':               { fi: 'Jatka sivustolle ilman tiliä →', en: 'Continue to the website without an account →' },
  'landing.footer.tagline':  { fi: 'Henkilökohtaista valmennusta nuorille jalkapalloilijoille.', en: '1-on-1 coaching for young footballers.' },
  'landing.wizard.aria':     { fi: 'Varaa treeni', en: 'Book a session' },
  'landing.dots.aria':       { fi: 'Diat', en: 'Slides' },
  'landing.slide.aria':      { fi: 'Dia {n}', en: 'Slide {n}' },
  'landing.spotlight':       { fi: 'Valmentaja valokeilassa', en: 'Coach spotlight' },
  'landing.bookwith':        { fi: 'Varaa treeni — valmentajana {name}', en: 'Book a session with {name}' },
  'landing.fullprofile':     { fi: 'Koko profiili', en: 'Full profile' },
  'landing.fullprofile.arrow': { fi: 'Koko profiili →', en: 'Full profile →' },
  'landing.about.kicker':    { fi: 'Meistä', en: 'About us' },
  'landing.about.title':     { fi: 'Pelaajien rakentama,<br>seuraavalle sukupolvelle', en: 'Built by players,<br>for the next generation' },
  'landing.about.body1': {
    fi: 'Olemme suomalainen valmennuskollektiivi nuorille jalkapalloilijoille, jotka haluavat enemmän kuin kaksi joukkueharjoitusta viikossa. Valmentajamme ovat kasvaneet suomalaisissa akatemioissa ja pelaavat tai ovat pelanneet kilpatasolla — he muistavat tarkalleen, mitä kehittyminen vaatii, koska he elävät sitä itse. Jokainen treeni on 1-on-1 ja suunnitellaan pelipaikkasi, tavoitteidesi ja tahtisi mukaan kentillä Helsingissä, Espoossa ja Vantaalla.',
    en: 'We are a Finnish coaching collective for young footballers who want more than two team trainings a week. Our coaches have come up through Finnish academies and play or have played competitively — they remember exactly what it takes, because they are living it. Every session is 1-on-1, planned around your position, your goals and your pace, on pitches in Helsinki, Espoo and Vantaa.' },
  'landing.about.body2': {
    fi: 'Yksi tunti täydellä huomiolla vie pidemmälle kuin kymmenen jonossa seisten. Se on koko idea.',
    en: 'One hour with full attention on you beats ten where you wait in line. That is the whole idea.' },
  'landing.about.cta':       { fi: 'Löydä oma valmentajasi', en: 'Find your coach' },
  'landing.persession':      { fi: '/ treeni', en: '/ session' },
  'landing.readreviews':     { fi: 'Lue arvostelut', en: 'Read reviews' },
  'landing.hidereviews':     { fi: 'Piilota arvostelut', en: 'Hide reviews' },
  'landing.loadingreviews':  { fi: 'Ladataan arvosteluja…', en: 'Loading reviews…' },
  'landing.noreviews.dot':   { fi: 'Ei vielä arvosteluja.', en: 'No reviews yet.' },
  'landing.coachalt':        { fi: 'Valmentaja {name}', en: 'Coach {name}' },
  'landing.salebanner': {
    fi: '⚡ {label}: {percent} % alennus jokaisesta treenistä — huomioidaan automaattisesti varauksen yhteydessä',
    en: '⚡ {label}: {percent}% OFF every session — automatically applied at booking' },

  // --- booking wizard ---
  "booking.wizard.loading_calendar": { fi: "Ladataan kalenteria…", en: "Loading calendar…" },
  "booking.wizard.kicker": { fi: "Varaa treeni — {coach}", en: "Book {coach}" },
  "booking.step.time.title": { fi: "Valitse aika", en: "Pick a time" },
  "booking.step.position.title": { fi: "Pelipaikkasi", en: "Your position" },
  "booking.step.focus.title": { fi: "Treenin painopiste", en: "Session focus" },
  "booking.step.location.title": { fi: "Missä treenaat?", en: "Where do you train?" },
  "booking.step.confirm.title": { fi: "Vahvista varauksesi", en: "Confirm your booking" },
  "booking.nav.back": { fi: "Takaisin", en: "Back" },
  "booking.nav.continue": { fi: "Jatka", en: "Continue" },
  "booking.slots.empty": { fi: "{coach} ei ole juuri nyt avannut varattavia aikoja — kurkkaa pian uudelleen tai valitse toinen valmentaja.", en: "{coach} has not opened any bookable times right now — check back soon or pick another coach." },
  "booking.step.time.subtitle": { fi: "Kaikki ajat ovat tunnin treenejä Suomen aikaa (klo 8.00–20.00). Vain valmentajan avaamat ajat näytetään.", en: "All times are one-hour sessions, Finnish time (8:00–20:00). Only times the coach has opened are shown." },
  "booking.slots.free_count": { fi: "{count} vapaana", en: "{count} free" },
  "booking.step.position.subtitle": { fi: "{coach} valmentaa pelipaikkoja: {positions}.", en: "{coach} trains: {positions}." },
  "booking.step.position.card_desc": { fi: "Treeni räätälöity pelipaikalle: {position}", en: "Session built for {position}" },
  "booking.focus.hint.conditioning": { fi: "Moottorin rakentamista — toistospurtit, kestävyys", en: "Engine building — repeat sprints, stamina" },
  "booking.focus.hint.physicality": { fi: "Voima, kaksinkamppailut, paikan pitäminen", en: "Strength, duels, holding your ground" },
  "booking.focus.hint.agility": { fi: "Jalkatyö, käännökset, kolme ensimmäistä askelta", en: "Feet, turns, first three steps" },
  "booking.focus.hint.technical": { fi: "Kosketus, pallonhallinta, molemmat jalat", en: "Touch, control, both feet" },
  "booking.focus.hint.defending": { fi: "1v1-tilanteet, blokit, vartalon asento", en: "1v1s, blocks, body shape" },
  "booking.focus.hint.finishing": { fi: "Laukaukset, puskut, rauhallisuus boksissa", en: "Shots, headers, composure in the box" },
  "booking.focus.hint.passing": { fi: "Lyhyet ja pitkät syötöt, linjojen rikkominen", en: "Short, long, breaking lines" },
  "booking.focus.hint.game_iq": { fi: "Videotreeni — havainnointi, päätöksenteko, sijoittuminen", en: "Video session — scanning, decisions, positioning" },
  "booking.step.focus.subtitle": { fi: "Mihin tunti keskittyy?", en: "What should the hour concentrate on?" },
  "booking.focus.online_chip": { fi: "ETÄNÄ", en: "ONLINE" },
  "booking.step.location.subtitle": { fi: "{coach} valmentaa näissä kaupungeissa — valitse sinulle sopivin.", en: "{coach} coaches in these cities — pick what suits you." },
  "booking.step.location.card_desc": { fi: "Tarkka kenttä sovitaan valmentajasi kanssa", en: "Exact pitch confirmed with your coach" },
  "booking.location.online": { fi: "Etänä", en: "Online" },
  "booking.review.coach_label": { fi: "Valmentaja", en: "Coach" },
  "booking.review.time_label": { fi: "Aika", en: "Time" },
  "booking.review.position_label": { fi: "Pelipaikka", en: "Built for" },
  "booking.review.focus_label": { fi: "Painopiste", en: "Focus" },
  "booking.review.location_label": { fi: "Paikka", en: "Where" },
  "booking.review.price_label": { fi: "Hinta", en: "Price" },
  "booking.review.credit_chip": { fi: "ILMAINEN — hyvitys perutusta treenistä", en: "FREE — credit from a cancelled session" },
  "booking.review.sale_chip": { fi: "{saleLabel} −{salePercent}%", en: "{saleLabel} −{salePercent}%" },
  "booking.review.free_note": { fi: "Tämä treeni on ilmainen — treenikertasi käytetään automaattisesti, ja 0,00 €:n lasku on vain omaksi kuitiksesi.", en: "This session is free — your credit is applied automatically and the 0,00 € invoice is just for your records." },
  "booking.review.invoice_note": { fi: "Vahvistaminen luo laskun ({price}, maksuaikaa 7 päivää){delivery}. Maksutapa on {method} — tilinumero (IBAN) ja viitenumero löytyvät laskulta.", en: "Confirming issues the invoice ({price}, due in 7 days){delivery}. Payment is by {method} — the account number (IBAN) and reference are on the invoice." },
  "booking.review.invoice_note_delivery_email": { fi: ", joka lähetetään sähköpostiisi", en: " to your email" },
  "booking.review.invoice_note_delivery_mybookings": { fi: ", jonka näet Omat varaukset -sivulla", en: ", viewable in My bookings" },
  "booking.review.payment_method_fallback": { fi: "tilisiirto", en: "bank transfer" },
  "booking.review.confirm_button": { fi: "Vahvista varaus", en: "Confirm booking" },
  "booking.review.confirm_button_busy": { fi: "Varataan…", en: "Booking…" },
  "booking.toast.slot_taken": { fi: "Tuo aika ehdittiin juuri varata — valitsethan toisen ajan.", en: "That time was just taken — please pick another." },
  "booking.auth.coach_blocked": { fi: "Olet kirjautunut sisään valmentajana — varaukseen tarvitaan asiakastili. Kirjaudu ensin ulos ja varaa sitten asiakkaana.", en: "You are logged in as a coach — bookings need a customer account. Log out first, then book as a customer." },
  "booking.auth.tab_login": { fi: "Minulla on tili", en: "I have an account" },
  "booking.auth.tab_signup": { fi: "Olen uusi täällä", en: "I'm new here" },
  "booking.auth.name_label": { fi: "Pelaajan / huoltajan nimi", en: "Player / parent name" },
  "common.form.email": { fi: "Sähköposti", en: "Email" },
  "common.form.password": { fi: "Salasana", en: "Password" },
  "booking.auth.submit_login": { fi: "Kirjaudu sisään ja jatka", en: "Log in & continue" },
  "booking.auth.submit_signup": { fi: "Luo tili ja jatka", en: "Create account & continue" },
  "booking.auth.staff_error": { fi: "Tämä tili on henkilökunnan tili — varaathan asiakastilillä.", en: "This account is a staff account — please use a customer account to book." },
  "booking.success.title": { fi: "Treeni varattu!", en: "You're booked!" },
  "booking.success.reference": { fi: "Varaustunnus {code}", en: "Booking reference {code}" },
  "booking.success.invoice_label": { fi: "Lasku", en: "Invoice" },
  "booking.success.amount_label": { fi: "Summa", en: "Amount" },
  "booking.success.credit_chip": { fi: "ILMAINEN — treenikerta käytetty", en: "FREE — credit used" },
  "booking.success.due_label": { fi: "Eräpäivä", en: "Due" },
  "booking.success.invoice_emailed": { fi: "Lasku on lähetetty sähköpostiisi.", en: "The invoice has been sent to your email." },
  "booking.success.invoice_ready": { fi: "Laskusi on katsottavissa alla.", en: "Your invoice is ready to view below." },
  "booking.success.payment_note": { fi: "Maksa tilisiirrolla — IBAN ja viitenumero ovat laskulla. Voit avata laskun milloin tahansa sivulta {myBookingsLink}.", en: "Pay by bank transfer — the IBAN and payment reference are on the invoice. You can open it any time from {myBookingsLink}." },
  "booking.success.view_invoice": { fi: "Näytä lasku", en: "View invoice" },
  "common.nav.my_bookings": { fi: "Omat varaukset", en: "My bookings" },

  // --- login / signup ---
  "login.title": { fi: "Kirjaudu sisään — Proballers Coaching", en: "Log in — Proballers Coaching" },
  "common.brand": { fi: "Proballers Coaching", en: "Proballers Coaching" },
  "login.heading": { fi: "Tervetuloa takaisin", en: "Welcome back" },
  "login.intro": { fi: "Yksi ovi kaikille — pelaajille, valmentajille ja ylläpidolle. Päädyt suoraan omalle sivullesi.", en: "One door for everyone — players, coaches and admin. You'll land on your own page." },
  "login.action.login": { fi: "Kirjaudu sisään", en: "Log in" },
  "login.action.signup": { fi: "Luo tili", en: "Create account" },
  "login.form.name": { fi: "Pelaajan / huoltajan nimi", en: "Player / parent name" },
  "login.form.phone": { fi: "Puhelinnumero (valinnainen)", en: "Phone number (optional)" },
  "login.form.email": { fi: "Sähköposti", en: "Email" },
  "login.form.password": { fi: "Salasana", en: "Password" },
  "login.signup.note": { fi: "Uusille pelaajille: tilin luominen vie kymmenen sekuntia, ja sen jälkeen voit varata treenejä ja nähdä laskusi.", en: "New players: creating an account takes ten seconds and lets you book sessions and see your invoices." },

  // --- customer dashboard ---
  "mybookings.title": { fi: "Omat varaukset — Proballers Coaching", en: "My bookings — Proballers Coaching" },
  "mybookings.heading": { fi: "Omat varaukset", en: "My bookings" },
  "mybookings.subtitle": { fi: "Treenisi ja laskusi, kaikki yhdessä paikassa.", en: "Your sessions and invoices, all in one place." },
  "mybookings.book_another": { fi: "Varaa uusi treeni", en: "Book another session" },
  "mybookings.empty": { fi: "Ei vielä varauksia — valitse valmentaja ja hyppää kentälle.", en: "No bookings yet — pick a coach and get on the pitch." },
  "mybookings.credit.banner": { fi: "Sinulla on {count} ilmaista treenikertaa!", en: "You have {count} free sessions!" },
  "mybookings.credit.hint": { fi: "Varaa treeni kenen tahansa valmentajan kanssa — hinta on automaattisesti 0,00 €.", en: "Book any coach — the price will be 0,00 € automatically." },
  "mybookings.credit.use_now": { fi: "Käytä se nyt", en: "Use it now" },
  "mybookings.notifications.title": { fi: "Mitä uutta", en: "What's new" },
  "mybookings.table.ref": { fi: "Tunnus", en: "Ref" },
  "mybookings.table.when": { fi: "Aika", en: "When" },
  "mybookings.table.coach": { fi: "Valmentaja", en: "Coach" },
  "mybookings.table.session": { fi: "Treeni", en: "Session" },
  "mybookings.table.where": { fi: "Paikka", en: "Where" },
  "mybookings.table.total": { fi: "Yhteensä", en: "Total" },
  "mybookings.table.status": { fi: "Tila", en: "Status" },
  "mybookings.table.invoice": { fi: "Lasku", en: "Invoice" },
  "mybookings.table.online": { fi: "Etänä", en: "Online" },
  "common.status.confirmed": { fi: "vahvistettu", en: "confirmed" },
  "common.status.completed": { fi: "pidetty", en: "completed" },
  "common.status.cancelled": { fi: "peruttu", en: "cancelled" },
  "common.position.goalkeeper": { fi: "maalivahti", en: "goalkeeper" },
  "common.position.defender": { fi: "puolustaja", en: "defender" },
  "common.position.midfielder": { fi: "keskikenttäpelaaja", en: "midfielder" },
  "common.position.attacker": { fi: "hyökkääjä", en: "attacker" },
  "mybookings.reviews.rating_label": { fi: "Arvosana", en: "Rating" },
  "mybookings.reviews.stars_title": { fi: "{n} tähteä", en: "{n} stars" },
  "mybookings.reviews.placeholder": { fi: "Millaisia treenit olivat? (valinnainen)", en: "How were the sessions? (optional)" },
  "mybookings.reviews.submit": { fi: "Julkaise arvostelu", en: "Post review" },
  "mybookings.reviews.mine_title": { fi: "Arvostelusi", en: "Your reviews" },
  "mybookings.reviews.title": { fi: "Arvostelut", en: "Reviews" },
  "mybookings.reviews.prompt": { fi: "Arvostele valmentajat, joiden kanssa olet treenannut — se auttaa muita pelaajia valitsemaan.", en: "Rate the coaches you’ve trained with — it helps other players choose." },
  "mybookings.reviews.empty_hint": { fi: "Kun treenisi on pidetty, voit arvostella valmentajasi täällä.", en: "Once you’ve completed a session you can review your coach here." },
  "mybookings.reviews.pick_rating": { fi: "Valitse ensin tähtiarvosana.", en: "Please pick a star rating first." },
  "mybookings.reviews.posted": { fi: "Kiitos — arvostelusi on julkaistu!", en: "Thanks — your review is posted!" },

  // --- coach profile + 404 ---
  "profile.title": { fi: "Valmentaja — Proballers Coaching", en: "Coach — Proballers Coaching" },
  "profile.meta.description": { fi: "Valmentajaprofiili — varaa henkilökohtainen jalkapallotreeni.", en: "Coach profile — book a 1-on-1 football session." },
  "common.brand.header": { fi: "Proballers Coaching", en: "Proballers Coaching" },
  "profile.loading": { fi: "Ladataan valmentajaa…", en: "Loading coach…" },
  "common.footer.brand": { fi: "Proballers Coaching", en: "Proballers Coaching" },
  "common.footer.cities": { fi: "Helsinki · Espoo · Vantaa", en: "Helsinki · Espoo · Vantaa" },
  "common.footer.tagline": { fi: "Henkilökohtaista valmennusta nuorille jalkapalloilijoille.", en: "1-on-1 coaching for young footballers." },
  "booking.wizard.arialabel": { fi: "Varaa treeni", en: "Book a session" },
  "profile.price.persession": { fi: "/ treeni", en: "/ session" },
  "profile.price.salechip": { fi: "{saleLabel} −{salePercent}%", en: "{saleLabel} −{salePercent}%" },
  "profile.doctitle": { fi: "{coachName} — Proballers Coaching", en: "{coachName} — Proballers Coaching" },
  "profile.gallery.mainalt": { fi: "Valmentaja {coachName}", en: "Coach {coachName}" },
  "profile.back": { fi: "← Kaikki valmentajat", en: "← All coaches" },
  "profile.kicker": { fi: "Valmentajaprofiili", en: "Coach profile" },
  "profile.cta.book": { fi: "Varaa treeni — valmentajana {firstName}", en: "Book a session with {firstName}" },
  "profile.cta.hint": { fi: "Valitse seuraavassa vaiheessa jokin vapaista ajoista, jotka {firstName} on avannut — treenejä on joka päivä klo 8.00–20.00.", en: "Pick one of {firstName}'s free times in the next step — sessions run 8:00–20:00, every day." },
  "profile.reviews.heading": { fi: "Arvostelut", en: "Reviews" },
  "profile.reviews.empty": { fi: "Ei vielä arvosteluja — kirjoita ensimmäinen treenisi jälkeen.", en: "No reviews yet — be the first after your session." },
  "profile.notfound.heading": { fi: "Valmentajaa ei löytynyt", en: "Coach not found" },
  "profile.notfound.body": { fi: "Tätä profiilia ei ole (enää) olemassa.", en: "That profile doesn't exist (any more)." },
  "profile.notfound.cta": { fi: "Katso kaikki valmentajat", en: "See all coaches" },
  "common.salebanner": { fi: "⚡ {saleLabel}: {salePercent} % alennus jokaisesta treenistä — huomioidaan automaattisesti varauksen yhteydessä", en: "⚡ {saleLabel}: {salePercent}% OFF every session — automatically applied at booking" },
  "profile.error.load": { fi: "Valmentajan tietoja ei voitu ladata — päivitä sivu.", en: "Could not load this coach — please refresh." },
  "notfound.title": { fi: "Pallo hukassa — Proballers Coaching", en: "Lost the ball — Proballers Coaching" },
  "notfound.heading": { fi: "Ohi meni", en: "Off target" },
  "notfound.body": { fi: "Tätä sivua ei ole olemassa — mutta kenttä on ihan tässä vieressä.", en: "That page doesn't exist — but the pitch is right over here." },
  "notfound.cta": { fi: "Takaisin sivustolle", en: "Back to the site" },

  // --- shared (from extraction) ---
  "common.price": { fi: "{amount} €", en: "{amount} €" },

  // --- customer dashboard (fragments) ---
  "mybookings.empty.before": { fi: "Ei vielä varauksia — ", en: "No bookings yet — " },
  "mybookings.empty.link": { fi: "valitse valmentaja", en: "pick a coach" },
  "mybookings.empty.after": { fi: " ja hyppää kentälle.", en: " and get on the pitch." },

  // --- coach dashboard ---
  "coachdash.title": { fi: "Oma kalenteri — Proballers Coaching", en: "Coach dashboard — Proballers Coaching" },
  "coachdash.heading": { fi: "Valmentaja", en: "Coach" },
  "coachdash.subtitle": { fi: "Oma kalenteri, omat säännöt — pelaajat voivat varata vain aikoja, jotka olet avannut.", en: "Your calendar, your rules — players can only book times you open." },
  "coachdash.cal.title": { fi: "Vapaat ajat", en: "Availability" },
  "coachdash.cal.prev": { fi: "‹ Edellinen", en: "‹ Prev" },
  "coachdash.cal.next": { fi: "Seuraava ›", en: "Next ›" },
  "coachdash.cal.save": { fi: "Tallenna muutokset", en: "Save changes" },
  "coachdash.cal.save_n": { fi: "Tallenna muutokset ({n})", en: "Save changes ({n})" },
  "coachdash.cal.saving": { fi: "Tallennetaan…", en: "Saving…" },
  "coachdash.cal.help1": { fi: "Klikkaa tunteja merkitäksesi itsesi vapaaksi (klo 8.00–20.00). Mikään tunti", en: "Click hours to mark yourself free (8:00–20:00). Every hour is treated as" },
  "coachdash.cal.help.notavail": { fi: "ei ole varattavissa", en: "not available" },
  "coachdash.cal.help2": { fi: ", ennen kuin avaat sen. Muutokset tulevat voimaan vasta, kun painat", en: " until you open it. Changes only apply after you press" },
  "coachdash.cal.help3": { fi: " -painiketta.", en: "." },
  "coachdash.cal.confirm_discard": { fi: "Tällä viikolla on tallentamattomia muutoksia vapaisiin aikoihin. Hylätäänkö ne?", en: "You have unsaved availability changes on this week. Discard them?" },
  "coachdash.cal.saved": { fi: "Tallennettu — {added} avattu, {removed} suljettu.", en: "Saved — {added} opened, {removed} closed." },
  "coachdash.cal.saved_conflicts": { fi: "{n} ei voitu sulkea (jo varattu).", en: "{n} could not be closed (already booked)." },
  "coachdash.cal.saved_rejected": { fi: "{n} ohitettiin (mennyt aika tai sallitun alueen ulkopuolella).", en: "{n} skipped (past or out of range)." },
  "coachdash.legend.notavailable": { fi: "Ei varattavissa", en: "Not available" },
  "coachdash.legend.available": { fi: "Varattavissa", en: "Available" },
  "coachdash.legend.booked": { fi: "Varattu", en: "Booked" },
  "coachdash.legend.unsaved": { fi: "Tallentamaton muutos", en: "Unsaved change" },
  "coachdash.loading": { fi: "Ladataan…", en: "Loading…" },
  "coachdash.err.backadmin": { fi: " — <a href=\"/admin\">takaisin ylläpitoon</a>.", en: " — <a href=\"/admin\">back to the admin page</a>." },
  "coachdash.tier.title": { fi: "Oma taso ja ansiot", en: "My tier & earnings" },
  "coachdash.tier.name": { fi: "Taso {n}", en: "Tier {n}" },
  "coachdash.tier.progress_one": { fi: "Vielä {n} pidetty treeni, niin {next} aukeaa", en: "{n} more completed session and you move up to {next}" },
  "coachdash.tier.progress_many": { fi: "Vielä {n} pidettyä treeniä, niin {next} aukeaa", en: "{n} more completed sessions and you move up to {next}" },
  "coachdash.tier.top": { fi: "Korkein taso — suurimmat ansiot per treeni 🏆", en: "Top tier — maximum earnings per session 🏆" },
  "coachdash.tier.month_count_one": { fi: "{n} pidetty treeni {month}ssa", en: "{n} session completed in {month}" },
  "coachdash.tier.month_count_many": { fi: "{n} pidettyä treeniä {month}ssa", en: "{n} sessions completed in {month}" },
  "coachdash.tier.earn_onpitch": { fi: "Ansaitset kenttätreenistä", en: "You earn per on-pitch session" },
  "coachdash.tier.earn_online": { fi: "Ansaitset etätreenistä", en: "You earn per online session" },
  "coachdash.tier.earned_month": { fi: "Ansaittu {month}ssa", en: "Earned in {month}" },
  "coachdash.tier.all": { fi: "Kaikki tasot", en: "All tiers" },
  "coachdash.tier.per_session": { fi: "Per treeni:", en: "Per session:" },
  "coachdash.tier.onpitch": { fi: "kentällä", en: "on-pitch" },
  "coachdash.tier.online": { fi: "etänä", en: "online" },
  "coachdash.filters.title": { fi: "Omat suodattimet", en: "My filters" },
  "coachdash.filters.intro": { fi: "Missä treenaat ja mitä pelipaikkoja valmennat. Pelaajat näkevät vain näihin sopivat vaihtoehdot.", en: "Where you train and which positions you coach. Players only see options that match these." },
  "coachdash.filters.cities": { fi: "Kaupungit", en: "Cities" },
  "coachdash.filters.positions": { fi: "Valmentamani pelipaikat", en: "Positions I train" },
  "coachdash.filters.save": { fi: "Tallenna suodattimet", en: "Save filters" },
  "coachdash.filters.saved": { fi: "Suodattimet tallennettu — pelaajat näkevät nyt päivitetyt vaihtoehtosi.", en: "Filters saved — players now see your updated options." },
  "coachdash.clients.title": { fi: "Omat asiakkaat", en: "My clients" },
  "coachdash.clients.intro": { fi: "Varatut treenisi ja kenen kanssa ne ovat. Peruminen lähettää asiakkaalle ilmoituksen ja tekee hänen seuraavasta varauksestaan ilmaisen.", en: "Your booked sessions and who they're with. Cancelling notifies the client and makes their next booking free." },
  "coachdash.clients.empty": { fi: "Ei vielä varattuja treenejä.", en: "No sessions booked yet." },
  "coachdash.clients.upcoming": { fi: "Tulevat treenit ({n})", en: "Upcoming clients ({n})" },
  "coachdash.clients.none_upcoming": { fi: "Ei tulevia treenejä.", en: "Nothing upcoming." },
  "coachdash.clients.past": { fi: "Menneet ja perutut ({n})", en: "Past & cancelled ({n})" },
  "coachdash.clients.lock_future": { fi: "Käytettävissä, kun treeni on pidetty", en: "Available after the session has taken place" },
  "coachdash.clients.pays": { fi: "asiakas maksaa {amount}", en: "client pays {amount}" },
  "coachdash.clients.pays_credit": { fi: "asiakas maksaa 0 € (ilmainen treenikerta)", en: "client pays 0 € (credit)" },
  "coachdash.clients.earn": { fi: "Ansaitset {amount}", en: "You earn {amount}" },
  "coachdash.clients.earn_estimate": { fi: "(arvio — lopullinen summa vahvistuu, kun treeni on pidetty)", en: "(estimate — final amount set when the session is completed)" },
  "coachdash.clients.confirm_cancel": { fi: "Perutaanko tämä treeni? Asiakkaalle ilmoitetaan, ja hänen seuraava varauksensa kenen tahansa valmentajan kanssa on ILMAINEN.", en: "Cancel this session? The client will be notified and their next booking with any coach will be FREE." },
  "coachdash.clients.cancelled_toast": { fi: "Treeni peruttu — asiakkaalle on ilmoitettu ja hän sai ilmaisen treenikerran.", en: "Session cancelled — the client has been notified and got a free-session credit." },
  "coachdash.clients.marked": { fi: "Merkitty: {status}.", en: "Marked as {status}." },
  "coachdash.status.current": { fi: "vahvistettu", en: "current" },
  "coachdash.reviews.title": { fi: "Omat arvostelut", en: "My reviews" },
  "coachdash.reviews.intro": { fi: "Mitä pelaajat ja huoltajat sanovat treeneistäsi.", en: "What players and parents say about your sessions." },
  "coachdash.reviews.empty": { fi: "Ei vielä arvosteluja — ne ilmestyvät tähän, kun asiakkaasi jättävät ensimmäisen.", en: "No reviews yet — they’ll appear here once your clients leave one." },

  // --- coach mobile app (/app) ---
  "app.title": { fi: "Valmentajasovellus — Proballers Coaching", en: "Coach app — Proballers Coaching" },
  "app.brand": { fi: "PROBALLERS", en: "PROBALLERS" },
  "app.greeting": { fi: "Hei, {name} 👋", en: "Hey, {name} 👋" },
  "app.loading": { fi: "Ladataan…", en: "Loading…" },
  "app.error": { fi: "Tietojen lataus epäonnistui. Vedä alas päivittääksesi.", en: "Couldn’t load your data. Pull down to retry." },
  "app.notcoach.title": { fi: "Vain valmentajille", en: "Coaches only" },
  "app.notcoach.body": { fi: "Tämä sovellus on Proballers-valmentajille. Kirjaudu sisään valmentajatunnuksillasi.", en: "This app is for Proballers coaches. Sign in with your coach account." },
  "app.notcoach.login": { fi: "Kirjaudu sisään", en: "Log in" },
  // nav
  "app.nav.home": { fi: "Koti", en: "Home" },
  "app.nav.sessions": { fi: "Treenit", en: "Sessions" },
  "app.nav.calendar": { fi: "Kalenteri", en: "Calendar" },
  "app.nav.alerts": { fi: "Ilmoitukset", en: "Alerts" },
  "app.nav.profile": { fi: "Profiili", en: "Profile" },
  // stats
  "app.stat.upcoming": { fi: "Tulevat", en: "Upcoming" },
  "app.stat.completed": { fi: "Pidetyt", en: "Completed" },
  "app.stat.cancelled": { fi: "Perutut", en: "Cancelled" },
  // home
  "app.home.upcoming_title": { fi: "Tulevat treenit", en: "Upcoming sessions" },
  "app.home.upcoming_empty": { fi: "Ei tulevia treenejä", en: "No upcoming sessions" },
  "app.home.upcoming_empty_sub": { fi: "Uudet varaukset ilmestyvät tänne", en: "New bookings will appear here" },
  "app.home.seeall": { fi: "Näytä kaikki treenit →", en: "See all sessions →" },
  // sessions
  "app.sessions.title": { fi: "Treenit", en: "Sessions" },
  "app.sessions.empty": { fi: "Ei treenejä täällä", en: "No sessions here" },
  "app.session.earn": { fi: "Ansaitset {amount}", en: "You earn {amount}" },
  "app.session.earn_est": { fi: "Ansaitset n. {amount}", en: "You earn ~{amount}" },
  "app.session.online": { fi: "Etätreeni", en: "Online session" },
  "app.session.mark_done": { fi: "Merkitse pidetyksi", en: "Mark completed" },
  "app.session.cancel": { fi: "Peru treeni", en: "Cancel session" },
  "app.session.cancel_confirm": { fi: "Perutaanko tämä treeni? Asiakkaalle ilmoitetaan ja hän saa ilmaisen treenikerran.", en: "Cancel this session? The client is notified and gets a free-session credit." },
  "app.session.done_future": { fi: "Voit merkitä pidetyksi vasta, kun treeni on ollut.", en: "You can mark it completed once the session has taken place." },
  "app.session.done_toast": { fi: "Merkitty pidetyksi.", en: "Marked as completed." },
  "app.session.cancel_toast": { fi: "Treeni peruttu — asiakkaalle ilmoitettu.", en: "Session cancelled — the client has been notified." },
  // calendar
  "app.calendar.no_sessions": { fi: "Ei treenejä tänä päivänä", en: "No sessions on this day" },
  "app.calendar.legend": { fi: "Vihreä piste = treeni", en: "Green dot = a session" },
  // alerts
  "app.alerts.title": { fi: "Ilmoitukset", en: "Notifications" },
  "app.alerts.unread": { fi: "{n} lukematta", en: "{n} unread" },
  "app.alerts.markall": { fi: "Merkitse kaikki luetuiksi", en: "Mark all read" },
  "app.alerts.empty": { fi: "Ei ilmoituksia vielä", en: "No notifications yet" },
  "app.alerts.view": { fi: "Näytä treenit →", en: "View sessions →" },
  // profile
  "app.profile.stats": { fi: "Treenitilastot", en: "Session stats" },
  "app.profile.tier_title": { fi: "Taso ja ansiot", en: "Tier & earnings" },
  "app.profile.tier": { fi: "Taso {n}", en: "Tier {n}" },
  "app.profile.earned_month": { fi: "Ansaittu {month}", en: "Earned in {month}" },
  "app.profile.per_session": { fi: "{amount} / treeni", en: "{amount} / session" },
  "app.profile.manage": { fi: "Hallitse kalenteria ja vapaita aikoja", en: "Manage calendar & availability" },
  "app.profile.website": { fi: "Proballers-verkkosivusto", en: "Proballers website" },
  "app.profile.logout": { fi: "Kirjaudu ulos", en: "Log out" },
  "app.nav.chats": { fi: "Viestit", en: "Chats" },

  // --- booking wizard: additional notes step ---
  "booking.step.notes.title": { fi: "Lisätiedot", en: "Additional notes" },
  "booking.step.notes.subtitle": { fi: "Haluatko kertoa valmentajalle jotain etukäteen? (valinnainen)", en: "Anything you want the coach to know beforehand? (optional)" },
  "booking.step.notes.placeholder": { fi: "Esim. tavoitteet, loukkaantumiset, toiveet treenin sisällöstä…", en: "E.g. goals, injuries, wishes for the session…" },
  "booking.step.notes.hint": { fi: "Viesti välitetään valmentajallesi keskusteluun, joka avautuu varauksen yhteydessä.", en: "This is passed to your coach in the chat that opens with your booking." },
  "booking.review.notes_label": { fi: "Lisätiedot", en: "Notes" },

  // --- card payments (Stripe) ---
  "booking.review.pay_note": { fi: "Vahvistamisen jälkeen siirryt suoraan turvalliseen korttimaksuun ({price}). Varaus on voimassa, kun maksu on suoritettu — saat kuitin sähköpostiisi.", en: "After confirming you go straight to secure card payment ({price}). The booking is final once the payment completes — a receipt lands in your email." },
  "booking.success.redirecting_title": { fi: "Siirrytään maksuun", en: "Moving to payment" },
  "booking.success.redirecting": { fi: "Ohjaamme sinut turvalliseen korttimaksuun. Jos mitään ei tapahdu, paina alla olevaa painiketta.", en: "We are taking you to secure card payment. If nothing happens, press the button below." },
  "booking.success.paybtn": { fi: "Siirry maksuun", en: "Move to payment" },
  "pay.deadline": { fi: "Maksa viimeistään {deadline}, tai varaus peruuntuu", en: "Pay by {deadline} or the booking is cancelled" },
  "pay.refund_pending": { fi: "Maksusi ehti perille vasta varauksen peruunnuttua, eikä varausta voitu enää palauttaa. Palautamme maksun sinulle — otamme yhteyttä.", en: "Your payment arrived after the booking had already been cancelled and it could not be restored. We will refund the payment and be in touch." },
  "pay.card": { fi: "Maksa kortilla", en: "Pay by card" },
  "pay.now": { fi: "Maksa nyt kortilla", en: "Pay now by card" },
  "pay.received": { fi: "Maksu vastaanotettu — kiitos! Lasku on merkitty maksetuksi.", en: "Payment received — thank you! The invoice is marked paid." },
  "pay.pending": { fi: "Maksu käsitellään — lasku päivittyy hetken kuluttua.", en: "Payment is processing — the invoice updates shortly." },
  "pay.cancelled": { fi: "Maksua ei suoritettu.", en: "The payment was not completed." },

  // --- chat ---
  "chat.title": { fi: "Viestit — Proballers Coaching", en: "Chats — Proballers Coaching" },
  "chat.heading": { fi: "Viestit", en: "Chats" },
  "chat.subtitle": { fi: "Keskustelut valmentajan ja pelaajan välillä — avautuu jokaisesta varauksesta.", en: "Conversations between coach and player — one opens with every booking." },
  "chat.nav": { fi: "Viestit", en: "Chats" },
  "chat.empty": { fi: "Ei vielä keskusteluja — ne avautuvat automaattisesti, kun treeni varataan.", en: "No conversations yet — one opens automatically when a session is booked." },
  "chat.empty_thread": { fi: "Valitse keskustelu", en: "Pick a conversation" },
  "chat.send": { fi: "Lähetä", en: "Send" },
  "chat.input_placeholder": { fi: "Kirjoita viesti…", en: "Write a message…" },
  "chat.back": { fi: "‹ Takaisin", en: "‹ Back" },
  "chat.with_coach": { fi: "Valmentaja {name}", en: "Coach {name}" },
  "chat.admin_view": { fi: "Näet ylläpitäjänä kaikki keskustelut.", en: "As an admin you see every conversation." },
  "chat.admin_badge": { fi: "ylläpito", en: "admin" },
  "chat.coach_badge": { fi: "valmentaja", en: "coach" },
  "chat.system_booking": { fi: "Uusi varaus", en: "New booking" },
  "chat.system_pitch": { fi: "Kenttä valittu", en: "Pitch picked" },
  "chat.loading": { fi: "Ladataan…", en: "Loading…" },

  // --- admin dashboard ---
  "admin.title": { fi: "Ylläpito — Proballers Coaching", en: "Admin — Proballers Coaching" },
  "admin.heading": { fi: "Komentokeskus", en: "Mission control" },
  "admin.subtitle": { fi: "Koko liiketoiminta, reaaliajassa.", en: "Everything about the business, live." },
  "admin.subtitle.updated": { fi: "Koko liiketoiminta, reaaliajassa · päivitetty {time}", en: "Everything about the business, live · updated {time}" },
  "admin.window.d7": { fi: "7 päivää", en: "7 days" },
  "admin.window.d30": { fi: "30 päivää", en: "30 days" },
  "admin.window.d90": { fi: "90 päivää", en: "90 days" },
  "admin.window.all": { fi: "Koko aika", en: "All time" },
  "admin.window.label.d7": { fi: "viimeiset 7 päivää", en: "past 7 days" },
  "admin.window.label.d30": { fi: "viimeiset 30 päivää", en: "past 30 days" },
  "admin.window.label.d90": { fi: "viimeiset 90 päivää", en: "past 90 days" },
  "admin.window.label.all": { fi: "koko ajalta", en: "all time" },
  "admin.demo.loaded": { fi: "Demodata on ladattu.", en: "Demo data is loaded." },
  "admin.demo.note": { fi: "Alla olevissa luvuissa on mukana generoitua esimerkkidataa, jotta näet, miten kaikki toimii. Kun siirryt tuotantoon, paina", en: "The numbers below include generated example data so you can see how everything works. When you go live, press" },
  "admin.demo.remove": { fi: "Poista demodata", en: "Remove demo data" },
  "admin.demo.remove.confirm": { fi: "Poistetaanko KAIKKI demodata (esimerkkivalmentajat, varaukset, käynnit)? Oikeat tilisi säilyvät.", en: "Remove ALL demo data (example coaches, bookings, visits)? Your real accounts stay." },
  "admin.demo.removed": { fi: "Demodata poistettu — näet nyt vain todellisen toiminnan.", en: "Demo data removed — dashboard now shows only real activity." },
  "admin.stats.minirow": { fi: "7 pv {d7} · 30 pv {d30} · 90 pv {d90} · kaikki {all}", en: "7d {d7} · 30d {d30} · 90d {d90} · all {all}" },
  "admin.stats.visitors": { fi: "Yksittäiset kävijät", en: "Unique visitors" },
  "admin.stats.pageviews": { fi: "Sivunäytöt", en: "Page views" },
  "admin.stats.pending": { fi: "Varattu, ei vielä pidetty", en: "Booked, not completed" },
  "admin.stats.pending.sub": { fi: "tulevia treenejä arvoltaan {amount}", en: "upcoming sessions worth {amount}" },
  "admin.stats.completed": { fi: "Pidetyt treenit", en: "Completed sessions" },
  "admin.stats.conversion": { fi: "Varauskonversio", en: "Booking conversion" },
  "admin.stats.conversion.sub": { fi: "{completed} varasi {started} yrittäneestä ({window})", en: "{completed} booked of {started} who tried ({window})" },
  "admin.stats.revenue": { fi: "Liikevaihto (pidetyt)", en: "Revenue (completed)" },
  "admin.stats.newcustomers": { fi: "Uudet asiakkaat", en: "New customers" },
  "admin.stats.newcustomers.sub": { fi: "{count} asiakastiliä yhteensä", en: "{count} customer accounts in total" },
  "admin.stats.outstanding": { fi: "Avoimet laskut", en: "Invoices outstanding" },
  "admin.stats.outstanding.sub": { fi: "{amount} jo maksettu", en: "{amount} already paid" },
  "admin.percent": { fi: "{pct} %", en: "{pct}%" },
  "admin.chart.peak": { fi: "huippu {max}", en: "peak {max}" },
  "admin.chart.visitors.title": { fi: "Kävijät — viimeiset 90 päivää", en: "Visitors — last 90 days" },
  "admin.chart.visitors.legend": { fi: "sivunäyttöjä päivässä", en: "page views per day" },
  "admin.chart.sessions.title": { fi: "Pidetyt treenit", en: "Sessions completed" },
  "admin.chart.sessions.legend": { fi: "treenejä päivässä", en: "sessions per day" },
  "admin.chart.funnel.title": { fi: "Varausputki", en: "Booking funnel" },
  "admin.chart.funnel.started": { fi: "aloitti varauksen", en: "started booking" },
  "admin.chart.funnel.finished": { fi: "viimeisteli varauksen", en: "finished booking" },
  "admin.coaches.heading": { fi: "Miten valmentajilla menee", en: "How the coaches are doing" },
  "admin.coaches.add": { fi: "+ Lisää valmentaja", en: "+ Add coach" },
  "admin.coaches.hint.before": { fi: "Klikkaa valmentajan nimeä, niin näet hänen ajantasaisen kalenterinsa — ", en: "Click a coach's name to see their live calendar, or " },
  "admin.coaches.hint.manage": { fi: "Muokkaa", en: "Manage" },
  "admin.coaches.hint.after": { fi: "-painikkeesta pääset muokkaamaan kuvia, biota, kaupunkeja ja pelipaikkoja sekä kirjautumistietoja.", en: " to edit their photos, bio, cities/positions and login." },
  "admin.coachtable.trains": { fi: "Valmentaa", en: "Trains" },
  "admin.coachtable.cities": { fi: "Kaupungit", en: "Cities" },
  "admin.coachtable.completed": { fi: "Pidetyt", en: "Completed" },
  "admin.coachtable.completed.sub": { fi: "7 / 30 / 90 / kaikki", en: "7 / 30 / 90 / all" },
  "admin.coachtable.upcoming": { fi: "Tulevat", en: "Upcoming" },
  "admin.coachtable.openslots": { fi: "Avoimet ajat", en: "Open slots" },
  "admin.coachtable.openslots.sub": { fi: "seur. 14 pv", en: "next 14 d" },
  "admin.coachtable.utilization": { fi: "Käyttöaste", en: "Utilization" },
  "admin.coachtable.tier": { fi: "Taso", en: "Tier" },
  "admin.coachtable.thismonth": { fi: "tässä kuussa", en: "this month" },
  "admin.coachtable.payout": { fi: "Valmentajan palkkio", en: "Coach payout" },
  "admin.coachtable.earned": { fi: "Tuotto", en: "Earned" },
  "admin.coachtable.earned.sub": { fi: "pidetyt", en: "completed" },
  "admin.coachtable.bookedvalue": { fi: "Varausten arvo", en: "Booked value" },
  "admin.coachtable.bookedvalue.sub": { fi: "sis. tulevat", en: "incl. upcoming" },
  "admin.coachtable.noslots": { fi: "ei aikoja", en: "no slots" },
  "admin.coachtable.tier.title": { fi: "{count} treeniä tässä kuussa", en: "{count} sessions this month" },
  "admin.coachtable.calendar": { fi: "Kalenteri", en: "Calendar" },
  "admin.coachtable.manage": { fi: "Muokkaa", en: "Manage" },
  "admin.bookings.heading": { fi: "Varaukset", en: "Bookings" },
  "admin.filter.all": { fi: "Kaikki", en: "All" },
  "admin.bookings.filter.upcoming": { fi: "Tulevat", en: "Upcoming" },
  "admin.bookings.filter.completed": { fi: "Pidetyt", en: "Completed" },
  "admin.bookings.filter.cancelled": { fi: "Perutut", en: "Cancelled" },
  "admin.table.customer": { fi: "Asiakas", en: "Customer" },
  "admin.bookings.done": { fi: "Pidetty", en: "Done" },
  "admin.bookings.done.disabled": { fi: "Käytettävissä, kun treeni on pidetty", en: "Available after the session has taken place" },
  "admin.bookings.cancel": { fi: "Peru", en: "Cancel" },
  "admin.bookings.cancel.confirm": { fi: "Perutaanko tämä varaus? Lasku mitätöidään ja asiakas saa ilmaisen treenikerran.", en: "Cancel this booking? The invoice will be voided and the customer gets a free-session credit." },
  "admin.bookings.updated": { fi: "Varaus päivitetty.", en: "Booking updated." },
  "admin.invoices.markpaid": { fi: "Merkitse maksetuksi", en: "Mark paid" },
  "admin.invoices.paid.toast": { fi: "Lasku merkitty maksetuksi.", en: "Invoice marked as paid." },
  "admin.invoicestatus.sent": { fi: "maksamatta", en: "sent" },
  "admin.invoicestatus.paid": { fi: "maksettu", en: "paid" },
  "admin.invoicestatus.void": { fi: "mitätöity", en: "void" },
  "admin.crm.heading": { fi: "Asiakkaat — CRM", en: "Customers — CRM" },
  "admin.crm.sub": { fi: "Kenellä on tili, paljonko varauksia on tehty ja mitä on maksettu.", en: "Who has an account, how much they've booked, and what's been paid." },
  "admin.crm.empty": { fi: "Ei vielä asiakastilejä — ne ilmestyvät tänne heti, kun joku rekisteröityy sivustolla.", en: "No customer accounts yet — they'll appear here as soon as someone signs up on the site." },
  "admin.crm.stats.paid": { fi: "Maksetut laskut", en: "Invoices paid" },
  "admin.crm.stats.outstanding": { fi: "Avoinna", en: "Outstanding" },
  "admin.crm.stats.overdue": { fi: "erääntyneitä: {count}", en: "{count} overdue" },
  "admin.crm.stats.accounts": { fi: "Asiakastilit", en: "Customer accounts" },
  "admin.crm.table.email": { fi: "Sähköposti", en: "Email" },
  "admin.bookings.delete.title": { fi: "Poista varaus kokonaan", en: "Delete this booking entirely" },
  "admin.bookings.delete.confirm": { fi: "Poistetaanko varaus {code} ({customer}) pysyvästi? Myös lasku poistetaan, aika vapautuu ja käytetty ilmainen treenikerta palautuu asiakkaalle. Tätä ei voi perua.", en: "Permanently delete booking {code} ({customer})? Its invoice is deleted too, the slot frees up, and a used free-session credit returns to the customer. This cannot be undone." },
  "admin.bookings.delete.done": { fi: "Varaus {code} poistettu.", en: "Booking {code} deleted." },
  "admin.crm.leads.heading": { fi: "Liidit — puhelinnumerot", en: "Leads — phone numbers" },
  "admin.crm.leads.sub": { fi: "Asiakkaat, jotka antoivat puhelinnumeronsa tiliä luodessaan.", en: "Customers who left a phone number when creating their account." },
  "admin.crm.leads.empty": { fi: "Ei vielä puhelinnumeroita — numero kysytään (vapaaehtoisena) tilin luonnin yhteydessä.", en: "No phone numbers yet — the number is asked (optionally) when an account is created." },
  "admin.crm.leads.phone": { fi: "Puhelin", en: "Phone" },
  "admin.crm.leads.status": { fi: "Tila", en: "Status" },
  "admin.crm.leads.called": { fi: "Soitettu", en: "Called" },
  "admin.crm.leads.open": { fi: "Avoin", en: "Open" },
  "admin.crm.leads.toggle_title": { fi: "Merkitse soitetuksi / takaisin avoimeksi", en: "Mark as called / back to open" },
  "admin.crm.leads.booked_on": { fi: "· varaus tehty {date}", en: "· booked {date}" },
  "admin.crm.table.signedup": { fi: "Rekisteröitynyt", en: "Signed up" },
  "admin.crm.table.bookings": { fi: "Varaukset", en: "Bookings" },
  "admin.crm.table.dnc": { fi: "Pidetyt / tulevat / perutut", en: "Done / upcoming / cancelled" },
  "admin.crm.table.paid": { fi: "Maksettu", en: "Paid" },
  "admin.crm.table.outstanding": { fi: "Avoinna", en: "Outstanding" },
  "admin.crm.table.credits": { fi: "Ilmaiset treenikerrat", en: "Free credits" },
  "admin.crm.table.lastsession": { fi: "Viimeisin treeni", en: "Last session" },
  "admin.invoices.heading": { fi: "Laskut", en: "Invoices" },
  "admin.invoices.filter.unpaid": { fi: "Maksamatta", en: "Unpaid" },
  "admin.invoices.filter.paid": { fi: "Maksetut", en: "Paid" },
  "admin.invoices.filter.void": { fi: "Mitätöidyt", en: "Voided" },
  "admin.crm.invoices.amount": { fi: "Summa", en: "Amount" },
  "admin.crm.invoices.issued": { fi: "Päivätty", en: "Issued" },
  "admin.crm.invoices.due": { fi: "Eräpäivä", en: "Due" },
  "admin.reviews.heading": { fi: "Valmentajien arvostelut", en: "Coach reviews" },
  "admin.reviews.empty": { fi: "Ei vielä arvosteluja.", en: "No reviews yet." },
  "admin.crm.reviews.reviewer": { fi: "Arvostelija", en: "Reviewer" },
  "admin.crm.reviews.review": { fi: "Arvostelu", en: "Review" },
  "admin.crm.reviews.date": { fi: "Päivämäärä", en: "Date" },
  "admin.crm.reviews.demochip": { fi: "demo", en: "demo" },
  "admin.crm.reviews.nocomment": { fi: "ei kommenttia", en: "no comment" },
  "admin.crm.reviews.delete": { fi: "Poista", en: "Delete" },
  "admin.crm.reviews.delete.confirm": { fi: "Poistetaanko tämä arvostelu pysyvästi?", en: "Delete this review permanently?" },
  "admin.crm.reviews.deleted": { fi: "Arvostelu poistettu.", en: "Review deleted." },
  "admin.data.heading": { fi: "Liiketoiminnan data", en: "Business data" },
  "admin.sheets.checking": { fi: "Tarkistetaan…", en: "Checking…" },
  "admin.sheets.sync": { fi: "Synkronoi Google Sheetsiin nyt", en: "Sync to Google Sheets now" },
  "admin.sheets.note": { fi: "Eikö yhteyttä vielä ole? README-tiedostossa on kahden minuutin ohje ilman salasanoja (palvelutili) — sen jälkeen jokainen varaus synkronoituu automaattisesti.", en: "Not connected yet? The README has a 2-minute, no-password setup (service account) — after that every booking auto-syncs." },
  "admin.sheets.connected": { fi: "Yhdistetty ✓ — viimeisin synkronointi: {time}", en: "Connected ✓ — last sync: {time}" },
  "admin.sheets.notyet": { fi: "ei vielä", en: "not yet" },
  "admin.sheets.notconnected": { fi: "Ei vielä yhdistetty — data pysyy paikallisena, kunnes yhdistät taulukon.", en: "Not connected yet — data stays local until you connect a sheet." },
  "admin.sheets.synced": { fi: "{count} välilehteä synkronoitu Google Sheetsiin.", en: "Synced {count} tabs to Google Sheets." },
  "admin.sheets.sync.notconnected": { fi: "Google Sheets ei ole vielä yhdistetty — katso kahden minuutin ohje README-tiedostosta.", en: "Google Sheets is not connected yet — see the README for the 2-minute setup." },
  "admin.csv.heading": { fi: "CSV-lataukset", en: "CSV downloads" },
  "admin.csv.sub": { fi: "Samat tietojoukot kuin Google Sheetiin:", en: "The same datasets the Google Sheet gets:" },
  "admin.loading": { fi: "Ladataan…", en: "Loading…" },
  "admin.saving": { fi: "Tallennetaan…", en: "Saving…" },
  "admin.cal.loading": { fi: "Ladataan kalenteria…", en: "Loading calendar…" },
  "admin.cal.title": { fi: "{name} — seuraavat 14 päivää", en: "{name} — next 14 days" },
  "admin.cal.sub": { fi: "{locations} · valmentaa: {positions} · avaa tai sulje tunteja klikkaamalla", en: "{locations} · trains {positions} · click hours to open/close them for booking" },
  "admin.cal.legend.notavailable": { fi: "Ei varattavissa", en: "Not available" },
  "admin.cal.legend.open": { fi: "Avoinna varattavaksi", en: "Open for booking" },
  "admin.cal.legend.booked": { fi: "Varattu (vie osoitin päälle)", en: "Booked (hover for details)" },
  "admin.cal.legend.unsaved": { fi: "Tallentamaton muutos", en: "Unsaved change" },
  "admin.cal.save": { fi: "Tallenna muutokset", en: "Save changes" },
  "admin.cal.save.count": { fi: "Tallenna muutokset ({count})", en: "Save changes ({count})" },
  "admin.cal.saved": { fi: "Tallennettu — {added} avattu, {removed} suljettu.", en: "Saved — {added} opened, {removed} closed." },
  "admin.cal.saved.conflicts": { fi: "{count} aikaa ei voitu sulkea (varattu).", en: "{count} could not be closed (booked)." },
  "admin.cal.saved.rejected": { fi: "{count} ohitettu (menneet tunnit).", en: "{count} skipped (past hours)." },
  "admin.photo.notimage": { fi: "Tuo tiedosto ei ole kuva.", en: "That file is not an image." },
  "admin.photo.readfail": { fi: "Kuvan lukeminen ei onnistunut.", en: "Could not read that image." },
  "admin.editor.title.add": { fi: "Lisää valmentaja", en: "Add a coach" },
  "admin.editor.title.manage": { fi: "Muokkaa — {name}", en: "Manage {name}" },
  "admin.editor.overview": { fi: "{completed} treeniä yhteensä · {upcoming} tulevaa · {utilization} · taso T{tier} · palkkio tässä kuussa {payout}", en: "{completed} sessions all-time · {upcoming} upcoming · {utilization} · tier T{tier} · payout this month {payout}" },
  "admin.editor.overview.noslots": { fi: "ei avoimia aikoja", en: "no open slots" },
  "admin.editor.overview.booked": { fi: "{pct} % varattu", en: "{pct}% booked" },
  "admin.editor.editcalendar": { fi: "Muokkaa kalenteria →", en: "Edit calendar →" },
  "admin.editor.photos.label": { fi: "Kuvat", en: "Photos" },
  "admin.editor.photos.hint": { fi: "(suositus 2–3)", en: "(2–3 recommended)" },
  "admin.editor.photos.none": { fi: "Ei vielä kuvia — lisää 2–3.", en: "No photos yet — add 2–3." },
  "admin.editor.photos.remove": { fi: "Poista", en: "Remove" },
  "admin.editor.photos.max": { fi: "Enintään {max} kuvaa.", en: "Up to {max} photos." },
  "admin.editor.name": { fi: "Nimi", en: "Name" },
  "admin.editor.bio.fi": { fi: "Bio (suomeksi)", en: "Bio (Finnish)" },
  "admin.editor.bio.en": { fi: "Bio (englanniksi, valinnainen)", en: "Bio (English, optional)" },
  "admin.editor.positions": { fi: "Pelipaikat, joita hän valmentaa", en: "Positions they coach" },
  "admin.editor.cities": { fi: "Kaupungit", en: "Cities" },
  "admin.editor.featured": { fi: "Nosta etusivun karuselliin", en: "Feature in the homepage hero carousel" },
  "admin.editor.newlogin": { fi: "Luo valmentajalle tunnukset (valinnainen — voit lisätä ne myöhemmin)", en: "Give them a login (optional — you can add it later)" },
  "admin.editor.save": { fi: "Tallenna tiedot", en: "Save details" },
  "admin.editor.createcoach": { fi: "Luo valmentaja", en: "Create coach" },
  "admin.editor.updated": { fi: "Valmentaja päivitetty.", en: "Coach updated." },
  "admin.editor.added": { fi: "Valmentaja lisätty.", en: "Coach added." },
  "admin.editor.login.label": { fi: "Kirjautumistiedot", en: "Login" },
  "admin.editor.login.adminwarn": { fi: "⚠ Tämä valmentaja on myös ylläpitäjä — näiden tunnusten muuttaminen muuttaa ylläpitäjän kirjautumistietoja.", en: "⚠ This coach is also an admin — changing these credentials changes an admin login." },
  "admin.editor.login.none": { fi: "Ei vielä tunnuksia — anna sähköposti ja salasana, niin valmentaja voi kirjautua sisään ja ylläpitää omaa kalenteriaan.", en: "No login yet — set an email + password so this coach can sign in and manage their own calendar." },
  "admin.editor.login.email.ph": { fi: "valmentajan sähköposti", en: "coach email" },
  "admin.editor.login.pass.ph": { fi: "salasana (väh. 8 merkkiä)", en: "password (min 8 characters)" },
  "admin.editor.login.newpass.ph": { fi: "uusi salasana (jätä tyhjäksi, jos et vaihda)", en: "new password (leave blank to keep)" },
  "admin.editor.login.update": { fi: "Päivitä tunnukset", en: "Update login" },
  "admin.editor.login.create": { fi: "Luo tunnukset", en: "Create login" },
  "admin.editor.login.created": { fi: "Tunnukset luotu.", en: "Login created." },
  "admin.editor.login.updated": { fi: "Tunnukset päivitetty.", en: "Login updated." },

  // --- coach app: pitches tab (LIPAS directory) -------------------------------
  "app.nav.pitches": { fi: "Kentät", en: "Pitches" },
  "app.pitches.title": { fi: "Kentät", en: "Pitches" },
  "app.pitches.for_session": { fi: "Treeni", en: "Session" },
  "app.pitches.search_ph": { fi: "Hae nimellä tai alueella…", en: "Search by name or area…" },
  "app.pitches.note": { fi: "Vapaa/varattu kattaa vain Proballers-treenit — kaupungit eivät julkaise varauskalentereitaan avoimena datana. Tarkista kentän todellinen tilanne sen omasta linkistä. Lähde: LIPAS-liikuntapaikkarekisteri.", en: "Free/taken covers Proballers sessions only — the cities publish no open booking calendars. Check the pitch's own link for its real availability. Source: the LIPAS sports-facility registry." },
  "app.pitches.count": { fi: "{total} kenttää · {free} vapaana Proballers-varauksista", en: "{total} pitches · {free} free of Proballers bookings" },
  "app.pitches.count_plain": { fi: "{total} kenttää", en: "{total} pitches" },
  "app.pitches.free": { fi: "Vapaa", en: "Free" },
  "app.pitches.taken": { fi: "Varattu · {coach}", en: "Taken · {coach}" },
  "app.pitches.chosen": { fi: "Valittu", en: "Chosen" },
  "app.pitches.pick": { fi: "Valitse tähän treeniin", en: "Pick for this session" },
  "app.pitches.clear": { fi: "Poista valinta", en: "Remove selection" },
  "app.pitches.picked_toast": { fi: "Kenttä valittu — asiakas näkee sen varauksessaan ja chatissa.", en: "Pitch picked — the customer sees it on their booking and in the chat." },
  "app.pitches.cleared_toast": { fi: "Kenttävalinta poistettu.", en: "Pitch selection removed." },
  "app.pitches.no_sessions": { fi: "Ei tulevia kenttätreenejä", en: "No upcoming on-pitch sessions" },
  "app.pitches.no_sessions_sub": { fi: "Kenttälista näytetään varattujen treeniesi ajankohdille.", en: "The pitch list is shown for the times of your booked sessions." },
  "app.pitches.no_match": { fi: "Ei osumia haullesi", en: "No pitches match your search" },
  "app.pitches.narrow": { fi: "Näytetään {shown}/{total} — tarkenna hakua", en: "Showing {shown}/{total} — narrow the search" },
  "app.pitches.none": { fi: "Kenttä valitsematta", en: "No pitch chosen" },
  "app.pitches.choose": { fi: "Valitse kenttä →", en: "Choose a pitch →" },
  "app.pitches.change": { fi: "Vaihda →", en: "Change →" },
  "app.pitches.lit": { fi: "valaistus", en: "floodlit" },
  "app.pitches.indoor": { fi: "halli", en: "indoor hall" },
  "app.pitches.stadium": { fi: "stadion", en: "stadium" },
  "app.pitches.city_link": { fi: "Kentän tiedot / varaus", en: "Pitch info / booking" },
  // LIPAS surface-material tokens (rare ones fall back to the raw token)
  "app.pitches.surface.artificial-turf": { fi: "tekonurmi", en: "artificial turf" },
  "app.pitches.surface.grass": { fi: "nurmi", en: "grass" },
  "app.pitches.surface.rock-dust": { fi: "kivituhka", en: "rock dust" },
  "app.pitches.surface.sand": { fi: "hiekka", en: "sand" },
  "app.pitches.surface.gravel": { fi: "sora", en: "gravel" },
  "app.pitches.surface.asphalt": { fi: "asfaltti", en: "asphalt" },
  "app.pitches.surface.concrete": { fi: "betoni", en: "concrete" },
  "app.pitches.surface.sand-infilled-artificial-turf": { fi: "hiekkatekonurmi", en: "sand-infilled artificial turf" },
  // admin pitch curation (add own venues, hide/restore listed ones)
  "app.pitches.add": { fi: "Lisää kenttä", en: "Add a pitch" },
  "app.pitches.add_name_ph": { fi: "Kentän nimi *", en: "Pitch name *" },
  "app.pitches.add_area_ph": { fi: "Kaupunginosa", en: "Neighbourhood" },
  "app.pitches.add_address_ph": { fi: "Osoite", en: "Address" },
  "app.pitches.add_www_ph": { fi: "Linkki (tiedot/varaus)", en: "Link (info/booking)" },
  "app.pitches.surface_other": { fi: "muu alusta", en: "other surface" },
  "app.pitches.add_save": { fi: "Tallenna kenttä", en: "Save pitch" },
  "app.pitches.add_city_note": { fi: "Lisätään kaupunkiin: {city}", en: "Will be added to: {city}" },
  "app.pitches.added_toast": { fi: "Kenttä lisätty listalle.", en: "Pitch added to the list." },
  "app.pitches.custom_tag": { fi: "oma kenttä", en: "own pitch" },
  "app.pitches.hide": { fi: "Poista listalta", en: "Remove from list" },
  "app.pitches.hide_confirm": { fi: "Poistetaanko \"{name}\" kenttälistalta? Voit palauttaa kaikki poistetut myöhemmin.", en: "Remove \"{name}\" from the pitch list? You can restore all removed pitches later." },
  "app.pitches.delete_custom": { fi: "Poista", en: "Delete" },
  "app.pitches.delete_custom_confirm": { fi: "Poistetaanko itse lisätty kenttä \"{name}\" pysyvästi?", en: "Permanently delete your own pitch \"{name}\"?" },
  "app.pitches.removed_toast": { fi: "Kenttä poistettu listalta.", en: "Pitch removed from the list." },
  "app.pitches.restore": { fi: "Listalta poistettuja LIPAS-kenttiä: {n} — palauta kaikki", en: "Removed LIPAS pitches: {n} — restore all" },
  "app.pitches.restored_toast": { fi: "Poistetut kentät palautettu listalle.", en: "Removed pitches restored to the list." },

  // --- admin: email delivery status + test ------------------------------------
  "admin.email.problem": { fi: "Sähköpostien lähetyksessä on ongelma", en: "Email delivery has a problem" },
  "admin.email.ok": { fi: "Sähköpostit: käytössä", en: "Email delivery: on" },
  "admin.email.host": { fi: "Palvelin: {host}", en: "Server: {host}" },
  "admin.email.lastsent": { fi: "viimeksi lähetetty {time}", en: "last sent {time}" },
  "admin.email.notconfigured": { fi: "SMTP-asetuksia ei ole määritetty (SMTP_HOST ym. puuttuvat Renderin Environment-välilehdeltä) — laskut ja kuitit EIVÄT lähde sähköpostiin ennen kuin ne on lisätty.", en: "SMTP is not configured (SMTP_HOST etc. are missing from Render's Environment tab) — invoices and receipts are NOT emailed until they are set." },
  "admin.email.test": { fi: "Lähetä testisähköposti itsellesi", en: "Send a test email to yourself" },
  "admin.email.testing": { fi: "Lähetetään…", en: "Sending…" },
  "admin.email.test_ok": { fi: "Lähetetty osoitteeseen {to} — tarkista postilaatikko (myös roskaposti).", en: "Sent to {to} — check your inbox (and the spam folder)." },
  "admin.email.test_fail": { fi: "Lähetys epäonnistui.", en: "Send failed." },

  // --- admin: email communications panel ---
  "admin.emails.heading": { fi: "Sähköpostiviestintä", en: "Email communications" },
  "admin.emails.sub": { fi: "Tervetuloviestit, varaus- ja kenttävahvistukset sekä arvostelu- ja uusintapyynnöt lähtevät automaattisesti. Painike lähettää erääntyneet viestit heti.", en: "Welcome messages, booking and pitch confirmations, review requests and book-again nudges go out automatically. The button sends anything due right now." },
  "admin.emails.run": { fi: "Lähetä erääntyneet nyt", en: "Send due emails now" },
  "admin.emails.run.done": { fi: "Valmis — {review} arvostelupyyntöä ja {rebook} uusintapyyntöä lähetetty.", en: "Done — sent {review} review requests and {rebook} book-again nudges." },
  "admin.emails.lastrun": { fi: "Automatiikka ajettu viimeksi {time}", en: "Automation last ran {time}" },
  "admin.emails.norun": { fi: "Automatiikkaa ei ole vielä ajettu tällä palvelimella.", en: "The automation has not run on this server yet." },
  "admin.emails.counts": { fi: "Lähetetty (onnistuneet/kaikki)", en: "Sent (ok/all)" },
  "admin.emails.empty": { fi: "Ei vielä lähetettyjä sähköposteja.", en: "No emails sent yet." },
  "admin.emails.log.time": { fi: "Aika", en: "Time" },
  "admin.emails.log.type": { fi: "Tyyppi", en: "Type" },
  "admin.emails.log.to": { fi: "Vastaanottaja", en: "To" },
  "admin.emails.log.subject": { fi: "Aihe", en: "Subject" },
  "admin.emails.log.status": { fi: "Tila", en: "Status" },
  "admin.emails.type.welcome": { fi: "Tervetuloa", en: "Welcome" },
  "admin.emails.type.booking": { fi: "Varausvahvistus", en: "Booking confirmation" },
  "admin.emails.type.pitch": { fi: "Kenttävahvistus", en: "Pitch confirmation" },
  "admin.emails.type.review": { fi: "Arvostelupyyntö", en: "Review request" },
  "admin.emails.type.rebook": { fi: "Uusintapyyntö", en: "Book-again nudge" },
  "admin.emails.type.invoice": { fi: "Lasku", en: "Invoice" },
  "admin.emails.type.receipt": { fi: "Kuitti", en: "Receipt" },
  "admin.emails.type.test": { fi: "Testiviesti", en: "Test email" },
  "admin.emails.type.other": { fi: "Muu", en: "Other" },

  // --- admin: delete customer account -----------------------------------------
  "admin.crm.delete.title": { fi: "Poista asiakastili", en: "Delete customer account" },
  "admin.crm.delete.confirm1": { fi: "Poistetaanko asiakastili {name}? Tili poistetaan pysyvästi.", en: "Delete the customer account {name}? The account is removed permanently." },
  "admin.crm.delete.confirm2": { fi: "VIIMEINEN VARMISTUS — {name}: poistetaan {bookings} varausta (joista {upcoming} tulevaa; niiden ajat vapautuvat), kaikki laskut, chatit, ilmaiskerrat ja arvostelut. Poisto vaikuttaa myös tilastoihin ja valmentajien palkkiolaskelmiin pidettyjen treenien osalta. Tätä EI voi perua. Jatketaanko?", en: "FINAL CONFIRMATION — {name}: this deletes {bookings} bookings ({upcoming} upcoming; their slots open up), all invoices, chats, credits and reviews. Past sessions also disappear from statistics and coach payout figures. This CANNOT be undone. Continue?" },
  "admin.crm.delete.done": { fi: "Asiakastili {name} poistettu.", en: "Customer account {name} deleted." },
};

// Server-sent strings (API error messages, notification texts, config labels).
// Keyed by the EXACT English string the server sends; translated only in FI
// mode. Patterns (RegExp -> template) handle messages with embedded values.
const I18N_SERVER_EXACT = {
  "Unsupported image — use JPG, PNG or WebP.": "Kuvamuotoa ei tueta — käytä JPG-, PNG- tai WebP-kuvaa.",
  "That image looks empty.": "Kuva näyttää tyhjältä.",
  "Each image must be under 6 MB.": "Jokaisen kuvan on oltava alle 6 Mt.",
  "Coach name must be 2–60 characters.": "Valmentajan nimen on oltava 2–60 merkkiä.",
  "Pick at least one position group.": "Valitse vähintään yksi pelipaikkaryhmä.",
  "Pick at least one city.": "Valitse vähintään yksi kaupunki.",
  "That slot has since been booked by someone else.": "Joku muu on ehtinyt varata tuon ajan.",
  "The customer's free-session credit has already been used elsewhere — can't reactivate.": "Asiakkaan ilmainen treenikerta on jo käytetty muualla — varausta ei voi palauttaa.",
  "The free-session credit from this cancellation has already been used — can't reactivate.": "Tästä peruutuksesta myönnetty ilmainen treenikerta on jo käytetty — varausta ei voi palauttaa.",
  "Coach not found.": "Valmentajaa ei löytynyt.",
  "Please give a rating from 1 to 5 stars.": "Anna arvosanaksi 1–5 tähteä.",
  "You can review a coach only after a completed session with them.": "Voit arvostella valmentajan vasta hänen kanssaan pidetyn treenin jälkeen.",
  "You have already reviewed this coach.": "Olet jo arvostellut tämän valmentajan.",
  "Unknown event type.": "Tuntematon tapahtumatyyppi.",
  "Please give your name.": "Kerro vielä nimesi.",
  "That email address does not look right.": "Sähköpostiosoite ei näytä oikealta.",
  "That phone number does not look right.": "Puhelinnumero ei näytä oikealta.",
  "Password must be at least 8 characters.": "Salasanassa on oltava vähintään 8 merkkiä.",
  "An account with this email already exists — try logging in.": "Tällä sähköpostilla on jo tili — kokeile kirjautua sisään.",
  "Wrong email or password.": "Väärä sähköposti tai salasana.",
  "Please log in.": "Kirjaudu sisään.",
  "New password must be at least 8 characters.": "Uudessa salasanassa on oltava vähintään 8 merkkiä.",
  "Current password is wrong.": "Nykyinen salasana on väärä.",
  "Invalid date.": "Virheellinen päivämäärä.",
  "That time is already in the past.": "Tuo aika on jo mennyt.",
  "That date is too far ahead.": "Tuo päivä on liian kaukana tulevaisuudessa.",
  "Please choose a session focus.": "Valitse treenin painopiste.",
  "This coach does not train that position.": "Tämä valmentaja ei valmenna tuota pelipaikkaa.",
  "This coach does not train in that city.": "Tämä valmentaja ei valmenna tuossa kaupungissa.",
  "The coach is not available at that time.": "Valmentaja ei ole vapaana tuohon aikaan.",
  "Someone just booked that slot — please pick another time.": "Joku ehti juuri varata tuon ajan — valitse toinen aika.",
  "Invoice not found.": "Laskua ei löytynyt.",
  "Not allowed.": "Ei käyttöoikeutta.",
  "Invoice file missing.": "Laskutiedosto puuttuu.",
  "No coach profile linked to this account.": "Tähän tiliin ei ole liitetty valmentajaprofiilia.",
  "Too many changes at once.": "Liikaa muutoksia kerralla.",
  "Invalid filters.": "Virheelliset suodattimet.",
  "Bad status.": "Virheellinen tila.",
  "Booking not found.": "Varausta ei löytynyt.",
  "You can only mark a session complete once it has taken place.": "Voit merkitä treenin pidetyksi vasta, kun se on päättynyt.",
  "Add at least one photo (2–3 recommended).": "Lisää vähintään yksi kuva (suositus 2–3).",
  "An account with this email already exists.": "Tällä sähköpostilla on jo tili.",
  "That coach clashed with an existing one — please try again.": "Samanniminen valmentaja on jo olemassa — yritä uudelleen.",
  "A coach needs at least one photo.": "Valmentajalla on oltava vähintään yksi kuva.",
  "Nothing to change.": "Ei muutettavaa.",
  "Another account already uses that email.": "Tuo sähköposti on jo toisen tilin käytössä.",
  "Set both an email and a password to create a login.": "Anna sekä sähköposti että salasana, jotta tunnukset voidaan luoda.",
  "A session can only be completed once it has taken place.": "Treenin voi merkitä pidetyksi vasta, kun se on päättynyt.",
  "Review not found.": "Arvostelua ei löytynyt.",
  "This invoice is voided (its booking was cancelled) — it cannot be marked paid.": "Tämä lasku on mitätöity (sen varaus peruttiin) — sitä ei voi merkitä maksetuksi.",
  "Too many attempts. Try again in a few minutes.": "Liian monta yritystä. Yritä uudelleen muutaman minuutin kuluttua.",
  "your coach": "Valmentajasi",
  "the Proballers team": "Proballers-tiimi",
  "Your free-session credit is available again — use it on any coach.": "Ilmainen treenikertasi on taas käytettävissä — voit käyttää sen kenen tahansa valmentajan kanssa.",
  "To make it right, your next session with ANY coach is free — the credit is applied automatically when you book.": "Hyvitykseksi seuraava treenisi KENEN tahansa valmentajan kanssa on ilmainen — ilmainen treenikerta käytetään automaattisesti, kun varaat.",
  "An administrator updated your login password — please sign in with the new password.": "Ylläpitäjä päivitti salasanasi — kirjaudu sisään uudella salasanalla.",
  "Your booking was cancelled because the payment was not completed. The slot is open again — you are welcome to book a new time.": "Varauksesi peruttiin, koska maksua ei suoritettu loppuun. Aika on jälleen vapaana — voit varata uuden ajan.",

  // --- config labels served by /api/config (translated at display time) ------
  "LAUNCH OFFER": "AVAJAISTARJOUS",
  "Conditioning": "Kunto",
  "Physicality": "Fyysisyys",
  "Agility": "Ketteryys",
  "Technical": "Tekniikka",
  "Defending": "Puolustaminen",
  "Finishing": "Viimeistely",
  "Passing": "Syöttäminen",
  "Game IQ (online meeting)": "Game IQ (etätapaaminen)",
  "VAT 0% — small business, AVL 3 §": "ALV 0 % — pienyritys, AVL 3 §",
  "0–5 sessions / month": "0–5 treeniä / kk",
  "5–15 sessions / month": "5–15 treeniä / kk",
  "15+ sessions / month": "15+ treeniä / kk",
  "Bank transfer": "Tilisiirto",
  "Online": "Etänä",
  "Chat not found.": "Keskustelua ei löytynyt.",
  "Card payments are not enabled yet.": "Korttimaksut eivät ole vielä käytössä.",
  "Invoice is already paid.": "Lasku on jo maksettu.",
  "Nothing to pay.": "Ei maksettavaa.",
  "Empty message.": "Tyhjä viesti.",
  "Message is too long (max 2000 characters).": "Viesti on liian pitkä (enintään 2000 merkkiä).",
  "Unknown city.": "Tuntematon kaupunki.",
  "Only an upcoming session can have its pitch set.": "Kentän voi valita vain tulevalle treenille.",
  "An online session has no pitch.": "Etätreenillä ei ole kenttää.",
  "Pitch not found in that city.": "Kenttää ei löytynyt tästä kaupungista.",
  "Pitch name is required.": "Anna kentän nimi.",
  "Bad pitch id.": "Virheellinen kenttätunnus.",
  "Pitch not found.": "Kenttää ei löytynyt.",
  "Another Proballers session is already on that pitch at that time.": "Toinen Proballers-treeni on jo tuolla kentällä samaan aikaan.",
  "The pitch registry (LIPAS) is not responding — try again in a moment.": "Kenttärekisteri (LIPAS) ei vastaa — yritä hetken kuluttua uudelleen.",
  "Customer not found.": "Asiakasta ei löytynyt.",
  "Helsinki": "Helsinki",
  "Espoo": "Espoo",
  "Vantaa": "Vantaa",

  // --- focus ids as stored on bookings (displayed via I18N.server) ---
  "conditioning": "kunto",
  "physicality": "fyysisyys",
  "agility": "ketteryys",
  "technical": "tekniikka",
  "defending": "puolustaminen",
  "finishing": "viimeistely",
  "passing": "syöttäminen",
  "game-iq": "Game IQ",
};

// ISO 'YYYY-MM-DD' -> Finnish '31.12.2026' (used inside notification patterns).
const fiDate = (iso) => {
  const [y, m, d] = String(iso).split('-');
  return `${+d}.${+m}.${y}`;
};

const I18N_SERVER_PATTERNS = [
  [/^Sessions run between (\d{1,2}):00 and (\d{1,2}):00\.$/,
    (m) => `Treeniajat ovat klo ${m[1]}.00–${m[2]}.00.`],
  [/^Unknown dataset\. Options: ([\s\S]*)$/,
    (m) => `Tuntematon tietojoukko. Vaihtoehdot: ${m[1]}`],
  [/^Sheets sync failed: ([\s\S]*)$/,
    (m) => `Sheets-synkronointi epäonnistui: ${m[1]}`],
  // Cancellation notice: actor + optional credit fragment are themselves
  // translated through the exact map above.
  [/^Your session with (.+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 was cancelled by (your coach|the Proballers team)\. We're sorry!\s*([\s\S]*)$/,
    (m) => `${I18N_SERVER_EXACT[m[4]] || m[4]} perui treenisi valmentajan ${m[1]} kanssa ${fiDate(m[2])} klo ${m[3]}.00. Olemme pahoillamme!${m[5] ? ' ' + (I18N_SERVER_EXACT[m[5].trim()] || m[5]) : ''}`],
  [/^Good news — your session with (.+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 is back on\.$/,
    (m) => `Hyviä uutisia — treenisi valmentajan ${m[1]} kanssa ${fiDate(m[2])} klo ${m[3]}.00 järjestetään sittenkin.`],
  // Coach alert: a customer just booked (focus id + city resolve via the exact map).
  [/^New booking: (.+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 — ([\w-]+) \((.+)\)\.$/,
    (m) => `Uusi varaus: ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 — ${I18N_SERVER_EXACT[m[4]] || m[4]} (${I18N_SERVER_EXACT[m[5]] || m[5]}).`],
  // Coach alert: an unpaid booking was auto-released.
  [/^Booking (\S+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 was released because the payment was not completed\. The slot is open again\.$/,
    (m) => `Varaus ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 vapautettiin, koska maksua ei suoritettu. Aika on jälleen vapaana.`],
  // Coach alert: booking removed because the customer account was deleted.
  [/^Booking (\S+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 was removed because the customer's account was deleted\. The slot is open again\.$/,
    (m) => `Varaus ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 poistettiin, koska asiakkaan tili poistettiin. Aika on jälleen vapaana.`],
  // Coach: an upcoming booking was hard-deleted by the admin.
  [/^Booking (\S+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 was removed by the admin\. The slot is open again\.$/,
    (m) => `Varaus ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 poistettiin ylläpidon toimesta. Aika on jälleen vapaana.`],
  // Customer: 24 h payment reminder.
  [/^Payment reminder: your booking (\S+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 is still unpaid — pay it on the My bookings page within 24 hours \(before the session, if it is sooner\) or the booking will be cancelled automatically\.$/,
    (m) => `Maksumuistutus: varauksesi ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 on yhä maksamatta — maksa se 24 tunnin kuluessa (kuitenkin ennen treeniä) Omat varaukset -sivulla, tai varaus perutaan automaattisesti.`],
  // Customer: payment landed just after the release — booking restored.
  [/^Good news — we received your payment and your booking (\S+) is confirmed again\.$/,
    (m) => `Hyviä uutisia — saimme maksusi ja varauksesi ${m[1]} on jälleen vahvistettu.`],
  // Coach: the released booking came back once the late payment landed.
  [/^Booking (\S+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}):00 is confirmed again — the payment arrived just after the release\.$/,
    (m) => `Varaus ${m[1]} ${fiDate(m[2])} klo ${m[3]}.00 on jälleen vahvistettu — maksu saapui heti vapautuksen jälkeen.`],
  // Admin: money arrived for a booking that can't come back -> manual Stripe refund.
  [/^Payment received for invoice (\S+) AFTER its booking (\S+) was released and the slot re-booked — please refund the payment in Stripe\.$/,
    (m) => `Maksu laskusta ${m[1]} saapui vasta sen jälkeen, kun varaus ${m[2]} oli vapautettu ja aika ehditty varata uudelleen — palauta maksu Stripessä.`],
  [/^Payment received for invoice (\S+), but its booking (\S+) was cancelled — the booking stays cancelled; please refund the payment in Stripe\.$/,
    (m) => `Maksu laskusta ${m[1]} saapui, mutta sen varaus ${m[2]} on peruttu — varaus pysyy peruttuna; palauta maksu Stripessä.`],
  [/^Payment received for invoice (\S+), but that invoice no longer exists \(was the customer account deleted\?\) — please refund the payment in Stripe\.$/,
    (m) => `Maksu laskusta ${m[1]} saapui, mutta laskua ei enää ole (poistettiinko asiakastili?) — palauta maksu Stripessä.`],
];

const I18N = (() => {
  const LS_KEY = 'pbf-lang';
  let lang = 'fi';
  try { if (localStorage.getItem(LS_KEY) === 'en') lang = 'en'; } catch { /* private mode */ }

  function t(key, params) {
    // hasOwnProperty guard: never resolve inherited Object.prototype members.
    const entry = Object.prototype.hasOwnProperty.call(I18N_DICT, key) ? I18N_DICT[key] : undefined;
    let s = entry ? (entry[lang] ?? entry.fi) : null;
    if (s == null) { console.warn('[i18n] missing key:', key); s = key; }
    return params ? s.replace(/\{(\w+)\}/g, (m, p) => (params[p] ?? m)) : s;
  }

  // Translate a string that came from the server. English mode and unknown
  // strings pass through unchanged, so this is always safe to call.
  function server(msg) {
    if (lang !== 'fi' || !msg) return msg;
    const hit = Object.prototype.hasOwnProperty.call(I18N_SERVER_EXACT, msg)
      ? I18N_SERVER_EXACT[msg] : undefined;
    if (hit) return hit;
    for (const [re, render] of I18N_SERVER_PATTERNS) {
      const m = re.exec(msg);
      if (m) return render(m);
    }
    return msg;
  }

  // Swap the static (inline-Finnish) HTML to the current language.
  function applyStatic(root = document) {
    document.documentElement.lang = lang;
    const attrMap = [
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-aria', 'aria-label'],
      ['data-i18n-title-attr', 'title'],
      ['data-i18n-alt', 'alt'],
      ['data-i18n-content', 'content'],
    ];
    if (lang !== 'fi') {
      root.querySelectorAll('[data-i18n]').forEach((el) => {
        const entry = I18N_DICT[el.getAttribute('data-i18n')];
        if (!entry) return;
        // A handful of headings carry safe dictionary markup (<br>).
        if (entry.en.includes('<br>')) el.innerHTML = entry.en; else el.textContent = entry.en;
      });
    }
    for (const [dataAttr, attr] of attrMap) {
      root.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
        el.setAttribute(attr, t(el.getAttribute(dataAttr)));
      });
    }
  }

  function setLang(next) {
    if (next !== 'fi' && next !== 'en') return;
    try { localStorage.setItem(LS_KEY, next); } catch { /* private mode */ }
    // Reload: every page renders its dynamic content in the new language from
    // scratch — no stale mixed-language widgets.
    location.reload();
  }

  return { get lang() { return lang; }, t, server, applyStatic, setLang };
})();

const t = I18N.t;

// Position-group chip/label helper, shared by every page that shows coaches.
function posLabel(id) { return t('cfg.position.' + id); }

// Pick the right bio for the current language ('' bio_en falls back to Finnish).
function coachBio(c) { return (I18N.lang === 'en' && c.bio_en) ? c.bio_en : (c.bio || ''); }

// Small FI | EN segmented toggle, appended to the header by initHeaderAuth().
function langToggleEl() {
  const seg = document.createElement('div');
  seg.className = 'lang-toggle';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Kieli / Language');
  for (const l of ['fi', 'en']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang-opt' + (I18N.lang === l ? ' on' : '');
    b.textContent = l.toUpperCase();
    b.setAttribute('aria-label', l === 'fi' ? 'Suomeksi' : 'In English');
    b.setAttribute('aria-pressed', String(I18N.lang === l));
    b.addEventListener('click', () => { if (I18N.lang !== l) I18N.setLang(l); });
    seg.appendChild(b);
  }
  return seg;
}

// Static text is inline-Finnish in the HTML; swap immediately (scripts sit at
// the end of <body>, so the DOM above is ready).
I18N.applyStatic();
