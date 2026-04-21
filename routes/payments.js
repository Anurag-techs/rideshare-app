/**
 * routes/payments.js — Razorpay Integration
 *
 * Endpoints:
 *   POST /api/payments/create-order   → Create Razorpay order (returns order_id)
 *   POST /api/payments/verify         → Verify signature & mark booking paid
 *   GET  /api/payments/my             → List all payments for logged-in user
 *
 * Commission Model:
 *   total_amount      = seats × price_per_seat
 *   commission        = total_amount × COMMISSION_RATE  (default 10%)
 *   driver_earning    = total_amount − commission
 */
const express  = require('express');
const crypto   = require('crypto');
const { prepare, transaction, saveDb } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router   = express.Router();

// ── Init Razorpay (gracefully degrade if keys not set) ─────────────────────
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;

let razorpay = null;
const rzpKeyId     = process.env.RAZORPAY_KEY_ID     || '';
const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
const rzpConfigured = rzpKeyId && !rzpKeyId.includes('YOUR_') &&
                      rzpKeySecret && !rzpKeySecret.includes('YOUR_');

if (rzpConfigured) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });
  console.log('💳 Razorpay initialized');
} else {
  console.warn('⚠️  Razorpay keys not set — running in MOCK payment mode');
}

// ── Helper: compute commission split ───────────────────────────────────────
function calcCommission(totalAmount) {
  const commission    = parseFloat((totalAmount * COMMISSION_RATE).toFixed(2));
  const driverEarning = parseFloat((totalAmount - commission).toFixed(2));
  return { commission, driverEarning };
}

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order and returns order_id + amount to the frontend.
 * Body: { ride_id, seats }
 */
router.post('/create-order', authRequired, async (req, res) => {
  try {
    const { ride_id, seats } = req.body;
    const seatCount = Math.max(1, parseInt(seats) || 1);

    // Validate ride
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(ride_id);
    if (!ride)                           return res.status(404).json({ error: 'Ride not found.' });
    if (ride.driver_id === req.user.id)  return res.status(400).json({ error: "You can't book your own ride." });
    if (ride.available_seats < seatCount) return res.status(400).json({ error: 'Not enough seats available.' });

    // Prevent double-booking
    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status != 'cancelled'"
    ).get(ride_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You have already booked this ride.' });

    const totalAmount = ride.price_per_seat * seatCount;
    const { commission, driverEarning } = calcCommission(totalAmount);

    // ── Free ride — skip payment ───────────────────────────────────────────
    if (totalAmount <= 0) {
      return res.json({
        free: true,
        totalAmount: 0,
        commission: 0,
        driverEarning: 0,
      });
    }

    // ── Mock mode — no real Razorpay keys ─────────────────────────────────
    if (!razorpay) {
      return res.json({
        free: false,
        mock: true,
        totalAmount,
        commission,
        driverEarning,
        key_id: 'mock',
        order_id: `mock_order_${Date.now()}`,
        currency: 'INR',
        message: 'Razorpay not configured — mock mode',
      });
    }

    // ── Real Razorpay order ────────────────────────────────────────────────
    // Razorpay expects amount in paise (1 INR = 100 paise)
    const order = await razorpay.orders.create({
      amount:   Math.round(totalAmount * 100),
      currency: 'INR',
      notes: {
        ride_id:    ride_id.toString(),
        user_id:    req.user.id.toString(),
        seats:      seatCount.toString(),
        commission: commission.toString(),
      },
    });

    res.json({
      free:          false,
      mock:          false,
      totalAmount,
      commission,
      driverEarning,
      key_id:        rzpKeyId,
      order_id:      order.id,
      currency:      order.currency,
      amount:        order.amount,   // in paise
      ride_id,
      seats:         seatCount,
      ride_from:     ride.from_location,
      ride_to:       ride.to_location,
      driver_name:   prepare('SELECT name FROM users WHERE id = ?').get(ride.driver_id)?.name,
    });
  } catch (err) {
    console.error('❌ create-order error:', err);
    res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

/**
 * POST /api/payments/verify
 * Verifies Razorpay signature, creates booking record, stores payment details.
 * Body: { ride_id, seats, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post('/verify', authRequired, (req, res) => {
  try {
    const {
      ride_id, seats,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const seatCount = Math.max(1, parseInt(seats) || 1);

    // Validate ride
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(ride_id);
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });

    const totalAmount = ride.price_per_seat * seatCount;
    const { commission, driverEarning } = calcCommission(totalAmount);

    // ── Verify HMAC-SHA256 signature (skip in mock mode) ──────────────────
    if (razorpay && !razorpay_order_id?.startsWith('mock_')) {
      const body      = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected  = crypto
        .createHmac('sha256', rzpKeySecret)
        .update(body)
        .digest('hex');

      if (expected !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment verification failed — invalid signature.' });
      }
    }

    // ── Atomically create booking + payment record ─────────────────────────
    const doBook = transaction(() => {
      const bookingResult = prepare(
        `INSERT INTO bookings
           (ride_id, passenger_id, seats_booked, total_amount, commission_amount,
            driver_earning, payment_status, razorpay_order_id, razorpay_payment_id,
            razorpay_signature, status)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, 'confirmed')`
      ).run(
        ride_id, req.user.id, seatCount, totalAmount,
        commission, driverEarning,
        razorpay_order_id  || null,
        razorpay_payment_id || null,
        razorpay_signature  || null,
      );

      const bookingId = bookingResult.lastInsertRowid;

      // Deduct available seats
      prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?')
        .run(seatCount, ride_id);

      // Insert detailed payment record
      prepare(
        `INSERT INTO payments
           (booking_id, user_id, razorpay_order_id, razorpay_payment_id,
            razorpay_signature, amount, commission_amount, driver_earning,
            currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'paid')`
      ).run(
        bookingId, req.user.id,
        razorpay_order_id  || null,
        razorpay_payment_id || null,
        razorpay_signature  || null,
        totalAmount, commission, driverEarning,
      );

      return bookingId;
    });

    const bookingId = doBook();

    // Return full booking object
    const booking = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, u.name AS driver_name
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id
       WHERE b.id = ?`
    ).get(bookingId);

    res.status(201).json({
      booking,
      message: 'Payment verified & ride booked successfully! 🎉',
      commission,
      driverEarning,
    });
  } catch (err) {
    console.error('❌ payment verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

/**
 * POST /api/payments/book-free
 * Book a free (₹0) ride — no payment required.
 * Body: { ride_id, seats }
 */
router.post('/book-free', authRequired, (req, res) => {
  try {
    const { ride_id, seats } = req.body;
    const seatCount = Math.max(1, parseInt(seats) || 1);

    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(ride_id);
    if (!ride)                            return res.status(404).json({ error: 'Ride not found.' });
    if (ride.driver_id === req.user.id)   return res.status(400).json({ error: "You can't book your own ride." });
    if (ride.price_per_seat > 0)          return res.status(400).json({ error: 'This ride is not free.' });
    if (ride.available_seats < seatCount) return res.status(400).json({ error: 'Not enough seats.' });

    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status != 'cancelled'"
    ).get(ride_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You have already booked this ride.' });

    const doBook = transaction(() => {
      const result = prepare(
        `INSERT INTO bookings
           (ride_id, passenger_id, seats_booked, total_amount,
            commission_amount, driver_earning, payment_status, status)
         VALUES (?, ?, ?, 0, 0, 0, 'free', 'confirmed')`
      ).run(ride_id, req.user.id, seatCount);
      prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?')
        .run(seatCount, ride_id);
      return result.lastInsertRowid;
    });

    const bookingId = doBook();
    const booking   = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, u.name AS driver_name
       FROM bookings b JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id WHERE b.id = ?`
    ).get(bookingId);

    res.status(201).json({ booking, message: 'Free ride booked successfully! 🎉' });
  } catch (err) {
    console.error('❌ book-free error:', err);
    res.status(500).json({ error: 'Failed to book ride.' });
  }
});

/**
 * GET /api/payments/my
 * Returns all payment records for the logged-in user.
 */
router.get('/my', authRequired, (req, res) => {
  try {
    const payments = prepare(
      `SELECT p.*, b.seats_booked, r.from_location, r.to_location, r.departure_time
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN rides    r ON b.ride_id    = r.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`
    ).all(req.user.id);
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
