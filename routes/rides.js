/**
 * routes/rides.js — Ride management routes (MongoDB)
 */
const express = require('express');
const Ride    = require('../models/Ride');
const Booking = require('../models/Booking');
const { authRequired, authOptional } = require('../middleware/auth');

const router = express.Router();

function cleanInput(text) {
  if (!text) return text;
  return String(text).replace(/[^\x00-\x7F]/g, '');
}

// ── POST /api/rides ───────────────────────────────────────────────────────────
router.post('/', authRequired, async (req, res) => {
  try {
    let { car_name, from_location, to_location, from_lat, from_lng, to_lat, to_lng,
          departure_time, total_seats, available_seats, price_per_seat, notes } = req.body;

    car_name      = cleanInput(car_name);
    from_location = cleanInput(from_location);
    to_location   = cleanInput(to_location);
    notes         = cleanInput(notes);

    if (!from_location || !to_location || !departure_time)
      return res.status(400).json({ error: 'From, to, and departure time are required.' });

    const seats = total_seats || 4;
    const ride  = await Ride.create({
      driver_id:       req.user.id,
      car_name:        car_name   || null,
      from_location,
      to_location,
      from_lat:        from_lat   || null,
      from_lng:        from_lng   || null,
      to_lat:          to_lat     || null,
      to_lng:          to_lng     || null,
      departure_time,
      total_seats:     seats,
      available_seats: available_seats || seats,
      price_per_seat:  price_per_seat  || 0,
      notes:           notes || null,
    });

    const populated = await Ride.findById(ride._id).populate('driver_id', 'name profile_photo avg_rating');
    const r = populated.toObject();
    r.driver_name   = r.driver_id?.name;
    r.driver_photo  = r.driver_id?.profile_photo;
    r.driver_rating = r.driver_id?.avg_rating;
    r.id            = r._id;

    res.status(201).json({ ride: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/rides/search ─────────────────────────────────────────────────────
router.get('/search', authOptional, async (req, res) => {
  try {
    const { from, to, date, max_price, sort } = req.query;
    const query = { status: 'active', available_seats: { $gt: 0 } };

    if (from) query.from_location = { $regex: from, $options: 'i' };
    if (to)   query.to_location   = { $regex: to,   $options: 'i' };
    if (date) {
      const start = new Date(date); start.setHours(0,0,0,0);
      const end   = new Date(date); end.setHours(23,59,59,999);
      query.departure_time = { $gte: start, $lte: end };
    }
    if (max_price) query.price_per_seat = { $lte: parseFloat(max_price) };

    let sortObj = { departure_time: 1 };
    if (sort === 'price_asc')  sortObj = { price_per_seat: 1 };
    if (sort === 'price_desc') sortObj = { price_per_seat: -1 };
    if (sort === 'time_desc')  sortObj = { departure_time: -1 };

    const rides = await Ride.find(query)
      .populate('driver_id', 'name profile_photo avg_rating total_ratings')
      .populate('car_id', 'model color')
      .sort(sortObj)
      .limit(50);

    const result = await Promise.all(rides.map(async r => {
      const obj = r.toObject();
      obj.id             = obj._id;
      obj.driver_name    = obj.driver_id?.name;
      obj.driver_photo   = obj.driver_id?.profile_photo;
      obj.driver_rating  = obj.driver_id?.avg_rating;
      obj.driver_total_ratings = obj.driver_id?.total_ratings;
      obj.car_model      = obj.car_id?.model;
      obj.car_color      = obj.car_id?.color;
      obj.booking_count  = obj.total_seats - obj.available_seats;
      const driverCompletedRides = await Ride.countDocuments({ driver_id: r.driver_id, status: 'completed' });
      obj.driver_completed_rides = driverCompletedRides;
      return obj;
    }));

    res.json({ rides: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/rides/my/driver ──────────────────────────────────────────────────
router.get('/my/driver', authRequired, async (req, res) => {
  try {
    const rides = await Ride.find({ driver_id: req.user.id })
      .populate('car_id', 'model color')
      .sort({ departure_time: -1 });

    const result = await Promise.all(rides.map(async r => {
      const obj = r.toObject();
      obj.id          = obj._id;
      obj.car_model   = obj.car_id?.model;
      obj.car_color   = obj.car_id?.color;
      obj.booking_count = await Booking.countDocuments({ ride_id: r._id, status: { $in: ['confirmed', 'pending'] } });
      return obj;
    }));

    res.json({ rides: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/rides/:id ────────────────────────────────────────────────────────
router.get('/:id', authOptional, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate('driver_id', 'name email phone profile_photo avg_rating total_ratings')
      .populate('car_id', 'model color license_plate car_image');

    if (!ride) return res.status(404).json({ error: 'Ride not found.' });

    const obj = ride.toObject();
    obj.id                   = obj._id;
    obj.driver_name          = obj.driver_id?.name;
    obj.driver_email         = obj.driver_id?.email;
    obj.driver_phone         = obj.driver_id?.phone;
    obj.driver_photo         = obj.driver_id?.profile_photo;
    obj.driver_rating        = obj.driver_id?.avg_rating;
    obj.driver_total_ratings = obj.driver_id?.total_ratings;
    obj.car_model            = obj.car_id?.model;
    obj.car_color            = obj.car_id?.color;
    obj.car_plate            = obj.car_id?.license_plate;
    obj.car_image            = obj.car_id?.car_image;
    obj.booking_count        = obj.total_seats - obj.available_seats;
    obj.driver_completed_rides = await Ride.countDocuments({ driver_id: ride.driver_id, status: 'completed' });

    const bookings = await Booking.find({ ride_id: ride._id, status: { $ne: 'cancelled' } })
      .populate('passenger_id', 'name profile_photo');

    const formattedBookings = bookings.map(b => {
      const bo = b.toObject();
      bo.id              = bo._id;
      bo.passenger_name  = bo.passenger_id?.name;
      bo.passenger_photo = bo.passenger_id?.profile_photo;
      return bo;
    });

    res.json({ ride: obj, bookings: formattedBookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/rides/:id ─────────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const ride = await Ride.findOne({ _id: req.params.id, driver_id: req.user.id });
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });

    await Ride.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    await Booking.updateMany({ ride_id: req.params.id }, { status: 'cancelled' });

    res.json({ message: 'Ride cancelled.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
