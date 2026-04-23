/**
 * routes/auth.js — Authentication routes (MongoDB)
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const { body } = require('express-validator');
const User     = require('../models/User');
const { authRequired, generateToken } = require('../middleware/auth');
const validate   = require('../middleware/validate');
const { notify } = require('../utils/notify');

const router = express.Router();

function cleanInput(text) {
  if (!text) return text;
  return String(text).replace(/[^\x00-\x7F]/g, '');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `profile_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post('/signup', validate([
  body('name').trim().notEmpty().withMessage('Name is required').escape(),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().trim().escape()
]), async (req, res, next) => {
  try {
    let { name, email, phone, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      const err = new Error('An account with this email already exists.');
      err.statusCode = 409;
      return next(err);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, phone: phone || null, password_hash });

    await notify(user._id, '🎉 Welcome to RideShare!', `Hi ${name}! Your account is ready.`, 'success');

    const token = generateToken(user);
    const safeUser = { id: user._id, name: user.name, email: user.email, phone: user.phone, profile_photo: user.profile_photo, avg_rating: user.avg_rating, total_ratings: user.total_ratings, created_at: user.created_at };
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', validate([
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
]), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      return next(err);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      return next(err);
    }

    const token = generateToken(user);
    const safeUser = { id: user._id, name: user.name, email: user.email, phone: user.phone, profile_photo: user.profile_photo, avg_rating: user.avg_rating, total_ratings: user.total_ratings, wallet_balance: user.wallet_balance, is_admin: user.is_admin, created_at: user.created_at };
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash');
    if (!user) {
      const err = new Error('User not found. Please log in again.');
      err.statusCode = 401;
      return next(err);
    }

    res.json({ user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────────
router.put('/profile', authRequired, validate([
  body('name').optional().trim().notEmpty().escape(),
  body('phone').optional().trim().escape(),
  body('email').optional().trim().isEmail().normalizeEmail()
]), async (req, res, next) => {
  try {
    const { name, phone, email } = req.body;

    if (email) {
      const ex = await User.findOne({ email, _id: { $ne: req.user.id } });
      if (ex) {
        const err = new Error('Email already in use.');
        err.statusCode = 409;
        return next(err);
      }
    }

    const updates = {};
    if (name)  updates.name  = name;
    if (phone) updates.phone = phone;
    if (email) updates.email = email;

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true }).select('-password_hash');
    res.json({ user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/upload-photo ───────────────────────────────────────────────
router.post('/upload-photo', authRequired, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error('No photo uploaded.');
      err.statusCode = 400;
      return next(err);
    }
    const photoPath = `/uploads/${req.file.filename}`;
    await User.findByIdAndUpdate(req.user.id, { profile_photo: photoPath });
    res.json({ profile_photo: photoPath });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
