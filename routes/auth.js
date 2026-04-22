const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { prepare } = require('../db/init');
const { authRequired, generateToken } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `profile_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase()); cb(null, ok); } });

router.post('/signup', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const existing = prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });
    const password_hash = await bcrypt.hash(password, 10);
    const result = prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(name, email, phone || null, password_hash);
    const user = prepare('SELECT id, name, email, phone, profile_photo, avg_rating, total_ratings, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = generateToken(user);
    res.status(201).json({ token, user });
  } catch (err) { console.error('Signup error:', err); res.status(500).json({ error: 'Server error during signup.' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = generateToken(user);
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Server error during login.' }); }
});

router.get('/me', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    console.log('[AUTH /me] req.user:', req.user, '| querying id:', userId);

    if (!userId || isNaN(userId)) {
      console.error('[AUTH /me] Invalid user id in token:', req.user.id);
      return res.status(400).json({ error: 'Invalid token payload — missing user id.' });
    }

    const user = prepare(
      'SELECT id, name, email, phone, profile_photo, avg_rating, total_ratings, created_at FROM users WHERE id = ?'
    ).get(userId);

    if (!user) {
      console.error('[AUTH /me] No user found in DB for id:', userId);
      return res.status(404).json({ error: `User not found (id=${userId}). Please log in again.` });
    }

    console.log('[AUTH /me] Returning user:', user.id, user.email);
    res.json({ user });
  } catch (err) {
    console.error('[AUTH /me] Server error:', err);
    res.status(500).json({ error: 'Server error fetching user.' });
  }
});


router.put('/profile', authRequired, (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (email) { const ex = prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id); if (ex) return res.status(409).json({ error: 'Email already in use.' }); }
    if (name) prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    if (phone) prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);
    if (email) prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
    const user = prepare('SELECT id, name, email, phone, profile_photo, avg_rating, total_ratings, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.post('/upload-photo', authRequired, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded.' });
    const photoPath = `/uploads/${req.file.filename}`;
    prepare('UPDATE users SET profile_photo = ? WHERE id = ?').run(photoPath, req.user.id);
    res.json({ profile_photo: photoPath });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
