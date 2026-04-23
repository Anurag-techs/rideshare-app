/**
 * routes/bookings.js — Booking management (MongoDB)
 */
const express  = require('express');
const Booking  = require('../models/Booking');
const Ride     = require('../models/Ride');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/bookings/my ──────────────────────────────────────────────────────
router.get('/my', authRequired, async (req, res) => {
  try {
    const bookings = await Booking.find({ passenger_id: req.user.id })
      .populate({
        path: 'ride_id',
        populate: [
          { path: 'driver_id', select: 'name profile_photo avg_rating' },
          { path: 'car_id',    select: 'model color' },
        ],
      })
      .sort({ created_at: -1 });

    const result = bookings.map(b => {
      const obj  = b.toObject();
      const ride = obj.ride_id || {};
      obj.id             = obj._id;
      obj.from_location  = ride.from_location;
      obj.to_location    = ride.to_location;
      obj.departure_time = ride.departure_time;
      obj.price_per_seat = ride.price_per_seat;
      obj.ride_status    = ride.status;
      obj.driver_id      = ride.driver_id?._id;
      obj.driver_name    = ride.driver_id?.name;
      obj.driver_photo   = ride.driver_id?.profile_photo;
      obj.driver_rating  = ride.driver_id?.avg_rating;
      obj.car_model      = ride.car_id?.model;
      obj.car_color      = ride.car_id?.color;
      return obj;
    });

    res.json({ bookings: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/bookings/:id/cancel ──────────────────────────────────────────────
router.put('/:id/cancel', authRequired, async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id:          req.params.id,
      passenger_id: req.user.id,
      status:       { $ne: 'cancelled' },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    await Ride.findByIdAndUpdate(booking.ride_id, {
      $inc: { available_seats: booking.seats_booked },
    });

    res.json({ message: 'Booking cancelled.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/bookings/driver ──────────────────────────────────────────────────
router.get('/driver', authRequired, async (req, res) => {
  try {
    // Find all rides by this driver
    const rideIds = await Ride.find({ driver_id: req.user.id }).distinct('_id');

    const bookings = await Booking.find({
      ride_id: { $in: rideIds },
      status:  { $ne: 'cancelled' },
    })
      .populate('ride_id', 'from_location to_location departure_time')
      .populate('passenger_id', 'name profile_photo phone')
      .sort({ created_at: -1 });

    const result = bookings.map(b => {
      const obj = b.toObject();
      obj.id               = obj._id;
      obj.from_location    = obj.ride_id?.from_location;
      obj.to_location      = obj.ride_id?.to_location;
      obj.departure_time   = obj.ride_id?.departure_time;
      obj.passenger_name   = obj.passenger_id?.name;
      obj.passenger_photo  = obj.passenger_id?.profile_photo;
      obj.passenger_phone  = obj.passenger_id?.phone;
      return obj;
    });

    res.json({ bookings: result });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
