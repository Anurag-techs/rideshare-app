/**
 * models/Ride.js — Mongoose Ride model
 */
const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  driver_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  car_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Car', default: null },
  car_name:         { type: String, default: null },
  from_location:    { type: String, required: true },
  to_location:      { type: String, required: true },
  from_lat:         { type: Number, default: null },
  from_lng:         { type: Number, default: null },
  to_lat:           { type: Number, default: null },
  to_lng:           { type: Number, default: null },
  departure_time:   { type: Date, required: true },
  total_seats:      { type: Number, default: 4 },
  available_seats:  { type: Number, default: 4 },
  price_per_seat:   { type: Number, default: 0 },
  surge_multiplier: { type: Number, default: 1.0 },
  is_featured:      { type: Boolean, default: false },
  featured_until:   { type: Date, default: null },
  notes:            { type: String, default: null },
  status:           { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Text index for search
rideSchema.index({ from_location: 'text', to_location: 'text' });
rideSchema.index({ status: 1, departure_time: 1 });

module.exports = mongoose.model('Ride', rideSchema);
