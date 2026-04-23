/**
 * server.js — Main Express application entry point
 * Production-ready: MongoDB/Mongoose, rate limiting, structured routes, error handling, UTF-8
 */
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

const { connectDB }  = require('./db/mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads dir exists ─────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
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

// ── UTF-8 for API JSON responses ──────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts — please wait 15 minutes and try again.' },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many signup attempts from this IP — please try again in an hour.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login',  loginLimiter);
app.use('/api/auth/signup', signupLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/cars',      require('./routes/cars'));
app.use('/api/rides',     require('./routes/rides'));
app.use('/api/bookings',  require('./routes/bookings'));
app.use('/api/ratings',   require('./routes/ratings'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/wallet',    require('./routes/wallet'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/earnings',  require('./routes/earnings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/growth',    require('./routes/growth'));

// ── Config endpoint ───────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY   || '',
    razorpayKeyId:    process.env.RAZORPAY_KEY_ID       || '',
    commissionRate:   parseFloat(process.env.COMMISSION_RATE) || 0.12,
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start Server ──────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      const _rzpId  = (process.env.RAZORPAY_KEY_ID     || '').trim();
      const _rzpSec = (process.env.RAZORPAY_KEY_SECRET || '').trim();
      const _rzpOk  = _rzpId.startsWith('rzp_') && _rzpSec.length > 10;
      console.log(`\n🚗 RideShare Platform running at http://localhost:${PORT}`);
      console.log(`   🍃 Database: MongoDB (Mongoose)`);
      console.log(`   💳 Razorpay: ${_rzpOk
        ? `✅ ${_rzpId.startsWith('rzp_live') ? 'LIVE' : 'TEST'} (key: ${_rzpId.slice(0, 12)}...)`
        : `❌ NOT CONFIGURED`}`);
      console.log(`   🔒 Rate limiting: enabled\n`);

      // ── Retention Cron (runs every hour) ─────────────────────────────────────
      setInterval(async () => {
        try {
          const Notification = require('./models/Notification');
          const User         = require('./models/User');

          const oneDayAgo = new Date(Date.now() - 24 * 3600000);
          const recentNotifUserIds = await Notification.distinct('user_id', { created_at: { $gte: oneDayAgo } });

          const usersToNotify = await User.find({ _id: { $nin: recentNotifUserIds } }).select('_id').limit(20);

          for (const u of usersToNotify) {
            await Notification.create({
              user_id: u._id,
              title:   'New rides near you!',
              message: 'Drivers have posted new rides on your frequent routes. Check them out before seats run out.',
              type:    'info',
            });
          }

          if (usersToNotify.length > 0) {
            console.log(`[CRON] Sent retention notification to ${usersToNotify.length} inactive users.`);
          }
        } catch (err) {
          console.error('[CRON] Retention error:', err.message);
        }
      }, 60 * 60 * 1000);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
