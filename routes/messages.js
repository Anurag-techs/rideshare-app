const express = require('express');
const { body } = require('express-validator');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const Ride = require('../models/Ride');
const { authRequired } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

// ── GET /api/messages/:rideId ──────────────────────────────────────────────
router.get('/:rideId', authRequired, async (req, res, next) => {
  try {
    const rideId = req.params.rideId;
    const userId = req.user.id;
    
    const ride = await Ride.findById(rideId);
    if (!ride) return next(new Error('Ride not found.'));

    // Check if user is driver or a confirmed passenger
    let isAuthorized = false;
    if (String(ride.driver_id) === String(userId)) {
      isAuthorized = true;
    } else {
      const booking = await Booking.findOne({ ride_id: rideId, passenger_id: userId, status: 'confirmed' });
      if (booking) isAuthorized = true;
    }

    if (!isAuthorized) {
      const err = new Error('Unauthorized to view group chat for this ride.');
      err.statusCode = 403;
      return next(err);
    }

    const messages = await Message.find({ ride_id: rideId }).populate('sender_id', 'name').sort({ created_at: 1 });
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/messages/:rideId ─────────────────────────────────────────────
router.post('/:rideId', authRequired, validate([
  body('message').trim().notEmpty().withMessage('Message cannot be empty').escape()
]), async (req, res, next) => {
  try {
    const rideId = req.params.rideId;
    const { message } = req.body;
    const userId = req.user.id;
    
    const ride = await Ride.findById(rideId);
    if (!ride) return next(new Error('Ride not found.'));

    let isAuthorized = false;
    if (String(ride.driver_id) === String(userId)) {
      isAuthorized = true;
    } else {
      const booking = await Booking.findOne({ ride_id: rideId, passenger_id: userId, status: 'confirmed' });
      if (booking) isAuthorized = true;
    }

    if (!isAuthorized) {
      const err = new Error('Unauthorized to send messages to this group chat.');
      err.statusCode = 403;
      return next(err);
    }

    const msg = await Message.create({
      ride_id: rideId,
      sender_id: userId,
      message
    });

    res.status(201).json({ message: msg });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
