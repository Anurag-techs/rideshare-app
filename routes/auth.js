/**
 * routes/auth.js — Authentication routes (MongoDB)
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const User     = require('../models/User');
const { authRequired, generateToken } = require('../middleware/auth');
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
router.post('/signup', async (req, res) => {
  try {
    let { name, email, phone, password } = req.body;
    name  = cleanInput(name);
    phone = cleanInput(phone);

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email: email.toLowerCase(), phone: phone || null, password_hash });

    await notify(user._id, '🎉 Welcome to RideShare!', `Hi ${name}! Your account is ready.`, 'success');

    const token = generateToken(user);
    const safeUser = { id: user._id, name: user.name, email: user.email, phone: user.phone, profile_photo: user.profile_photo, avg_rating: user.avg_rating, total_ratings: user.total_ratings, created_at: user.created_at };
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = generateToken(user);
    const safeUser = { id: user._id, name: user.name, email: user.email, phone: user.phone, profile_photo: user.profile_photo, avg_rating: user.avg_rating, total_ratings: user.total_ratings, wallet_balance: user.wallet_balance, is_admin: user.is_admin, created_at: user.created_at };
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash');
    if (!user)
      return res.status(401).json({ error: 'User not found. Please log in again.' });

    res.json({ user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    console.error('[AUTH /me] Server error:', err);
    res.status(500).json({ error: 'Server error fetching user.' });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────────
router.put('/profile', authRequired, async (req, res) => {
  try {
    let { name, phone, email } = req.body;
    name  = cleanInput(name);
    phone = cleanInput(phone);

    if (email) {
      const ex = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user.id } });
      if (ex) return res.status(409).json({ error: 'Email already in use.' });
    }

    const updates = {};
    if (name)  updates.name  = name;
    if (phone) updates.phone = phone;
    if (email) updates.email = email.toLowerCase();

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select('-password_hash');
    res.json({ user: { ...user.toObject(), id: user._id } });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/auth/upload-photo ───────────────────────────────────────────────
router.post('/upload-photo', authRequired, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded.' });
    const photoPath = `/uploads/${req.file.filename}`;
    await User.findByIdAndUpdate(req.user.id, { profile_photo: photoPath });
    res.json({ profile_photo: photoPath });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
