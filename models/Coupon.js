/**
 * models/Coupon.js — Mongoose Coupon model
 */
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code:            { type: String, required: true, unique: true, uppercase: true, trim: true },
  discount_amount: { type: Number, required: true, min: 0.01 },
  discount_type:   { type: String, enum: ['flat', 'percent'], default: 'flat' },
  max_uses:        { type: Number, default: 100 },
  used_count:      { type: Number, default: 0 },
  min_amount:      { type: Number, default: 0 },
  expiry_date:     { type: Date, default: null },
  is_active:       { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Coupon', couponSchema);
