/**
 * server.js — Main Express application entry point
 * Production-ready: rate limiting, structured routes, error handling, UTF-8
 */
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

const { initialize } = require('./db/init');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads dir exists ─────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

// ── Static files — BEFORE any route or charset middleware ─────────────────────
// Express automatically sets correct Content-Type per file extension:
//   .html → text/html; charset=UTF-8
//   .css  → text/css; charset=UTF-8
//   .js   → application/javascript; charset=UTF-8
// DO NOT put a global Content-Type middleware before this — it breaks rendering.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Force UTF-8 charset on all text assets to prevent ₹ → â‚¹ mojibake
    const ext = path.extname(filePath).toLowerCase();
    const textTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map':  'application/json; charset=utf-8',
    };
    if (textTypes[ext]) res.setHeader('Content-Type', textTypes[ext]);
  }
}));
app.use('/uploads', express.static(uploadsDir));

// ── UTF-8 for API JSON responses ONLY ────────────────────────────────────────
// Scoped to /api/* so it never touches HTML/CSS/JS file serving
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// General API: 300 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});

// Login: 50 per 15 min (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — please wait 15 minutes and try again.' },
});

// Signup: 20 per hour, only failed attempts counted
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many signup attempts from this IP — please try again in an hour.' },
});

// AI endpoints: 30 per minute (OpenAI costs money)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit exceeded — please wait a moment.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login',  loginLimiter);
app.use('/api/auth/signup', signupLimiter);
app.use('/api/ai/',         aiLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/cars',     require('./routes/cars'));
app.use('/api/rides',    require('./routes/rides'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/ratings',  require('./routes/ratings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/ai',       require('./routes/ai'));

// ── Config endpoint — expose safe public keys to frontend ─────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY   || '',
    razorpayKeyId:    process.env.RAZORPAY_KEY_ID       || '',
    commissionRate:   parseFloat(process.env.COMMISSION_RATE) || 0.10,
    aiEnabled:        !!(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('YOUR_')),
  });
});

// ── SPA fallback — MUST be last ───────────────────────────────────────────────
// All non-API, non-file routes return index.html so the SPA router handles them
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start Server ──────────────────────────────────────────────────────────────
async function start() {
  try {
    await initialize();
    app.listen(PORT, () => {
      const _rzpId  = (process.env.RAZORPAY_KEY_ID     || '').trim();
      const _rzpSec = (process.env.RAZORPAY_KEY_SECRET || '').trim();
      const _rzpOk  = _rzpId.startsWith('rzp_') && _rzpSec.length > 10;
      console.log(`\n🚗 RideShare AI Platform running at http://localhost:${PORT}`);
      console.log(`   💳 Razorpay: ${_rzpOk
        ? `✅ ${_rzpId.startsWith('rzp_live') ? 'LIVE' : 'TEST'} (key: ${_rzpId.slice(0, 12)}...)`
        : `❌ NOT CONFIGURED — key="${_rzpId.slice(0, 8) || '(empty)'}" secret_len=${_rzpSec.length}`}`);
      console.log(`   🤖 AI:       OpenAI   ${process.env.OPENAI_API_KEY?.includes('YOUR_') ? '(mock mode)' : '✅'}`);
      console.log(`   🔒 Rate limiting: enabled\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
