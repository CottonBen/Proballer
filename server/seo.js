// Search-engine surface: robots.txt, sitemap.xml, and the per-page <head>
// signals (canonical, Open Graph, structured data) that a client-rendered page
// cannot provide on its own.
//
// The site paints itself with JavaScript, which is fine for visitors but leaves
// crawlers and link-preview bots (WhatsApp, Facebook, iMessage — where a youth
// football audience actually shares things) reading whatever is in the served
// HTML. None of those bots run our scripts. So anything that must be correct in
// search results or a shared link is injected HERE, server-side, before the
// document leaves the building.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { db } = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SITE = config.siteUrl;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Absolute URL for an asset path. Social and structured data need absolute
// URLs — a relative one is silently dropped by most crawlers.
const abs = (p) => (/^https?:\/\//.test(p || '') ? p : SITE + (p || ''));

// Trim to a length search results will actually show, breaking on a word.
function clamp(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(' ', max - 1) > 0 ? s.lastIndexOf(' ', max - 1) : max - 1).trim() + '…';
}

const parseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------
// Everything behind a login is disallowed: those pages render nothing useful to
// a crawler and would only dilute the site with near-empty duplicates. The API
// is disallowed for the same reason (it answers JSON, or 401s).
function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /coaches/',
    'Disallow: /admin',
    'Disallow: /coach',
    'Disallow: /app',
    'Disallow: /chats',
    'Disallow: /my-bookings',
    'Disallow: /login',
    'Disallow: /api/',
    'Disallow: /uploads/',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------
// Built from the live coach list, so a coach added or deactivated in the admin
// appears (or disappears) without anyone remembering to edit a file.
function sitemapXml() {
  const coaches = db.prepare(
    'SELECT slug, created_at FROM coaches WHERE active = 1 ORDER BY display_order, id').all();
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, priority, changefreq, lastmod) =>
    `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n`
    + `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

  const entries = [url(SITE + '/', '1.0', 'weekly', today)];
  for (const c of coaches) {
    entries.push(url(`${SITE}/coaches/${c.slug}`, '0.8', 'monthly',
      (c.created_at || today).slice(0, 10)));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// <head> injection
// ---------------------------------------------------------------------------
// Replaces the placeholder title/description that the client script would
// otherwise fill in, and adds what it never could: a canonical URL, social
// cards, and structured data. Returns the whole document.
// `keepI18n` keeps the original data-i18n hooks on the title/description so the
// client can still re-localise them when a visitor switches to English. Use it
// where the served text and the Finnish translation say the same thing. Leave
// it off where the server text is RICHER than the key (a coach profile names
// the coach; the generic key would clobber it on load).
function injectHead(html, { title, description, canonical, image, jsonLd, noindex, keepI18n }) {
  const attrOf = (tag, name) => {
    const m = html.match(tag);
    const a = m && m[0].match(new RegExp(`${name}="[^"]*"`));
    return a ? ' ' + a[0] : '';
  };
  const titleI18n = keepI18n ? attrOf(/<title[^>]*>/i, 'data-i18n') : '';
  const descI18n = keepI18n ? attrOf(/<meta\s+name="description"[^>]*>/i, 'data-i18n-content') : '';
  const tags = [];
  if (canonical) tags.push(`<link rel="canonical" href="${esc(canonical)}">`);
  if (noindex) tags.push('<meta name="robots" content="noindex, nofollow">');
  else tags.push('<meta name="robots" content="index, follow, max-image-preview:large">');

  if (title) {
    tags.push(`<meta property="og:title" content="${esc(title)}">`);
    tags.push(`<meta name="twitter:title" content="${esc(title)}">`);
  }
  if (description) {
    tags.push(`<meta property="og:description" content="${esc(description)}">`);
    tags.push(`<meta name="twitter:description" content="${esc(description)}">`);
  }
  tags.push('<meta property="og:type" content="website">');
  tags.push(`<meta property="og:site_name" content="${esc(config.siteName)}">`);
  tags.push('<meta property="og:locale" content="fi_FI">');
  if (canonical) tags.push(`<meta property="og:url" content="${esc(canonical)}">`);
  const img = abs(image || '/assets/apple-touch-icon.png');
  tags.push(`<meta property="og:image" content="${esc(img)}">`);
  tags.push(`<meta name="twitter:image" content="${esc(img)}">`);
  tags.push('<meta name="twitter:card" content="summary_large_image">');
  if (jsonLd) {
    // </script> inside JSON would close the tag early; escaping the slash is
    // the standard way to keep an inline JSON-LD block intact.
    tags.push('<script type="application/ld+json">'
      + JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>');
  }

  let out = html;
  if (title) {
    out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title${titleI18n}>${esc(title)}</title>`);
  }
  if (description) {
    out = out.replace(/<meta\s+name="description"[^>]*>/i,
      `<meta name="description"${descI18n} content="${esc(description)}">`);
  }
  return out.replace('</head>', '  ' + tags.join('\n  ') + '\n</head>');
}

// The business itself. SportsActivityLocation is the closest Schema.org type to
// "someone who coaches football at pitches around the capital region", and it
// inherits LocalBusiness, so Google reads the areaServed/price signals from it.
function organisationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: config.siteName,
    description: 'Henkilökohtaista jalkapallovalmennusta nuorille pelaajille '
      + 'pääkaupunkiseudulla. 1-on-1-treenit valmentajilta, jotka pelaavat itse kilpatasolla.',
    url: SITE,
    logo: abs('/assets/logo.svg'),
    image: abs('/assets/apple-touch-icon.png'),
    email: config.invoice.replyEmail,
    telephone: config.payment.mobilepay || undefined,
    sport: 'Football',
    address: { '@type': 'PostalAddress', addressCountry: 'FI', addressRegion: 'Uusimaa' },
    areaServed: config.locations.map((city) => ({ '@type': 'City', name: city })),
    priceRange: `€${config.pricing.sessionPrice}`,
    currenciesAccepted: config.pricing.currency,
    paymentAccepted: config.payment.method,
    makesOffer: [
      {
        '@type': 'Offer',
        name: 'Henkilökohtainen jalkapallotreeni (60 min)',
        price: String(config.pricing.sessionPrice),
        priceCurrency: config.pricing.currency,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Ryhmätreeni',
        price: String(config.groupTraining.pricePerPlayer),
        priceCurrency: config.pricing.currency,
        availability: 'https://schema.org/InStock',
      },
    ],
  };
}

// One coach. Person + the service they offer, so a "jalkapallovalmentaja
// <city>" search has something concrete to match and show.
function coachJsonLd(coach, url) {
  const locations = parseJSON(coach.locations, []);
  const photo = parseJSON(coach.photos, [])[0];
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: coach.name,
    url,
    jobTitle: 'Jalkapallovalmentaja',
    worksFor: { '@type': 'Organization', name: config.siteName, url: SITE },
    knowsAbout: ['Jalkapallo', 'Henkilökohtainen valmennus', 'Nuorten urheiluvalmennus'],
  };
  if (photo) node.image = abs(photo);
  if (coach.bio) node.description = clamp(coach.bio, 300);
  if (locations.length) node.areaServed = locations.map((c) => ({ '@type': 'City', name: c }));
  const rating = db.prepare(
    'SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE coach_id = ?').get(coach.id);
  if (rating && rating.n > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(rating.avg * 10) / 10,
      reviewCount: rating.n,
      bestRating: 5,
    };
  }
  return node;
}

// ---------------------------------------------------------------------------
// Page renderers
// ---------------------------------------------------------------------------
const readPage = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

function renderHome() {
  const cities = config.locations.join(', ').replace(/, ([^,]*)$/, ' ja $1');
  return injectHead(readPage('index.html'), {
    title: `${config.siteName} — henkilökohtaista jalkapallovalmennusta nuorille pelaajille`,
    description: `Henkilökohtaista jalkapallovalmennusta nuorille pelaajille: ${cities}. `
      + `Varaa 1-on-1-treeni ${config.pricing.sessionPrice} € valmentajalta, joka pelaa itse kilpatasolla.`,
    canonical: SITE + '/',
    jsonLd: organisationJsonLd(),
    keepI18n: true,
  });
}

// A coach profile. Every one of these used to serve the same generic title and
// description, so six real pages competed as one duplicate — the single
// biggest thing standing between this site and local search traffic.
function renderCoachProfile(slug) {
  const coach = db.prepare('SELECT * FROM coaches WHERE slug = ? AND active = 1').get(String(slug));
  const html = readPage('coach-profile.html');
  if (!coach) {
    // Unknown or deactivated coach: the page renders its own not-found state,
    // but it must never be indexed as if it were a real profile.
    return injectHead(html, {
      title: `Valmentajaa ei löytynyt — ${config.siteName}`,
      canonical: null, noindex: true,
    });
  }
  const url = `${SITE}/coaches/${coach.slug}`;
  const locations = parseJSON(coach.locations, []);
  const where = locations.length
    ? locations.join(', ').replace(/, ([^,]*)$/, ' ja $1')
    : config.locations[0];
  const photo = parseJSON(coach.photos, [])[0];
  return injectHead(html, {
    title: `${coach.name} — jalkapallovalmentaja ${locations[0] || ''} | ${config.siteName}`.replace(/\s+\|/, ' |'),
    description: coach.bio
      ? clamp(`${coach.name}, jalkapallovalmentaja (${where}). ${coach.bio}`, 155)
      : `Varaa henkilökohtainen jalkapallotreeni: ${coach.name}, ${where}. `
        + `${config.pricing.sessionPrice} € / 60 min.`,
    canonical: url,
    image: photo ? abs(photo) : null,
    jsonLd: coachJsonLd(coach, url),
  });
}

// Signed-in pages. Nothing to index — they are empty shells until a script
// fills them for one specific person — so they say so explicitly.
function renderPrivate(file, title) {
  return injectHead(readPage(file), { title, canonical: null, noindex: true, keepI18n: true });
}

module.exports = { robotsTxt, sitemapXml, renderHome, renderCoachProfile, renderPrivate };
