const fs = require('fs');

const files = ['public/js/rides.js', 'public/js/dashboard.js', 'public/js/growth.js', 'public/admin.html', 'public/index.html'];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  
  // Find all inline style attributes
  const regex = /style="([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const styleStr = match[1];
    // Check if it has a hardcoded color
    if (/color:\s*(#|rgba|rgb|[a-zA-Z]+(?!-))/.test(styleStr) && !styleStr.includes('var(')) {
      console.log(`[HARDCODED] ${file}: ${styleStr}`);
    } else if (/background:\s*(#|rgba|rgb|[a-zA-Z]+(?!-))/.test(styleStr) && !styleStr.includes('var(')) {
      console.log(`[HARDCODED BG] ${file}: ${styleStr}`);
    }
  }
}
