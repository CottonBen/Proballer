// Football pitch directory for the coach app, from LIPAS — the Finnish
// national sports-facility registry run by the University of Jyväskylä
// (api.lipas.fi, open data, CC BY 4.0). We list every active football venue in
// the three operating cities and mark which ones OUR OWN sessions occupy at a
// given time. LIPAS has no live occupancy data (verified: none is published),
// so "free" always means "no Proballers session there" — the UI says so and
// links the city's own booking page for the real-world calendar.
//
// The per-city list changes rarely, so it is cached in the meta table for a
// week; if a refresh fails the stale copy is served instead (better a
// slightly old list than none on a pitch-side phone).
'use strict';

const { db, nowISO } = require('./db');

const LIPAS = 'https://api.lipas.fi/v2/sports-sites';
const CITY_CODES = { Helsinki: 91, Espoo: 49, Vantaa: 92 };
// 1340 ball field, 1350 football stadium, 2230 indoor football hall.
const TYPE_CODES = '1340,1350,2230';
const CACHE_TTL_MS = 7 * 24 * 3600000;
// v2: school pitches, dirt fields and petanque courts filtered out (below).
const CACHE_KEY = (city) => `pitches:v2:${city}`;

// Curated for real coaching use (owner's call): drop school pitches
// (koulu/skola), petanque courts, and dirt/gravel fields — by surface token
// when LIPAS provides one, by name ("hiekkakenttä"/"grusplan") when it
// doesn't. NOTE "hiekkatekonurmi" (sand-infilled artificial turf) is a proper
// turf pitch and stays: the name regex deliberately does not match it.
const NAME_EXCLUDE = /koulu|skola|petank|hiekkakenttä|grusplan/i;
const SURFACE_EXCLUDE = new Set(['rock-dust', 'sand', 'gravel', 'soil', 'clay']);
const excluded = (pitch) =>
  NAME_EXCLUDE.test(pitch.name) || pitch.surface.some((s) => SURFACE_EXCLUDE.has(s));

const knownCity = (city) => Object.prototype.hasOwnProperty.call(CITY_CODES, city);

// Squeeze one LIPAS site down to what the app shows. Surface materials stay
// as LIPAS tokens ('artificial-turf', 'grass', …) — the client translates.
function normalize(site) {
  const p = site.properties || {};
  const loc = site.location || {};
  const type = (site.type && site.type['type-code']) || 0;
  let www = String(site.www || '').trim();
  if (www && !/^https?:\/\//i.test(www)) www = 'https://' + www;
  return {
    // Numbers are coerced (the app interpolates them into HTML unescaped) and
    // free-text fields stringified, so odd registry data can't smuggle markup.
    id: Number(site['lipas-id']) || 0,
    name: String(site.name || '').trim(),
    neighborhood: String((loc.city && loc.city.neighborhood) || ''),
    address: String(loc.address || ''),
    surface: Array.isArray(p['surface-material']) ? p['surface-material'].map(String) : [],
    length: Number(p['field-length-m']) || null,
    width: Number(p['field-width-m']) || null,
    lighting: Boolean(p['ligthing?'] || p['lighting?']), // sic: LIPAS misspells the key
    indoor: type === 2230,
    stadium: type === 1350,
    www: www || null,
  };
}

async function fetchCityFromLipas(city) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${LIPAS}?city-codes=${CITY_CODES[city]}&type-codes=${TYPE_CODES}&page-size=100&page=${page}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`LIPAS ${res.status}`);
    const data = await res.json();
    for (const site of data.items || []) {
      if (site.status !== 'active') continue; // skip demolished / out-of-service
      const pitch = normalize(site);
      if (pitch.id && pitch.name && !excluded(pitch)) out.push(pitch);
    }
    if (page >= ((data.pagination && data.pagination['total-pages']) || 1)) break;
  }
  // All three cities have hundreds of pitches — an empty result is an API
  // glitch, and caching it would blank the tab for a week. Fail instead
  // (the caller falls back to the previous cached list).
  if (!out.length) throw new Error('LIPAS returned no pitches');
  out.sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return out;
}

const readCache = (city) => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(CACHE_KEY(city));
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
};

const writeCache = (city, pitches) => {
  db.prepare('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(CACHE_KEY(city), JSON.stringify({ fetchedAt: nowISO(), pitches }));
};

// The city's pitch list: fresh cache -> as-is; stale/missing -> refetch, and
// on a fetch error fall back to whatever cache exists.
async function getCityPitches(city) {
  if (!knownCity(city)) throw Object.assign(new Error('Unknown city.'), { status: 400 });
  const cached = readCache(city);
  const fresh = cached && (Date.now() - Date.parse(cached.fetchedAt)) < CACHE_TTL_MS;
  if (fresh) return cached;
  try {
    const pitches = await fetchCityFromLipas(city);
    writeCache(city, pitches);
    return { fetchedAt: nowISO(), pitches };
  } catch (err) {
    if (cached) {
      console.error(`[pitches] LIPAS refresh failed for ${city} (${err.message}) — serving cached list`);
      return cached;
    }
    throw Object.assign(new Error('The pitch registry (LIPAS) is not responding — try again in a moment.'),
      { status: 502 });
  }
}

// Does this pitch id exist in the city's cached list? Returns the pitch or null.
function findPitch(cityData, pitchId) {
  return cityData.pitches.find((p) => p.id === Number(pitchId)) || null;
}

module.exports = { getCityPitches, findPitch, knownCity, CITY_CODES };
