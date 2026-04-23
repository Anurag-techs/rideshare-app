/**
 * models/Booking.js — Mongoose Booking model
 */
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  ride_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
  passenger_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seats_booked:        { type: Number, default: 1 },
  total_amount:        { type: Number, default: 0 },
  commission_amount:   { type: Number, default: 0 },
  driver_earning:      { type: Number, default: 0 },
  payment_status:      { type: String, enum: ['pending', 'paid', 'failed', 'refunded', 'free'], default: 'pending' },
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  razorpay_signature:  { type: String, default: null },
  status:              { type: String, enum: ['pending', 'confirmed', 'cancelled', 'completed'], default: 'confirmed' },
  coupon_code:         { type: String, default: null },
  coupon_discount:     { type: Number, default: 0 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

bookingSchema.index({ ride_id: 1, passenger_id: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
