/**
 * models/WalletTransaction.js — Mongoose Wallet Transaction model
 */
const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['credit', 'debit'], required: true },
  amount:  { type: Number, required: true, min: 0.01 },
  reason:  { type: String, required: true },
  ref_id:  { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

walletTransactionSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
