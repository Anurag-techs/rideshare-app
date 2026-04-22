/**
 * scripts/make-admin.js
 * One-time script to grant admin access to a user by email.
 *
 * Usage (from project root):
 *   node scripts/make-admin.js your@email.com
 */
require('dotenv').config();
const { initialize, prepare } = require('../db/init');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/make-admin.js <email>');
  process.exit(1);
}

(async () => {
  await initialize();

  const user = prepare('SELECT id, name, email, is_admin FROM users WHERE email = ?').get(email);
  if (!user) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }
  if (user.is_admin) {
    console.log(`✅ ${user.name} (${email}) is already an admin.`);
    process.exit(0);
  }

  prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  console.log(`✅ Admin access granted to ${user.name} (${email}) — id:${user.id}`);
  process.exit(0);
})();
