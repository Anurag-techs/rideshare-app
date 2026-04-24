/**
 * server.js — Main Express application entry point
 * Production-ready: MongoDB/Mongoose, rate limiting, structured routes, error handling, UTF-8
 */
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const mongoose   = require('mongoose');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const morgan     = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
require('dotenv').config();

const { connectDB }  = require('./db/mongoose');
const errorHandler   = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3000;
let server; // For graceful shutdown

// ── Ensure uploads dir exists ─────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Core Middleware (Security & Parsing) ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // Disabled CSP temporarily so frontend scripts/fonts load correctly

// Restrict CORS in production to frontend domain, allow all in development
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? (process.env.FRONTEND_URL || false) : '*',
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json({ strict: false, limit: '10kb' })); // Limit body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(mongoSanitize()); // Prevent NoSQL injection

// Logging Upgrade: JSON format in prod, dev format in local
if (process.env.NODE_ENV === 'production') {
  app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
} else {
  app.use(morgan('dev'));
}

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
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts — please wait 15 minutes and try again.' },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many signup attempts from this IP — please try again in an hour.' },
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many payment requests — please wait 15 minutes.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login',  loginLimiter);
app.use('/api/auth/signup', signupLimiter);
app.use('/api/payments', paymentLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────
// Health Check Endpoint
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbStatus[dbState] || 'unknown',
    memory: process.memoryUsage()
  });
});

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
app.use('/api/messages',  require('./routes/messages'));

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
app.use(errorHandler);

// ── Graceful Shutdown Utility ─────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Closing HTTP server...`);
  if (server) {
    server.close(async () => {
      console.log('✅ HTTP server closed.');
      try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed.');
        process.exit(0);
      } catch (err) {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
}

// ── Global Unhandled Rejection Catcher ────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED REJECTION! Shutting down gracefully...');
  console.error(err.name, err.message);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down immediately...');
  console.error(err.name, err.message);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start Server ──────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectDB();

    server = app.listen(PORT, () => {
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
