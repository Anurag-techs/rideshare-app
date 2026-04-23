const fs = require('fs');

const files = ['public/js/rides.js', 'public/js/dashboard.js', 'public/js/growth.js'];

// We will add helper utility classes to styles.css
let css = fs.readFileSync('public/css/styles.css', 'utf8');
if (!css.includes('.text-success')) {
  css += `
/* === UTILITIES === */
.text-success { color: var(--success); }
.text-warning { color: var(--warning); }
.text-error { color: var(--error); }
.text-muted { color: var(--text-muted); }
.text-secondary { color: var(--text-secondary); }
.bg-primary { background: var(--primary); }
.bg-card { background: var(--bg-card); }
`;
  fs.writeFileSync('public/css/styles.css', css);
}

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8');

  // We have a lot of inline styles with CSS vars.
  // The simplest is to replace specific style strings with classes.
  
  content = content.replace(/style="color:var\(--success\);?"/g, 'class="text-success"');
  content = content.replace(/style="color:var\(--warning\);?"/g, 'class="text-warning"');
  content = content.replace(/style="color:var\(--error\);?"/g, 'class="text-error"');
  content = content.replace(/style="color:var\(--text-muted\);?"/g, 'class="text-muted"');
  content = content.replace(/style="color:var\(--text-secondary\);?"/g, 'class="text-secondary"');
  
  content = content.replace(/style='color:var\(--success\);?'/g, "class='text-success'");
  content = content.replace(/style='color:var\(--warning\);?'/g, "class='text-warning'");
  content = content.replace(/style='color:var\(--error\);?'/g, "class='text-error'");

  // Replace compound inline styles by just removing them if they are simple,
  // but it's safer to just replace the color portions.
  content = content.replace(/style="([^"]*)color:\s*var\(--success\);?([^"]*)"/g, 'class="text-success" style="$1$2"');
  content = content.replace(/style="([^"]*)color:\s*var\(--warning\);?([^"]*)"/g, 'class="text-warning" style="$1$2"');
  content = content.replace(/style="([^"]*)color:\s*var\(--text-muted\);?([^"]*)"/g, 'class="text-muted" style="$1$2"');
  content = content.replace(/style="([^"]*)color:\s*var\(--text-secondary\);?([^"]*)"/g, 'class="text-secondary" style="$1$2"');
  content = content.replace(/style="([^"]*)color:\s*var\(--error\);?([^"]*)"/g, 'class="text-error" style="$1$2"');

  // Fix empty styles
  content = content.replace(/style="\s*"/g, '');
  content = content.replace(/style='\s*'/g, '');

  fs.writeFileSync(f, content);
}
