/**
 * server.js — Main Express application entry point
 * Production-ready: rate limiting, structured routes, error handling
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// General API limit: 200 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});

// Stricter limit for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts — try again in 15 minutes.' },
});

// Stricter limit for AI endpoints (OpenAI costs money)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'AI rate limit exceeded — please wait a moment.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login',  authLimiter);
app.use('/api/auth/signup', authLimiter);
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
    googleMapsApiKey:   process.env.GOOGLE_MAPS_API_KEY   || '',
    razorpayKeyId:      process.env.RAZORPAY_KEY_ID       || '',
    commissionRate:     parseFloat(process.env.COMMISSION_RATE) || 0.10,
    aiEnabled:          !!(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('YOUR_')),
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

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
      console.log(`\n🚗 RideShare AI Platform running at http://localhost:${PORT}`);
      console.log(`   💳 Payments: Razorpay ${process.env.RAZORPAY_KEY_ID?.includes('YOUR_') ? '(mock mode)' : '✅'}`);
      console.log(`   🤖 AI:       OpenAI   ${process.env.OPENAI_API_KEY?.includes('YOUR_')  ? '(mock mode)' : '✅'}`);
      console.log(`   🔒 Rate limiting: enabled\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
