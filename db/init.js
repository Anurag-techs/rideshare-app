/**
 * db/init.js — SQLite database initialization
 * Uses sql.js (in-memory + file persistence) for zero-install SQLite.
 * Production: swap for pg (PostgreSQL) using DATABASE_URL from .env
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Always resolve DB path relative to this file's directory (not CWD)
// This prevents DB reset when the server is started from a different directory
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'database.sqlite');
console.log('[DB] Database path:', dbPath);
let db = null;
let inTransaction = false;

async function initialize() {
  const SQL = await initSqlJs();

  // Load existing database file, or create fresh
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // ── Users ──────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      email            TEXT    UNIQUE NOT NULL,
      phone            TEXT,
      password_hash    TEXT    NOT NULL,
      profile_photo    TEXT    DEFAULT NULL,
      avg_rating       REAL    DEFAULT 0,
      total_ratings    INTEGER DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Cars ───────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS cars (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      model         TEXT    NOT NULL,
      total_seats   INTEGER NOT NULL DEFAULT 4,
      car_image     TEXT    DEFAULT NULL,
      license_plate TEXT,
      color         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Rides ──────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS rides (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id       INTEGER NOT NULL,
      car_id          INTEGER,
      car_name        TEXT,
      from_location   TEXT    NOT NULL,
      to_location     TEXT    NOT NULL,
      from_lat        REAL,
      from_lng        REAL,
      to_lat          REAL,
      to_lng          REAL,
      departure_time  DATETIME NOT NULL,
      total_seats     INTEGER NOT NULL DEFAULT 4,
      available_seats INTEGER NOT NULL DEFAULT 4,
      price_per_seat  REAL    DEFAULT 0,
      notes           TEXT,
      status          TEXT    DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (car_id)    REFERENCES cars(id)  ON DELETE SET NULL
    )
  `);

  // ── Bookings ───────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id             INTEGER NOT NULL,
      passenger_id        INTEGER NOT NULL,
      seats_booked        INTEGER NOT NULL DEFAULT 1,
      total_amount        REAL    DEFAULT 0,
      commission_amount   REAL    DEFAULT 0,
      driver_earning      REAL    DEFAULT 0,
      payment_status      TEXT    DEFAULT 'pending'
                          CHECK(payment_status IN ('pending','paid','failed','refunded','free')),
      razorpay_order_id   TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature  TEXT,
      status              TEXT    DEFAULT 'confirmed'
                          CHECK(status IN ('pending','confirmed','cancelled','completed')),
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id)       REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (passenger_id)  REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Payments (detailed payment records) ────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id          INTEGER NOT NULL,
      user_id             INTEGER NOT NULL,
      razorpay_order_id   TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature  TEXT,
      amount              REAL    NOT NULL,
      commission_amount   REAL    DEFAULT 0,
      driver_earning      REAL    DEFAULT 0,
      currency            TEXT    DEFAULT 'INR',
      status              TEXT    DEFAULT 'pending'
                          CHECK(status IN ('pending','paid','failed','refunded')),
      method              TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    )
  `);

  // ── Ratings ────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id      INTEGER NOT NULL,
      from_user_id INTEGER NOT NULL,
      to_user_id   INTEGER NOT NULL,
      rating       INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment      TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id)      REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Safe migrations (add new columns to existing tables without breaking) ──
  _safeAddColumns('bookings', [
    ['total_amount',        'REAL    DEFAULT 0'],
    ['commission_amount',   'REAL    DEFAULT 0'],
    ['driver_earning',      'REAL    DEFAULT 0'],
    ['payment_status',      "TEXT    DEFAULT 'pending'"],
    ['razorpay_order_id',   'TEXT'],
    ['razorpay_payment_id', 'TEXT'],
    ['razorpay_signature',  'TEXT'],
    // rename old payment_intent_id → keep for backward compat
    ['payment_intent_id',   'TEXT'],
  ]);

  _safeAddColumns('rides', [
    ['car_name', 'TEXT'],
  ]);

  saveDb();
  console.log('✅ Database initialized successfully');
}

/** Add columns to a table only if they don't already exist */
function _safeAddColumns(table, columns) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const existing = result.length > 0 ? result[0].values.map(r => r[1]) : [];
  for (const [col, def] of columns) {
    if (!existing.includes(col)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
}

/** Persist in-memory DB to disk */
function saveDb() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

/** Return raw sql.js db instance (rarely needed directly) */
function getDb() { return db; }

/**
 * Thin ORM-like wrapper — returns an object with .run / .get / .all
 * matching the better-sqlite3 API so route files stay clean.
 */
function prepare(sql) {
  function sanitize(params) {
    return params.map(p => {
      if (p === undefined || (typeof p === 'number' && isNaN(p))) return null;
      return p;
    });
  }

  return {
    run(...params) {
      const clean = sanitize(params);
      db.run(sql, clean);
      const lastId  = db.exec('SELECT last_insert_rowid() as id');
      const changes = db.exec('SELECT changes() as c');
      if (!inTransaction) saveDb();
      return {
        lastInsertRowid: lastId.length  > 0 ? lastId[0].values[0][0]  : 0,
        changes:         changes.length > 0 ? changes[0].values[0][0] : 0,
      };
    },
    get(...params) {
      const clean = sanitize(params);
      try {
        const stmt = db.prepare(sql);
        if (clean.length > 0) stmt.bind(clean);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      } catch (err) {
        console.error('DB get error:', err.message, '|SQL:', sql);
        return undefined;
      }
    },
    all(...params) {
      const clean = sanitize(params);
      const results = [];
      try {
        const stmt = db.prepare(sql);
        if (clean.length > 0) stmt.bind(clean);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row  = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
      } catch (err) {
        console.error('DB all error:', err.message, '|SQL:', sql);
      }
      return results;
    },
  };
}

/** Wrap multiple DB operations in a single transaction */
function transaction(fn) {
  return (...args) => {
    inTransaction = true;
    db.run('BEGIN TRANSACTION');
    try {
      const result = fn(...args);
      db.run('COMMIT');
      inTransaction = false;
      saveDb();
      return result;
    } catch (err) {
      try { db.run('ROLLBACK'); } catch (_) { /* ignore */ }
      inTransaction = false;
      throw err;
    }
  };
}

module.exports = { initialize, getDb, prepare, transaction, saveDb };
