const fs = require('fs');
let css = fs.readFileSync('public/css/styles.css', 'utf8');

css = css.replace(/:root\s*\{[^}]+\}/, '');
css = css.replace(/\[data-theme="dark"\]\s*\{[^}]+\}/, '');

const matches = css.match(/(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b|rgba\([^)]+\))/g);
if (matches) {
  console.log(Array.from(new Set(matches)));
} else {
  console.log('No hardcoded colors found');
}
