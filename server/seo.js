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

// ---------------------------------------------------------------------------
// Bilingual URLs
// ---------------------------------------------------------------------------
// Finnish is the canonical site and keeps the bare paths (/, /coaches/:slug);
// English mirrors them under /en. Two URLs, one per language, is what lets a
// search engine index both — the old single URL with a client-side toggle could
// only ever be indexed as Finnish, because a crawler never clicks the toggle.
//
// Only PUBLIC pages are mirrored. The signed-in pages stay on one URL and keep
// switching language in the browser: they are noindex, so nothing is lost.
const LANGS = ['fi', 'en'];

// The path a given page has in a given language.
const pathFor = (bare, lang) => (lang === 'en' ? (bare === '/' ? '/en' : '/en' + bare) : bare);

// Every language's URL for one page, for hreflang. x-default points at Finnish:
// it is the original, and a visitor with no matching language preference is
// most likely to be in Finland.
function alternates(bare) {
  const out = LANGS.map((l) => ({ lang: l, href: SITE + pathFor(bare, l) }));
  out.push({ lang: 'x-default', href: SITE + bare });
  return out;
}

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
    'Allow: /en',
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

  // One <url> per language per page, each carrying the full set of alternates.
  // Listing the pair explicitly is what tells Google these are translations of
  // one page rather than two thin duplicates.
  function entry(bare, lang, priority, changefreq, lastmod) {
    const links = alternates(bare).map((a) =>
      `    <xhtml:link rel="alternate" hreflang="${esc(a.lang)}" href="${esc(a.href)}"/>`).join('\n');
    return `  <url>\n    <loc>${esc(SITE + pathFor(bare, lang))}</loc>\n${links}\n`
      + `    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n`
      + `    <priority>${priority}</priority>\n  </url>`;
  }

  const pages = [{ bare: '/', priority: '1.0', changefreq: 'weekly', lastmod: today }];
  for (const c of coaches) {
    pages.push({
      bare: `/coaches/${c.slug}`, priority: '0.8', changefreq: 'monthly',
      lastmod: (c.created_at || today).slice(0, 10),
    });
  }
  const entries = [];
  for (const pg of pages) {
    for (const lang of LANGS) entries.push(entry(pg.bare, lang, pg.priority, pg.changefreq, pg.lastmod));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`
    + ` xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
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
function injectHead(html, { title, description, canonical, image, jsonLd, noindex, keepI18n,
  lang = 'fi', alts = null }) {
  const attrOf = (tag, name) => {
    const m = html.match(tag);
    const a = m && m[0].match(new RegExp(`${name}="[^"]*"`));
    return a ? ' ' + a[0] : '';
  };
  const titleI18n = keepI18n ? attrOf(/<title[^>]*>/i, 'data-i18n') : '';
  const descI18n = keepI18n ? attrOf(/<meta\s+name="description"[^>]*>/i, 'data-i18n-content') : '';
  const tags = [];
  if (canonical) tags.push(`<link rel="canonical" href="${esc(canonical)}">`);
  // hreflang must be reciprocal — every language version points at ALL of them,
  // itself included, or Google ignores the whole cluster.
  for (const a of (alts || [])) {
    tags.push(`<link rel="alternate" hreflang="${esc(a.lang)}" href="${esc(a.href)}">`);
  }
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
  tags.push(`<meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'fi_FI'}">`);
  if (alts) {
    for (const a of alts) {
      if (a.lang !== 'x-default' && a.lang !== lang) {
        tags.push(`<meta property="og:locale:alternate" content="${a.lang === 'en' ? 'en_GB' : 'fi_FI'}">`);
      }
    }
  }
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

  let out = html.replace(/<html[^>]*\slang="[^"]*"/i, `<html lang="${lang}"`);
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
function organisationJsonLd(lang = 'fi') {
  const c = COPY[lang] || COPY.fi;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: config.siteName,
    description: c.orgDesc,
    url: SITE + pathFor('/', lang),
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
        name: c.offer1,
        price: String(config.pricing.sessionPrice),
        priceCurrency: config.pricing.currency,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: c.offer2,
        price: String(config.groupTraining.pricePerPlayer),
        priceCurrency: config.pricing.currency,
        availability: 'https://schema.org/InStock',
      },
    ],
  };
}

// One coach. Person + the service they offer, so a "jalkapallovalmentaja
// <city>" search has something concrete to match and show.
function coachJsonLd(coach, url, lang = 'fi') {
  const c = COPY[lang] || COPY.fi;
  const locations = parseJSON(coach.locations, []);
  const photo = parseJSON(coach.photos, [])[0];
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: coach.name,
    url,
    jobTitle: c.jobTitle,
    worksFor: { '@type': 'Organization', name: config.siteName, url: SITE },
    knowsAbout: c.knowsAbout,
  };
  if (photo) node.image = abs(photo);
  const ldBio = lang === 'en' ? (coach.bio_en || coach.bio) : coach.bio;
  if (ldBio) node.description = clamp(ldBio, 300);
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

// The static markup links to the Finnish pages ("/", "/#coaches", the brand
// logo). On an English page those have to point at the English twins, or a
// crawler reads the English section as a cul-de-sac that only leads back to
// Finnish — and a reader clicking the logo silently changes language.
// Only MIRRORED targets are touched; /login, /api and assets are left alone.
// (The client does the same for links it generates — see I18N.url().)
function localiseLinks(html, lang) {
  if (lang !== 'en') return html;
  return html.replace(/href="(\/[^"]*)"/g, (whole, href) => {
    if (/^\/en(?=[/#?]|$)/.test(href)) return whole;
    const pathPart = href.split(/[#?]/)[0];
    const mirrored = pathPart === '/' || /^\/coaches\/[^/]+\/?$/.test(pathPart);
    return mirrored ? `href="/en${href === '/' ? '' : href}"` : whole;
  });
}

// SEO copy, both languages side by side so they cannot drift apart. This is
// the text that appears in a search result, so it is written for a searcher
// ("football coaching in Helsinki"), not lifted from the page headings.
const COPY = {
  fi: {
    homeTitle: (cities) => `${config.siteName} — henkilökohtaista jalkapallovalmennusta nuorille pelaajille`,
    homeDesc: (cities, price) => `Henkilökohtaista jalkapallovalmennusta nuorille pelaajille: ${cities}. `
      + `Varaa 1-on-1-treeni ${price} € valmentajalta, joka pelaa itse kilpatasolla.`,
    coachTitle: (name, city) => `${name} — jalkapallovalmentaja${city ? ' ' + city : ''} | ${config.siteName}`,
    coachDescWithBio: (name, where, bio) => `${name}, jalkapallovalmentaja (${where}). ${bio}`,
    coachDesc: (name, where, price) => `Varaa henkilökohtainen jalkapallotreeni: ${name}, ${where}. `
      + `${price} € / 60 min.`,
    notFound: `Valmentajaa ei löytynyt — ${config.siteName}`,
    orgDesc: 'Henkilökohtaista jalkapallovalmennusta nuorille pelaajille pääkaupunkiseudulla. '
      + '1-on-1-treenit valmentajilta, jotka pelaavat itse kilpatasolla.',
    jobTitle: 'Jalkapallovalmentaja',
    knowsAbout: ['Jalkapallo', 'Henkilökohtainen valmennus', 'Nuorten urheiluvalmennus'],
    offer1: 'Henkilökohtainen jalkapallotreeni (60 min)',
    offer2: 'Ryhmätreeni',
    and: (list) => list.join(', ').replace(/, ([^,]*)$/, ' ja $1'),
  },
  en: {
    homeTitle: () => `${config.siteName} — 1-on-1 football coaching for young players in Helsinki`,
    homeDesc: (cities, price) => `Personal football coaching for young players in ${cities}. `
      + `Book a 1-on-1 session for €${price} with a coach who still plays competitively.`,
    coachTitle: (name, city) => `${name} — football coach${city ? ' in ' + city : ''} | ${config.siteName}`,
    coachDescWithBio: (name, where, bio) => `${name}, football coach in ${where}. ${bio}`,
    coachDesc: (name, where, price) => `Book a 1-on-1 football session with ${name} in ${where}. `
      + `€${price} for 60 minutes.`,
    notFound: `Coach not found — ${config.siteName}`,
    orgDesc: 'Personal football coaching for young players across the Helsinki capital region. '
      + '1-on-1 sessions with coaches who still play competitively.',
    jobTitle: 'Football coach',
    knowsAbout: ['Football', 'Personal coaching', 'Youth sports coaching'],
    offer1: 'Personal football session (60 min)',
    offer2: 'Group session',
    and: (list) => list.join(', ').replace(/, ([^,]*)$/, ' and $1'),
  },
};

function renderHome(lang = 'fi') {
  const c = COPY[lang] || COPY.fi;
  const cities = c.and(config.locations);
  return injectHead(localiseLinks(readPage('index.html'), lang), {
    title: c.homeTitle(cities),
    description: c.homeDesc(cities, config.pricing.sessionPrice),
    canonical: SITE + pathFor('/', lang),
    jsonLd: organisationJsonLd(lang),
    alts: alternates('/'),
    lang,
    // The Finnish page keeps its i18n hooks (server text and dictionary agree);
    // the English page must NOT, or the client would repaint it in Finnish.
    keepI18n: lang === 'fi',
  });
}

// A coach profile. Every one of these used to serve the same generic title and
// description, so six real pages competed as one duplicate — the single
// biggest thing standing between this site and local search traffic.
function renderCoachProfile(slug, lang = 'fi') {
  const c = COPY[lang] || COPY.fi;
  const coach = db.prepare('SELECT * FROM coaches WHERE slug = ? AND active = 1').get(String(slug));
  const html = localiseLinks(readPage('coach-profile.html'), lang);
  if (!coach) {
    // Unknown or deactivated coach: the page renders its own not-found state,
    // but it must never be indexed as if it were a real profile.
    return injectHead(html, { title: c.notFound, canonical: null, noindex: true, lang });
  }
  const bare = `/coaches/${coach.slug}`;
  const url = SITE + pathFor(bare, lang);
  const locations = parseJSON(coach.locations, []);
  const where = locations.length ? c.and(locations) : config.locations[0];
  const photo = parseJSON(coach.photos, [])[0];
  // bio_en is the coach's own English bio; '' means it was never translated, so
  // fall back to the Finnish one rather than showing nothing.
  const bio = lang === 'en' ? (coach.bio_en || coach.bio) : coach.bio;
  return injectHead(html, {
    title: c.coachTitle(coach.name, locations[0] || ''),
    description: bio
      ? clamp(c.coachDescWithBio(coach.name, where, bio), 155)
      : c.coachDesc(coach.name, where, config.pricing.sessionPrice),
    canonical: url,
    image: photo ? abs(photo) : null,
    jsonLd: coachJsonLd(coach, url, lang),
    alts: alternates(bare),
    lang,
  });
}

// Signed-in pages. Nothing to index — they are empty shells until a script
// fills them for one specific person — so they say so explicitly.
function renderPrivate(file, title) {
  return injectHead(readPage(file), { title, canonical: null, noindex: true, keepI18n: true });
}

module.exports = { robotsTxt, sitemapXml, renderHome, renderCoachProfile, renderPrivate };
