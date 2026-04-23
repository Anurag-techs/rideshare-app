/**
 * db/mongoose.js — MongoDB connection via Mongoose
 */
const mongoose = require('mongoose');

async function connectDB(retries = 5) {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }

  // Set up connection event listeners once
  if (mongoose.connection.listeners('connected').length === 0) {
    mongoose.connection.on('connected', () => console.log('✅ MongoDB Connected Successfully'));
    mongoose.connection.on('error', (err) => console.error('❌ MongoDB Connection Error:', err.message));
    mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB Disconnected. Attempting to reconnect...'));
  }

  while (retries > 0) {
    try {
      console.log(`⏳ Attempting to connect to MongoDB... (${retries} attempts left)`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000, // Fail quickly so we can retry
        socketTimeoutMS: 45000,
      });
      return; // Success, exit loop
    } catch (err) {
      console.error(`❌ MongoDB Connection Failed: ${err.message}`);
      retries -= 1;
      if (retries === 0) {
        console.error('🚨 Could not connect to MongoDB after multiple attempts. Exiting...');
        process.exit(1);
      }
      console.log('⏳ Waiting 5 seconds before retrying...');
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

module.exports = { connectDB };
