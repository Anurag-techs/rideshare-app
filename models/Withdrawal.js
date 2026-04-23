/**
 * models/Withdrawal.js — Mongoose Withdrawal model
 */
const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:         { type: Number, required: true, min: 0.01 },
  status:         { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending' },
  upi_id:         { type: String, default: null },
  note:           { type: String, default: null },
  payment_method: { type: String, default: null },
  payment_ref:    { type: String, default: null },
  processed_at:   { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

withdrawalSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
