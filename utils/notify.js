/**
 * utils/notify.js — Shared notification helper
 * Call this from any route to push a notification to a user.
 * Always call INSIDE or OUTSIDE a transaction — it uses prepare() directly.
 */
const { prepare } = require('../db/init');

/**
 * @param {number} userId
 * @param {string} title
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {string|null} refType  e.g. 'booking', 'withdrawal'
 * @param {number|null} refId
 */
function notify(userId, title, message, type = 'info', refType = null, refId = null) {
  try {
    prepare(
      `INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, title, message, type, refType, refId);
  } catch (err) {
    // Never let notification failure break a transaction
    console.error('[notify] Failed to create notification:', err.message);
  }
}

module.exports = { notify };
