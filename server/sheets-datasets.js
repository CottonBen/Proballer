// The canonical "business data" datasets — used by both the Google Sheets sync
// and the admin CSV export, so the spreadsheet and the downloads always match.
const { db, autoCompleteBookings } = require('./db');

module.exports = function datasets() {
  autoCompleteBookings();
  const q = (sql) => db.prepare(sql).all();
  return {
    Bookings: q(`SELECT b.code, b.date, b.hour || ':00' AS time, c.name AS coach,
        u.name AS customer, u.email AS customer_email, b.location, b.position, b.focus,
        CASE b.is_online WHEN 1 THEN 'yes' ELSE 'no' END AS online,
        b.price_cents/100.0 AS price_eur, b.discount_cents/100.0 AS discount_eur,
        b.total_cents/100.0 AS total_eur, b.status, b.created_at, b.completed_at
      FROM bookings b JOIN coaches c ON c.id=b.coach_id JOIN users u ON u.id=b.customer_id
      ORDER BY b.date DESC, b.hour DESC`),
    Invoices: q(`SELECT i.number, i.customer_email, i.amount_cents/100.0 AS amount_eur,
        i.issued_at, i.due_date, i.status, b.code AS booking_code
      FROM invoices i JOIN bookings b ON b.id=i.booking_id ORDER BY i.id DESC`),
    Coaches: q(`SELECT name, bio, locations, positions,
        CASE active WHEN 1 THEN 'yes' ELSE 'no' END AS active FROM coaches ORDER BY display_order`),
    Availability: q(`SELECT c.name AS coach, a.date, a.hour || ':00-' || (a.hour+1) || ':00' AS slot
      FROM availability a JOIN coaches c ON c.id=a.coach_id
      WHERE a.date >= date('now','-7 day') ORDER BY a.date, a.hour`),
    VisitsDaily: q(`SELECT day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_id) AS visitors
      FROM visits GROUP BY day ORDER BY day DESC`),
    Funnel: q(`SELECT day,
        SUM(CASE WHEN type='booking_started' THEN 1 ELSE 0 END) AS booking_started,
        SUM(CASE WHEN type='booking_completed' THEN 1 ELSE 0 END) AS booking_completed
      FROM events WHERE type LIKE 'booking_%' GROUP BY day ORDER BY day DESC`),
    // Full CRM view: contact details, home area, activity and lifetime value.
    Customers: q(`SELECT name, email, phone, area,
        CASE WHEN source = '' THEN 'unknown' ELSE source END AS source,
        CASE email_verified WHEN 1 THEN 'yes' ELSE 'no' END AS verified, created_at,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id AND b.status != 'cancelled') AS bookings,
        (SELECT MAX(b.date) FROM bookings b WHERE b.customer_id = u.id AND b.status = 'completed') AS last_session,
        (SELECT COALESCE(SUM(i.amount_cents),0)/100.0 FROM invoices i
           JOIN bookings b ON b.id = i.booking_id
           WHERE b.customer_id = u.id AND i.status = 'paid') AS paid_1on1_eur,
        (SELECT COALESCE(SUM(g.price_cents),0)/100.0 FROM group_signups g
           WHERE g.customer_id = u.id AND g.status = 'confirmed' AND g.paid_at IS NOT NULL) AS paid_groups_eur,
        (SELECT COALESCE(SUM(p.price_cents),0)/100.0 FROM packages p
           WHERE p.customer_id = u.id AND p.status = 'active') AS paid_packages_eur
      FROM users u WHERE role='customer' ORDER BY created_at DESC`),
    ContactLeads: q(`SELECT contact, kind,
        CASE WHEN source = '' THEN 'unknown' ELSE source END AS source, created_at,
        CASE WHEN handled_at IS NULL THEN 'open' ELSE 'handled' END AS status
      FROM contact_requests ORDER BY id DESC`),
    GroupSessions: q(`SELECT g.code, g.date, g.hour || ':00' AS time, c.name AS coach,
        g.location, g.age_group, g.created_by, g.capacity,
        (SELECT COUNT(*) FROM group_signups s
           WHERE s.group_session_id = g.id AND s.status = 'confirmed') AS players,
        g.price_cents/100.0 AS price_per_player_eur, g.status
      FROM group_sessions g JOIN coaches c ON c.id = g.coach_id
      ORDER BY g.date DESC, g.hour DESC`),
    GroupSignups: q(`SELECT s.code, g.code AS session_code, u.name AS player, u.email,
        s.price_cents/100.0 AS paid_eur, s.status, s.paid_at, s.created_at
      FROM group_signups s JOIN group_sessions g ON g.id = s.group_session_id
      JOIN users u ON u.id = s.customer_id ORDER BY s.id DESC`),
    Packages: (() => {
      const packages = require('./packages');
      return db.prepare(`SELECT p.*, u.name AS customer, u.email FROM packages p
        JOIN users u ON u.id = p.customer_id WHERE p.status != 'void' ORDER BY p.id DESC`).all()
        .map((p) => ({
          code: p.code, customer: p.customer, email: p.email,
          sessions: p.sessions_total, price_eur: p.price_cents / 100,
          used: packages.usedSessions(p.id), remaining: packages.remainingSessions(p),
          adjusted: p.adjust_sessions, status: p.status,
          purchased_at: p.paid_at || p.created_at,
        }));
    })(),
    FinanceMonthly: (() => {
      const months = [...new Set([
        ...q("SELECT DISTINCT substr(issued_at,1,7) m FROM invoices WHERE status='paid'").map((r) => r.m),
        ...q("SELECT DISTINCT substr(paid_at,1,7) m FROM group_signups WHERE paid_at IS NOT NULL").map((r) => r.m),
        ...q("SELECT DISTINCT substr(paid_at,1,7) m FROM packages WHERE paid_at IS NOT NULL").map((r) => r.m),
      ])].filter(Boolean).sort().reverse();
      const one = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM invoices
        WHERE status='paid' AND substr(issued_at,1,7)=?`);
      const grp = db.prepare(`SELECT COALESCE(SUM(price_cents),0) s FROM group_signups
        WHERE status='confirmed' AND paid_at IS NOT NULL AND substr(paid_at,1,7)=?`);
      const pkg = db.prepare(`SELECT COALESCE(SUM(price_cents),0) s FROM packages
        WHERE status='active' AND paid_at IS NOT NULL AND substr(paid_at,1,7)=?`);
      const pay = db.prepare(`SELECT COALESCE(SUM(earn_cents),0) s FROM bookings
        WHERE status='completed' AND earn_cents IS NOT NULL AND substr(date,1,7)=?`);
      return months.map((m) => {
        const a = one.get(m).s, b = grp.get(m).s, c = pkg.get(m).s, d = pay.get(m).s;
        return {
          month: m, one_on_one_eur: a / 100, groups_eur: b / 100, packages_eur: c / 100,
          revenue_eur: (a + b + c) / 100, coach_payouts_eur: d / 100, net_eur: (a + b + c - d) / 100,
        };
      });
    })(),
    Reviews: q(`SELECT c.name AS coach, r.author_name AS reviewer, r.rating, r.body,
        r.created_at FROM reviews r JOIN coaches c ON c.id=r.coach_id
      ORDER BY r.created_at DESC`),
    CoachPayouts: (() => {
      const tiers = require('./tiers');
      return db.prepare('SELECT id, name FROM coaches WHERE active = 1 ORDER BY display_order').all()
        .map(c => {
          const status = tiers.coachTierStatus(c.id);
          const pay = tiers.coachMonthPayouts(c.id);
          return {
            coach: c.name, month: status.month,
            sessions_this_month: status.sessionsThisMonth,
            tier: `Tier ${status.tierIndex + 1}`,
            commission_percent: status.tier.percent,
            payout_eur: pay.payoutCents / 100,
          };
        });
    })(),
  };
};
