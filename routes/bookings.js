const express = require('express');
const { prepare, transaction, saveDb } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

router.post('/', authRequired, (req, res) => {
  try {
    const { ride_id, seats_booked } = req.body;
    const seats = seats_booked || 1;
    if (!ride_id) return res.status(400).json({ error: 'Ride ID is required.' });
    const ride = prepare("SELECT * FROM rides WHERE id = ? AND status = 'active'").get(ride_id);
    if (!ride) return res.status(404).json({ error: 'Ride not found or no longer active.' });
    if (ride.driver_id === req.user.id) return res.status(400).json({ error: "You can't book your own ride." });
    const existing = prepare("SELECT * FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status != 'cancelled'").get(ride_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You have already booked this ride.' });
    if (ride.available_seats < seats) return res.status(400).json({ error: `Only ${ride.available_seats} seat(s) available.` });

    const bookRide = transaction(() => {
      const result = prepare('INSERT INTO bookings (ride_id, passenger_id, seats_booked, status) VALUES (?, ?, ?, ?)').run(ride_id, req.user.id, seats, 'confirmed');
      prepare('UPDATE rides SET available_seats = available_seats - ? WHERE id = ?').run(seats, ride_id);
      return result.lastInsertRowid;
    });
    const bookingId = bookRide();

    const booking = prepare("SELECT b.*, r.from_location, r.to_location, r.departure_time, r.price_per_seat, u.name as driver_name FROM bookings b JOIN rides r ON b.ride_id = r.id JOIN users u ON r.driver_id = u.id WHERE b.id = ?").get(bookingId);
    res.status(201).json({ booking, message: 'Ride booked successfully!' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/my', authRequired, (req, res) => {
  try {
    const bookings = prepare("SELECT b.*, r.from_location, r.to_location, r.departure_time, r.price_per_seat, r.status as ride_status, r.driver_id, u.name as driver_name, u.profile_photo as driver_photo, u.avg_rating as driver_rating, c.model as car_model, c.color as car_color FROM bookings b JOIN rides r ON b.ride_id = r.id JOIN users u ON r.driver_id = u.id LEFT JOIN cars c ON r.car_id = c.id WHERE b.passenger_id = ? ORDER BY r.departure_time DESC").all(req.user.id);
    res.json({ bookings });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.put('/:id/cancel', authRequired, (req, res) => {
  try {
    const booking = prepare("SELECT * FROM bookings WHERE id = ? AND passenger_id = ? AND status != 'cancelled'").get(req.params.id, req.user.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    const cancel = transaction(() => {
      prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
      prepare('UPDATE rides SET available_seats = available_seats + ? WHERE id = ?').run(booking.seats_booked, booking.ride_id);
    });
    cancel();
    res.json({ message: 'Booking cancelled.' });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
