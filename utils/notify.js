/**
 * utils/notify.js — Shared notification helper (MongoDB)
 */
const Notification = require('../models/Notification');

function cleanInput(text) {
  if (!text) return text;
  return String(text).replace(/[^\x00-\x7F]/g, '');
}

/**
 * @param {ObjectId|string} userId
 * @param {string} title
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {string|null} refType  e.g. 'booking', 'withdrawal'
 * @param {ObjectId|string|null} refId
 */
async function notify(userId, title, message, type = 'info', refType = null, refId = null) {
  try {
    await Notification.create({
      user_id:  userId,
      title:    cleanInput(title),
      message:  cleanInput(message),
      type,
      ref_type: refType,
      ref_id:   refId || null,
    });
  } catch (err) {
    // Never let notification failure break a transaction
    console.error('[notify] Failed to create notification:', err.message);
  }
}

module.exports = { notify };
