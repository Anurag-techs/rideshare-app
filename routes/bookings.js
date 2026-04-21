/**
 * routes/bookings.js — Booking management
 * Kept for GET /my and PUT /:id/cancel
 * POST booking is now handled via /api/payments/verify and /api/payments/book-free
 */
const express = require('express');
const { prepare, transaction } = require('../db/init');
const { authRequired }         = require('../middleware/auth');
const router  = express.Router();

/**
 * GET /api/bookings/my — All bookings for the logged-in passenger
 */
router.get('/my', authRequired, (req, res) => {
  try {
    const bookings = prepare(
      `SELECT b.*,
              r.from_location, r.to_location, r.departure_time,
              r.price_per_seat, r.status AS ride_status, r.driver_id,
              u.name            AS driver_name,
              u.profile_photo   AS driver_photo,
              u.avg_rating      AS driver_rating,
              c.model           AS car_model,
              c.color           AS car_color
       FROM bookings b
       JOIN rides r  ON b.ride_id    = r.id
       JOIN users u  ON r.driver_id  = u.id
       LEFT JOIN cars c ON r.car_id  = c.id
       WHERE b.passenger_id = ?
       ORDER BY r.departure_time DESC`
    ).all(req.user.id);

    res.json({ bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/**
 * PUT /api/bookings/:id/cancel — Cancel a booking & restore seats
 */
router.put('/:id/cancel', authRequired, (req, res) => {
  try {
    const booking = prepare(
      "SELECT * FROM bookings WHERE id = ? AND passenger_id = ? AND status != 'cancelled'"
    ).get(req.params.id, req.user.id);

    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    const cancel = transaction(() => {
      prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
      prepare('UPDATE rides SET available_seats = available_seats + ? WHERE id = ?')
        .run(booking.seats_booked, booking.ride_id);
    });
    cancel();

    res.json({ message: 'Booking cancelled.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/**
 * GET /api/bookings/driver — All bookings on the driver's rides
 */
router.get('/driver', authRequired, (req, res) => {
  try {
    const bookings = prepare(
      `SELECT b.*, r.from_location, r.to_location, r.departure_time,
              u.name AS passenger_name, u.profile_photo AS passenger_photo,
              u.phone AS passenger_phone
       FROM bookings b
       JOIN rides r ON b.ride_id    = r.id
       JOIN users u ON b.passenger_id = u.id
       WHERE r.driver_id = ? AND b.status != 'cancelled'
       ORDER BY r.departure_time DESC`
    ).all(req.user.id);
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
