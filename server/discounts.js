// Promo / discount codes. A code takes either a percentage or a fixed euro
// amount off a purchase, and can be limited by a number of uses, an expiry
// date, or both. Codes stack on top of the launch sale (callers pass the
// post-sale price as the base). Usage is DERIVED — the count of non-cancelled
// purchases carrying the code — so a cancelled booking frees its use with no
// bookkeeping, exactly like package sessions.
'use strict';

const { db, nowISO } = require('./db');

function norm(code) { return String(code || '').trim().toUpperCase(); }

function find(code) {
  const c = norm(code);
  return c ? (db.prepare('SELECT * FROM discounts WHERE code = ?').get(c) || null) : null;
}

// How many times the code has actually been redeemed right now: live bookings,
// group spots and packages that carry it (cancelled/void ones don't count).
function usesOf(code) {
  const c = norm(code);
  if (!c) return 0;
  const b = db.prepare("SELECT COUNT(*) n FROM bookings WHERE discount_code = ? AND status != 'cancelled'").get(c).n;
  const g = db.prepare("SELECT COUNT(*) n FROM group_signups WHERE discount_code = ? AND status != 'cancelled'").get(c).n;
  const p = db.prepare("SELECT COUNT(*) n FROM packages WHERE discount_code = ? AND status != 'void'").get(c).n;
  return b + g + p;
}

// Currently redeemable? Returns { discount } or { error }.
function validate(code) {
  const d = find(code);
  if (!d) return { error: 'That discount code is not valid.' };
  if (!d.active) return { error: 'That discount code is no longer active.' };
  if (d.expires_at && d.expires_at <= nowISO()) return { error: 'That discount code has expired.' };
  if (d.max_uses != null && usesOf(d.code) >= d.max_uses) return { error: 'That discount code has been fully used.' };
  return { discount: d };
}

// Euro-cents a discount takes off a base charge — never below 0, and a fixed
// code never exceeds the base (so the customer is never "owed" money).
function computeCents(d, baseCents) {
  if (baseCents <= 0) return 0;
  const off = d.kind === 'percent' ? Math.round(baseCents * d.percent / 100) : d.amount_cents;
  return Math.max(0, Math.min(off, baseCents));
}

// Validate a code and apply it to a base charge. Empty code = clean no-op.
// Returns { code, discountCents, finalCents, discount } or { error }.
function apply(baseCents, code) {
  const c = norm(code);
  if (!c) return { code: '', discountCents: 0, finalCents: baseCents };
  const v = validate(c);
  if (v.error) return { error: v.error };
  const discountCents = computeCents(v.discount, baseCents);
  return { code: c, discountCents, finalCents: Math.max(0, baseCents - discountCents), discount: v.discount };
}

// Short human label, e.g. "20 %" or "10,00 €".
function label(d) {
  return d.kind === 'percent'
    ? `${Number(d.percent) % 1 === 0 ? Number(d.percent) : Number(d.percent).toFixed(1)} %`
    : (d.amount_cents / 100).toFixed(2).replace('.', ',') + ' €';
}

// Accepts 'YYYY-MM-DD' (end of that day) or a full ISO string; '' / null clears.
// Returns an ISO string, null, or false when the input is unparseable.
function normExpiry(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59.999Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? false : new Date(t).toISOString();
}

// ---- Admin management ------------------------------------------------------
function list() {
  return db.prepare('SELECT * FROM discounts ORDER BY active DESC, id DESC').all()
    .map((d) => ({ ...d, uses: usesOf(d.code), label: label(d) }));
}

function create(f) {
  const code = norm(f.code);
  if (!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(code)) {
    return { error: 'Code must be 2–32 characters (letters, numbers, . _ -).' };
  }
  const kind = f.kind === 'fixed' ? 'fixed' : 'percent';
  const percent = kind === 'percent' ? Number(f.percent) : 0;
  const amountCents = kind === 'fixed'
    ? Math.round(Number(f.amountCents != null ? f.amountCents : Number(f.amount) * 100) || 0) : 0;
  if (kind === 'percent' && !(percent > 0 && percent <= 100)) return { error: 'Percentage must be between 0 and 100.' };
  if (kind === 'fixed' && !(amountCents > 0)) return { error: 'Amount must be more than 0 €.' };
  const maxUses = f.maxUses == null || f.maxUses === '' ? null : Math.max(1, Math.round(Number(f.maxUses)));
  if (maxUses != null && !Number.isFinite(maxUses)) return { error: 'Max uses must be a whole number.' };
  const expiresAt = normExpiry(f.expiresAt);
  if (expiresAt === false) return { error: 'That expiry date is not valid.' };
  try {
    const info = db.prepare(`INSERT INTO discounts
      (code, kind, percent, amount_cents, max_uses, expires_at, active, notes, created_at)
      VALUES (?,?,?,?,?,?,1,?,?)`)
      .run(code, kind, percent, amountCents, maxUses, expiresAt, String(f.notes || '').slice(0, 200), nowISO());
    return { id: Number(info.lastInsertRowid) };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { error: 'A discount with that code already exists.' };
    throw e;
  }
}

// Post-creation you can only toggle active, adjust the limits, or edit the note
// — never the code or amount (that would silently change what past redemptions
// meant). Delete and recreate to change those.
function update(id, f) {
  const d = db.prepare('SELECT * FROM discounts WHERE id = ?').get(Number(id));
  if (!d) return { error: 'Discount not found.' };
  const active = f.active == null ? d.active : (f.active ? 1 : 0);
  const maxUses = f.maxUses === undefined ? d.max_uses
    : (f.maxUses == null || f.maxUses === '' ? null : Math.max(1, Math.round(Number(f.maxUses))));
  let expiresAt = d.expires_at;
  if (f.expiresAt !== undefined) {
    expiresAt = normExpiry(f.expiresAt);
    if (expiresAt === false) return { error: 'That expiry date is not valid.' };
  }
  const notes = f.notes === undefined ? d.notes : String(f.notes || '').slice(0, 200);
  db.prepare('UPDATE discounts SET active = ?, max_uses = ?, expires_at = ?, notes = ? WHERE id = ?')
    .run(active, maxUses, expiresAt, notes, d.id);
  return { ok: true };
}

function remove(id) {
  db.prepare('DELETE FROM discounts WHERE id = ?').run(Number(id));
  return { ok: true };
}

module.exports = {
  norm, find, usesOf, validate, computeCents, apply, label, normExpiry,
  list, create, update, remove,
};
