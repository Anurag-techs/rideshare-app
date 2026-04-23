/**
 * routes/payments.js — Razorpay Integration (MongoDB)
 */
const express          = require('express');
const crypto           = require('crypto');
const { body }         = require('express-validator');
const Booking          = require('../models/Booking');
const Payment          = require('../models/Payment');
const Ride             = require('../models/Ride');
const User             = require('../models/User');
const WalletTransaction= require('../models/WalletTransaction');
const PlatformEarning  = require('../models/PlatformEarning');
const { authRequired } = require('../middleware/auth');
const validate         = require('../middleware/validate');
const { notify }       = require('../utils/notify');

const router = express.Router();

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.12;
const rzpKeyId        = (process.env.RAZORPAY_KEY_ID     || '').trim();
const rzpKeySecret    = (process.env.RAZORPAY_KEY_SECRET || '').trim();
const rzpConfigured   = rzpKeyId.startsWith('rzp_') && rzpKeySecret.length > 10;
const rzpIsLive       = rzpKeyId.startsWith('rzp_live');
const rzpMode         = rzpIsLive ? 'LIVE' : 'TEST';

if (rzpConfigured) {
  console.log(`✅ [Razorpay] Initialized in ${rzpMode} mode (key prefix: ${rzpKeyId.slice(0, 12)}...)`);
} else {
  console.warn('⚠️  [Razorpay] Keys missing or invalid — MOCK mode.');
}

let razorpay = null;
if (rzpConfigured) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });
}

function calcCommission(totalAmount) {
  const commission    = parseFloat((totalAmount * COMMISSION_RATE).toFixed(2));
  const driverEarning = parseFloat((totalAmount - commission).toFixed(2));
  return { commission, driverEarning };
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const body     = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', rzpKeySecret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch { return false; }
}

function ok(res, data, status = 200)  { return res.status(status).json({ success: true,  ...data }); }

// ── GET /api/payments/mode ────────────────────────────────────────────────────
router.get('/mode', (req, res) => {
  res.json({
    configured: !!razorpay,
    mock:       !razorpay,
    mode:       razorpay ? rzpMode : 'MOCK',
    isLive:     rzpIsLive,
    isTest:     rzpKeyId.startsWith('rzp_test'),
    message:    razorpay ? `Razorpay active (${rzpMode} mode)` : 'Razorpay not configured.',
  });
});

// ── POST /api/payments/create-order ──────────────────────────────────────────
router.post('/create-order', authRequired, validate([
  body('ride_id').trim().notEmpty().withMessage('Invalid ride_id'),
  body('seats').optional().isInt({ min: 1, max: 10 }).toInt()
]), async (req, res, next) => {
  try {
    const rideId    = req.body.ride_id;
    const seatCount = req.body.seats || 1;
    const userId    = req.user.id;

    const ride = await Ride.findOne({ _id: rideId, status: 'active' });
    if (!ride) {
      const err = new Error('Ride not found or no longer active.');
      err.statusCode = 404;
      return next(err);
    }
    if (String(ride.driver_id) === String(userId)) {
      const err = new Error('You cannot book your own ride.');
      err.statusCode = 400;
      return next(err);
    }
    if (ride.available_seats < seatCount) {
      const err = new Error(`Not enough seats. Requested ${seatCount}, only ${ride.available_seats} available.`);
      err.statusCode = 400;
      return next(err);
    }

    const existing = await Booking.findOne({ ride_id: rideId, passenger_id: userId, status: 'confirmed' });
    if (existing) {
      const err = new Error('You already have a confirmed booking for this ride.');
      err.statusCode = 409;
      return next(err);
    }

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);

    if (totalAmount <= 0) return res.json({ free: true, totalAmount: 0, commission: 0, driverEarning: 0 });

    if (!razorpay) {
      const err = new Error('Payment system is not configured. Please contact support.');
      err.statusCode = 503;
      return next(err);
    }

    let order;
    try {
      order = await razorpay.orders.create({
        amount: Math.round(totalAmount * 100),
        currency: 'INR',
        notes: { ride_id: String(rideId), user_id: String(userId), seats: String(seatCount) },
      });
    } catch (rzpErr) {
      const isAuthFail = rzpErr?.statusCode === 401 || (rzpErr?.error?.description || '').toLowerCase().includes('authentication');
      const err = new Error(isAuthFail ? 'Payment gateway authentication failed.' : 'Payment gateway error. Please try again.');
      err.statusCode = isAuthFail ? 401 : 502;
      return next(err);
    }

    res.json({ free: false, mock: false, key_id: rzpKeyId, order_id: order.id, amount: order.amount, currency: order.currency, totalAmount, commission, driverEarning, ride_id: rideId, seats: seatCount, ride_from: ride.from_location, ride_to: ride.to_location });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post('/verify', authRequired, validate([
  body('ride_id').trim().notEmpty().withMessage('Invalid ride_id'),
  body('razorpay_order_id').trim().notEmpty().withMessage('Missing razorpay_order_id'),
  body('razorpay_payment_id').trim().notEmpty().withMessage('Missing razorpay_payment_id'),
  body('razorpay_signature').trim().notEmpty().withMessage('Missing razorpay_signature'),
  body('seats').optional().isInt({ min: 1, max: 10 }).toInt()
]), async (req, res, next) => {
  try {
    const { ride_id, seats, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const seatCount = seats || 1;
    const userId    = req.user.id;

    const dupOrder = await Booking.findOne({ razorpay_order_id, status: 'confirmed' });
    if (dupOrder) {
      const err = new Error('This payment has already been processed.');
      err.statusCode = 409;
      return next(err);
    }

    const dupPayment = await Payment.findOne({ razorpay_payment_id });
    if (dupPayment) {
      const err = new Error('This payment ID has already been used.');
      err.statusCode = 409;
      return next(err);
    }

    const ride = await Ride.findOne({ _id: ride_id, status: 'active' });
    if (!ride) {
      const err = new Error('Ride not found.');
      err.statusCode = 404;
      return next(err);
    }
    if (String(ride.driver_id) === String(userId)) {
      const err = new Error('You cannot book your own ride.');
      err.statusCode = 400;
      return next(err);
    }
    if (ride.available_seats < seatCount) {
      const err = new Error(`Not enough seats. Only ${ride.available_seats} available.`);
      err.statusCode = 400;
      return next(err);
    }

    const dupBooking = await Booking.findOne({ ride_id, passenger_id: userId, status: 'confirmed' });
    if (dupBooking) {
      const err = new Error('You already have a confirmed booking for this ride.');
      err.statusCode = 409;
      return next(err);
    }

    if (razorpay) {
      const valid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!valid) {
        const err = new Error('Payment verification failed — invalid signature.');
        err.statusCode = 400;
        return next(err);
      }
    }

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);

    // Atomic updates - Ideally use mongoose session, but keeping current flow for parity
    const booking = await Booking.create({
      ride_id,
      passenger_id:        userId,
      seats_booked:        seatCount,
      total_amount:        totalAmount,
      commission_amount:   commission,
      driver_earning:      driverEarning,
      payment_status:      'paid',
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      status: 'confirmed',
    });

    await Ride.findByIdAndUpdate(ride_id, { $inc: { available_seats: -seatCount } });

    await Payment.create({
      booking_id: booking._id, user_id: userId, razorpay_order_id, razorpay_payment_id, razorpay_signature,
      amount: totalAmount, commission_amount: commission, driver_earning: driverEarning, currency: 'INR', status: 'paid',
    });

    await User.findByIdAndUpdate(ride.driver_id, { $inc: { wallet_balance: driverEarning } });

    await WalletTransaction.create({ user_id: ride.driver_id, type: 'credit', amount: parseFloat(driverEarning.toFixed(2)), reason: 'payment_credit', ref_id: booking._id });

    await PlatformEarning.create({ booking_id: booking._id, ride_id, driver_id: ride.driver_id, amount: commission, type: 'commission' });

    await notify(userId, 'Booking Confirmed!', `Your booking for ${ride.from_location} → ${ride.to_location} is confirmed. Paid: ₹${totalAmount}.`, 'success', 'booking', booking._id);
    await notify(ride.driver_id, 'New Booking & Earning', `A passenger booked ${seatCount} seat(s). You earned: ₹${driverEarning.toFixed(2)}.`, 'success', 'booking', booking._id);

    const populatedBooking = await Booking.findById(booking._id).populate('ride_id', 'from_location to_location departure_time price_per_seat').populate('ride_id.driver_id', 'name');

    return ok(res, { booking: populatedBooking, message: 'Payment verified & ride booked successfully! 🎉', commission, driverEarning }, 201);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/payments/book-free ──────────────────────────────────────────────
router.post('/book-free', authRequired, validate([
  body('ride_id').trim().notEmpty().withMessage('Invalid ride_id'),
  body('seats').optional().isInt({ min: 1, max: 10 }).toInt()
]), async (req, res, next) => {
  try {
    const rideId    = req.body.ride_id;
    const seatCount = req.body.seats || 1;
    const userId    = req.user.id;

    const ride = await Ride.findOne({ _id: rideId, status: 'active' });
    if (!ride) {
      const err = new Error('Ride not found or not active.');
      err.statusCode = 404;
      return next(err);
    }
    if (String(ride.driver_id) === String(userId)) {
      const err = new Error('You cannot book your own ride.');
      err.statusCode = 400;
      return next(err);
    }
    if (ride.price_per_seat > 0) {
      const err = new Error('This is a paid ride — use the payment flow.');
      err.statusCode = 400;
      return next(err);
    }
    if (ride.available_seats < seatCount) {
      const err = new Error(`Not enough seats. Only ${ride.available_seats} left.`);
      err.statusCode = 400;
      return next(err);
    }

    const existing = await Booking.findOne({ ride_id: rideId, passenger_id: userId, status: 'confirmed' });
    if (existing) {
      const err = new Error('You already have a confirmed booking for this ride.');
      err.statusCode = 409;
      return next(err);
    }

    const booking = await Booking.create({
      ride_id: rideId, passenger_id: userId, seats_booked: seatCount,
      total_amount: 0, commission_amount: 0, driver_earning: 0, payment_status: 'free', status: 'confirmed',
    });

    await Ride.findByIdAndUpdate(rideId, { $inc: { available_seats: -seatCount } });

    res.status(201).json({ booking, message: 'Free ride booked successfully! 🎉' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/payments/my ──────────────────────────────────────────────────────
router.get('/my', authRequired, async (req, res, next) => {
  try {
    const payments = await Payment.find({ user_id: req.user.id })
      .populate({ path: 'booking_id', populate: { path: 'ride_id', select: 'from_location to_location departure_time' } })
      .sort({ created_at: -1 })
      .lean();

    const result = payments.map(p => {
      const obj = { ...p };
      obj.id             = obj._id;
      obj.seats_booked   = obj.booking_id?.seats_booked;
      obj.from_location  = obj.booking_id?.ride_id?.from_location;
      obj.to_location    = obj.booking_id?.ride_id?.to_location;
      obj.departure_time = obj.booking_id?.ride_id?.departure_time;
      return obj;
    });

    res.json({ payments: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
