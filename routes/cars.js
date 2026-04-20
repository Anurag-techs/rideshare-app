const express = require('express');
const multer = require('multer');
const path = require('path');
const { prepare } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `car_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5*1024*1024 } });

router.get('/', authRequired, (req, res) => {
  try { res.json({ cars: prepare('SELECT * FROM cars WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id) }); }
  catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.post('/', authRequired, (req, res) => {
  try {
    const { model, total_seats, license_plate, color } = req.body;
    if (!model) return res.status(400).json({ error: 'Car model is required.' });
    const result = prepare('INSERT INTO cars (user_id, model, total_seats, license_plate, color) VALUES (?, ?, ?, ?, ?)').run(req.user.id, model, total_seats || 4, license_plate || null, color || null);
    const car = prepare('SELECT * FROM cars WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ car });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.delete('/:id', authRequired, (req, res) => {
  try {
    const car = prepare('SELECT * FROM cars WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!car) return res.status(404).json({ error: 'Car not found.' });
    prepare('DELETE FROM cars WHERE id = ?').run(req.params.id);
    res.json({ message: 'Car removed.' });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

router.post('/:id/upload-image', authRequired, upload.single('image'), (req, res) => {
  try {
    const car = prepare('SELECT * FROM cars WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!car) return res.status(404).json({ error: 'Car not found.' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const imagePath = `/uploads/${req.file.filename}`;
    prepare('UPDATE cars SET car_image = ? WHERE id = ?').run(imagePath, req.params.id);
    res.json({ car_image: imagePath });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
