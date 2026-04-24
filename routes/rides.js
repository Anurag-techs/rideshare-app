/**
 * routes/rides.js — Ride management routes (MongoDB)
 */
const express = require('express');
const { body, query } = require('express-validator');
const Ride    = require('../models/Ride');
const Booking = require('../models/Booking');
const { authRequired, authOptional } = require('../middleware/auth');
const validate = require('../middleware/validate');
const rateLimit = require('express-rate-limit');

const rideCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 ride creations per windowMs
  message: { success: false, message: 'Too many rides created from this IP, please try again after 15 minutes' }
});

const router = express.Router();

// ── POST /api/rides ───────────────────────────────────────────────────────────
router.post('/', authRequired, rideCreateLimiter, validate([
  body('from_location').trim().notEmpty().withMessage('From location is required').escape(),
  body('to_location').trim().notEmpty().withMessage('To location is required').escape(),
  body('departure_time').isISO8601().withMessage('Valid departure time is required').toDate(),
  body('car_name').optional({ nullable: true }).trim().escape(),
  body('notes').optional({ nullable: true }).trim().escape(),
  body('total_seats').notEmpty().withMessage('Total seats is required').isInt({ min: 1, max: 10 }).toInt(),
  body('price_per_seat').notEmpty().withMessage('Price per seat is required').isFloat({ min: 0 }).toFloat(),
  body('from_lat').optional({ nullable: true }).isFloat().toFloat(),
  body('from_lng').optional({ nullable: true }).isFloat().toFloat(),
  body('to_lat').optional({ nullable: true }).isFloat().toFloat(),
  body('to_lng').optional({ nullable: true }).isFloat().toFloat()
]), async (req, res, next) => {
  try {
    const { car_name, from_location, to_location, from_lat, from_lng, to_lat, to_lng,
          departure_time, total_seats, available_seats, price_per_seat, notes } = req.body;

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
    next(err);
  }
});

// ── GET /api/rides (all active future rides) ──────────────────────────────────
router.get('/', authOptional, async (req, res, next) => {
  try {
    const q = { status: 'active', available_seats: { $gt: 0 }, departure_time: { $gte: new Date() } };
    const rides = await Ride.find(q)
      .populate('driver_id', 'name profile_photo avg_rating total_ratings')
      .populate('car_id', 'model color')
      .sort({ departure_time: 1 })
      .limit(50)
      .lean();

    const result = await Promise.all(rides.map(async r => {
      const obj = { ...r };
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
    next(err);
  }
});

// ── GET /api/rides/search ─────────────────────────────────────────────────────
router.get('/search', authOptional, validate([
  query('from').optional().trim().escape(),
  query('to').optional().trim().escape(),
  query('date').optional().isISO8601().toDate(),
  query('max_price').optional().isFloat({ min: 0 }).toFloat(),
  query('sort').optional().isIn(['price_asc', 'price_desc', 'time_desc']).escape()
]), async (req, res, next) => {
  try {
    const { from, to, date, max_price, sort } = req.query;
    const q = { status: 'active', available_seats: { $gt: 0 } };

    if (from) q.from_location = { $regex: from, $options: 'i' };
    if (to)   q.to_location   = { $regex: to,   $options: 'i' };
    if (date) {
      const start = new Date(date); start.setHours(0,0,0,0);
      const end   = new Date(date); end.setHours(23,59,59,999);
      q.departure_time = { $gte: start, $lte: end };
    } else {
      q.departure_time = { $gte: new Date() };
    }
    if (max_price) q.price_per_seat = { $lte: max_price };

    let sortObj = { departure_time: 1 };
    if (sort === 'price_asc')  sortObj = { price_per_seat: 1 };
    if (sort === 'price_desc') sortObj = { price_per_seat: -1 };
    if (sort === 'time_desc')  sortObj = { departure_time: -1 };

    const rides = await Ride.find(q)
      .populate('driver_id', 'name profile_photo avg_rating total_ratings')
      .populate('car_id', 'model color')
      .sort(sortObj)
      .limit(50)
      .lean();

    const result = await Promise.all(rides.map(async r => {
      const obj = { ...r };
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
    next(err);
  }
});

// ── GET /api/rides/my/driver ──────────────────────────────────────────────────
router.get('/my/driver', authRequired, async (req, res, next) => {
  try {
    const rides = await Ride.find({ driver_id: req.user.id })
      .populate('car_id', 'model color')
      .sort({ departure_time: -1 })
      .lean();

    const result = await Promise.all(rides.map(async r => {
      const obj = { ...r };
      obj.id          = obj._id;
      obj.car_model   = obj.car_id?.model;
      obj.car_color   = obj.car_id?.color;
      obj.booking_count = await Booking.countDocuments({ ride_id: r._id, status: { $in: ['confirmed', 'pending'] } });
      return obj;
    }));

    res.json({ rides: result });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/rides/:id ────────────────────────────────────────────────────────
router.get('/:id', authOptional, async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate('driver_id', 'name profile_photo avg_rating total_ratings')
      .populate('car_id', 'model color license_plate car_image')
      .lean();

    if (!ride) {
      const err = new Error('Ride not found.');
      err.statusCode = 404;
      return next(err);
    }

    const obj = { ...ride };
    obj.id                   = obj._id;
    obj.driver_name          = obj.driver_id?.name;
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
      .populate('passenger_id', 'name profile_photo')
      .lean();

    const formattedBookings = bookings.map(b => {
      const bo = { ...b };
      bo.id              = bo._id;
      bo.passenger_name  = bo.passenger_id?.name;
      bo.passenger_photo = bo.passenger_id?.profile_photo;
      return bo;
    });

    res.json({ ride: obj, bookings: formattedBookings });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/rides/:id ─────────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const ride = await Ride.findOne({ _id: req.params.id, driver_id: req.user.id });
    if (!ride) {
      const err = new Error('Ride not found.');
      err.statusCode = 404;
      return next(err);
    }

    await Ride.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    await Booking.updateMany({ ride_id: req.params.id }, { status: 'cancelled' });

    res.json({ message: 'Ride cancelled.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
