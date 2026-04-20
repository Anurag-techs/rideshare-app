const express = require('express');
const { prepare, transaction, saveDb } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

router.post('/', authRequired, (req, res) => {
  try {
    const { ride_id, to_user_id, rating, comment } = req.body;
    if (!ride_id || !to_user_id || !rating) return res.status(400).json({ error: 'ride_id, to_user_id, and rating are required.' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    if (to_user_id === req.user.id) return res.status(400).json({ error: "You can't rate yourself." });
    const existing = prepare('SELECT * FROM ratings WHERE ride_id = ? AND from_user_id = ?').get(ride_id, req.user.id);
    if (existing) return res.status(409).json({ error: 'You have already rated this ride.' });

    const addRating = transaction(() => {
      prepare('INSERT INTO ratings (ride_id, from_user_id, to_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)').run(ride_id, req.user.id, to_user_id, rating, comment || null);
      const stats = prepare('SELECT AVG(rating) as avg_val, COUNT(*) as total FROM ratings WHERE to_user_id = ?').get(to_user_id);
      const avg = Math.round((stats.avg_val || 0) * 10) / 10;
      prepare('UPDATE users SET avg_rating = ?, total_ratings = ? WHERE id = ?').run(avg, stats.total, to_user_id);
    });
    addRating();
    res.status(201).json({ message: 'Rating submitted.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

router.get('/user/:id', (req, res) => {
  try {
    const ratings = prepare('SELECT r.*, u.name as from_name, u.profile_photo as from_photo FROM ratings r JOIN users u ON r.from_user_id = u.id WHERE r.to_user_id = ? ORDER BY r.created_at DESC LIMIT 20').all(req.params.id);
    const user = prepare('SELECT avg_rating, total_ratings FROM users WHERE id = ?').get(req.params.id);
    res.json({ ratings, avg_rating: user?.avg_rating || 0, total_ratings: user?.total_ratings || 0 });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
