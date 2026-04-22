/**
 * routes/payments.js — Razorpay Integration (Production-Hardened)
 *
 * Endpoints:
 *   GET  /api/payments/mode          → Safe status (LIVE/TEST/mock) — no secrets
 *   POST /api/payments/create-order  → Create Razorpay order
 *   POST /api/payments/verify        → Verify HMAC signature & create booking
 *   POST /api/payments/book-free     → Book a ₹0 ride (no payment)
 *   GET  /api/payments/my            → Logged-in user's payment history
 *
 * Security guarantees:
 *   • Keys loaded exclusively from env vars — never hardcoded
 *   • Secret never logged or returned to client
 *   • Signature verified with constant-time comparison (timingSafeEqual)
 *   • Idempotency: duplicate razorpay_order_id is rejected
 *   • Atomic transactions: booking + payment + wallet credit in one DB tx
 *   • LIVE vs TEST auto-detected from key prefix
 */
const express = require('express');
const crypto  = require('crypto');
const { prepare, transaction } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

// ── Helper: log wallet transaction (called inside a transaction block) ─────────
function logTx(userId, type, amount, reason, refId = null) {
  prepare(
    `INSERT INTO wallet_transactions (user_id, type, amount, reason, ref_id) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, type, parseFloat(amount.toFixed(2)), reason, refId);
}
const { notify } = require('../utils/notify');

// ── Standardised response helpers ────────────────────────────────────────────────
function ok(res, data, status = 200)  { return res.status(status).json({ success: true,  ...data }); }
function fail(res, msg, status = 400) { return res.status(status).json({ success: false, error: msg }); }

// ── Load & validate Razorpay credentials ─────────────────────────────────────
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;
const rzpKeyId        = (process.env.RAZORPAY_KEY_ID     || '').trim();
const rzpKeySecret    = (process.env.RAZORPAY_KEY_SECRET || '').trim();

const rzpConfigured = rzpKeyId.startsWith('rzp_') && rzpKeySecret.length > 10;
const rzpIsLive     = rzpKeyId.startsWith('rzp_live');
const rzpMode       = rzpIsLive ? 'LIVE' : 'TEST';

// Safe startup log — shows mode & key prefix only, never the secret
if (rzpConfigured) {
  console.log(`✅ [Razorpay] Initialized in ${rzpMode} mode (key prefix: ${rzpKeyId.slice(0, 12)}...)`);
} else {
  console.warn(`⚠️  [Razorpay] Keys missing or invalid — MOCK mode. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.`);
}

let razorpay = null;
if (rzpConfigured) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });
}

// ── Helper: commission split ──────────────────────────────────────────────────
function calcCommission(totalAmount) {
  const commission    = parseFloat((totalAmount * COMMISSION_RATE).toFixed(2));
  const driverEarning = parseFloat((totalAmount - commission).toFixed(2));
  return { commission, driverEarning };
}

// ── Helper: constant-time HMAC signature comparison ──────────────────────────
function verifyRazorpaySignature(orderId, paymentId, signature) {
  const body     = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', rzpKeySecret)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false; // length mismatch → definitely invalid
  }
}

// ── GET /api/payments/mode ────────────────────────────────────────────────────
// Safe public endpoint — never exposes the secret
router.get('/mode', (req, res) => {
  res.json({
    configured: !!razorpay,
    mock:       !razorpay,
    mode:       razorpay ? rzpMode : 'MOCK',
    isLive:     rzpIsLive,
    isTest:     rzpKeyId.startsWith('rzp_test'),
    message:    razorpay
      ? `Razorpay active (${rzpMode} mode)`
      : 'Razorpay not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
  });
});

// ── POST /api/payments/create-order ──────────────────────────────────────────
router.post('/create-order', authRequired, async (req, res) => {
  try {
    const rideId    = parseInt(req.body.ride_id, 10);
    const seatCount = Math.max(1, parseInt(req.body.seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);

    // ── Input validation ──────────────────────────────────────────────────────
    if (!rideId || isNaN(rideId)) {
      return res.status(400).json({ error: 'Invalid ride_id.' });
    }
    if (!userId || isNaN(userId)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (seatCount < 1 || seatCount > 10) {
      return res.status(400).json({ error: 'Seat count must be between 1 and 10.' });
    }

    // ── Fetch & validate ride ─────────────────────────────────────────────────
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or no longer active.' });
    }
    if (parseInt(ride.driver_id) === userId) {
      return res.status(400).json({ error: "You cannot book your own ride." });
    }
    if (ride.available_seats < seatCount) {
      return res.status(400).json({
        error: `Not enough seats. Requested ${seatCount}, only ${ride.available_seats} available.`
      });
    }

    // ── Idempotency: block confirmed double-booking ───────────────────────────
    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'"
    ).get(rideId, userId);
    if (existing) {
      return res.status(409).json({ error: 'You already have a confirmed booking for this ride.' });
    }

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);

    // ── Free ride ─────────────────────────────────────────────────────────────
    if (totalAmount <= 0) {
      return res.json({ free: true, totalAmount: 0, commission: 0, driverEarning: 0 });
    }

    // ── Razorpay not configured ───────────────────────────────────────────────
    if (!razorpay) {
      console.error(`[CREATE-ORDER] Blocked paid booking — Razorpay not configured. rideId=${rideId}`);
      return res.status(503).json({
        error: 'Payment system is not configured. Please contact support.',
        mock: true,
      });
    }

    // ── Create Razorpay order ─────────────────────────────────────────────────
    let order;
    try {
      order = await razorpay.orders.create({
        amount:   Math.round(totalAmount * 100), // paise
        currency: 'INR',
        notes: {
          ride_id: String(rideId),
          user_id: String(userId),
          seats:   String(seatCount),
        },
      });
    } catch (rzpErr) {
      // Determine if it's an auth failure without leaking key values
      const isAuthFail = rzpErr?.statusCode === 401 ||
        (rzpErr?.error?.description || '').toLowerCase().includes('authentication');
      if (isAuthFail) {
        console.error('[CREATE-ORDER] ❌ Razorpay authentication failed — rotate keys immediately');
        return res.status(401).json({
          error: 'Payment gateway authentication failed. Please contact support.',
        });
      }
      const msg = rzpErr?.error?.description || rzpErr?.message || 'Order creation failed.';
      console.error(`[CREATE-ORDER] Razorpay error: ${msg}`);
      return res.status(502).json({ error: `Payment gateway error. Please try again.` });
    }

    console.log(`[CREATE-ORDER] Order created: ${order.id} | ride=${rideId} | user=${userId} | ₹${totalAmount}`);

    // Return only key_id (public) — NEVER return the secret
    res.json({
      free:         false,
      mock:         false,
      key_id:       rzpKeyId,   // public key — safe to send
      order_id:     order.id,
      amount:       order.amount,
      currency:     order.currency,
      totalAmount,
      commission,
      driverEarning,
      ride_id:      rideId,
      seats:        seatCount,
      ride_from:    ride.from_location,
      ride_to:      ride.to_location,
    });

  } catch (err) {
    console.error('[CREATE-ORDER] Unexpected error:', err.message);
    res.status(500).json({ error: 'Failed to create payment order. Please try again.' });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post('/verify', authRequired, (req, res) => {
  try {
    const {
      ride_id, seats,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const rideId    = parseInt(ride_id, 10);
    const seatCount = Math.max(1, parseInt(seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);

    // ── Validate all required fields ──────────────────────────────────────────
    if (!rideId || isNaN(rideId))       return res.status(400).json({ error: 'Invalid ride_id.' });
    if (!razorpay_order_id)              return res.status(400).json({ error: 'Missing razorpay_order_id.' });
    if (!razorpay_payment_id)            return res.status(400).json({ error: 'Missing razorpay_payment_id.' });
    if (!razorpay_signature)             return res.status(400).json({ error: 'Missing razorpay_signature.' });

    // ── Idempotency: reject if order_id OR payment_id already processed ────────
    const dupOrder = prepare(
      "SELECT id FROM bookings WHERE razorpay_order_id = ? AND status = 'confirmed'"
    ).get(razorpay_order_id);
    if (dupOrder) {
      console.warn(`[VERIFY] Duplicate order_id: ${razorpay_order_id} | user=${userId}`);
      return fail(res, 'This payment has already been processed.', 409);
    }

    const dupPayment = prepare(
      "SELECT id FROM payments WHERE razorpay_payment_id = ?"
    ).get(razorpay_payment_id);
    if (dupPayment) {
      console.warn(`[VERIFY] Duplicate payment_id: ${razorpay_payment_id} | user=${userId}`);
      return fail(res, 'This payment ID has already been used.', 409);
    }

    // ── Fetch ride ────────────────────────────────────────────────────────────────
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    if (!ride) return fail(res, 'Ride not found.', 404);

    // Fraud: prevent self-booking
    if (parseInt(ride.driver_id) === userId) return fail(res, "You cannot book your own ride.");

    // Availability check
    if (ride.available_seats < seatCount)
      return fail(res, `Not enough seats. Only ${ride.available_seats} available.`);

    // Duplicate confirmed booking
    const dupBooking = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'"
    ).get(rideId, userId);
    if (dupBooking) return fail(res, 'You already have a confirmed booking for this ride.', 409);

    // ── Strict HMAC-SHA256 signature verification ─────────────────────────────
    // Always enforce in production (when razorpay is configured)
    if (razorpay) {
      const valid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!valid) {
        console.error(`[VERIFY] ❌ Signature mismatch | order=${razorpay_order_id} | user=${userId}`);
        return res.status(400).json({ error: 'Payment verification failed — invalid signature.' });
      }
    }

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);

    // ── Atomic: booking + payment record + driver wallet credit ──────────────
    const doBook = transaction(() => {
      const bookingResult = prepare(
        `INSERT INTO bookings
           (ride_id, passenger_id, seats_booked, total_amount, commission_amount,
            driver_earning, payment_status, razorpay_order_id, razorpay_payment_id,
            razorpay_signature, status)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, 'confirmed')`
      ).run(
        rideId, userId, seatCount, totalAmount,
        commission, driverEarning,
        razorpay_order_id, razorpay_payment_id, razorpay_signature,
      );

      const bookingId = bookingResult.lastInsertRowid;

      prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?')
        .run(seatCount, rideId);

      prepare(
        `INSERT INTO payments
           (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
            razorpay_signature, amount, commission_amount, driver_earning,
            currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'paid')`
      ).run(
        bookingId, userId,
        razorpay_order_id, razorpay_payment_id, razorpay_signature,
        totalAmount, commission, driverEarning,
      );

      // Credit driver wallet (same atomic transaction — no partial state)
      prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?')
        .run(driverEarning, ride.driver_id);

      // Audit log — driver earning credit
      logTx(ride.driver_id, 'credit', driverEarning, `payment_credit`, bookingId);

      // Platform commission ledger
      prepare(
        `INSERT INTO platform_earnings (booking_id, ride_id, driver_id, amount) VALUES (?, ?, ?, ?)`
      ).run(bookingId, rideId, ride.driver_id, commission);

      return bookingId;
    });

    const bookingId = doBook();
    console.log(`[VERIFY] ✅ Booking #${bookingId} | ride=${rideId} | user=${userId} | ₹${totalAmount}`);

    // Notifications
    notify(userId, '🎉 Booking Confirmed!',
      `Your booking for ${ride.from_location} → ${ride.to_location} is confirmed. Paid: ₹${totalAmount}.`,
      'success', 'booking', bookingId);
    notify(ride.driver_id, '💰 New Booking & Earning',
      `A passenger booked ${seatCount} seat(s) on your ride. You earned: ₹${driverEarning.toFixed(2)}.`,
      'success', 'booking', bookingId);

    const booking = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, u.name AS driver_name
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id
       WHERE b.id = ?`
    ).get(bookingId);

    return ok(res, {
      booking,
      message: 'Payment verified & ride booked successfully! 🎉',
      commission,
      driverEarning,
    }, 201);

  } catch (err) {
    console.error('[VERIFY] Error:', err.message);
    return fail(res, 'Failed to verify payment. Please contact support.', 500);
  }
});

// ── POST /api/payments/book-free ──────────────────────────────────────────────
router.post('/book-free', authRequired, (req, res) => {
  try {
    const rideId    = parseInt(req.body.ride_id, 10);
    const seatCount = Math.max(1, parseInt(req.body.seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);

    if (!rideId || isNaN(rideId)) return res.status(400).json({ error: 'Invalid ride_id.' });

    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    if (!ride)                               return res.status(404).json({ error: 'Ride not found or not active.' });
    if (parseInt(ride.driver_id) === userId) return res.status(400).json({ error: "You cannot book your own ride." });
    if (ride.price_per_seat > 0)             return res.status(400).json({ error: 'This is a paid ride — use the payment flow.' });
    if (ride.available_seats < seatCount)    return res.status(400).json({ error: `Not enough seats. Only ${ride.available_seats} left.` });

    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'"
    ).get(rideId, userId);
    if (existing) return res.status(409).json({ error: 'You already have a confirmed booking for this ride.' });

    const doBook = transaction(() => {
      const result = prepare(
        `INSERT INTO bookings
           (ride_id, passenger_id, seats_booked, total_amount,
            commission_amount, driver_earning, payment_status, status)
         VALUES (?, ?, ?, 0, 0, 0, 'free', 'confirmed')`
      ).run(rideId, userId, seatCount);
      prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?')
        .run(seatCount, rideId);
      return result.lastInsertRowid;
    });

    const bookingId = doBook();
    console.log(`[BOOK-FREE] Booking #${bookingId} | ride=${rideId} | user=${userId}`);

    const booking = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, u.name AS driver_name
       FROM bookings b JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id WHERE b.id = ?`
    ).get(bookingId);

    res.status(201).json({ booking, message: 'Free ride booked successfully! 🎉' });

  } catch (err) {
    console.error('[BOOK-FREE] Error:', err.message);
    res.status(500).json({ error: 'Failed to book ride. Please try again.' });
  }
});

// ── GET /api/payments/my ──────────────────────────────────────────────────────
router.get('/my', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    const payments = prepare(
      `SELECT p.*, b.seats_booked, r.from_location, r.to_location, r.departure_time
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN rides    r ON b.ride_id    = r.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`
    ).all(userId);
    res.json({ payments });
  } catch (err) {
    console.error('[PAYMENTS /my] Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
