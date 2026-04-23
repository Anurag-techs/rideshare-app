/**
 * routes/admin.js — Admin Panel API (MongoDB)
 */
const express          = require('express');
const User             = require('../models/User');
const Withdrawal       = require('../models/Withdrawal');
const WalletTransaction= require('../models/WalletTransaction');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');
const { notify }       = require('../utils/notify');

const router = express.Router();
router.use(authRequired, adminOnly);

function ok(res, data, status = 200)   { return res.status(status).json({ success: true, ...data }); }
function fail(res, message, status = 400) { return res.status(status).json({ success: false, error: message }); }

function maskAccount(accNo) {
  if (!accNo || accNo.length < 4) return accNo;
  return '•'.repeat(accNo.length - 4) + accNo.slice(-4);
}
function maskIfsc(ifsc) {
  if (!ifsc || ifsc.length < 4) return ifsc;
  return ifsc.slice(0, 4) + '•'.repeat(ifsc.length - 4);
}

// ── GET /api/admin/withdrawals ────────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  try {
    const { status } = req.query;
    const allowed    = ['pending', 'paid', 'rejected'];
    const query      = {};
    if (status && allowed.includes(status)) query.status = status;

    const withdrawals = await Withdrawal.find(query)
      .populate('user_id', 'name email phone upi_id')
      .sort({ created_at: -1 });

    const result = withdrawals.map(w => {
      const obj      = w.toObject();
      obj.id         = obj._id;
      obj.user_name  = obj.user_id?.name;
      obj.user_email = obj.user_id?.email;
      obj.user_phone = obj.user_id?.phone;
      obj.user_upi   = obj.user_id?.upi_id;
      return obj;
    });

    return ok(res, { withdrawals: result, count: result.length });
  } catch (err) {
    console.error('[ADMIN /withdrawals]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/admin/withdrawals/:id/approve ───────────────────────────────────
router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const wdId          = req.params.id;
    const paymentMethod = (req.body.payment_method || '').trim().toUpperCase();
    const paymentRef    = (req.body.payment_ref    || '').trim().slice(0, 100);

    if (!['UPI', 'BANK', 'IMPS', 'NEFT', 'RTGS'].includes(paymentMethod))
      return fail(res, 'payment_method is required. Valid values: UPI, BANK, IMPS, NEFT, RTGS.');
    if (!paymentRef)
      return fail(res, 'payment_ref (UTR/transaction reference) is required for approval.');

    const wd = await Withdrawal.findById(wdId);
    if (!wd)                      return fail(res, `Withdrawal not found.`, 404);
    if (wd.status !== 'pending')  return fail(res, `Withdrawal is already ${wd.status}. Cannot approve again.`, 409);

    await Withdrawal.findByIdAndUpdate(wdId, {
      status: 'paid', processed_at: new Date(), payment_method: paymentMethod, payment_ref: paymentRef,
    });

    await User.findByIdAndUpdate(wd.user_id, { $inc: { total_withdrawn: wd.amount } });

    await WalletTransaction.create({ user_id: wd.user_id, type: 'debit', amount: parseFloat(wd.amount.toFixed(2)), reason: 'payout_approved', ref_id: wd._id });

    console.log(`[ADMIN] ✅ Withdrawal #${wdId} approved | ₹${wd.amount} | ref:${paymentRef} | by adminId:${req.user.id}`);
    await notify(wd.user_id, '✅ Withdrawal Approved', `Your withdrawal of ₹${wd.amount.toFixed(2)} has been approved (${paymentMethod} ref: ${paymentRef}).`, 'success', 'withdrawal', wd._id);

    const updated = await Withdrawal.findById(wdId);
    return ok(res, { withdrawal: updated, message: `Withdrawal approved and marked as paid.` });
  } catch (err) {
    console.error('[ADMIN /approve]', err.message);
    return fail(res, err.message || 'Server error.', 500);
  }
});

// ── POST /api/admin/withdrawals/:id/reject ────────────────────────────────────
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const wdId = req.params.id;
    const note = (req.body.note || '').trim().slice(0, 255) || null;

    const wd = await Withdrawal.findById(wdId);
    if (!wd)                     return fail(res, 'Withdrawal not found.', 404);
    if (wd.status !== 'pending') return fail(res, `Withdrawal is already ${wd.status}. Cannot reject again.`, 409);

    await Withdrawal.findByIdAndUpdate(wdId, { status: 'rejected', processed_at: new Date(), note });
    await User.findByIdAndUpdate(wd.user_id, { $inc: { wallet_balance: wd.amount } });
    await WalletTransaction.create({ user_id: wd.user_id, type: 'credit', amount: parseFloat(wd.amount.toFixed(2)), reason: 'withdrawal_refund', ref_id: wd._id });

    console.log(`[ADMIN] ❌ Withdrawal #${wdId} rejected | ₹${wd.amount} refunded to userId:${wd.user_id} | by adminId:${req.user.id}`);
    await notify(wd.user_id, '❌ Withdrawal Rejected', `Your withdrawal of ₹${wd.amount.toFixed(2)} was rejected and refunded to your wallet.`, 'warning', 'withdrawal', wd._id);

    const updated = await Withdrawal.findById(wdId);
    return ok(res, { withdrawal: updated, message: `Withdrawal rejected. ₹${wd.amount.toFixed(2)} refunded to wallet.` });
  } catch (err) {
    console.error('[ADMIN /reject]', err.message);
    return fail(res, err.message || 'Server error.', 500);
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const raw = await User.find({}).select('name email phone avg_rating total_ratings wallet_balance is_admin upi_id account_number ifsc created_at').sort({ created_at: -1 });

    const users = raw.map(u => ({
      ...u.toObject(),
      id:             u._id,
      account_number: maskAccount(u.account_number),
      ifsc:           maskIfsc(u.ifsc),
    }));

    return ok(res, { users, count: users.length });
  } catch (err) {
    console.error('[ADMIN /users]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/admin/transactions ───────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const query  = req.query.user_id ? { user_id: req.query.user_id } : {};

    const transactions = await WalletTransaction.find(query)
      .populate('user_id', 'name')
      .sort({ created_at: -1 })
      .limit(limit);

    const result = transactions.map(t => {
      const obj   = t.toObject();
      obj.id        = obj._id;
      obj.user_name = obj.user_id?.name;
      return obj;
    });

    return ok(res, { transactions: result, count: result.length });
  } catch (err) {
    console.error('[ADMIN /transactions]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/admin/users/:id/make-admin ─────────────────────────────────────
router.post('/users/:id/make-admin', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name email is_admin');
    if (!user)         return fail(res, 'User not found.', 404);
    if (user.is_admin) return fail(res, `${user.name} is already an admin.`, 409);

    await User.findByIdAndUpdate(req.params.id, { is_admin: true });
    console.log(`[ADMIN] User #${req.params.id} (${user.email}) granted admin by adminId:${req.user.id}`);
    return ok(res, { message: `${user.name} has been granted admin access.` });
  } catch (err) {
    console.error('[ADMIN /make-admin]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/admin/config ─────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  return ok(res, { config: { surge_enabled: process.env.SURGE_ENABLED === 'true' } });
});

// ── POST /api/admin/config ────────────────────────────────────────────────────
router.post('/config', (req, res) => {
  const { key, value } = req.body;
  if (key === 'surge_enabled') process.env.SURGE_ENABLED = value ? 'true' : 'false';
  return ok(res, { message: 'Config updated.', key, value });
});

module.exports = router;
