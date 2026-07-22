// Unit tests for the pure financial-model engine (public/js/fm-model.js).
// Covers the spec's worked examples, forward/reverse consistency and edges.
'use strict';
const FM = require('../public/js/fm-model.js');

let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// --- forward derivation (spec Phase 6 example) -------------------------------
let d = FM.derive({ price: 40, customers: 50, sessionsPerCustomer: 2 });
check('sessions = customers × sessions/customer (100)', d.sessions === 100);
check('revenue = sessions × price (4000)', d.revenue === 4000);
check('annual revenue = 12 × monthly', d.revenueAnnual === 48000);
d = FM.derive({ price: 45, customers: 50, sessionsPerCustomer: 2 });
check('price change updates revenue (4500)', d.revenue === 4500);
check('price change does NOT change customers', d.assumptions.customers === 50);

// --- margins + tax chain -----------------------------------------------------
const base = {
  price: 40, customers: 100, sessionsPerCustomer: 2,
  coachMode: 'per_session', coachCost: 20, extraFixed: 1000, taxRate: 20, taxBasis: 'profit',
};
d = FM.derive(base);
check('revenue 8000', d.revenue === 8000);
check('variable costs = 200 sessions × 20 € (4000)', d.variableCosts === 4000);
check('gross profit = revenue − variable (4000)', d.grossProfit === 4000);
check('gross margin 50 %', near(d.grossMarginPct, 50));
check('pre-tax profit = gross − fixed (3000)', d.preTaxProfit === 3000);
check('tax 20 % of profit (600)', near(d.tax, 600));
check('net profit 2400', near(d.netProfit, 2400));
check('net margin 30 %', near(d.netMarginPct, 30));
check('contribution per session 20 €', near(d.contribution, 20));

// coach cost changes gross profit + margin
d = FM.derive({ ...base, coachCost: 25 });
check('coach cost ↑ lowers gross profit (3000)', d.grossProfit === 3000);
check('coach cost ↑ lowers gross margin (37.5 %)', near(d.grossMarginPct, 37.5));
// fixed cost changes net but not gross
d = FM.derive({ ...base, extraFixed: 2000 });
check('fixed cost ↑ leaves gross margin at 50 %', near(d.grossMarginPct, 50));
check('fixed cost ↑ lowers net profit (1600)', near(d.netProfit, 1600));
// tax changes net
d = FM.derive({ ...base, taxRate: 0 });
check('0 % tax → net = pre-tax (3000)', near(d.netProfit, 3000));
d = FM.derive({ ...base, taxRate: 100 });
check('100 % tax → net profit 0', near(d.netProfit, 0));
// revenue-based tax opt-in
d = FM.derive({ ...base, taxBasis: 'revenue', taxRate: 10 });
check('revenue tax basis: tax = 10 % of revenue (800)', near(d.tax, 800));
check('revenue tax basis: net = 3000 − 800 = 2200', near(d.netProfit, 2200));
// losses carry no negative profit tax
d = FM.derive({ ...base, extraFixed: 10000 });
check('loss: pre-tax −6000', near(d.preTaxProfit, -6000));
check('loss: profit-based tax is 0', d.tax === 0);
check('loss: net profit −6000 (negative displays)', near(d.netProfit, -6000));
check('loss: net margin −75 %', near(d.netMarginPct, -75));

// percentage-of-revenue variable cost (e.g. Stripe fee)
d = FM.derive({ ...base, costs: [{ kind: 'pct_revenue', percent: 1.5, active: true }] });
check('pct-of-revenue cost joins variable costs (4000 + 120)', near(d.variableCosts, 4120));
check('contribution accounts for pct cost (19.4)', near(d.contribution, 40 * 0.985 - 20));
// per-session itemized cost
d = FM.derive({ ...base, costs: [{ kind: 'per_session', amountEur: 5, active: true }] });
check('per-session cost joins variable costs (5000)', near(d.variableCosts, 5000));
// inactive costs are ignored
d = FM.derive({ ...base, costs: [{ kind: 'fixed', amountEur: 500, active: false }] });
check('inactive cost ignored', d.fixedCosts === 1000);
// itemized fixed cost adds to slider fixed
d = FM.derive({ ...base, costs: [{ kind: 'fixed', amountEur: 500, active: true }] });
check('itemized fixed adds to extra fixed (1500)', d.fixedCosts === 1500);

// --- break-even (spec Phase 10 example) --------------------------------------
d = FM.derive({ price: 40, customers: 0, sessionsPerCustomer: 2, coachCost: 20, extraFixed: 1000 });
check('BE contribution 20 €', near(d.contribution, 20));
check('BE sessions 50', d.breakEven.sessions === 50);
check('BE customers 25 (2 sessions/customer)', d.breakEven.customers === 25);
check('BE revenue 2000', near(d.breakEven.revenue, 2000));
d = FM.derive({ price: 20, customers: 10, sessionsPerCustomer: 2, coachCost: 25, extraFixed: 1000 });
check('negative contribution → break-even unreachable', d.breakEven.reachable === false);
d = FM.derive({ price: 40, customers: 10, sessionsPerCustomer: 2, coachCost: 20, extraFixed: 0 });
check('no fixed costs → break-even at 0 sessions', d.breakEven.sessions === 0);

// --- edge cases --------------------------------------------------------------
d = FM.derive({});
check('all-zero model: no NaN/Infinity', d.revenue === 0 && d.netProfit === 0
  && d.grossMarginPct === null && d.netMarginPct === null && !Number.isNaN(d.tax));
d = FM.derive({ price: -5, customers: -3, sessionsPerCustomer: -1, taxRate: 250 });
check('negatives clamp to 0, tax caps at 100', d.assumptions.price === 0
  && d.assumptions.customers === 0 && d.assumptions.taxRate === 100);
d = FM.derive({ price: 39.9, customers: 100000, sessionsPerCustomer: 2.5, coachCost: 19.95 });
check('decimals + very high volume stay finite', Number.isFinite(d.netProfit) && d.sessions === 250000);
d = FM.derive({ price: 40, customers: 10, sessionsPerCustomer: 2, arpc: 100 });
check('ARPC override: revenue = customers × arpc (1000)', d.revenue === 1000);
check('ARPC override: effective price = 50 €/session', near(d.priceEff, 50));

// --- reverse solver (spec Phase 7 examples) ----------------------------------
const cur = { price: 40, customers: 100, sessionsPerCustomer: 2 };
let s = FM.solve(cur, { type: 'revenue', value: 10000 }, 'price');
check('solve price for 10 000 € revenue → 50 €', s.ok && near(s.value, 50), s);
s = FM.solve(cur, { type: 'revenue', value: 10000 }, 'customers');
check('solve customers for 10 000 € revenue → 125', s.ok && s.value === 125, s);
s = FM.solve(cur, { type: 'revenue', value: 10000 }, 'sessions');
check('solve sessions for 10 000 € revenue → 250', s.ok && s.value === 250, s);
s = FM.solve(cur, { type: 'revenue', value: 10000 }, 'sessionsPerCustomer');
check('solve sessions/customer for 10 000 € → 2.5', s.ok && near(s.value, 2.5), s);
check('solver does not mutate the input model', cur.price === 40 && cur.customers === 100);

// spec Phase 11: price 45, S=2, target 10 000 → sessions 223, customers 112
s = FM.solve({ price: 45, customers: 1, sessionsPerCustomer: 2 }, { type: 'revenue', value: 10000 }, 'sessions');
check('required sessions = 223 (ceiling)', s.ok && s.value === 223, s && s.value);
s = FM.solve({ price: 45, customers: 1, sessionsPerCustomer: 2 }, { type: 'revenue', value: 10000 }, 'customers');
check('required customers = 112 (ceiling)', s.ok && s.value === 112, s && s.value);

// profit target (spec Phase 8): price 45, coach 20, fixed 1000, tax 20 %,
// target net 5000 → PTP 6250 → GP 7250 → sessions 7250/25 = 290 → customers 145
const p8 = { price: 45, customers: 1, sessionsPerCustomer: 2, coachCost: 20, extraFixed: 1000, taxRate: 20 };
s = FM.solve(p8, { type: 'profit', value: 5000 }, 'sessions');
check('profit target: required sessions 290', s.ok && s.value === 290, s && s.value);
s = FM.solve(p8, { type: 'profit', value: 5000 }, 'customers');
check('profit target: required customers 145', s.ok && s.value === 145, s && s.value);
s = FM.solve({ ...p8, customers: 100 }, { type: 'profit', value: 5000 }, 'price');
// 200 sessions: PTP*=6250, GP*=7250 → P = (7250/200 + 20) = 56.25
check('profit target: required price 56.25 €', s.ok && near(s.value, 56.25), s && s.value);
check('solved scenario meets the target', s.ok && s.derived.netProfit >= 5000 - 0.01, s.derived && s.derived.netProfit);

// annual targets are monthly ÷ 12
s = FM.solve(cur, { type: 'revenueAnnual', value: 120000 }, 'customers');
check('annual revenue target → monthly ÷ 12 (125 customers)', s.ok && s.value === 125, s && s.value);

// net-margin target: base has NM 30 % at 100 customers; higher margin needs more volume
s = FM.solve(base, { type: 'netMargin', value: 35 }, 'customers');
check('net-margin target solvable via customers', s.ok && s.value > 100, s && s.value);
check('margin met at solved volume', s.ok && s.derived.netMarginPct >= 35 - 0.05, s.derived && s.derived.netMarginPct);
// structural ceiling: with 20 % tax and 50 % gross margin, NM can never hit 45 %
s = FM.solve(base, { type: 'netMargin', value: 45 }, 'customers');
check('impossible margin → unreachable', !s.ok && s.reason === 'unreachable', s);

// decreasing metric (negative contribution): whole units round DOWN so the
// answer still meets the target instead of overshooting past it
s = FM.solve({ price: 20, customers: 10, sessionsPerCustomer: 2, coachCost: 25, extraFixed: 1000 },
  { type: 'profit', value: -1505 }, 'customers');
check('decreasing solve floors to stay on target (50)', s.ok && s.value === 50, s && s.value);
check('floored answer still meets the target', s.ok && s.derived.netProfit >= -1505, s.derived && s.derived.netProfit);

// unreachable + no-effect guards
s = FM.solve({ price: 40, customers: 0, sessionsPerCustomer: 0 }, { type: 'revenue', value: 1000 }, 'price');
check('zero sessions: price has no effect → clear reason', !s.ok && s.reason === 'no_effect', s);
s = FM.solve({ price: 0, customers: 10, sessionsPerCustomer: 2 }, { type: 'revenue', value: 10 ** 12 }, 'price');
check('absurd target → unreachable', !s.ok && s.reason === 'unreachable', s);
s = FM.solve(cur, { type: 'revenue', value: 0 }, 'customers');
check('target already met at zero → 0 required', s.ok && s.value === 0, s);

// --- projection --------------------------------------------------------------
const proj = FM.projection({ ...base, newCustomersPerMonth: 10 });
check('projection: 12 months', proj.length === 12);
check('projection month 1 = current model', near(proj[0].revenue, 8000));
check('projection month 12 = +110 customers', proj[11].customers === 210 && near(proj[11].revenue, 210 * 2 * 40));
check('projection profits stay finite', proj.every((m) => Number.isFinite(m.netProfit)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
