/**
 * routes/earnings.js — Driver Earnings & Platform Revenue
 *
 * Endpoints:
 *   GET /api/earnings/summary          → Driver's full earnings breakdown
 *   GET /api/earnings/rides            → Per-ride earnings history
 *   GET /api/earnings/chart            → Weekly earnings (last 8 weeks)
 *   GET /api/earnings/platform         → Admin: platform revenue summary
 *   GET /api/earnings/top-drivers      → Admin: top earning drivers
 *   GET /api/earnings/stats            → Admin: overall platform stats
 */
const express = require('express');
const { prepare } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(res, data)       { return res.json({ success: true, ...data }); }
function fail(res, msg, s=500) { return res.status(s).json({ success: false, error: msg }); }

// ── GET /api/earnings/summary ─────────────────────────────────────────────────
// Driver's own earnings breakdown — no sensitive data
router.get('/summary', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);

    // Wallet balances from users table
    const user = prepare(
      'SELECT wallet_balance, total_withdrawn FROM users WHERE id = ?'
    ).get(userId);
    if (!user) return fail(res, 'User not found.', 404);

    // Total ever earned (sum of all credit transactions)
    const earnedRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM wallet_transactions WHERE user_id = ? AND type = 'credit'`
    ).get(userId);

    // Pending withdrawal amount
    const pendingRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM withdrawals WHERE user_id = ? AND status = 'pending'`
    ).get(userId);

    // Total rides driven (where user was driver)
    const ridesRow = prepare(
      `SELECT COUNT(*) AS count FROM rides WHERE driver_id = ? AND status != 'cancelled'`
    ).get(userId);

    // Total confirmed paid bookings driven
    const bookingsRow = prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(b.driver_earning), 0) AS total
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       WHERE r.driver_id = ? AND b.status = 'confirmed' AND b.payment_status = 'paid'`
    ).get(userId);

    return ok(res, {
      summary: {
        wallet_balance:     parseFloat((user.wallet_balance    || 0).toFixed(2)),
        total_earned:       parseFloat((earnedRow.total        || 0).toFixed(2)),
        total_withdrawn:    parseFloat((user.total_withdrawn   || 0).toFixed(2)),
        pending_withdrawal: parseFloat((pendingRow.total       || 0).toFixed(2)),
        rides_driven:       ridesRow.count     || 0,
        paid_bookings:      bookingsRow.count  || 0,
        total_from_rides:   parseFloat((bookingsRow.total      || 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('[EARNINGS /summary]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/rides ───────────────────────────────────────────────────
// Per-ride breakdown for driver
router.get('/rides', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const rides = prepare(`
      SELECT b.id AS booking_id, b.seats_booked, b.total_amount, b.commission_amount,
             b.driver_earning, b.payment_status, b.created_at AS booked_at,
             r.from_location, r.to_location, r.departure_time, r.price_per_seat,
             u.name AS passenger_name
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      JOIN users u ON b.passenger_id = u.id
      WHERE r.driver_id = ? AND b.status = 'confirmed' AND b.payment_status = 'paid'
      ORDER BY b.created_at DESC
      LIMIT ${limit}
    `).all(userId);

    return ok(res, { rides });
  } catch (err) {
    console.error('[EARNINGS /rides]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/chart ───────────────────────────────────────────────────
// Weekly earnings for the last 8 weeks — for chart display
router.get('/chart', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);

    // Build last 8 ISO week labels
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      // SQLite strftime week: '%Y-%W'
      const y = d.getFullYear();
      const w = String(Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000)).padStart(2, '0');
      weeks.push(`${y}-${w}`);
    }

    const rows = prepare(`
      SELECT strftime('%Y-%W', b.created_at) AS week,
             COALESCE(SUM(b.driver_earning), 0) AS earned
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      WHERE r.driver_id = ? AND b.status = 'confirmed' AND b.payment_status = 'paid'
        AND b.created_at >= date('now', '-56 days')
      GROUP BY week ORDER BY week
    `).all(userId);

    // Fill in zeros for weeks with no earnings
    const map = {};
    rows.forEach(r => { map[r.week] = parseFloat((r.earned || 0).toFixed(2)); });
    const chart = weeks.map(w => ({ week: w, earned: map[w] || 0 }));

    return ok(res, { chart });
  } catch (err) {
    console.error('[EARNINGS /chart]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/platform ────────────────────────────────────────────────
// ADMIN: platform commission revenue
router.get('/platform', authRequired, adminOnly, (req, res) => {
  try {
    const totalRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM platform_earnings`
    ).get();

    const todayRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_earnings
       WHERE date(created_at) = date('now')`
    ).get();

    const weekRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_earnings
       WHERE created_at >= date('now', '-7 days')`
    ).get();

    const monthRow = prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_earnings
       WHERE created_at >= date('now', '-30 days')`
    ).get();

    const recent = prepare(`
      SELECT pe.*, r.from_location, r.to_location, u.name AS driver_name
      FROM platform_earnings pe
      JOIN rides r ON pe.ride_id = r.id
      JOIN users u ON pe.driver_id = u.id
      ORDER BY pe.created_at DESC LIMIT 20
    `).all();

    return ok(res, {
      revenue: {
        total_all_time: parseFloat((totalRow.total || 0).toFixed(2)),
        total_count:    totalRow.count || 0,
        today:          parseFloat((todayRow.total  || 0).toFixed(2)),
        this_week:      parseFloat((weekRow.total   || 0).toFixed(2)),
        this_month:     parseFloat((monthRow.total  || 0).toFixed(2)),
      },
      recent,
    });
  } catch (err) {
    console.error('[EARNINGS /platform]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/top-drivers ─────────────────────────────────────────────
// ADMIN: top earning drivers
router.get('/top-drivers', authRequired, adminOnly, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    const drivers = prepare(`
      SELECT u.id, u.name, u.email, u.avg_rating,
             u.wallet_balance, u.total_withdrawn,
             COUNT(b.id)              AS total_bookings,
             COALESCE(SUM(b.driver_earning), 0) AS total_earned
      FROM users u
      LEFT JOIN rides r  ON r.driver_id = u.id
      LEFT JOIN bookings b ON b.ride_id = r.id
        AND b.status = 'confirmed' AND b.payment_status = 'paid'
      GROUP BY u.id
      HAVING total_earned > 0
      ORDER BY total_earned DESC
      LIMIT ${limit}
    `).all();

    return ok(res, { drivers });
  } catch (err) {
    console.error('[EARNINGS /top-drivers]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/stats ───────────────────────────────────────────────────
// ADMIN: overall platform overview
router.get('/stats', authRequired, adminOnly, (req, res) => {
  try {
    const users     = prepare('SELECT COUNT(*) AS c FROM users').get();
    const rides     = prepare("SELECT COUNT(*) AS c FROM rides WHERE status != 'cancelled'").get();
    const bookings  = prepare("SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS gmv FROM bookings WHERE status='confirmed' AND payment_status='paid'").get();
    const platform  = prepare('SELECT COALESCE(SUM(amount),0) AS revenue FROM platform_earnings').get();
    const pending_w = prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE status='pending'").get();

    return ok(res, {
      stats: {
        total_users:         users.c          || 0,
        total_rides:         rides.c          || 0,
        confirmed_bookings:  bookings.c       || 0,
        gross_volume:        parseFloat((bookings.gmv      || 0).toFixed(2)),
        platform_revenue:    parseFloat((platform.revenue  || 0).toFixed(2)),
        pending_withdrawals: pending_w.c      || 0,
        pending_payout:      parseFloat((pending_w.total   || 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('[EARNINGS /stats]', err.message);
    return fail(res, 'Server error.');
  }
});

module.exports = router;
