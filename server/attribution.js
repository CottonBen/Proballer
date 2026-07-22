// THE one definition of "where did this person come from" — every report and
// every stamped source in the app goes through this module, so the numbers
// always agree with each other.
//
// Capture: the existing landing-page visit rows (server/app.js) get a
// `source` per view — ?utm_source=... wins, else the referrer's domain
// (normalized to a channel name), else 'direct'.
// Attribution: FIRST-touch — a person's source is the source on their visitor
// cookie's earliest landing view. It is stamped permanently onto the rows the
// business cares about at the moment they appear: contact requests (leads),
// pending signups, and customer accounts. Bookings and revenue are attributed
// through the customer's stamped source — never re-derived.
//
// Marketing tip encoded here: links in campaigns should carry ?utm_source=
// (e.g. proballerscoaching.com/?utm_source=facebook) — referrers survive most
// clicks, but utm_source is the only fully reliable signal.
'use strict';

const config = require('../config');
const { db } = require('./db');

const REFERRER_MAP = [
  [/facebook\.com|fb\.me|fb\.com|messenger\.com/i, 'facebook'],
  [/instagram\.com/i, 'instagram'],
  [/google\./i, 'google'],
  [/bing\.com/i, 'bing'],
  [/duckduckgo\.com/i, 'duckduckgo'],
  [/tiktok\.com/i, 'tiktok'],
  [/youtube\.com|youtu\.be/i, 'youtube'],
  [/whatsapp\.com|wa\.me/i, 'whatsapp'],
  [/twitter\.com|^t\.co$|(^|\.)x\.com/i, 'x'],
  [/linkedin\.com/i, 'linkedin'],
  [/futisforum|suomifutis/i, 'futisforum'],
];

let siteHost = '';
try { siteHost = new URL(config.siteUrl).hostname; } catch { /* unset in odd envs */ }

// Normalized source of ONE request (used when a landing view is logged).
function requestSource(req) {
  const utm = String((req.query && req.query.utm_source) || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (utm) return utm;
  const ref = String(req.headers.referer || req.headers.referrer || '');
  if (!ref) return 'direct';
  let host = '';
  try { host = new URL(ref).hostname; } catch { return 'direct'; }
  if (!host || host === siteHost || host === req.headers.host) return 'direct'; // in-site navigation
  for (const [re, name] of REFERRER_MAP) if (re.test(host)) return name;
  return host.replace(/^www\./, '').slice(0, 40); // unknown site: keep its domain
}

// FIRST-touch source of the visitor behind this request — used at the moment
// a lead / signup / account is created. Falls back to classifying the current
// request when the visitor has no attributed landing view (e.g. rows from
// before source tracking existed).
function visitorSource(req) {
  if (req.visitorId) {
    const first = db.prepare(`SELECT source FROM visits
      WHERE visitor_id = ? AND source != '' ORDER BY id LIMIT 1`).get(req.visitorId);
    if (first) return first.source;
  }
  return requestSource(req);
}

module.exports = { requestSource, visitorSource };
