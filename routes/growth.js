/**
 * routes/growth.js — Coupons, Notifications (MongoDB)
 */
const express      = require('express');
const Coupon       = require('../models/Coupon');
const CouponUse    = require('../models/CouponUse');
const Notification = require('../models/Notification');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');

const router = express.Router();

function ok(res, data, s = 200)  { return res.status(s).json({ success: true,  ...data }); }
function fail(res, msg, s = 400) { return res.status(s).json({ success: false, error: msg }); }

// ── POST /api/growth/coupon/validate ─────────────────────────────────────────
router.post('/coupon/validate', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const code   = (req.body.code || '').trim().toUpperCase();
    const amount = parseFloat(req.body.amount);

    if (!code)                             return fail(res, 'Coupon code is required.');
    if (!amount || isNaN(amount) || amount <= 0) return fail(res, 'Valid booking amount is required.');

    const coupon = await Coupon.findOne({ code, is_active: true });
    if (!coupon) return fail(res, 'Coupon not found or inactive.', 404);

    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date())
      return fail(res, 'This coupon has expired.');
    if (coupon.used_count >= coupon.max_uses)
      return fail(res, 'This coupon has reached its usage limit.');
    if (amount < coupon.min_amount)
      return fail(res, `Minimum booking amount for this coupon is ₹${coupon.min_amount}.`);

    const already = await CouponUse.findOne({ coupon_id: coupon._id, user_id: userId });
    if (already) return fail(res, 'You have already used this coupon.');

    let discount = coupon.discount_type === 'percent'
      ? parseFloat((amount * coupon.discount_amount / 100).toFixed(2))
      : parseFloat(Math.min(coupon.discount_amount, amount).toFixed(2));

    const finalAmount = parseFloat(Math.max(0, amount - discount).toFixed(2));
    return ok(res, { valid: true, code, discount, final_amount: finalAmount, coupon_id: coupon._id });
  } catch (err) {
    console.error('[GROWTH /coupon/validate]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/growth/notifications ────────────────────────────────────────────
router.get('/notifications', authRequired, async (req, res) => {
  try {
    const notifs = await Notification.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(30);
    const unread = notifs.filter(n => !n.is_read).length;
    const result = notifs.map(n => ({ ...n.toObject(), id: n._id }));
    return ok(res, { notifications: result, unread });
  } catch (err) {
    console.error('[GROWTH /notifications]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/growth/notifications/read ──────────────────────────────────────
router.post('/notifications/read', authRequired, async (req, res) => {
  try {
    await Notification.updateMany({ user_id: req.user.id }, { is_read: true });
    return ok(res, { message: 'All notifications marked as read.' });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/growth/notifications/:id/read ───────────────────────────────────
router.post('/notifications/:id/read', authRequired, async (req, res) => {
  try {
    await Notification.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, { is_read: true });
    return ok(res, { message: 'Notification marked as read.' });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: POST /api/growth/coupons ──────────────────────────────────────────
router.post('/coupons', authRequired, adminOnly, async (req, res) => {
  try {
    const code     = (req.body.code || '').trim().toUpperCase().slice(0, 20);
    const discount = parseFloat(req.body.discount_amount);
    const type     = req.body.discount_type === 'percent' ? 'percent' : 'flat';
    const maxUses  = parseInt(req.body.max_uses, 10)  || 100;
    const minAmt   = parseFloat(req.body.min_amount)  || 0;
    const expiry   = req.body.expiry_date || null;

    if (!code)                    return fail(res, 'Coupon code is required.');
    if (!discount || discount <= 0) return fail(res, 'discount_amount must be > 0.');
    if (type === 'percent' && discount > 100) return fail(res, 'Percent discount cannot exceed 100.');

    const existing = await Coupon.findOne({ code });
    if (existing) return fail(res, `Coupon code "${code}" already exists.`, 409);

    const coupon = await Coupon.create({ code, discount_amount: discount, discount_type: type, max_uses: maxUses, min_amount: minAmt, expiry_date: expiry });
    return ok(res, { coupon_id: coupon._id, message: `Coupon ${code} created.` }, 201);
  } catch (err) {
    console.error('[GROWTH /coupons POST]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: GET /api/growth/coupons ───────────────────────────────────────────
router.get('/coupons', authRequired, adminOnly, async (req, res) => {
  try {
    const coupons = await Coupon.find({}).sort({ created_at: -1 });
    return ok(res, { coupons });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── ADMIN: PATCH /api/growth/coupons/:id ──────────────────────────────────────
router.patch('/coupons/:id', authRequired, adminOnly, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return fail(res, 'Coupon not found.', 404);
    const newState = !coupon.is_active;
    await Coupon.findByIdAndUpdate(req.params.id, { is_active: newState });
    return ok(res, { message: `Coupon ${coupon.code} ${newState ? 'enabled' : 'disabled'}.` });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

module.exports = router;
