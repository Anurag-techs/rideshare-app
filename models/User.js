/**
 * models/User.js — Mongoose User model
 */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:                  { type: String, required: true, trim: true },
  email:                 { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:                 { type: String, default: null },
  password_hash:         { type: String, required: true },
  profile_photo:         { type: String, default: null },
  avg_rating:            { type: Number, default: 0 },
  total_ratings:         { type: Number, default: 0 },
  wallet_balance:        { type: Number, default: 0 },
  total_withdrawn:       { type: Number, default: 0 },
  is_admin:              { type: Boolean, default: false },
  upi_id:                { type: String, default: null },
  account_number:        { type: String, default: null },
  ifsc:                  { type: String, default: null },
  loyalty_points:        { type: Number, default: 0 },
  cancellation_count:    { type: Number, default: 0 },
  favorites:             [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('User', userSchema);
