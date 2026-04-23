/**
 * models/Notification.js — Mongoose Notification model
 */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  type:     { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
  is_read:  { type: Boolean, default: false },
  ref_type: { type: String, default: null },
  ref_id:   { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

notificationSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
