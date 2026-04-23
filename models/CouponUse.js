/**
 * models/CouponUse.js — Mongoose CouponUse model
 */
const mongoose = require('mongoose');

const couponUseSchema = new mongoose.Schema({
  coupon_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  discount:   { type: Number, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// One use per coupon per user
couponUseSchema.index({ coupon_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('CouponUse', couponUseSchema);
