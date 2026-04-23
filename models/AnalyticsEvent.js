/**
 * models/AnalyticsEvent.js — Mongoose Analytics Event model
 */
const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
  event:   { type: String, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  meta:    { type: Object, default: {} },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

analyticsEventSchema.index({ event: 1, created_at: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
