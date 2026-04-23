/**
 * routes/ratings.js — Rating routes (MongoDB)
 */
const express = require('express');
const Rating  = require('../models/Rating');
const User    = require('../models/User');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/ratings ─────────────────────────────────────────────────────────
router.post('/', authRequired, async (req, res) => {
  try {
    const { ride_id, to_user_id, rating, comment } = req.body;
    if (!ride_id || !to_user_id || !rating)
      return res.status(400).json({ error: 'ride_id, to_user_id, and rating are required.' });
    if (rating < 1 || rating > 5)
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    if (String(to_user_id) === String(req.user.id))
      return res.status(400).json({ error: "You can't rate yourself." });

    const existing = await Rating.findOne({ ride_id, from_user_id: req.user.id });
    if (existing) return res.status(409).json({ error: 'You have already rated this ride.' });

    await Rating.create({
      ride_id,
      from_user_id: req.user.id,
      to_user_id,
      rating,
      comment: comment || null,
    });

    // Recalculate average rating for target user
    const stats = await Rating.aggregate([
      { $match: { to_user_id: to_user_id } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const avg   = stats.length ? Math.round((stats[0].avg || 0) * 10) / 10 : 0;
    const total = stats.length ? stats[0].count : 0;

    await User.findByIdAndUpdate(to_user_id, { avg_rating: avg, total_ratings: total });

    res.status(201).json({ message: 'Rating submitted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/ratings/user/:id ─────────────────────────────────────────────────
router.get('/user/:id', async (req, res) => {
  try {
    const ratings = await Rating.find({ to_user_id: req.params.id })
      .populate('from_user_id', 'name profile_photo')
      .sort({ created_at: -1 })
      .limit(20);

    const result = ratings.map(r => {
      const obj      = r.toObject();
      obj.id         = obj._id;
      obj.from_name  = obj.from_user_id?.name;
      obj.from_photo = obj.from_user_id?.profile_photo;
      return obj;
    });

    const user = await User.findById(req.params.id).select('avg_rating total_ratings');
    res.json({ ratings: result, avg_rating: user?.avg_rating || 0, total_ratings: user?.total_ratings || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
