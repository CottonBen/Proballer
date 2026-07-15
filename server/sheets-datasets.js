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
    Customers: q(`SELECT name, email, phone, created_at,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id) AS bookings
      FROM users u WHERE role='customer' ORDER BY created_at DESC`),
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
