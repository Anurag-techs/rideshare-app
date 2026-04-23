/**
 * models/PlatformEarning.js — Mongoose Platform Earning model
 */
const mongoose = require('mongoose');

const platformEarningSchema = new mongoose.Schema({
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  ride_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
  driver_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:     { type: Number, required: true, min: 0 },
  type:       { type: String, enum: ['commission', 'withdrawal_fee', 'feature_fee'], default: 'commission' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('PlatformEarning', platformEarningSchema);
