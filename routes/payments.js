// Payment routes — Stripe integration
const express = require('express');
const { prepare, saveDb } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

// Initialize Stripe (only if key is configured)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('YOUR_')) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/**
 * POST /api/payments/create-intent
 * Creates a Stripe PaymentIntent for a ride booking
 * Body: { ride_id, seats }
 */
router.post('/create-intent', authRequired, async (req, res) => {
  try {
    const { ride_id, seats } = req.body;
    const seatCount = seats || 1;

    // Get ride details
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(ride_id);
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.driver_id === req.user.id) return res.status(400).json({ error: "You can't book your own ride." });
    if (ride.available_seats < seatCount) return res.status(400).json({ error: 'Not enough seats.' });

    const totalAmount = ride.price_per_seat * seatCount;

    // If ride is free, no payment needed
    if (totalAmount <= 0) {
      return res.json({ free: true, totalAmount: 0 });
    }

    // If Stripe is not configured, return a mock payment
    if (!stripe) {
      return res.json({
        free: false,
        mock: true,
        totalAmount,
        message: 'Stripe not configured — mock payment mode'
      });
    }

    // Create a Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100), // Stripe expects amount in paise (cents)
      currency: 'inr',
      metadata: {
        ride_id: ride_id.toString(),
        user_id: req.user.id.toString(),
        seats: seatCount.toString(),
      },
    });

    res.json({
      free: false,
      mock: false,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalAmount,
    });
  } catch (err) {
    console.error('Payment intent error:', err);
    res.status(500).json({ error: 'Failed to create payment.' });
  }
});

/**
 * POST /api/payments/confirm
 * Confirms a payment and updates the booking record
 * Body: { booking_id, payment_intent_id }
 */
router.post('/confirm', authRequired, (req, res) => {
  try {
    const { booking_id, payment_intent_id } = req.body;

    prepare(
      "UPDATE bookings SET payment_status = 'paid', payment_intent_id = ? WHERE id = ? AND passenger_id = ?"
    ).run(payment_intent_id || 'mock_payment', booking_id, req.user.id);
    saveDb();

    res.json({ message: 'Payment confirmed!' });
  } catch (err) {
    console.error('Payment confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm payment.' });
  }
});

module.exports = router;
