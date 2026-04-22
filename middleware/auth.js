const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

/**
 * Required authentication middleware.
 * Verifies JWT token and attaches user info to req.user.
 * Handles: missing header, malformed token, expired token.
 */
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.warn('[AUTH] No Authorization header on', req.method, req.path);
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  // Support both 'Bearer <token>' and accidental whitespace variants
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    console.warn('[AUTH] Malformed Authorization header:', authHeader);
    return res.status(401).json({ error: 'Invalid Authorization header format.' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log('[AUTH] Token verified — user id:', decoded.id, 'email:', decoded.email);
    next();
  } catch (err) {
    console.warn('[AUTH] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

/**
 * Optional authentication middleware.
 * Attaches user info if token is valid, but doesn't block the request.
 */
function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      const token = parts[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
      } catch (err) {
        // Token invalid — continue without user (optional auth)
      }
    }
  }

  next();
}

/**
 * Generate a JWT token for a user.
 * Payload: { id, email, name }
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authRequired, authOptional, generateToken };
