const express = require('express');
const { prepare } = require('../db/init');
const { authRequired, authOptional } = require('../middleware/auth');
const router = express.Router();

router.post('/', authRequired, (req, res) => {
  try {
    const { car_name, from_location, to_location, from_lat, from_lng, to_lat, to_lng, departure_time, total_seats, available_seats, price_per_seat, notes } = req.body;
    if (!from_location || !to_location || !departure_time) return res.status(400).json({ error: 'From, to, and departure time are required.' });
    const seats = total_seats || 4;
    const result = prepare('INSERT INTO rides (driver_id, car_name, from_location, to_location, from_lat, from_lng, to_lat, to_lng, departure_time, total_seats, available_seats, price_per_seat, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      req.user.id, car_name || null, from_location, to_location, from_lat || null, from_lng || null, to_lat || null, to_lng || null, departure_time, seats, available_seats || seats, price_per_seat || 0, notes || null
    );
    const ride = prepare('SELECT r.*, u.name as driver_name, u.profile_photo as driver_photo, u.avg_rating as driver_rating FROM rides r JOIN users u ON r.driver_id = u.id WHERE r.id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ride });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/search', authOptional, (req, res) => {
  try {
    const { from, to, date, max_price, sort } = req.query;
    let conditions = ["r.status = 'active'", "r.available_seats > 0"];
    let params = [];

    if (from) { conditions.push("LOWER(r.from_location) LIKE LOWER(?)"); params.push(`%${from}%`); }
    if (to) { conditions.push("LOWER(r.to_location) LIKE LOWER(?)"); params.push(`%${to}%`); }
    if (date) { conditions.push("DATE(r.departure_time) = DATE(?)"); params.push(date); }
    if (max_price) { conditions.push("r.price_per_seat <= ?"); params.push(parseFloat(max_price)); }

    let orderBy = 'r.departure_time ASC';
    if (sort === 'price_asc') orderBy = 'r.price_per_seat ASC';
    else if (sort === 'price_desc') orderBy = 'r.price_per_seat DESC';
    else if (sort === 'time_desc') orderBy = 'r.departure_time DESC';
    else if (sort === 'rating') orderBy = 'u.avg_rating DESC';

    const query = `SELECT r.*, (r.total_seats - r.available_seats) as booking_count, u.name as driver_name, u.profile_photo as driver_photo, u.avg_rating as driver_rating, u.total_ratings as driver_total_ratings, (SELECT COUNT(*) FROM rides WHERE driver_id = u.id AND status='completed') as driver_completed_rides, c.model as car_model, c.color as car_color FROM rides r JOIN users u ON r.driver_id = u.id LEFT JOIN cars c ON r.car_id = c.id WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT 50`;
    const rides = prepare(query).all(...params);
    res.json({ rides });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/my/driver', authRequired, (req, res) => {
  try {
    const rides = prepare("SELECT r.*, c.model as car_model, c.color as car_color, (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status IN ('confirmed', 'pending')) as booking_count FROM rides r LEFT JOIN cars c ON r.car_id = c.id WHERE r.driver_id = ? ORDER BY r.departure_time DESC").all(req.user.id);
    res.json({ rides });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/:id', authOptional, (req, res) => {
  try {
    const ride = prepare("SELECT r.*, (r.total_seats - r.available_seats) as booking_count, u.name as driver_name, u.email as driver_email, u.phone as driver_phone, u.profile_photo as driver_photo, u.avg_rating as driver_rating, u.total_ratings as driver_total_ratings, (SELECT COUNT(*) FROM rides WHERE driver_id = u.id AND status='completed') as driver_completed_rides, c.model as car_model, c.color as car_color, c.license_plate as car_plate, c.car_image FROM rides r JOIN users u ON r.driver_id = u.id LEFT JOIN cars c ON r.car_id = c.id WHERE r.id = ?").get(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    const bookings = prepare("SELECT b.*, u.name as passenger_name, u.profile_photo as passenger_photo FROM bookings b JOIN users u ON b.passenger_id = u.id WHERE b.ride_id = ? AND b.status != 'cancelled'").all(req.params.id);
    res.json({ ride, bookings });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.delete('/:id', authRequired, (req, res) => {
  try {
    const ride = prepare('SELECT * FROM rides WHERE id = ? AND driver_id = ?').get(req.params.id, req.user.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    prepare("UPDATE rides SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    prepare("UPDATE bookings SET status = 'cancelled' WHERE ride_id = ?").run(req.params.id);
    res.json({ message: 'Ride cancelled.' });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
