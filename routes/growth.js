/**
 * routes/growth.js — Coupons, Notifications
 *
 * Endpoints:
 *   POST /api/growth/coupon/validate    → Validate coupon for a booking amount
 *   GET  /api/growth/notifications      → User's notifications (last 30)
 *   POST /api/growth/notifications/read → Mark all as read
 *   POST /api/growth/notifications/:id/read → Mark one as read
 *
 * Admin:
 *   POST /api/growth/coupons            → Create coupon
 *   GET  /api/growth/coupons            → List all coupons
 *   PATCH /api/growth/coupons/:id       → Enable/disable coupon
 */
const express  = require('express');
const crypto   = require('crypto');
const { prepare, transaction } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');
const router   = express.Router();

function ok(res, data, s = 200)  { return res.status(s).json({ success: true,  ...data }); }
function fail(res, msg, s = 400) { return res.status(s).json({ success: false, error: msg }); }

// ── Helpers ───────────────────────────────────────────────────────────────────


// ── POST /api/growth/coupon/validate ─────────────────────────────────────────
// Body: { code, amount }  → returns { valid, discount, final_amount }
router.post('/coupon/validate', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    const code   = (req.body.code || '').trim().toUpperCase();
    const amount = parseFloat(req.body.amount);

    if (!code)             return fail(res, 'Coupon code is required.');
    if (!amount || isNaN(amount) || amount <= 0) return fail(res, 'Valid booking amount is required.');

    const coupon = prepare(
      `SELECT * FROM coupons WHERE code = ? AND is_active = 1`
    ).get(code);
    if (!coupon) return fail(res, 'Coupon not found or inactive.', 404);

    // Expiry check
    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
      return fail(res, 'This coupon has expired.');
    }
    // Max uses
    if (coupon.used_count >= coupon.max_uses) {
      return fail(res, 'This coupon has reached its usage limit.');
    }
    // Min amount
    if (amount < coupon.min_amount) {
      return fail(res, `Minimum booking amount for this coupon is ₹${coupon.min_amount}.`);
    }
    // One use per user
    const already = prepare(
      'SELECT id FROM coupon_uses WHERE coupon_id = ? AND user_id = ?'
    ).get(coupon.id, userId);
    if (already) return fail(res, 'You have already used this coupon.');

    let discount = coupon.discount_type === 'percent'
      ? parseFloat((amount * coupon.discount_amount / 100).toFixed(2))
      : parseFloat(Math.min(coupon.discount_amount, amount).toFixed(2));

    const finalAmount = parseFloat(Math.max(0, amount - discount).toFixed(2));
    return ok(res, { valid: true, code, discount, final_amount: finalAmount, coupon_id: coupon.id });
  } catch (err) {
    console.error('[GROWTH /coupon/validate]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/growth/notifications ────────────────────────────────────────────
router.get('/notifications', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    const notifs = prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
    ).all(userId);
    const unread = notifs.filter(n => !n.is_read).length;
    return ok(res, { notifications: notifs, unread });
  } catch (err) {
    console.error('[GROWTH /notifications]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/growth/notifications/read ──────────────────────────────────────
router.post('/notifications/read', authRequired, (req, res) => {
  try {
    prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    return ok(res, { message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[GROWTH /notifications/read]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/growth/notifications/:id/read ───────────────────────────────────
router.post('/notifications/:id/read', authRequired, (req, res) => {
  try {
    const nId = parseInt(req.params.id, 10);
    prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(nId, req.user.id);
    return ok(res, { message: 'Notification marked as read.' });
  } catch (err) {
    console.error('[GROWTH /notifications/:id/read]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: POST /api/growth/coupons ──────────────────────────────────────────
router.post('/coupons', authRequired, adminOnly, (req, res) => {
  try {
    const code     = (req.body.code || '').trim().toUpperCase().slice(0, 20);
    const discount = parseFloat(req.body.discount_amount);
    const type     = req.body.discount_type === 'percent' ? 'percent' : 'flat';
    const maxUses  = parseInt(req.body.max_uses, 10)  || 100;
    const minAmt   = parseFloat(req.body.min_amount)  || 0;
    const expiry   = req.body.expiry_date || null;

    if (!code)                   return fail(res, 'Coupon code is required.');
    if (!discount || discount <= 0) return fail(res, 'discount_amount must be > 0.');
    if (type === 'percent' && discount > 100) return fail(res, 'Percent discount cannot exceed 100.');

    const existing = prepare('SELECT id FROM coupons WHERE code = ?').get(code);
    if (existing) return fail(res, `Coupon code "${code}" already exists.`, 409);

    const result = prepare(
      `INSERT INTO coupons (code, discount_amount, discount_type, max_uses, min_amount, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(code, discount, type, maxUses, minAmt, expiry);

    return ok(res, { coupon_id: result.lastInsertRowid, message: `Coupon ${code} created.` }, 201);
  } catch (err) {
    console.error('[GROWTH /coupons POST]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: GET /api/growth/coupons ───────────────────────────────────────────
router.get('/coupons', authRequired, adminOnly, (req, res) => {
  try {
    const coupons = prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return ok(res, { coupons });
  } catch (err) {
    console.error('[GROWTH /coupons GET]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: PATCH /api/growth/coupons/:id ──────────────────────────────────────
router.patch('/coupons/:id', authRequired, adminOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const coupon = prepare('SELECT id, is_active, code FROM coupons WHERE id = ?').get(id);
    if (!coupon) return fail(res, 'Coupon not found.', 404);
    const newState = coupon.is_active ? 0 : 1;
    prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(newState, id);
    return ok(res, { message: `Coupon ${coupon.code} ${newState ? 'enabled' : 'disabled'}.` });
  } catch (err) {
    console.error('[GROWTH /coupons PATCH]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

module.exports = router;
