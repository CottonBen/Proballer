// One-way sync of CRM-relevant data into Attio (https://attio.com).
//
// WHAT SYNCS: customers and website leads become Attio *People*; their bookings,
// group spots and packages become Attio *Deals* linked to that person. Coaches
// and admins are staff, not sales contacts, so they are never synced.
//
// SYSTEM OF RECORD: the app stays authoritative for bookings, invoices, payments
// and payouts. Attio only ever RECEIVES a copy for relationship/pipeline work —
// nothing here reads back from Attio, and a booking is never blocked or changed
// by an Attio error.
//
// SETUP (see README "Connect Attio"):
//   1. In Attio: Settings → Developers → create an access token with scopes
//      record_permission:read-write and object_configuration:read-write.
//   2. Run the server (and the one-time backfill) with ATTIO_API_KEY=<token>.
// Without the key everything here is a no-op, so tests and demo mode are clean.
//
// SAFETY: every hook is fire-and-forget (never awaited in a request) and every
// error is swallowed with a log line. A person upsert that Attio rejects for a
// bad field is retried with the minimal name+email shape so the contact still
// lands. Custom fields are only written after the workspace schema is ensured.
'use strict';

const { db, nowISO } = require('./db');
const config = require('../config');

const API_BASE = 'https://api.attio.com/v2';
// Read from the environment on each call (not captured at load) so the backfill
// script and tests can toggle them regardless of require order.
function apiKey() { return process.env.ATTIO_API_KEY || ''; }
// ATTIO_DRY_RUN=1 makes every call print its payload instead of sending it —
// used by scripts/attio-backfill.js --dry-run to eyeball payloads before going
// live. Never set this on the running server.
function dryRun() { return process.env.ATTIO_DRY_RUN === '1'; }

function enabled() { return Boolean(apiKey()) || dryRun(); }

// Local bookkeeping so deals are idempotent using only documented create/patch
// endpoints — no reliance on Attio-side unique attributes. Self-contained: this
// table is written and read only here.
db.exec(`CREATE TABLE IF NOT EXISTS attio_map (
  kind TEXT NOT NULL,
  local_id INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, local_id)
)`);

function mapGet(kind, id) {
  const r = db.prepare('SELECT record_id FROM attio_map WHERE kind = ? AND local_id = ?').get(kind, id);
  return r ? r.record_id : null;
}
function mapSet(kind, id, recordId) {
  db.prepare(`INSERT INTO attio_map (kind, local_id, record_id, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(kind, local_id) DO UPDATE SET record_id = excluded.record_id, updated_at = excluded.updated_at`)
    .run(kind, id, recordId, nowISO());
}

async function req(method, path, body) {
  if (dryRun()) {
    console.log(`[attio:dry] ${method} ${path}${body ? '\n' + JSON.stringify(body, null, 2) : ''}`);
    // GET (attribute listing) returns an empty collection; writes return a
    // deterministic fake record id so downstream linking still works.
    if (method === 'GET') return { data: [] };
    return { data: { id: { record_id: `dry-${Math.abs(hash(path + (body ? JSON.stringify(body) : '')))}` } } };
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Attio ${method} ${path} -> ${resp.status} ${text}`);
    err.status = resp.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

// Tiny stable hash so dry-run deal ids are deterministic (no Math.random).
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ---- Attio value builders (canonical [{ ... }] form) ----------------------
function txt(v) { return v == null || v === '' ? undefined : [{ value: String(v) }]; }
function numv(v) { return v == null || Number.isNaN(Number(v)) ? undefined : [{ value: Number(v) }]; }
function phoneValue(phone) {
  const p = String(phone).trim();
  // A "+" number already carries its country; otherwise these are Finnish.
  return p.startsWith('+') ? { original_phone_number: p } : { original_phone_number: p, country_code: 'FI' };
}
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// Custom People attributes we own (all prefixed pb_ to avoid clashes). Created
// on demand by ensurePeopleSchema; written only when that succeeds.
const PERSON_ATTRS = [
  { api_slug: 'pb_source', title: 'Acquisition source', type: 'text' },
  { api_slug: 'pb_stage', title: 'Lifecycle stage', type: 'text' },
  { api_slug: 'pb_area', title: 'Home area', type: 'text' },
  { api_slug: 'pb_language', title: 'Language', type: 'text' },
  { api_slug: 'pb_customer_since', title: 'Customer since', type: 'text' },
  { api_slug: 'pb_sessions', title: 'Sessions booked', type: 'number' },
  { api_slug: 'pb_lifetime_eur', title: 'Lifetime value (EUR)', type: 'number' },
];

let schemaPromise = null;
function ensurePeopleSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    try {
      const list = await req('GET', '/objects/people/attributes');
      const have = new Set((list.data || []).map((a) => a.api_slug));
      for (const a of PERSON_ATTRS) {
        if (have.has(a.api_slug)) continue;
        await req('POST', '/objects/people/attributes', {
          data: { title: a.title, api_slug: a.api_slug, type: a.type, is_required: false, is_unique: false, is_multiselect: false },
        });
      }
      return true;
    } catch (e) {
      // Missing object_configuration scope, or the endpoint is unavailable:
      // fall back to standard fields + the description summary, which carry the
      // same information in text form.
      console.error('[attio] custom-field setup skipped (using standard fields only):', e.message);
      return false;
    }
  })();
  return schemaPromise;
}

// A one-line human summary written to the standard `description` field, so every
// person is readable at a glance even when custom fields are not set up.
function personSummary(p) {
  const bits = [];
  if (p.stage) bits.push(p.stage);
  if (p.source) bits.push(`Source: ${p.source}`);
  if (p.area) bits.push(`Area: ${p.area}`);
  if (p.lang) bits.push(`Lang: ${String(p.lang).toUpperCase()}`);
  if (p.since) bits.push(`Since ${p.since}`);
  if (p.sessions) bits.push(`${p.sessions} session${p.sessions === 1 ? '' : 's'}`);
  if (p.lifetimeEur) bits.push(`€${p.lifetimeEur} lifetime`);
  return bits.join(' · ');
}

// Pure — exported for tests. `schemaReady` gates the custom pb_* fields.
function buildPersonValues(p, schemaReady) {
  const values = {};
  const name = (p.name || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    values.name = [{ first_name: parts[0], last_name: parts.slice(1).join(' '), full_name: name }];
  }
  if (p.email) values.email_addresses = [{ email_address: String(p.email).toLowerCase() }];
  if (p.phone) values.phone_numbers = [phoneValue(p.phone)];
  const summary = personSummary(p);
  if (summary) values.description = [{ value: summary }];
  if (schemaReady) {
    Object.assign(values, compact({
      pb_source: txt(p.source),
      pb_stage: txt(p.stage),
      pb_area: txt(p.area),
      pb_language: txt(p.lang ? String(p.lang).toUpperCase() : ''),
      pb_customer_since: txt(p.since),
      pb_sessions: numv(p.sessions),
      pb_lifetime_eur: numv(p.lifetimeEur),
    }));
  }
  return values;
}

function buildDealValues({ name, euros, personRecordId }) {
  const values = { name: [{ value: name }] };
  if (euros != null) values.value = [{ currency_value: euros, currency_code: config.pricing.currency || 'EUR' }];
  if (personRecordId) values.associated_people = [{ target_object: 'people', target_record_id: personRecordId }];
  return values;
}

// ---- Person / deal upserts -------------------------------------------------
async function upsertPerson(p) {
  if (!p.email && !p.phone) return null;
  const schemaReady = await ensurePeopleSchema();
  const values = buildPersonValues(p, schemaReady);
  // Phone-only leads cannot be matched on email, so they are created (the app
  // dedupes open leads by contact, so this runs at most once per lead).
  if (!p.email) {
    const r = await req('POST', '/objects/people/records', { data: { values } });
    return r?.data?.id?.record_id || null;
  }
  try {
    const r = await req('PUT', '/objects/people/records?matching_attribute=email_addresses', { data: { values } });
    return r?.data?.id?.record_id || null;
  } catch (e) {
    // A rejected field must not lose the contact: retry with the minimal shape
    // Attio always accepts.
    if (e.status >= 400 && e.status < 500) {
      console.error('[attio] person upsert rejected, retrying minimal:', e.message);
      const minimal = { email_addresses: [{ email_address: String(p.email).toLowerCase() }] };
      if (values.name) minimal.name = values.name;
      const r = await req('PUT', '/objects/people/records?matching_attribute=email_addresses', { data: { values: minimal } });
      return r?.data?.id?.record_id || null;
    }
    throw e;
  }
}

async function upsertDeal(kind, localId, deal) {
  const values = buildDealValues(deal);
  const existing = mapGet(kind, localId);
  if (existing) {
    await req('PATCH', `/objects/deals/records/${existing}`, { data: { values } });
    return existing;
  }
  const r = await req('POST', '/objects/deals/records', { data: { values } });
  const rid = r?.data?.id?.record_id || null;
  // Never persist the fake dry-run id — it would make a later real sync PATCH a
  // record that does not exist.
  if (rid && !dryRun()) mapSet(kind, localId, rid);
  return rid;
}

// ---- App-shape → Attio -----------------------------------------------------
function personStats(userId) {
  const bk = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) c, MAX(date) last
    FROM bookings WHERE customer_id = ? AND status IN ('confirmed','completed')`).get(userId);
  const gs = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_cents),0) c
    FROM group_signups WHERE customer_id = ? AND status = 'confirmed'`).get(userId);
  const pk = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_cents),0) c
    FROM packages WHERE customer_id = ? AND status = 'active'`).get(userId);
  return {
    sessions: bk.n + gs.n,
    lifetimeCents: bk.c + gs.c + pk.c,
    lastDate: bk.last || null,
    hasActivity: bk.n + gs.n > 0 || pk.n > 0,
  };
}
function lifecycleStage(hasActivity) { return hasActivity ? 'Customer' : 'Signed up'; }

// Upsert a customer as a Person and return the Attio record id (for linking a
// deal). Returns null for non-customers/demo rows — they are never synced.
async function pushPerson(u) {
  if (!u || u.role !== 'customer' || u.demo) return null;
  const st = personStats(u.id);
  return upsertPerson({
    name: u.name,
    email: u.email,
    phone: u.phone,
    source: u.source || 'direct',
    area: u.area,
    lang: u.lang,
    stage: lifecycleStage(st.hasActivity),
    since: String(u.created_at || '').slice(0, 10),
    sessions: st.sessions,
    lifetimeEur: Math.round(st.lifetimeCents / 100),
  });
}

async function pushLead({ contact, kind, source }) {
  if (kind === 'email') {
    return upsertPerson({ name: 'Lead', email: contact, source: source || 'direct', stage: 'Lead' });
  }
  return upsertPerson({ name: `Lead ${contact}`, phone: contact, source: source || 'direct', stage: 'Lead' });
}

async function pushBooking(bookingId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b || b.demo || b.status === 'cancelled') return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(b.customer_id);
  const rid = await pushPerson(u);
  const coach = db.prepare('SELECT name FROM coaches WHERE id = ?').get(b.coach_id);
  const inv = db.prepare('SELECT status, at_session FROM invoices WHERE booking_id = ?').get(bookingId);
  const pay = b.credit_applied ? 'Free credit'
    : inv ? (inv.status === 'paid' ? 'Paid' : (inv.at_session ? 'Pay at session' : 'Unpaid')) : 'Paid';
  const name = `1-on-1 · ${coach ? coach.name : 'Coach'} · ${b.date} ${String(b.hour).padStart(2, '0')}:00 · ${b.location} · ${pay} [${b.code}]`;
  return upsertDeal('booking', b.id, { name, euros: Math.round(b.total_cents / 100), personRecordId: rid });
}

async function pushGroupSignup(signupId) {
  const su = db.prepare('SELECT * FROM group_signups WHERE id = ?').get(signupId);
  if (!su || su.demo || su.status !== 'confirmed') return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(su.customer_id);
  const rid = await pushPerson(u);
  const gs = db.prepare('SELECT * FROM group_sessions WHERE id = ?').get(su.group_session_id);
  const coach = gs ? db.prepare('SELECT name FROM coaches WHERE id = ?').get(gs.coach_id) : null;
  const pay = su.paid_at ? 'Paid' : 'Confirmed (unpaid)';
  const when = gs ? `${gs.date} ${String(gs.hour).padStart(2, '0')}:00 · ${gs.location}` : '';
  const name = `Group · ${coach ? coach.name : 'Coach'} · ${when} · ${pay} [${su.code}]`;
  return upsertDeal('group', su.id, { name, euros: Math.round(su.price_cents / 100), personRecordId: rid });
}

async function pushPackage(packageId) {
  const pk = db.prepare('SELECT * FROM packages WHERE id = ?').get(packageId);
  if (!pk || pk.demo || pk.status !== 'active') return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pk.customer_id);
  const rid = await pushPerson(u);
  const name = `Package · ${pk.sessions_total}×1-on-1 · Paid [${pk.code}]`;
  return upsertDeal('package', pk.id, { name, euros: Math.round(pk.price_cents / 100), personRecordId: rid });
}

// ---- Fire-and-forget wrappers (what the app calls) -------------------------
function run(label, fn) {
  if (!enabled()) return;
  Promise.resolve().then(fn).catch((e) => console.error(`[attio] ${label}:`, e.message));
}
const syncPerson = (userId) => run(`person#${userId}`, async () => pushPerson(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
const syncLead = (lead) => run(`lead:${lead.contact}`, () => pushLead(lead));
const syncBooking = (id) => run(`booking#${id}`, () => pushBooking(id));
const syncGroupSignup = (id) => run(`gsignup#${id}`, () => pushGroupSignup(id));
const syncPackage = (id) => run(`package#${id}`, () => pushPackage(id));

module.exports = {
  enabled,
  syncPerson, syncLead, syncBooking, syncGroupSignup, syncPackage,
  // Awaitable cores + pure helpers (backfill script + tests).
  pushPerson, pushLead, pushBooking, pushGroupSignup, pushPackage,
  ensurePeopleSchema, upsertPerson, upsertDeal,
  buildPersonValues, buildDealValues, personSummary, personStats, lifecycleStage, phoneValue,
  PERSON_ATTRS,
};
