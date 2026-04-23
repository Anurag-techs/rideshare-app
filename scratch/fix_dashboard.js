const fs = require('fs');
const path = require('path');

function fixMojibake(file) {
  const p = path.resolve(__dirname, file);
  if (!fs.existsSync(p)) return;
  let text = fs.readFileSync(p, 'utf8');
  text = text.replace(/â­ /g, '⭐ '); // star with space
  text = text.replace(/â­/g, '⭐'); // star without space
  text = text.replace(/ðŸ• /g, '🕐 ');
  text = text.replace(/ðŸ•/g, '🕐');
  text = text.replace(/ðŸ§‘â€ âœˆï¸ /g, '🧑‍✈️ ');
  text = text.replace(/ðŸ§‘â€ âœˆï¸/g, '🧑‍✈️');
  text = text.replace(/ðŸ ¦/g, '🏦');
  text = text.replace(/ðŸ—‘ï¸ /g, '🗑️');
  text = text.replace(/ðŸ—‘ï¸/g, '🗑️');
  
  if (file.includes('dashboard.js')) {
    text = text.replace(/c\.color\?'• '\+c\.color:''/g, "c.color?'• '+Rides.esc(c.color):''");
    text = text.replace(/c\.license_plate\?'• '\+c\.license_plate:''/g, "c.license_plate?'• '+Rides.esc(c.license_plate):''");
  }
  
  fs.writeFileSync(p, text, 'utf8');
}

fixMojibake('../../public/js/dashboard.js');
console.log('Fixed dashboard.js');
