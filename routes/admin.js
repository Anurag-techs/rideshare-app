/**
 * routes/admin.js — Admin Panel API (Production-Final)
 *
 * All routes: authRequired + adminOnly via router.use()
 *
 * Endpoints:
 *   GET  /api/admin/withdrawals              → All withdrawals (filter: ?status=)
 *   POST /api/admin/withdrawals/:id/approve  → Atomic: mark paid + require payment_ref
 *   POST /api/admin/withdrawals/:id/reject   → Atomic: reject + refund + log
 *   GET  /api/admin/users                    → All users (masked bank details)
 *   GET  /api/admin/transactions             → Full wallet_transactions ledger
 *   POST /api/admin/users/:id/make-admin     → Grant admin role
 *
 * Production guarantees:
 *   • Approve requires payment_method + payment_ref (UTR/transaction ID)
 *   • Approve/reject re-fetch inside transaction (prevents double execution)
 *   • Reject atomically refunds + logs credit
 *   • Bank account/IFSC masked in user list
 *   • Consistent { success, error } response format
 */
const express = require('express');
const { prepare, transaction } = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { adminOnly }    = require('../middleware/admin');
const { notify }       = require('../utils/notify');
const router = express.Router();

router.use(authRequired, adminOnly);

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

// ── GET /api/admin/withdrawals ────────────────────────────────────────────────
router.get('/withdrawals', (req, res) => {
  try {
    const { status } = req.query;
    const allowed    = ['pending', 'paid', 'rejected'];
    let sql    = `
      SELECT w.*, u.name AS user_name, u.email AS user_email,
             u.phone AS user_phone, u.upi_id AS user_upi
      FROM   withdrawals w
      JOIN   users u ON w.user_id = u.id
    `;
    const params = [];
    if (status && allowed.includes(status)) {
      sql += ' WHERE w.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY w.created_at DESC';

    const withdrawals = prepare(sql).all(...params);
    return ok(res, { withdrawals, count: withdrawals.length });
  } catch (err) {
    console.error('[ADMIN /withdrawals]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/admin/withdrawals/:id/approve ───────────────────────────────────
// Body: { payment_method: 'UPI'|'BANK', payment_ref: 'UTR123...' }
router.post('/withdrawals/:id/approve', (req, res) => {
  try {
    const wdId          = parseInt(req.params.id, 10);
    const paymentMethod = (req.body.payment_method || '').trim().toUpperCase();
    const paymentRef    = (req.body.payment_ref    || '').trim().slice(0, 100);

    if (!wdId || isNaN(wdId))                          return fail(res, 'Invalid withdrawal ID.');
    if (!['UPI', 'BANK', 'IMPS', 'NEFT', 'RTGS'].includes(paymentMethod)) {
      return fail(res, 'payment_method is required. Valid values: UPI, BANK, IMPS, NEFT, RTGS.');
    }
    if (!paymentRef) return fail(res, 'payment_ref (UTR/transaction reference) is required for approval.');

    // Re-fetch inside transaction — prevents double-approval
    const doApprove = transaction(() => {
      const wd = prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
      if (!wd) throw Object.assign(new Error(`Withdrawal #${wdId} not found.`), { statusCode: 404 });
      if (wd.status !== 'pending') {
        throw Object.assign(
          new Error(`Withdrawal is already ${wd.status}. Cannot approve again.`),
          { statusCode: 409 }
        );
      }

      prepare(
        `UPDATE withdrawals
         SET status = 'paid', processed_at = CURRENT_TIMESTAMP,
             payment_method = ?, payment_ref = ?
         WHERE id = ?`
      ).run(paymentMethod, paymentRef, wdId);

      // Increment total_withdrawn on user for lifetime tracking
      prepare('UPDATE users SET total_withdrawn = total_withdrawn + ? WHERE id = ?')
        .run(wd.amount, wd.user_id);

      // Audit log — payout completed (balance already deducted at request time)
      logTx(wd.user_id, 'debit', wd.amount, `payout_approved`, wdId);

      return wd;
    });

    const wd = doApprove();
    console.log(`[ADMIN] ✅ Withdrawal #${wdId} approved | ₹${wd.amount} | ref:${paymentRef} | by adminId:${req.user.id}`);
    notify(wd.user_id, '✅ Withdrawal Approved', `Your withdrawal of ₹${wd.amount.toFixed(2)} has been approved (${paymentMethod} ref: ${paymentRef}).`, 'success', 'withdrawal', wdId);

    const updated = prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
    return ok(res, { withdrawal: updated, message: `Withdrawal #${wdId} approved and marked as paid.` });
  } catch (err) {
    console.error('[ADMIN /approve]', err.message);
    return fail(res, err.message || 'Server error.', err.statusCode || 500);
  }
});

// ── POST /api/admin/withdrawals/:id/reject ────────────────────────────────────
// Body: { note?: string }
router.post('/withdrawals/:id/reject', (req, res) => {
  try {
    const wdId = parseInt(req.params.id, 10);
    const note = (req.body.note || '').trim().slice(0, 255) || null;

    if (!wdId || isNaN(wdId)) return fail(res, 'Invalid withdrawal ID.');

    const doReject = transaction(() => {
      const wd = prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
      if (!wd) throw Object.assign(new Error(`Withdrawal #${wdId} not found.`), { statusCode: 404 });
      if (wd.status !== 'pending') {
        throw Object.assign(
          new Error(`Withdrawal is already ${wd.status}. Cannot reject again.`),
          { statusCode: 409 }
        );
      }

      prepare(
        `UPDATE withdrawals SET status = 'rejected', processed_at = CURRENT_TIMESTAMP, note = ? WHERE id = ?`
      ).run(note, wdId);

      // Atomically refund wallet balance
      prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?')
        .run(wd.amount, wd.user_id);

      // Audit log — refund credit
      logTx(wd.user_id, 'credit', wd.amount, `withdrawal_refund`, wdId);

      return wd;
    });

    const wd = doReject();
    console.log(`[ADMIN] ❌ Withdrawal #${wdId} rejected | ₹${wd.amount} refunded to userId:${wd.user_id} | by adminId:${req.user.id}`);
    notify(wd.user_id, '❌ Withdrawal Rejected', `Your withdrawal of ₹${wd.amount.toFixed(2)} was rejected and refunded to your wallet.`, 'warning', 'withdrawal', wdId);

    const updated = prepare('SELECT * FROM withdrawals WHERE id = ?').get(wdId);
    return ok(res, {
      withdrawal: updated,
      message: `Withdrawal #${wdId} rejected. ₹${wd.amount.toFixed(2)} refunded to user's wallet.`,
    });
  } catch (err) {
    console.error('[ADMIN /reject]', err.message);
    return fail(res, err.message || 'Server error.', err.statusCode || 500);
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Bank details are masked — full values never sent over the wire
router.get('/users', (req, res) => {
  try {
    const raw = prepare(`
      SELECT id, name, email, phone, avg_rating, total_ratings,
             wallet_balance, is_admin, upi_id, account_number, ifsc, created_at
      FROM   users
      ORDER  BY created_at DESC
    `).all();

    const users = raw.map(u => ({
      ...u,
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
router.get('/transactions', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

    let sql    = `SELECT t.*, u.name AS user_name FROM wallet_transactions t JOIN users u ON t.user_id = u.id`;
    const params = [];
    if (userId) { sql += ' WHERE t.user_id = ?'; params.push(userId); }
    sql += ` ORDER BY t.created_at DESC LIMIT ${limit}`;

    const transactions = prepare(sql).all(...params);
    return ok(res, { transactions, count: transactions.length });
  } catch (err) {
    console.error('[ADMIN /transactions]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/admin/users/:id/make-admin ─────────────────────────────────────
router.post('/users/:id/make-admin', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId || isNaN(targetId)) return fail(res, 'Invalid user ID.');

    const user = prepare('SELECT id, name, email, is_admin FROM users WHERE id = ?').get(targetId);
    if (!user)         return fail(res, 'User not found.', 404);
    if (user.is_admin) return fail(res, `${user.name} is already an admin.`, 409);

    prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(targetId);
    console.log(`[ADMIN] User #${targetId} (${user.email}) granted admin by adminId:${req.user.id}`);
    return ok(res, { message: `${user.name} has been granted admin access.` });
  } catch (err) {
    console.error('[ADMIN /make-admin]', err.message);
    return fail(res, 'Server error.', 500);
  }
});

// ── GET /api/admin/config ─────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  try {
    return ok(res, { 
      config: {
        surge_enabled: process.env.SURGE_ENABLED === 'true',
      }
    });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

// ── POST /api/admin/config ────────────────────────────────────────────────────
router.post('/config', (req, res) => {
  try {
    const { key, value } = req.body;
    if (key === 'surge_enabled') process.env.SURGE_ENABLED = value ? 'true' : 'false';
    return ok(res, { message: 'Config updated.', key, value });
  } catch (err) {
    return fail(res, 'Server error.', 500);
  }
});

module.exports = router;
