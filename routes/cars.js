/**
 * routes/cars.js — Car management routes (MongoDB)
 */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const Car      = require('../models/Car');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `car_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── GET /api/cars ─────────────────────────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const cars = await Car.find({ user_id: req.user.id }).sort({ created_at: -1 });
    res.json({ cars });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/cars ────────────────────────────────────────────────────────────
router.post('/', authRequired, async (req, res) => {
  try {
    const { model, total_seats, license_plate, color } = req.body;
    if (!model) return res.status(400).json({ error: 'Car model is required.' });

    const car = await Car.create({
      user_id:       req.user.id,
      model,
      total_seats:   total_seats || 4,
      license_plate: license_plate || null,
      color:         color || null,
    });
    res.status(201).json({ car });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/cars/:id ──────────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const car = await Car.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!car) return res.status(404).json({ error: 'Car not found.' });
    await Car.findByIdAndDelete(req.params.id);
    res.json({ message: 'Car removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/cars/:id/upload-image ──────────────────────────────────────────
router.post('/:id/upload-image', authRequired, upload.single('image'), async (req, res) => {
  try {
    const car = await Car.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!car) return res.status(404).json({ error: 'Car not found.' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const imagePath = `/uploads/${req.file.filename}`;
    await Car.findByIdAndUpdate(req.params.id, { car_image: imagePath });
    res.json({ car_image: imagePath });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
