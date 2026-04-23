/**
 * routes/wallet.js — Driver Wallet System (MongoDB)
 */
const express          = require('express');
const User             = require('../models/User');
const Withdrawal       = require('../models/Withdrawal');
const WalletTransaction= require('../models/WalletTransaction');
const PlatformEarning  = require('../models/PlatformEarning');
const { authRequired } = require('../middleware/auth');
const { notify }       = require('../utils/notify');

const router = express.Router();

const MIN_WITHDRAWAL = 50;
const COOLDOWN_HOURS = 24;
const WITHDRAWAL_FEE = parseFloat(process.env.WITHDRAWAL_FEE) || 10;

function ok(res, data, status = 200)  { return res.status(status).json({ success: true, ...data }); }
function fail(res, message, status = 400) { return res.status(status).json({ success: false, error: message }); }

function maskAccount(accNo) {
  if (!accNo || accNo.length < 4) return accNo;
  return '•'.repeat(accNo.length - 4) + accNo.slice(-4);
}
function maskIfsc(ifsc) {
  if (!ifsc || ifsc.length < 4) return ifsc;
  return ifsc.slice(0, 4) + '•'.repeat(ifsc.length - 4);
}

// ── GET /api/wallet/balance ───────────────────────────────────────────────────
router.get('/balance', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('wallet_balance');
    if (!user) return fail(res, 'User not found.', 404);
    return ok(res, { balance: parseFloat((user.wallet_balance || 0).toFixed(2)) });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/wallet/transactions ──────────────────────────────────────────────
router.get('/transactions', authRequired, async (req, res) => {
  try {
    const txns = await WalletTransaction.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(100);
    return ok(res, { transactions: txns });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/wallet/withdrawals ───────────────────────────────────────────────
router.get('/withdrawals', authRequired, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user_id: req.user.id }).sort({ created_at: -1 });
    return ok(res, { withdrawals });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/wallet/withdraw ─────────────────────────────────────────────────
router.post('/withdraw', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const rawAmount = req.body.amount;
    if (rawAmount === undefined || rawAmount === null || rawAmount === '') return fail(res, 'Amount is required.');
    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || !isFinite(amount)) return fail(res, 'Amount must be a valid number.');
    if (amount <= 0)              return fail(res, 'Amount must be greater than zero.');
    if (amount < MIN_WITHDRAWAL)  return fail(res, `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL}.`);

    const upiId = (req.body.upi_id || '').trim().slice(0, 100) || null;
    const note  = (req.body.note   || '').trim().slice(0, 255) || null;

    const pending = await Withdrawal.findOne({ user_id: userId, status: 'pending' });
    if (pending) return fail(res, 'You already have a pending withdrawal.', 409);

    const lastWd = await Withdrawal.findOne({ user_id: userId }).sort({ created_at: -1 });
    if (lastWd) {
      const hoursSinceLast = (Date.now() - new Date(lastWd.created_at).getTime()) / 3600000;
      if (hoursSinceLast < COOLDOWN_HOURS) {
        const hoursLeft = Math.ceil(COOLDOWN_HOURS - hoursSinceLast);
        return fail(res, `Please wait ${hoursLeft} more hour${hoursLeft !== 1 ? 's' : ''} before requesting another withdrawal.`, 429);
      }
    }

    const user    = await User.findById(userId).select('wallet_balance');
    if (!user) return fail(res, 'User not found.', 404);

    const balance   = parseFloat((user.wallet_balance || 0).toFixed(2));
    const rounded   = parseFloat(amount.toFixed(2));
    const fee       = parseFloat(Math.min(WITHDRAWAL_FEE, rounded * 0.5).toFixed(2));
    const netPayout = parseFloat((rounded - fee).toFixed(2));

    if (balance < rounded) return fail(res, `Insufficient balance. Available: ₹${balance.toFixed(2)}`);

    await User.findByIdAndUpdate(userId, { $inc: { wallet_balance: -rounded } });

    const withdrawal = await Withdrawal.create({ user_id: userId, amount: rounded, status: 'pending', upi_id: upiId, note });

    await WalletTransaction.create({ user_id: userId, type: 'debit', amount: rounded, reason: 'withdrawal_request', ref_id: withdrawal._id });

    if (fee > 0) {
      await PlatformEarning.create({ booking_id: withdrawal._id, ride_id: withdrawal._id, driver_id: userId, amount: fee, type: 'withdrawal_fee' });
    }

    await notify(userId, 'Withdrawal Requested', `₹${amount.toFixed(2)} withdrawal submitted (fee: ₹${fee}). Net payout: ₹${netPayout}. Processing 2–3 business days.`, 'info', 'withdrawal', withdrawal._id);

    const updatedUser = await User.findById(userId).select('wallet_balance');

    return ok(res, {
      withdrawal,
      fee,
      net_payout:  netPayout,
      new_balance: parseFloat((updatedUser?.wallet_balance || 0).toFixed(2)),
      message:     `₹${amount.toFixed(2)} withdrawal submitted (platform fee: ₹${fee}). Net payout: ₹${netPayout}.`,
    }, 201);
  } catch (err) {
    console.error('[WALLET /withdraw]', err.message);
    return fail(res, err.message || 'Failed to process withdrawal.', err.statusCode || 500);
  }
});

// ── GET /api/wallet/payment-details ──────────────────────────────────────────
router.get('/payment-details', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('upi_id account_number ifsc');
    if (!user) return fail(res, 'User not found.', 404);
    return ok(res, {
      payment_details: {
        upi_id:         user.upi_id,
        account_number: maskAccount(user.account_number),
        ifsc:           maskIfsc(user.ifsc),
      }
    });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/wallet/payment-details ─────────────────────────────────────────
router.post('/payment-details', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const upiId  = (req.body.upi_id         || '').trim().slice(0, 100) || null;
    const accNo  = (req.body.account_number  || '').trim().replace(/\s/g, '').slice(0, 20) || null;
    const ifsc   = (req.body.ifsc            || '').trim().toUpperCase().slice(0, 11) || null;

    if (upiId  && !/^[\w.\-+]+@[\w]+$/.test(upiId))    return fail(res, 'Invalid UPI ID format.');
    if (ifsc   && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return fail(res, 'Invalid IFSC code.');
    if (accNo  && !/^\d{9,18}$/.test(accNo))             return fail(res, 'Invalid account number. Must be 9–18 digits.');

    await User.findByIdAndUpdate(userId, { upi_id: upiId, account_number: accNo, ifsc });
    return ok(res, { message: 'Payment details updated successfully.' });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

module.exports = router;
