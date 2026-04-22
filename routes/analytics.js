/**
 * routes/analytics.js — Conversion & Growth Analytics
 *
 * Endpoints (all lightweight, non-blocking):
 *   POST /api/analytics/event          → Track a frontend event
 *   GET  /api/analytics/summary        → Admin: daily/weekly stats
 *   GET  /api/analytics/growth         → Admin: user growth, bookings, revenue
 *   GET  /api/analytics/rides/popular  → Most popular routes (public)
 *   GET  /api/analytics/platform-stats → Live trust stats (public)
 */
const express = require('express');
const { prepare } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');
const router = express.Router();

const cache = new Map();
function getCached(key, ttl, fn) {
  const now = Date.now();
  if (cache.has(key) && cache.get(key).expires > now) return cache.get(key).data;
  const data = fn();
  cache.set(key, { data, expires: now + ttl });
  return data;
}

function ok(res, data)         { return res.json({ success: true, ...data }); }
function fail(res, msg, s=500) { return res.status(s).json({ success: false, error: msg }); }

// ── POST /api/analytics/event ─────────────────────────────────────────────────
// Body: { event: 'signup'|'ride_created'|'booking_made'|'page_view', meta?: {} }
// Fire-and-forget — never blocks the caller
router.post('/event', (req, res) => {
  const event   = (req.body.event || '').trim().slice(0, 64);
  const userId  = req.body.user_id || null;
  const meta    = JSON.stringify(req.body.meta || {}).slice(0, 500);
  const allowed = ['signup','login','ride_created','booking_made','page_view',
                   'ride_searched','coupon_used','withdrawal_requested'];
  if (!event || !allowed.includes(event)) {
    return res.status(400).json({ success: false, error: 'Invalid event.' });
  }
  try {
    prepare(
      `INSERT INTO analytics_events (event, user_id, meta) VALUES (?, ?, ?)`
    ).run(event, userId || null, meta);
  } catch (err) {
    // Non-critical — log but don't fail
    console.error('[ANALYTICS /event]', err.message);
  }
  return res.json({ success: true });
});

// ── GET /api/analytics/summary ────────────────────────────────────────────────
// ADMIN: daily KPIs for the growth panel
router.get('/summary', authRequired, adminOnly, (req, res) => {
  try {
    const today = prepare(`
      SELECT
        (SELECT COUNT(*) FROM users     WHERE date(created_at) = date('now')) AS new_users_today,
        (SELECT COUNT(*) FROM bookings  WHERE date(created_at) = date('now') AND status='confirmed') AS bookings_today,
        (SELECT COUNT(*) FROM rides     WHERE date(created_at) = date('now')) AS rides_today,
        (SELECT COALESCE(SUM(amount),0) FROM platform_earnings WHERE date(created_at) = date('now')) AS revenue_today
    `).get();

    const week = prepare(`
      SELECT
        (SELECT COUNT(*) FROM users     WHERE created_at >= date('now','-7 days')) AS new_users_week,
        (SELECT COUNT(*) FROM bookings  WHERE created_at >= date('now','-7 days') AND status='confirmed') AS bookings_week,
        (SELECT COALESCE(SUM(amount),0) FROM platform_earnings WHERE created_at >= date('now','-7 days')) AS revenue_week
    `).get();

    // Daily breakdown for last 14 days
    const daily = prepare(`
      SELECT date(created_at) AS day,
             COUNT(*) AS bookings,
             COALESCE(SUM(total_amount),0) AS gmv
      FROM bookings WHERE status='confirmed' AND created_at >= date('now','-14 days')
      GROUP BY day ORDER BY day
    `).all();

    // Signup daily
    const signups = prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS count
      FROM users WHERE created_at >= date('now','-14 days')
      GROUP BY day ORDER BY day
    `).all();

    // Surge + coupon toggle state
    const surgeEnabled  = process.env.SURGE_ENABLED !== 'false';
    const withdrawalFee = parseFloat(process.env.WITHDRAWAL_FEE) || 10;

    return ok(res, { today, week, daily, signups, surgeEnabled, withdrawalFee });
  } catch (err) {
    console.error('[ANALYTICS /summary]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/analytics/growth ─────────────────────────────────────────────────
// ADMIN: growth over time
router.get('/growth', authRequired, adminOnly, (req, res) => {
  try {
    const totalUsers    = prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const totalRides    = prepare("SELECT COUNT(*) AS c FROM rides WHERE status!='cancelled'").get().c;
    const totalBookings = prepare("SELECT COUNT(*) AS c FROM bookings WHERE status='confirmed'").get().c;
    const totalRevenue  = prepare('SELECT COALESCE(SUM(amount),0) AS t FROM platform_earnings').get().t;
    const totalPaid     = prepare("SELECT COALESCE(SUM(total_amount),0) AS t FROM bookings WHERE status='confirmed' AND payment_status='paid'").get().t;
    const activeDrivers = prepare("SELECT COUNT(DISTINCT driver_id) AS c FROM rides WHERE status='active'").get().c;

    // Conversion: users who made at least 1 booking
    const convertedUsers = prepare(
      "SELECT COUNT(DISTINCT passenger_id) AS c FROM bookings WHERE status='confirmed'"
    ).get().c;

    const conversionRate = totalUsers > 0 ? parseFloat(((convertedUsers / totalUsers) * 100).toFixed(1)) : 0;

    return ok(res, {
      totals: { users: totalUsers, rides: totalRides, bookings: totalBookings,
                revenue: parseFloat(totalRevenue.toFixed(2)), gmv: parseFloat(totalPaid.toFixed(2)),
                activeDrivers, convertedUsers, conversionRate }
    });
  } catch (err) {
    console.error('[ANALYTICS /growth]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/analytics/rides/popular ─────────────────────────────────────────
// Public: top 5 most-booked routes (for social proof)
router.get('/rides/popular', (req, res) => {
  try {
    const routes = getCached('popular_routes', 60000, () => {
      return prepare(`
        SELECT r.from_location, r.to_location,
               COUNT(b.id) AS booking_count,
               MIN(r.price_per_seat) AS min_price,
               MAX(r.price_per_seat) AS max_price
        FROM rides r
        LEFT JOIN bookings b ON b.ride_id = r.id AND b.status='confirmed'
        WHERE r.status = 'active'
        GROUP BY r.from_location, r.to_location
        ORDER BY booking_count DESC
        LIMIT 5
      `).all();
    });
    return ok(res, { routes });
  } catch (err) {
    return ok(res, { routes: [] });
  }
});

// ── GET /api/analytics/platform-stats ────────────────────────────────────────
// Public: real trust counters for landing page
router.get('/platform-stats', (req, res) => {
  try {
    const s = getCached('platform_stats', 30000, () => {
      return prepare(`
        SELECT
          (SELECT COUNT(*) FROM users)                                     AS total_users,
          (SELECT COUNT(*) FROM bookings WHERE status='confirmed')         AS total_bookings,
          (SELECT COUNT(*) FROM rides WHERE status != 'cancelled')        AS total_rides,
          (SELECT COALESCE(SUM(driver_earning),0)
             FROM bookings WHERE status='confirmed' AND payment_status='paid') AS total_driver_earnings
      `).get();
    });
    return ok(res, {
      total_users:          s.total_users    || 0,
      total_bookings:       s.total_bookings || 0,
      total_rides:          s.total_rides    || 0,
      total_driver_earnings: parseFloat((s.total_driver_earnings || 0).toFixed(2)),
    });
  } catch (err) {
    return ok(res, { total_users: 0, total_bookings: 0, total_rides: 0, total_driver_earnings: 0 });
  }
});

// ── GET /api/analytics/feed ──────────────────────────────────────────────────
// Public: latest 5 activities for live ticker
router.get('/feed', (req, res) => {
  try {
    const feed = prepare(`
      SELECT b.id, b.created_at, u.name as passenger_name, r.from_location, r.to_location
      FROM bookings b
      JOIN users u ON b.passenger_id = u.id
      JOIN rides r ON b.ride_id = r.id
      WHERE b.status = 'confirmed'
      ORDER BY b.created_at DESC
      LIMIT 5
    `).all();
    return ok(res, { feed });
  } catch (err) {
    return ok(res, { feed: [] });
  }
});

// ── GET /api/analytics/leaderboard ───────────────────────────────────────────
router.get('/leaderboard', authRequired, adminOnly, (req, res) => {
  try {
    const drivers = prepare(`
      SELECT u.id, u.name, u.email, u.wallet_balance,
             (SELECT COUNT(*) FROM rides WHERE driver_id = u.id AND status='completed') as completed_rides,
             (SELECT COALESCE(SUM(driver_earning),0) FROM bookings b JOIN rides r ON b.ride_id = r.id WHERE r.driver_id = u.id AND b.status='confirmed' AND b.payment_status='paid') as total_earnings
      FROM users u
      WHERE total_earnings > 0
      ORDER BY total_earnings DESC
      LIMIT 10
    `).all();
    return ok(res, { drivers });
  } catch (err) {
    return fail(res, 'Server error.');
  }
});

module.exports = router;
