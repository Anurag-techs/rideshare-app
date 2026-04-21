const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(process.env.DB_PATH || './database.sqlite');
let db = null;
let inTransaction = false;

async function initialize() {
  const SQL = await initSqlJs();

  // Load existing database if it exists
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      profile_photo TEXT DEFAULT NULL,
      avg_rating REAL DEFAULT 0,
      total_ratings INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      total_seats INTEGER NOT NULL DEFAULT 4,
      car_image TEXT DEFAULT NULL,
      license_plate TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      car_id INTEGER,
      from_location TEXT NOT NULL,
      to_location TEXT NOT NULL,
      from_lat REAL,
      from_lng REAL,
      to_lat REAL,
      to_lng REAL,
      departure_time DATETIME NOT NULL,
      total_seats INTEGER NOT NULL DEFAULT 4,
      available_seats INTEGER NOT NULL DEFAULT 4,
      price_per_seat REAL DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      passenger_id INTEGER NOT NULL,
      seats_booked INTEGER NOT NULL DEFAULT 1,
      total_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'paid', 'refunded')),
      payment_intent_id TEXT,
      status TEXT DEFAULT 'confirmed' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (passenger_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Safe migration: add payment columns if they don't already exist
  const bookingCols = db.exec("PRAGMA table_info(bookings)");
  const colNames = bookingCols.length > 0 ? bookingCols[0].values.map(r => r[1]) : [];
  if (!colNames.includes('total_amount')) db.run('ALTER TABLE bookings ADD COLUMN total_amount REAL DEFAULT 0');
  if (!colNames.includes('payment_status')) db.run("ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
  if (!colNames.includes('payment_intent_id')) db.run('ALTER TABLE bookings ADD COLUMN payment_intent_id TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id INTEGER NOT NULL,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  saveDb();
  console.log('✅ Database initialized successfully');
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Helper functions to mimic better-sqlite3 API
function getDb() { return db; }

function prepare(sql) {
  // Sanitize params: convert undefined/NaN to null, ensure proper types
  function sanitize(params) {
    return params.map(p => {
      if (p === undefined || p === '' || (typeof p === 'number' && isNaN(p))) return null;
      return p;
    });
  }

  return {
    run(...params) {
      const clean = sanitize(params);
      db.run(sql, clean);
      const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
      const changesResult = db.exec('SELECT changes() as c');
      // Only persist immediately for non-transactional calls
      if (!inTransaction) saveDb();
      return {
        lastInsertRowid: lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : 0,
        changes: changesResult.length > 0 ? changesResult[0].values[0][0] : 0
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
        console.error('DB get error:', err.message, 'SQL:', sql, 'Params:', clean);
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
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
      } catch (err) {
        console.error('DB all error:', err.message, 'SQL:', sql, 'Params:', clean);
      }
      return results;
    }
  };
}

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
      try { db.run('ROLLBACK'); } catch (_) { /* ignore rollback error */ }
      inTransaction = false;
      throw err;
    }
  };
}

module.exports = { initialize, getDb, prepare, transaction, saveDb };
