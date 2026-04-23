/**
 * routes/earnings.js — Driver Earnings & Platform Revenue (MongoDB)
 */
const express          = require('express');
const Booking          = require('../models/Booking');
const Ride             = require('../models/Ride');
const User             = require('../models/User');
const WalletTransaction= require('../models/WalletTransaction');
const Withdrawal       = require('../models/Withdrawal');
const PlatformEarning  = require('../models/PlatformEarning');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');

const router = express.Router();

function ok(res, data)        { return res.json({ success: true, ...data }); }
function fail(res, msg, s=500){ return res.status(s).json({ success: false, error: msg }); }

// ── GET /api/earnings/summary ─────────────────────────────────────────────────
router.get('/summary', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('wallet_balance total_withdrawn');
    if (!user) return fail(res, 'User not found.', 404);

    const [earned, pendingWd, ridesCount, bookingStats] = await Promise.all([
      WalletTransaction.aggregate([{ $match: { user_id: user._id, type: 'credit' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Withdrawal.aggregate([{ $match: { user_id: user._id, status: 'pending' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Ride.countDocuments({ driver_id: userId, status: { $ne: 'cancelled' } }),
      Booking.aggregate([
        { $lookup: { from: 'rides', localField: 'ride_id', foreignField: '_id', as: 'ride' } },
        { $unwind: '$ride' },
        { $match: { 'ride.driver_id': user._id, status: 'confirmed', payment_status: 'paid' } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$driver_earning' } } },
      ]),
    ]);

    return ok(res, {
      summary: {
        wallet_balance:     parseFloat((user.wallet_balance    || 0).toFixed(2)),
        total_earned:       parseFloat((earned[0]?.total       || 0).toFixed(2)),
        total_withdrawn:    parseFloat((user.total_withdrawn   || 0).toFixed(2)),
        pending_withdrawal: parseFloat((pendingWd[0]?.total    || 0).toFixed(2)),
        rides_driven:       ridesCount    || 0,
        paid_bookings:      bookingStats[0]?.count || 0,
        total_from_rides:   parseFloat((bookingStats[0]?.total || 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('[EARNINGS /summary]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/rides ───────────────────────────────────────────────────
router.get('/rides', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const rides = await Booking.find({ status: 'confirmed', payment_status: 'paid' })
      .populate({ path: 'ride_id', match: { driver_id: userId }, select: 'from_location to_location departure_time price_per_seat driver_id' })
      .populate('passenger_id', 'name')
      .sort({ created_at: -1 })
      .limit(limit * 3); // over-fetch due to populate match filter

    const result = rides
      .filter(b => b.ride_id)
      .slice(0, limit)
      .map(b => ({
        booking_id:      b._id,
        seats_booked:    b.seats_booked,
        total_amount:    b.total_amount,
        commission_amount: b.commission_amount,
        driver_earning:  b.driver_earning,
        payment_status:  b.payment_status,
        booked_at:       b.created_at,
        from_location:   b.ride_id?.from_location,
        to_location:     b.ride_id?.to_location,
        departure_time:  b.ride_id?.departure_time,
        price_per_seat:  b.ride_id?.price_per_seat,
        passenger_name:  b.passenger_id?.name,
      }));

    return ok(res, { rides: result });
  } catch (err) {
    console.error('[EARNINGS /rides]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/chart ───────────────────────────────────────────────────
router.get('/chart', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const user   = await User.findById(userId);

    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const y = d.getFullYear();
      const w = String(Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000)).padStart(2, '0');
      weeks.push(`${y}-${w}`);
    }

    const since = new Date();
    since.setDate(since.getDate() - 56);

    const bookings = await Booking.find({ status: 'confirmed', payment_status: 'paid', created_at: { $gte: since } })
      .populate({ path: 'ride_id', match: { driver_id: user._id }, select: 'driver_id' });

    const map = {};
    for (const b of bookings) {
      if (!b.ride_id) continue;
      const d   = new Date(b.created_at);
      const y   = d.getFullYear();
      const w   = String(Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000)).padStart(2, '0');
      const key = `${y}-${w}`;
      map[key]  = (map[key] || 0) + (b.driver_earning || 0);
    }

    const chart = weeks.map(w => ({ week: w, earned: parseFloat((map[w] || 0).toFixed(2)) }));
    return ok(res, { chart });
  } catch (err) {
    console.error('[EARNINGS /chart]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/platform (ADMIN) ────────────────────────────────────────
router.get('/platform', authRequired, adminOnly, async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(Date.now() - 7  * 24 * 3600000);
    const month = new Date(Date.now() - 30 * 24 * 3600000);

    const [allTime, todayEarned, weekEarned, monthEarned, recent] = await Promise.all([
      PlatformEarning.aggregate([{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      PlatformEarning.aggregate([{ $match: { created_at: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      PlatformEarning.aggregate([{ $match: { created_at: { $gte: week  } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      PlatformEarning.aggregate([{ $match: { created_at: { $gte: month } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      PlatformEarning.find({}).populate('ride_id', 'from_location to_location').populate('driver_id', 'name').sort({ created_at: -1 }).limit(20),
    ]);

    return ok(res, {
      revenue: {
        total_all_time: parseFloat((allTime[0]?.total  || 0).toFixed(2)),
        total_count:    allTime[0]?.count || 0,
        today:          parseFloat((todayEarned[0]?.total || 0).toFixed(2)),
        this_week:      parseFloat((weekEarned[0]?.total  || 0).toFixed(2)),
        this_month:     parseFloat((monthEarned[0]?.total || 0).toFixed(2)),
      },
      recent,
    });
  } catch (err) {
    console.error('[EARNINGS /platform]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/top-drivers (ADMIN) ─────────────────────────────────────
router.get('/top-drivers', authRequired, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    const drivers = await Booking.aggregate([
      { $match: { status: 'confirmed', payment_status: 'paid' } },
      { $lookup: { from: 'rides', localField: 'ride_id', foreignField: '_id', as: 'ride' } },
      { $unwind: '$ride' },
      { $group: { _id: '$ride.driver_id', total_bookings: { $sum: 1 }, total_earned: { $sum: '$driver_earning' } } },
      { $match: { total_earned: { $gt: 0 } } },
      { $sort: { total_earned: -1 } },
      { $limit: limit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { id: '$_id', name: '$user.name', email: '$user.email', avg_rating: '$user.avg_rating', wallet_balance: '$user.wallet_balance', total_withdrawn: '$user.total_withdrawn', total_bookings: 1, total_earned: 1 } },
    ]);

    return ok(res, { drivers });
  } catch (err) {
    console.error('[EARNINGS /top-drivers]', err.message);
    return fail(res, 'Server error.');
  }
});

// ── GET /api/earnings/stats (ADMIN) ──────────────────────────────────────────
router.get('/stats', authRequired, adminOnly, async (req, res) => {
  try {
    const [users, rides, bookings, platform, pendingW] = await Promise.all([
      User.countDocuments({}),
      Ride.countDocuments({ status: { $ne: 'cancelled' } }),
      Booking.aggregate([{ $match: { status: 'confirmed', payment_status: 'paid' } }, { $group: { _id: null, count: { $sum: 1 }, gmv: { $sum: '$total_amount' } } }]),
      PlatformEarning.aggregate([{ $group: { _id: null, revenue: { $sum: '$amount' } } }]),
      Withdrawal.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }]),
    ]);

    return ok(res, {
      stats: {
        total_users:         users,
        total_rides:         rides,
        confirmed_bookings:  bookings[0]?.count   || 0,
        gross_volume:        parseFloat((bookings[0]?.gmv       || 0).toFixed(2)),
        platform_revenue:    parseFloat((platform[0]?.revenue   || 0).toFixed(2)),
        pending_withdrawals: pendingW[0]?.count   || 0,
        pending_payout:      parseFloat((pendingW[0]?.total     || 0).toFixed(2)),
      }
    });
  } catch (err) {
    console.error('[EARNINGS /stats]', err.message);
    return fail(res, 'Server error.');
  }
});

module.exports = router;
