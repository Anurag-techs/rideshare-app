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

// ── Init Razorpay ─────────────────────────────────────────────────────────────
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE) || 0.10;

let razorpay = null;
const rzpKeyId     = (process.env.RAZORPAY_KEY_ID     || '').trim();
const rzpKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
const rzpConfigured = rzpKeyId.startsWith('rzp_') && rzpKeySecret.length > 10;

console.log('[Razorpay] KEY_ID  present:', !!rzpKeyId,  '| starts with rzp_:', rzpKeyId.startsWith('rzp_'),  '| prefix:', rzpKeyId.slice(0, 12) || '(empty)');
console.log('[Razorpay] SECRET  present:', !!rzpKeySecret, '| length:', rzpKeySecret.length || 0);
console.log('[Razorpay] Mode:', rzpConfigured ? 'LIVE / TEST' : 'MOCK (keys missing or invalid)');

if (rzpConfigured) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });
  console.log('✅ Razorpay initialized successfully');
} else {
  console.warn('⚠️  Razorpay keys missing/invalid — running in MOCK payment mode');
  console.warn('   Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment (Render dashboard / .env)');
}

// ── Helper: compute commission split ───────────────────────────────────────
function calcCommission(totalAmount) {
  const commission    = parseFloat((totalAmount * COMMISSION_RATE).toFixed(2));
  const driverEarning = parseFloat((totalAmount - commission).toFixed(2));
  return { commission, driverEarning };
}

/**
 * GET /api/payments/mode
 * Public endpoint — tells the frontend whether Razorpay is live/test or mock.
 * Safe: never exposes secret keys.
 */
router.get('/mode', (req, res) => {
  res.json({
    mock:       !razorpay,
    configured: !!razorpay,
    keyPrefix:  rzpKeyId ? rzpKeyId.slice(0, 8) : null,  // e.g. "rzp_live" or "rzp_test"
    isLive:     rzpKeyId.startsWith('rzp_live'),
    isTest:     rzpKeyId.startsWith('rzp_test'),
    message:    razorpay
      ? `Razorpay active (${rzpKeyId.startsWith('rzp_live') ? 'LIVE' : 'TEST'} mode)`
      : 'Razorpay not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to environment variables',
  });
});


/**
 * POST /api/payments/create-order
 * Creates a Razorpay order and returns order_id + amount to the frontend.
 * Body: { ride_id, seats }
 */
router.post('/create-order', authRequired, async (req, res) => {
  try {
    // ── Parse & validate inputs ────────────────────────────────────────────
    const rideId    = parseInt(req.body.ride_id, 10);
    const seatCount = Math.max(1, parseInt(req.body.seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);

    console.log('[CREATE-ORDER] req.body:', req.body, '| req.user:', req.user,
                '| rideId:', rideId, '| seats:', seatCount, '| userId:', userId);

    if (!rideId || isNaN(rideId)) {
      return res.status(400).json({ error: 'Invalid ride_id provided.' });
    }
    if (!userId || isNaN(userId)) {
      return res.status(401).json({ error: 'Unauthorized — invalid token payload.' });
    }

    // ── Fetch & validate ride ──────────────────────────────────────────────
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    console.log('[CREATE-ORDER] ride found:', ride ? `id=${ride.id} driver=${ride.driver_id} seats=${ride.available_seats}` : 'NOT FOUND');

    if (!ride) {
      return res.status(404).json({ error: `Ride #${rideId} not found or no longer active.` });
    }
    // Use == (loose) to handle potential int/string mismatch from sql.js vs JWT
    if (parseInt(ride.driver_id) === userId) {
      return res.status(400).json({ error: "You can't book your own ride." });
    }
    if (ride.available_seats < seatCount) {
      return res.status(400).json({
        error: `Not enough seats. Requested ${seatCount}, only ${ride.available_seats} available.`
      });
    }

    // ── Prevent double-booking (only block confirmed bookings) ───────────────
    // Use status = 'confirmed' NOT status != 'cancelled' so users can retry
    // after a failed or incomplete payment (those rows have status 'pending').
    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'"
    ).get(rideId, userId);
    if (existing) {
      console.log('[CREATE-ORDER] Duplicate confirmed booking detected — bookingId:', existing.id);
      return res.status(409).json({ error: 'You already have a confirmed booking for this ride.' });
    }

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);
    console.log('[CREATE-ORDER] totalAmount:', totalAmount, '| commission:', commission, '| driverEarning:', driverEarning);

    // ── Free ride — skip payment ───────────────────────────────────────────
    if (totalAmount <= 0) {
      console.log('[CREATE-ORDER] Free ride — skipping payment');
      return res.json({ free: true, totalAmount: 0, commission: 0, driverEarning: 0 });
    }

    // ── Mock mode — Razorpay keys not configured ─────────────────────────────
    // BLOCK paid rides — never create fake bookings in production.
    // Free rides go through /book-free instead, so this only fires for paid rides.
    if (!razorpay) {
      console.error('[CREATE-ORDER] ⚠️  Razorpay not configured — blocking paid booking for ride', rideId);
      return res.status(503).json({
        error: 'Payment system not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your environment variables (Render dashboard).',
        mock:  true,
      });
    }

    // ── Real Razorpay order ────────────────────────────────────────────────
    console.log('[CREATE-ORDER] Creating real Razorpay order for amount (paise):', Math.round(totalAmount * 100));
    let order;
    try {
      order = await razorpay.orders.create({
        amount:   Math.round(totalAmount * 100),
        currency: 'INR',
        notes: {
          ride_id:    rideId.toString(),
          user_id:    userId.toString(),
          seats:      seatCount.toString(),
          commission: commission.toString(),
        },
      });
    } catch (rzpErr) {
      console.error('[CREATE-ORDER] Razorpay API error:', JSON.stringify(rzpErr));
      // Razorpay returns statusCode 401 when keys are wrong/revoked
      const isAuthFail = rzpErr?.statusCode === 401 ||
                         rzpErr?.error?.code === 'BAD_REQUEST_ERROR' ||
                         (rzpErr?.error?.description || '').toLowerCase().includes('authentication');
      if (isAuthFail) {
        console.error('[CREATE-ORDER] ❌ Razorpay key authentication failed — keys may be revoked or wrong');
        return res.status(401).json({
          error: 'Razorpay authentication failed — the API keys are invalid or revoked. Regenerate them at dashboard.razorpay.com → Settings → API Keys.',
        });
      }
      const msg = rzpErr?.error?.description || rzpErr?.message || 'Razorpay order creation failed.';
      return res.status(502).json({ error: `Payment gateway error: ${msg}` });
    }

    console.log('[CREATE-ORDER] Razorpay order created:', order.id);
    const driverName = prepare('SELECT name FROM users WHERE id = ?').get(ride.driver_id)?.name || '';

    res.json({
      free:          false,
      mock:          false,
      totalAmount,
      commission,
      driverEarning,
      key_id:        rzpKeyId,
      order_id:      order.id,
      currency:      order.currency,
      amount:        order.amount,
      ride_id:       rideId,
      seats:         seatCount,
      ride_from:     ride.from_location,
      ride_to:       ride.to_location,
      driver_name:   driverName,
    });
  } catch (err) {
    console.error('[CREATE-ORDER] Unexpected error:', err);
    res.status(500).json({ error: err.message || 'Failed to create payment order.' });
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

    const rideId    = parseInt(ride_id, 10);
    const seatCount = Math.max(1, parseInt(seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);
    console.log('[VERIFY] rideId:', rideId, '| seats:', seatCount, '| userId:', userId, '| order:', razorpay_order_id);

    // Validate ride
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    if (!ride) return res.status(404).json({ error: `Ride #${rideId} not found.` });

    const totalAmount = parseFloat((ride.price_per_seat * seatCount).toFixed(2));
    const { commission, driverEarning } = calcCommission(totalAmount);

    // ── Verify HMAC-SHA256 signature (skip in mock mode) ──────────────────
    if (razorpay && !razorpay_order_id?.startsWith('mock_')) {
      const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac('sha256', rzpKeySecret)
        .update(body)
        .digest('hex');

      if (expected !== razorpay_signature) {
        console.error('[VERIFY] Signature mismatch. Expected:', expected, 'Got:', razorpay_signature);
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
        rideId, userId, seatCount, totalAmount,
        commission, driverEarning,
        razorpay_order_id   || null,
        razorpay_payment_id || null,
        razorpay_signature  || null,
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
        razorpay_order_id   || null,
        razorpay_payment_id || null,
        razorpay_signature  || null,
        totalAmount, commission, driverEarning,
      );

      return bookingId;
    });

    const bookingId = doBook();
    console.log('[VERIFY] Booking created:', bookingId);

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
    console.error('[VERIFY] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to verify payment.' });
  }
});

/**
 * POST /api/payments/book-free
 * Book a free (₹0) ride — no payment required.
 * Body: { ride_id, seats }
 */
router.post('/book-free', authRequired, (req, res) => {
  try {
    const rideId    = parseInt(req.body.ride_id, 10);
    const seatCount = Math.max(1, parseInt(req.body.seats, 10) || 1);
    const userId    = parseInt(req.user.id, 10);
    console.log('[BOOK-FREE] rideId:', rideId, '| seats:', seatCount, '| userId:', userId);

    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(rideId);
    if (!ride)                                       return res.status(404).json({ error: `Ride #${rideId} not found or not active.` });
    if (parseInt(ride.driver_id) === userId)         return res.status(400).json({ error: "You can't book your own ride." });
    if (ride.price_per_seat > 0)                     return res.status(400).json({ error: 'This is a paid ride — use the payment flow.' });
    if (ride.available_seats < seatCount)            return res.status(400).json({ error: `Not enough seats. Only ${ride.available_seats} left.` });

    // Only block if a confirmed booking exists — not pending/failed ones
    const existing = prepare(
      "SELECT id FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'"
    ).get(rideId, userId);
    if (existing) {
      console.log('[BOOK-FREE] Duplicate confirmed booking detected — bookingId:', existing.id);
      return res.status(409).json({ error: 'You already have a confirmed booking for this ride.' });
    }

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
    console.log('[BOOK-FREE] Booking created:', bookingId);
    const booking = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, u.name AS driver_name
       FROM bookings b JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id WHERE b.id = ?`
    ).get(bookingId);

    res.status(201).json({ booking, message: 'Free ride booked successfully! 🎉' });
  } catch (err) {
    console.error('[BOOK-FREE] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to book ride.' });
  }
});

/**
 * GET /api/payments/my
 * Returns all payment records for the logged-in user.
 */
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
    console.error('[PAYMENTS /my] Error:', err);
    res.status(500).json({ error: err.message || 'Server error.' });
  }
});

module.exports = router;
