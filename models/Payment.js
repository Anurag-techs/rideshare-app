/**
 * models/Payment.js — Mongoose Payment model (detailed records)
 */
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  booking_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  user_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null, index: true },
  razorpay_signature:  { type: String, default: null },
  amount:              { type: Number, required: true },
  commission_amount:   { type: Number, default: 0 },
  driver_earning:      { type: Number, default: 0 },
  currency:            { type: String, default: 'INR' },
  status:              { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  method:              { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Payment', paymentSchema);
