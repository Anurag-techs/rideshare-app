/**
 * routes/analytics.js — Conversion & Growth Analytics (MongoDB)
 */
const express          = require('express');
const AnalyticsEvent   = require('../models/AnalyticsEvent');
const User             = require('../models/User');
const Booking          = require('../models/Booking');
const Ride             = require('../models/Ride');
const PlatformEarning  = require('../models/PlatformEarning');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');

const router = express.Router();

// Simple in-memory cache
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
router.post('/event', async (req, res) => {
  const event   = (req.body.event || '').trim().slice(0, 64);
  const userId  = req.body.user_id || null;
  const meta    = req.body.meta || {};
  const allowed = ['signup','login','ride_created','booking_made','page_view','ride_searched','coupon_used','withdrawal_requested'];

  if (!event || !allowed.includes(event))
    return res.status(400).json({ success: false, error: 'Invalid event.' });

  try {
    await AnalyticsEvent.create({ event, user_id: userId || null, meta });
  } catch (err) {
    console.error('[ANALYTICS /event]', err.message);
  }
  return res.json({ success: true });
});

// ── GET /api/analytics/summary (ADMIN) ───────────────────────────────────────
router.get('/summary', authRequired, adminOnly, async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const weekAgo    = new Date(Date.now() - 7  * 24 * 3600000);
    const day14Ago   = new Date(Date.now() - 14 * 24 * 3600000);

    const [
      newUsersToday, bookingsToday, ridesToday, revenueToday,
      newUsersWeek,  bookingsWeek,  revenueWeek,
      dailyBookings, dailySignups,
    ] = await Promise.all([
      User.countDocuments({ created_at: { $gte: todayStart } }),
      Booking.countDocuments({ created_at: { $gte: todayStart }, status: 'confirmed' }),
      Ride.countDocuments({ created_at: { $gte: todayStart } }),
      PlatformEarning.aggregate([{ $match: { created_at: { $gte: todayStart } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
      User.countDocuments({ created_at: { $gte: weekAgo } }),
      Booking.countDocuments({ created_at: { $gte: weekAgo }, status: 'confirmed' }),
      PlatformEarning.aggregate([{ $match: { created_at: { $gte: weekAgo } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
      Booking.aggregate([
        { $match: { status: 'confirmed', created_at: { $gte: day14Ago } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, bookings: { $sum: 1 }, gmv: { $sum: '$total_amount' } } },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        { $match: { created_at: { $gte: day14Ago } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return ok(res, {
      today: { new_users_today: newUsersToday, bookings_today: bookingsToday, rides_today: ridesToday, revenue_today: parseFloat((revenueToday[0]?.t || 0).toFixed(2)) },
      week:  { new_users_week: newUsersWeek, bookings_week: bookingsWeek, revenue_week: parseFloat((revenueWeek[0]?.t || 0).toFixed(2)) },
      daily: dailyBookings.map(d => ({ day: d._id, bookings: d.bookings, gmv: d.gmv })),
      signups: dailySignups.map(d => ({ day: d._id, count: d.count })),
      surgeEnabled: process.env.SURGE_ENABLED !== 'false',
      withdrawalFee: parseFloat(process.env.WITHDRAWAL_FEE) || 10,
    });
  } catch (err) {
    console.error('[ANALYTICS /summary]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/analytics/growth (ADMIN) ────────────────────────────────────────
router.get('/growth', authRequired, adminOnly, async (req, res) => {
  try {
    const [totalUsers, totalRides, totalBookings, totalRevenue, totalPaid, activeDrivers, convertedUsers] = await Promise.all([
      User.countDocuments({}),
      Ride.countDocuments({ status: { $ne: 'cancelled' } }),
      Booking.countDocuments({ status: 'confirmed' }),
      PlatformEarning.aggregate([{ $group: { _id: null, t: { $sum: '$amount' } } }]),
      Booking.aggregate([{ $match: { status: 'confirmed', payment_status: 'paid' } }, { $group: { _id: null, t: { $sum: '$total_amount' } } }]),
      Ride.distinct('driver_id', { status: 'active' }),
      Booking.distinct('passenger_id', { status: 'confirmed' }),
    ]);

    const conversionRate = totalUsers > 0 ? parseFloat(((convertedUsers.length / totalUsers) * 100).toFixed(1)) : 0;

    return ok(res, {
      totals: {
        users: totalUsers, rides: totalRides, bookings: totalBookings,
        revenue:        parseFloat((totalRevenue[0]?.t || 0).toFixed(2)),
        gmv:            parseFloat((totalPaid[0]?.t    || 0).toFixed(2)),
        activeDrivers:  activeDrivers.length,
        convertedUsers: convertedUsers.length,
        conversionRate,
      }
    });
  } catch (err) {
    console.error('[ANALYTICS /growth]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/analytics/rides/popular (public) ────────────────────────────────
router.get('/rides/popular', async (req, res) => {
  try {
    const routes = await Booking.aggregate([
      { $match: { status: 'confirmed' } },
      { $lookup: { from: 'rides', localField: 'ride_id', foreignField: '_id', as: 'ride' } },
      { $unwind: '$ride' },
      { $match: { 'ride.status': 'active' } },
      { $group: { _id: { from: '$ride.from_location', to: '$ride.to_location' }, booking_count: { $sum: 1 }, min_price: { $min: '$ride.price_per_seat' }, max_price: { $max: '$ride.price_per_seat' } } },
      { $sort: { booking_count: -1 } },
      { $limit: 5 },
      { $project: { from_location: '$_id.from', to_location: '$_id.to', booking_count: 1, min_price: 1, max_price: 1, _id: 0 } },
    ]);
    return ok(res, { routes });
  } catch (err) {
    return ok(res, { routes: [] });
  }
});

// ── GET /api/analytics/platform-stats (public) ───────────────────────────────
router.get('/platform-stats', async (req, res) => {
  try {
    const [totalUsers, totalBookings, totalRides, earningsAgg] = await Promise.all([
      User.countDocuments({}),
      Booking.countDocuments({ status: 'confirmed' }),
      Ride.countDocuments({ status: { $ne: 'cancelled' } }),
      Booking.aggregate([{ $match: { status: 'confirmed', payment_status: 'paid' } }, { $group: { _id: null, total: { $sum: '$driver_earning' } } }]),
    ]);

    return ok(res, {
      total_users:           totalUsers,
      total_bookings:        totalBookings,
      total_rides:           totalRides,
      total_driver_earnings: parseFloat((earningsAgg[0]?.total || 0).toFixed(2)),
    });
  } catch (err) {
    return ok(res, { total_users: 0, total_bookings: 0, total_rides: 0, total_driver_earnings: 0 });
  }
});

// ── GET /api/analytics/feed (public) ─────────────────────────────────────────
router.get('/feed', async (req, res) => {
  try {
    const feed = await Booking.find({ status: 'confirmed' })
      .populate('passenger_id', 'name')
      .populate('ride_id', 'from_location to_location')
      .sort({ created_at: -1 })
      .limit(5);

    const result = feed.map(b => ({
      id:             b._id,
      created_at:     b.created_at,
      passenger_name: b.passenger_id?.name,
      from_location:  b.ride_id?.from_location,
      to_location:    b.ride_id?.to_location,
    }));

    return ok(res, { feed: result });
  } catch (err) {
    return ok(res, { feed: [] });
  }
});

// ── GET /api/analytics/leaderboard (ADMIN) ───────────────────────────────────
router.get('/leaderboard', authRequired, adminOnly, async (req, res) => {
  try {
    const drivers = await Booking.aggregate([
      { $match: { status: 'confirmed', payment_status: 'paid' } },
      { $lookup: { from: 'rides', localField: 'ride_id', foreignField: '_id', as: 'ride' } },
      { $unwind: '$ride' },
      { $group: { _id: '$ride.driver_id', total_earnings: { $sum: '$driver_earning' } } },
      { $match: { total_earnings: { $gt: 0 } } },
      { $sort: { total_earnings: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $lookup: { from: 'rides', localField: '_id', foreignField: 'driver_id', as: 'completedRides', pipeline: [{ $match: { status: 'completed' } }] } },
      { $project: { id: '$_id', name: '$user.name', email: '$user.email', wallet_balance: '$user.wallet_balance', completed_rides: { $size: '$completedRides' }, total_earnings: 1, _id: 0 } },
    ]);
    return ok(res, { drivers });
  } catch (err) {
    return fail(res, 'Server error.');
  }
});

module.exports = router;
