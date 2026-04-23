/**
 * models/Rating.js — Mongoose Rating model
 */
const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  ride_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
  from_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to_user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating:       { type: Number, required: true, min: 1, max: 5 },
  comment:      { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Prevent duplicate rating per ride per user
ratingSchema.index({ ride_id: 1, from_user_id: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);
