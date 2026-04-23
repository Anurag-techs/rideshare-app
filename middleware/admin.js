/**
 * middleware/admin.js — Admin-only route guard (MongoDB)
 *
 * Must be used AFTER authRequired (relies on req.user being populated).
 * Re-fetches is_admin from the DB on every request so revocations
 * take effect immediately without needing a token refresh.
 */
const User = require('../models/User');

async function adminOnly(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const user = await User.findById(req.user.id).select('is_admin');
    if (!user || !user.is_admin) {
      console.warn(`[ADMIN] Unauthorized admin access attempt — userId:${req.user.id} path:${req.path}`);
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  } catch (err) {
    console.error('[ADMIN] DB error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
}

module.exports = { adminOnly };
