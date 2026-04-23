/**
 * models/Car.js — Mongoose Car model
 */
const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  user_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  model:         { type: String, required: true, trim: true },
  total_seats:   { type: Number, default: 4 },
  car_image:     { type: String, default: null },
  license_plate: { type: String, default: null },
  color:         { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Car', carSchema);
