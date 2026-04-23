/**
 * routes/wallet.js — Driver Wallet System (Production-Final)
 *
 * Endpoints:
 *   GET  /api/wallet/balance         → Current balance
 *   GET  /api/wallet/transactions    → Full ledger (last 100)
 *   GET  /api/wallet/withdrawals     → Withdrawal history
 *   POST /api/wallet/withdraw        → Request withdrawal (atomic)
 *   GET  /api/wallet/payment-details → Saved UPI/bank details (masked)
 *   POST /api/wallet/payment-details → Save/update UPI or bank details
 *
 * Production guarantees:
 *   • Min ₹50 per withdrawal
 *   • One pending withdrawal at a time
 *   • 24-hour cooldown between requests
 *   • Balance check + deduct in one atomic transaction
 *   • Every movement logged to wallet_transactions
 *   • Bank account shown masked in GET response
 */
const express = require('express');
const { prepare, transaction } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { notify }       = require('../utils/notify');
const router = express.Router();

const MIN_WITHDRAWAL  = 50;    // ₹50 minimum
const COOLDOWN_HOURS  = 24;    // hours between requests
const WITHDRAWAL_FEE  = parseFloat(process.env.WITHDRAWAL_FEE) || 10; // ₹10 platform fee

// ── Helpers ───────────────────────────────────────────────────────────────────
function logTx(userId, type, amount, reason, refId = null) {
  prepare(
    `INSERT INTO wallet_transactions (user_id, type, amount, reason, ref_id) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, type, parseFloat(amount.toFixed(2)), reason, refId);
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

function maskAccount(accNo) {
  if (!accNo || accNo.length < 4) return accNo;
  return '•'.repeat(accNo.length - 4) + accNo.slice(-4);
}

function maskIfsc(ifsc) {
  if (!ifsc || ifsc.length < 4) return ifsc;
  return ifsc.slice(0, 4) + '•'.repeat(ifsc.length - 4);
}

// ── GET /api/wallet/balance ───────────────────────────────────────────────────
router.get('/balance', authRequired, (req, res) => {
  try {
    const user = prepare('SELECT wallet_balance FROM users WHERE id = ?').get(req.user.id);
    if (!user) return fail(res, 'User not found.', 404);
    return ok(res, { balance: parseFloat((user.wallet_balance || 0).toFixed(2)) });
  } catch (err) {
    console.error('[WALLET /balance]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/wallet/transactions ──────────────────────────────────────────────
router.get('/transactions', authRequired, (req, res) => {
  try {
    const txns = prepare(
      `SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    ).all(req.user.id);
    return ok(res, { transactions: txns });
  } catch (err) {
    console.error('[WALLET /transactions]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/wallet/withdrawals ───────────────────────────────────────────────
router.get('/withdrawals', authRequired, (req, res) => {
  try {
    const withdrawals = prepare(
      `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`
    ).all(req.user.id);
    return ok(res, { withdrawals });
  } catch (err) {
    console.error('[WALLET /withdrawals]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/wallet/withdraw ─────────────────────────────────────────────────
router.post('/withdraw', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);

    // ── Input validation ──────────────────────────────────────────────────────
    const rawAmount = req.body.amount;
    if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
      return fail(res, 'Amount is required.');
    }
    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || !isFinite(amount)) return fail(res, 'Amount must be a valid number.');
    if (amount <= 0)                          return fail(res, 'Amount must be greater than zero.');
    if (amount < MIN_WITHDRAWAL)              return fail(res, `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL}.`);

    const upiId = (req.body.upi_id || '').trim().slice(0, 100) || null;
    const note  = (req.body.note  || '').trim().slice(0, 255)  || null;

    // ── One-at-a-time: block if pending withdrawal exists ─────────────────────
    const pending = prepare(
      `SELECT id FROM withdrawals WHERE user_id = ? AND status = 'pending'`
    ).get(userId);
    if (pending) {
      return fail(res,
        'You already have a pending withdrawal. Wait for it to be processed before requesting another.',
        409
      );
    }

    // ── 24-hour cooldown: check last completed/rejected withdrawal ────────────
    const lastWd = prepare(
      `SELECT created_at FROM withdrawals WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(userId);
    if (lastWd) {
      const hoursSinceLast = (Date.now() - new Date(lastWd.created_at).getTime()) / 3600000;
      if (hoursSinceLast < COOLDOWN_HOURS) {
        const hoursLeft = Math.ceil(COOLDOWN_HOURS - hoursSinceLast);
        return fail(res,
          `Please wait ${hoursLeft} more hour${hoursLeft !== 1 ? 's' : ''} before requesting another withdrawal.`,
          429
        );
      }
    }

    // ── Atomic: balance check → deduct → fee → create record → log ────────────
    const doWithdraw = transaction(() => {
      const user = prepare('SELECT wallet_balance FROM users WHERE id = ?').get(userId);
      if (!user) throw Object.assign(new Error('User not found.'), { statusCode: 404 });

      const balance   = parseFloat((user.wallet_balance || 0).toFixed(2));
      const rounded   = parseFloat(amount.toFixed(2));
      const fee       = parseFloat(Math.min(WITHDRAWAL_FEE, rounded * 0.5).toFixed(2));
      const netPayout = parseFloat((rounded - fee).toFixed(2));

      if (balance < rounded) {
        throw Object.assign(
          new Error(`Insufficient balance. Available: ₹${balance.toFixed(2)}`),
          { statusCode: 400 }
        );
      }

      prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?')
        .run(rounded, userId);

      const result = prepare(
        `INSERT INTO withdrawals (user_id, amount, status, upi_id, note) VALUES (?, ?, 'pending', ?, ?)`
      ).run(userId, rounded, upiId, note);

      const wdId = result.lastInsertRowid;
      logTx(userId, 'debit', rounded, `withdrawal_request`, wdId);

      // Platform earns the withdrawal fee
      if (fee > 0) {
        prepare(
          `INSERT INTO platform_earnings (booking_id, ride_id, driver_id, amount, type) VALUES (0, 0, ?, ?, 'withdrawal_fee')`
        ).run(userId, fee);
      }

      return { wdId, fee, netPayout };
    });

    const { wdId, fee, netPayout } = doWithdraw();
    console.log(`[WALLET] Withdrawal #${wdId} | userId:${userId} | gross:₹${amount.toFixed(2)} | fee:₹${fee} | net:₹${netPayout}`);

    notify(
      userId,
      'Withdrawal Requested',
      `₹${amount.toFixed(2)} withdrawal submitted (fee: ₹${fee}). Net payout: ₹${netPayout}. Processing 2–3 business days.`,
      'info', 'withdrawal', wdId
    );

    const withdrawal  = prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
    const updatedUser = prepare('SELECT wallet_balance FROM users WHERE id = ?').get(userId);

    return ok(res, {
      withdrawal,
      fee,
      net_payout: netPayout,
      new_balance: parseFloat((updatedUser?.wallet_balance || 0).toFixed(2)),
      message: `₹${amount.toFixed(2)} withdrawal submitted (platform fee: ₹${fee}). Net payout: ₹${netPayout}.`,
    }, 201);

  } catch (err) {
    console.error('[WALLET /withdraw]', err.message);
    return fail(res, err.message || 'Failed to process withdrawal.', err.statusCode || 500);
  }
});

// ── GET /api/wallet/payment-details ──────────────────────────────────────────
// Returns masked bank details for privacy
router.get('/payment-details', authRequired, (req, res) => {
  try {
    const user = prepare(
      'SELECT upi_id, account_number, ifsc FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return fail(res, 'User not found.', 404);
    return ok(res, {
      payment_details: {
        upi_id:         user.upi_id,
        account_number: maskAccount(user.account_number),
        ifsc:           maskIfsc(user.ifsc),
      }
    });
  } catch (err) {
    console.error('[WALLET /payment-details GET]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/wallet/payment-details ─────────────────────────────────────────
router.post('/payment-details', authRequired, (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10);
    const upiId  = (req.body.upi_id         || '').trim().slice(0, 100) || null;
    const accNo  = (req.body.account_number  || '').trim().replace(/\s/g, '').slice(0, 20) || null;
    const ifsc   = (req.body.ifsc            || '').trim().toUpperCase().slice(0, 11) || null;

    if (upiId  && !/^[\w.\-+]+@[\w]+$/.test(upiId))    return fail(res, 'Invalid UPI ID format. Expected: name@bank');
    if (ifsc   && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return fail(res, 'Invalid IFSC code. Expected: ABCD0123456');
    if (accNo  && !/^\d{9,18}$/.test(accNo))             return fail(res, 'Invalid account number. Must be 9–18 digits.');

    prepare('UPDATE users SET upi_id = ?, account_number = ?, ifsc = ? WHERE id = ?')
      .run(upiId, accNo, ifsc, userId);

    return ok(res, { message: 'Payment details updated successfully.' });
  } catch (err) {
    console.error('[WALLET /payment-details POST]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

module.exports = router;
