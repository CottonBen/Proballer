// Financial-model calculation engine — PURE functions only: no DOM, no
// network, no globals. The /admin/financial-model page renders what this
// returns, and the same file runs under Node for unit tests (export guard at
// the bottom).
//
// Everything here operates on MODELLED assumptions (plain numbers) and
// produces derived values. It never reads or writes business data.
//
// Money is in EUROS (floats) per MONTH unless a name says Annual.
//
// Definitions (also explained in the UI):
//   sessions          = customers × sessionsPerCustomer
//   revenue           = sessions × price        (or customers × arpc override)
//   variable costs    = sessions × (per-session costs) + revenue × (%-of-revenue costs)
//   gross profit      = revenue − variable costs
//   gross margin      = gross profit ÷ revenue × 100
//   pre-tax profit    = gross profit − fixed costs
//   tax (default)     = max(0, pre-tax profit) × rate   — losses carry no negative tax
//   tax (opt-in)      = revenue × rate                  — explicit revenue basis
//   net profit        = pre-tax profit − tax
//   net margin        = net profit ÷ revenue × 100
//   contribution      = what ONE extra session adds toward fixed costs:
//                       price × (1 − %-of-revenue costs) − per-session costs
//   break-even        = fixed costs ÷ contribution  (in sessions)
'use strict';

const FM = (() => {
  const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Bounds keep every input sane: no negatives, no runaway values, taxes and
  // percentages inside 0–100.
  function normalize(a = {}) {
    return {
      price: clamp(num(a.price), 0, 10000),
      customers: clamp(num(a.customers), 0, 100000),
      sessionsPerCustomer: clamp(num(a.sessionsPerCustomer), 0, 100),
      newCustomersPerMonth: clamp(num(a.newCustomersPerMonth), 0, 10000),
      arpc: clamp(num(a.arpc), 0, 100000), // optional avg-revenue-per-customer override; 0 = off
      coachMode: a.coachMode === 'pct' ? 'pct' : 'per_session',
      coachCost: clamp(num(a.coachCost), 0, 10000),
      coachPct: clamp(num(a.coachPct), 0, 100),
      extraFixed: clamp(num(a.extraFixed), 0, 1000000),
      taxRate: clamp(num(a.taxRate), 0, 100),
      taxBasis: a.taxBasis === 'revenue' ? 'revenue' : 'profit',
      costs: Array.isArray(a.costs) ? a.costs
        .filter((c) => c && c.active !== false)
        .map((c) => ({
          kind: ['fixed', 'per_session', 'pct_revenue'].includes(c.kind) ? c.kind : 'fixed',
          amountEur: clamp(num(c.amountEur), 0, 1000000),
          percent: clamp(num(c.percent), 0, 100),
        })) : [],
    };
  }

  // Cost structure: fixed (operating) vs the two variable (direct) shapes.
  function costParts(a) {
    let fixed = a.extraFixed;
    let perSession = 0; // € per session held
    let pctRevenue = 0; // % of revenue
    for (const c of a.costs) {
      if (c.kind === 'fixed') fixed += c.amountEur;
      else if (c.kind === 'per_session') perSession += c.amountEur;
      else pctRevenue += c.percent;
    }
    if (a.coachMode === 'per_session') perSession += a.coachCost;
    else pctRevenue += a.coachPct;
    return { fixed, perSession, pctRevenue: Math.min(pctRevenue, 100) };
  }

  function breakEven({ fixedCosts, contribution, priceEff, sessionsPerCustomer }) {
    if (fixedCosts <= 0) {
      return { reachable: true, sessionsExact: 0, sessions: 0, revenue: 0, customers: 0 };
    }
    if (contribution <= 0) {
      // Every session loses money (or adds nothing) — no volume breaks even.
      return { reachable: false, sessionsExact: null, sessions: null, revenue: null, customers: null };
    }
    const sessionsExact = fixedCosts / contribution;
    return {
      reachable: true,
      sessionsExact,
      sessions: Math.ceil(sessionsExact - 1e-9),
      revenue: sessionsExact * priceEff,
      customers: sessionsPerCustomer > 0 ? Math.ceil(sessionsExact / sessionsPerCustomer - 1e-9) : null,
    };
  }

  // Forward derivation: assumptions in, every derived value out.
  function derive(raw) {
    const a = normalize(raw);
    const parts = costParts(a);
    const sessions = a.customers * a.sessionsPerCustomer;
    const revenue = a.arpc > 0 ? a.customers * a.arpc : sessions * a.price;
    // Effective earnings of one session (equals price unless the ARPC
    // override drives revenue) — the basis for contribution and break-even.
    const priceEff = a.arpc > 0 ? (sessions > 0 ? revenue / sessions : 0) : a.price;
    const variableCosts = sessions * parts.perSession + revenue * parts.pctRevenue / 100;
    const fixedCosts = parts.fixed;
    const grossProfit = revenue - variableCosts;
    const preTaxProfit = grossProfit - fixedCosts;
    const tax = a.taxBasis === 'revenue'
      ? revenue * a.taxRate / 100
      : Math.max(0, preTaxProfit) * a.taxRate / 100;
    const netProfit = preTaxProfit - tax;
    const contribution = priceEff * (1 - parts.pctRevenue / 100) - parts.perSession;
    return {
      assumptions: a,
      sessions,
      revenue,
      revenueAnnual: revenue * 12,
      revenuePerCustomer: a.customers > 0 ? revenue / a.customers : null,
      variableCosts,
      fixedCosts,
      totalCosts: variableCosts + fixedCosts,
      totalCostsAnnual: (variableCosts + fixedCosts) * 12,
      grossProfit,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : null,
      preTaxProfit,
      tax,
      netProfit,
      netProfitAnnual: netProfit * 12,
      netMarginPct: revenue > 0 ? (netProfit / revenue) * 100 : null,
      contribution,
      priceEff,
      breakEven: breakEven({ fixedCosts, contribution, priceEff, sessionsPerCustomer: a.sessionsPerCustomer }),
    };
  }

  // -------------------------------------------------------------------------
  // Reverse solver ("what do I need to hit the target?").
  //   target:   { type: 'revenue'|'revenueAnnual'|'profit'|'profitAnnual'|'netMargin', value }
  //   solveFor: 'price' | 'customers' | 'sessionsPerCustomer' | 'sessions'
  // Every other assumption stays constant; the caller's inputs are never
  // touched — the result is a separate TARGET SCENARIO.
  //
  // Implementation: the metric is monotonic in each solve variable, so a sign-
  // change bisection is exact within cents and immune to the algebra of tax
  // bases, %-of-revenue costs and the ARPC override. Whole customers/sessions
  // round UP (you can't hit a target with a fraction of a customer); price
  // rounds up to the next cent.
  // -------------------------------------------------------------------------
  const SOLVE_MAX = { price: 10000, customers: 100000, sessionsPerCustomer: 100, sessions: 1000000 };

  function solve(raw, target, solveFor) {
    const base = normalize(raw);
    const value = Number(target && target.value);
    const type = target && target.type;
    if (!['revenue', 'revenueAnnual', 'profit', 'profitAnnual', 'netMargin'].includes(type)
        || !Number.isFinite(value)) return { ok: false, reason: 'bad_target' };
    if (!(solveFor in SOLVE_MAX)) return { ok: false, reason: 'bad_solve_for' };
    if (solveFor === 'sessions' && base.sessionsPerCustomer <= 0) {
      return { ok: false, reason: 'needs_sessions_per_customer' };
    }
    const monthlyTarget = (type === 'revenueAnnual' || type === 'profitAnnual') ? value / 12 : value;

    const metricOf = (d) => {
      if (type === 'revenue' || type === 'revenueAnnual') return d.revenue;
      if (type === 'profit' || type === 'profitAnnual') return d.netProfit;
      return d.netMarginPct === null ? -Infinity : d.netMarginPct; // netMargin
    };
    const apply = (x) => {
      const a = { ...base };
      if (solveFor === 'price') { a.price = x; a.arpc = 0; } // solving price switches the ARPC override off
      else if (solveFor === 'customers') a.customers = x;
      else if (solveFor === 'sessionsPerCustomer') a.sessionsPerCustomer = x;
      else a.customers = x / base.sessionsPerCustomer; // 'sessions' -> continuous customers
      return derive(a);
    };
    const g = (x) => metricOf(apply(x)) - monthlyTarget;

    const hiBound = SOLVE_MAX[solveFor];
    const g0 = g(0);
    const gHi = g(hiBound);
    if (g0 === gHi) return { ok: false, reason: 'no_effect' }; // variable doesn't move the metric
    const increasing = gHi > g0;
    const atLow = increasing ? g0 : gHi;
    const atHigh = increasing ? gHi : g0;
    if (atHigh < 0) return { ok: false, reason: 'unreachable' };
    let x;
    if (atLow >= 0) {
      x = increasing ? 0 : hiBound; // already met at the extreme
    } else {
      let lo = 0;
      let hi = hiBound;
      for (let i = 0; i < 90; i++) {
        const mid = (lo + hi) / 2;
        const below = g(mid) < 0;
        if (below === increasing) lo = mid; else hi = mid;
      }
      x = increasing ? hi : lo; // the side that meets/exceeds the target
    }
    // Round toward the side that still MEETS the target: up when the metric
    // grows with x, down when it shrinks with x (e.g. customers under a
    // negative contribution) — otherwise the whole-unit answer would overshoot
    // past the target it claims to hit.
    if (solveFor === 'customers' || solveFor === 'sessions') {
      x = increasing ? Math.ceil(x - 1e-6) : Math.floor(x + 1e-6);
    } else {
      x = increasing ? Math.ceil(x * 100 - 1e-4) / 100 : Math.floor(x * 100 + 1e-4) / 100;
    }
    const derived = apply(x);
    return {
      ok: true,
      solveFor,
      value: x,
      targetType: type,
      targetMonthly: monthlyTarget,
      derived,
      // sessions the solved scenario implies (whole sessions, rounded up)
      requiredSessions: Math.ceil(derived.sessions - 1e-6),
      requiredCustomers: Math.ceil(derived.assumptions.customers - 1e-6),
    };
  }

  // 12-month projection with simple linear customer growth. Month 0 = the
  // current model; each later month adds newCustomersPerMonth customers.
  function projection(raw, months = 12) {
    const a = normalize(raw);
    const out = [];
    for (let m = 0; m < months; m++) {
      const d = derive({ ...a, customers: a.customers + a.newCustomersPerMonth * m });
      out.push({
        month: m + 1,
        customers: a.customers + a.newCustomersPerMonth * m,
        revenue: d.revenue,
        totalCosts: d.totalCosts,
        netProfit: d.netProfit,
      });
    }
    return out;
  }

  return { normalize, costParts, derive, solve, projection, breakEven };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FM;
