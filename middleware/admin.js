/**
 * middleware/admin.js — Admin-only route guard
 *
 * Must be used AFTER authRequired (relies on req.user being populated).
 * Re-fetches is_admin from the DB on every request so revocations
 * take effect immediately without needing a token refresh.
 */
const { prepare } = require('../db/init');

function adminOnly(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const user = prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);

  if (!user || !user.is_admin) {
    console.warn(`[ADMIN] Unauthorized admin access attempt — userId:${req.user.id} path:${req.path}`);
    return res.status(403).json({ error: 'Admin access required.' });
  }

  next();
}

module.exports = { adminOnly };
